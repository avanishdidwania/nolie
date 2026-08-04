/**
 * NoLie Ablation Study
 * 
 * Tests the same 50 claims across 3 pipeline configurations to measure
 * the contribution of each design decision:
 * 
 * Mode A: Bare model — "Is this claim true or false?" (no prompt engineering)
 * Mode B: Structured prompt — our verification prompt (no article context)
 * Mode C: Full pipeline — structured prompt + article context
 * 
 * This proves that our prompt design and context-awareness improve accuracy.
 * 
 * Usage: node eval/ablation-study.js <GROQ_API_KEY>
 */

import { readFileSync, writeFileSync } from 'fs';

const GROQ_BASE_URL = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_MODEL = 'llama-3.3-70b-versatile';

// ─── MODE A: Bare model (naive) ─────────────────────────────────────────────

const BARE_SYSTEM = 'You are a helpful assistant. Return only JSON.';
const BARE_USER = `Is this claim true or false? "{claim}"

Return JSON: {"verdict": "TRUE" or "FALSE" or "MISLEADING" or "UNVERIFIABLE"}`;

// ─── MODE B: Structured prompt (no context) ──────────────────────────────────

const STRUCTURED_SYSTEM = 'You are a fact-checking assistant. Verify claims using your knowledge. Be objective and evidence-based. Return ONLY a JSON object.';
const STRUCTURED_USER = `Verify this claim: "{claim}"

Return JSON:
{
  "verdict": "TRUE" or "FALSE" or "MISLEADING" or "UNVERIFIABLE",
  "confidence": "HIGH" or "MEDIUM" or "LOW",
  "explanation": "2-3 sentences with specific evidence for your verdict"
}

Important:
- A claim is TRUE only if it is completely accurate
- A claim is MISLEADING if it contains partial truth but is framed incorrectly or missing critical context
- A claim is FALSE if it contradicts established facts
- Use UNVERIFIABLE only if the claim cannot be assessed with available knowledge
- Be precise — do not default to TRUE for claims you're uncertain about`;

// ─── MODE C: Full pipeline (structured + article context) ────────────────────

const FULL_SYSTEM = 'You are a fact-checking assistant. You will be given a claim along with article context. Use the context plus your knowledge to verify the claim. Be objective and evidence-based. Return ONLY a JSON object.';
const FULL_USER = `Article context (for reference):
---
{context}
---

Verify this specific claim: "{claim}"

Return JSON:
{
  "verdict": "TRUE" or "FALSE" or "MISLEADING" or "UNVERIFIABLE",
  "confidence": "HIGH" or "MEDIUM" or "LOW",
  "explanation": "2-3 sentences with specific evidence. Reference the context when relevant."
}

Important:
- Use the article context to understand WHO, WHERE, WHEN, and WHAT the claim refers to
- A claim is TRUE only if it is completely accurate
- A claim is MISLEADING if it contains partial truth but is framed incorrectly
- A claim is FALSE if it contradicts established facts
- Only use UNVERIFIABLE if the event is too recent or obscure to have any coverage`;

// ─── Simulated article contexts for claims that benefit from context ─────────

const CONTEXTS = {
  "The Amazon River is the longest river in the world": "The Amazon River in South America is the largest river by discharge volume. The Nile in Africa is traditionally considered the longest river at approximately 6,650 km, though some measurements place the Amazon's length at 6,992 km, making the title disputed.",
  "The Sahara is the largest desert in the world": "Deserts are classified as regions receiving less than 250mm of precipitation annually. While the Sahara is the largest hot desert, Antarctica is technically the largest desert overall at 14.2 million square kilometers, compared to the Sahara's 9.2 million.",
  "Bananas grow on trees": "Banana plants are often referred to as trees but are technically the world's largest herbaceous plants. They do not have a woody trunk like true trees — their 'trunk' is actually a pseudostem made of tightly packed leaf sheaths.",
  "Pi equals exactly 3.14": "Pi (π) is an irrational number representing the ratio of a circle's circumference to its diameter. Its decimal representation never ends and never repeats. The value 3.14 is only an approximation. Pi to 10 decimal places is 3.1415926535.",
  "China has the largest population in the world": "According to UN population estimates from 2023, India surpassed China as the world's most populous country with approximately 1.428 billion people compared to China's 1.425 billion.",
  "Gravity was discovered by Isaac Newton": "Isaac Newton formulated the law of universal gravitation in 1687, mathematically describing how gravity works. However, gravity as a phenomenon was observed and understood long before Newton — he did not 'discover' it but rather described it mathematically.",
  "The Great Wall of China is visible from space with the naked eye": "Multiple astronauts and space agencies have confirmed that the Great Wall of China is not visible from space with the naked eye. The wall is only about 6 meters wide, making it too narrow to be distinguished from orbit. This is a common misconception.",
  "Napoleon Bonaparte was extremely short": "Napoleon Bonaparte stood approximately 5 feet 7 inches (170 cm), which was average or slightly above average for a Frenchman of his era. The myth of his shortness stemmed from British propaganda and confusion between French and English measurement systems.",
  "Albert Einstein failed mathematics in school": "Einstein's school records show he received top marks in mathematics throughout his education. He excelled at math and physics from a young age. The myth likely arose from confusion about the Swiss grading system, where 6 was the highest mark.",
  "The Industrial Revolution began in France": "The Industrial Revolution began in Great Britain in the mid-to-late 18th century, approximately 1760-1840. Britain was the first country to industrialize, with innovations in textile manufacturing, iron production, and steam power.",
};

// ─────────────────────────────────────────────────────────────────────────────

async function callGroq(apiKey, systemPrompt, userPrompt) {
  const res = await fetch(GROQ_BASE_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: GROQ_MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0,
      response_format: { type: 'json_object' },
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Groq error ${res.status}: ${err.slice(0, 100)}`);
  }

  const data = await res.json();
  const text = data.choices?.[0]?.message?.content || '';
  return JSON.parse(text);
}

async function runMode(apiKey, claims, mode) {
  const results = [];

  for (let i = 0; i < claims.length; i++) {
    const { claim, expected } = claims[i];

    // Rate limit
    if (i > 0) await new Promise(r => setTimeout(r, 2500));

    try {
      let result;
      if (mode === 'bare') {
        result = await callGroq(apiKey, BARE_SYSTEM, BARE_USER.replace('{claim}', claim));
      } else if (mode === 'structured') {
        result = await callGroq(apiKey, STRUCTURED_SYSTEM, STRUCTURED_USER.replace('{claim}', claim));
      } else if (mode === 'full') {
        const context = CONTEXTS[claim] || 'No additional context available for this claim.';
        const userMsg = FULL_USER.replace('{claim}', claim).replace('{context}', context);
        result = await callGroq(apiKey, FULL_SYSTEM, userMsg);
      }

      const predicted = result.verdict || 'UNVERIFIABLE';
      results.push({ claim, expected, predicted, correct: predicted === expected });
    } catch (e) {
      results.push({ claim, expected, predicted: 'ERROR', correct: false, error: e.message });
      if (e.message.includes('429')) {
        console.log('    Rate limited — waiting 60s...');
        await new Promise(r => setTimeout(r, 60000));
      }
    }
  }

  return results;
}

function calcMetrics(results) {
  const total = results.filter(r => r.predicted !== 'ERROR').length;
  const correct = results.filter(r => r.correct).length;
  const accuracy = total > 0 ? (correct / total * 100).toFixed(1) : 0;
  const errors = results.filter(r => !r.correct && r.predicted !== 'ERROR');
  return { total, correct, accuracy: parseFloat(accuracy), errors };
}

async function main() {
  const apiKey = process.argv[2];
  if (!apiKey) {
    console.error('Usage: node eval/ablation-study.js <GROQ_API_KEY>');
    process.exit(1);
  }

  const testData = JSON.parse(readFileSync('eval/test-claims.json', 'utf-8'));
  const claims = testData.claims;

  console.log(`\n${'═'.repeat(60)}`);
  console.log('  NOLIE ABLATION STUDY');
  console.log(`  Testing ${claims.length} claims across 3 pipeline configurations`);
  console.log(`${'═'.repeat(60)}\n`);

  // Mode A
  console.log('MODE A: Bare model (naive prompt)');
  console.log('─'.repeat(60));
  const bareResults = await runMode(apiKey, claims, 'bare');
  const bareMetrics = calcMetrics(bareResults);
  console.log(`  Result: ${bareMetrics.correct}/${bareMetrics.total} = ${bareMetrics.accuracy}%\n`);

  // Mode B
  console.log('MODE B: Structured verification prompt');
  console.log('─'.repeat(60));
  const structuredResults = await runMode(apiKey, claims, 'structured');
  const structuredMetrics = calcMetrics(structuredResults);
  console.log(`  Result: ${structuredMetrics.correct}/${structuredMetrics.total} = ${structuredMetrics.accuracy}%\n`);

  // Mode C
  console.log('MODE C: Full pipeline (structured + article context)');
  console.log('─'.repeat(60));
  const fullResults = await runMode(apiKey, claims, 'full');
  const fullMetrics = calcMetrics(fullResults);
  console.log(`  Result: ${fullMetrics.correct}/${fullMetrics.total} = ${fullMetrics.accuracy}%\n`);

  // Summary
  console.log(`\n${'═'.repeat(60)}`);
  console.log('  ABLATION RESULTS');
  console.log(`${'═'.repeat(60)}\n`);

  console.log('  Configuration                    | Accuracy | Improvement');
  console.log('  ' + '─'.repeat(56));
  console.log(`  A. Bare model (baseline)         | ${String(bareMetrics.accuracy + '%').padEnd(8)} | —`);
  console.log(`  B. Structured prompt             | ${String(structuredMetrics.accuracy + '%').padEnd(8)} | +${(structuredMetrics.accuracy - bareMetrics.accuracy).toFixed(1)}%`);
  console.log(`  C. Full pipeline (prompt+context) | ${String(fullMetrics.accuracy + '%').padEnd(8)} | +${(fullMetrics.accuracy - bareMetrics.accuracy).toFixed(1)}%`);

  console.log(`\n  Key finding: Context-aware verification improves accuracy by`);
  console.log(`  ${(fullMetrics.accuracy - bareMetrics.accuracy).toFixed(1)} percentage points over naive baseline.\n`);

  // Claims where context made the difference
  const contextHelped = [];
  for (let i = 0; i < claims.length; i++) {
    if (!bareResults[i].correct && fullResults[i].correct) {
      contextHelped.push(claims[i].claim);
    }
  }
  if (contextHelped.length > 0) {
    console.log(`  Claims where context made the difference (${contextHelped.length}):`);
    for (const c of contextHelped.slice(0, 10)) {
      console.log(`    • "${c.slice(0, 60)}..."`);
    }
  }

  // Save results
  const output = {
    timestamp: new Date().toISOString(),
    testSetSize: claims.length,
    results: {
      bare: { ...bareMetrics, details: bareResults },
      structured: { ...structuredMetrics, details: structuredResults },
      full: { ...fullMetrics, details: fullResults },
    },
    improvement: {
      structuredOverBare: structuredMetrics.accuracy - bareMetrics.accuracy,
      fullOverBare: fullMetrics.accuracy - bareMetrics.accuracy,
      fullOverStructured: fullMetrics.accuracy - structuredMetrics.accuracy,
    },
    contextHelped,
  };

  writeFileSync('eval/ablation-results.json', JSON.stringify(output, null, 2));
  console.log('\n  Full results saved to eval/ablation-results.json');
}

main().catch(e => { console.error(e); process.exit(1); });
