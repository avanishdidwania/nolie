/**
 * NoLie Evaluation Script
 * Runs 50 test claims through the verification pipeline and measures accuracy.
 * 
 * Usage: node eval/run-eval.js <GROQ_API_KEY>
 */

import { readFileSync, writeFileSync } from 'fs';

const GROQ_BASE_URL = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_MODEL = 'llama-3.3-70b-versatile';

const VERIFY_SYSTEM = `You are a fact-checking assistant. Verify claims using your knowledge. Be objective and evidence-based. Return ONLY a JSON object.`;

const VERIFY_USER = `Verify this claim: "{claim}"

Return JSON:
{
  "verdict": "TRUE" or "FALSE" or "MISLEADING" or "UNVERIFIABLE",
  "confidence": "HIGH" or "MEDIUM" or "LOW",
  "explanation": "Brief explanation"
}`;

async function callGroq(apiKey, claim) {
  const res = await fetch(GROQ_BASE_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: GROQ_MODEL,
      messages: [
        { role: 'system', content: VERIFY_SYSTEM },
        { role: 'user', content: VERIFY_USER.replace('{claim}', claim) },
      ],
      temperature: 0,
      response_format: { type: 'json_object' },
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Groq error ${res.status}: ${err}`);
  }

  const data = await res.json();
  const text = data.choices?.[0]?.message?.content || '';
  return JSON.parse(text);
}

async function main() {
  const apiKey = process.argv[2];
  if (!apiKey) {
    console.error('Usage: node eval/run-eval.js <GROQ_API_KEY>');
    process.exit(1);
  }

  const testData = JSON.parse(readFileSync('eval/test-claims.json', 'utf-8'));
  const claims = testData.claims;

  console.log(`\nRunning evaluation on ${claims.length} claims...\n`);
  console.log('─'.repeat(60));

  const results = [];
  let correct = 0;
  let total = 0;

  // Per-class counters
  const classStats = {
    TRUE: { tp: 0, fp: 0, fn: 0 },
    FALSE: { tp: 0, fp: 0, fn: 0 },
    MISLEADING: { tp: 0, fp: 0, fn: 0 },
    UNVERIFIABLE: { tp: 0, fp: 0, fn: 0 },
  };

  for (let i = 0; i < claims.length; i++) {
    const { claim, expected, category } = claims[i];
    process.stdout.write(`[${i + 1}/${claims.length}] Verifying: "${claim.slice(0, 50)}..." `);

    try {
      // Rate limit: 2 second delay between calls
      if (i > 0) await new Promise(r => setTimeout(r, 2000));

      const result = await callGroq(apiKey, claim);
      const predicted = result.verdict || 'UNVERIFIABLE';
      const isCorrect = predicted === expected;

      if (isCorrect) correct++;
      total++;

      // Update class stats
      if (predicted === expected) {
        classStats[expected].tp++;
      } else {
        classStats[predicted].fp++;
        classStats[expected].fn++;
      }

      const mark = isCorrect ? '✓' : '✗';
      console.log(`${mark} ${predicted} (expected: ${expected})`);

      results.push({
        claim, expected, predicted, isCorrect, category,
        confidence: result.confidence,
        explanation: result.explanation,
      });
    } catch (e) {
      console.log(`ERROR: ${e.message}`);
      results.push({ claim, expected, predicted: 'ERROR', isCorrect: false, category, error: e.message });
      total++;

      // If rate limited, wait longer
      if (e.message.includes('429') || e.message.includes('Rate')) {
        console.log('  → Rate limited, waiting 60 seconds...');
        await new Promise(r => setTimeout(r, 60000));
      }
    }
  }

  // Calculate metrics
  console.log('\n' + '═'.repeat(60));
  console.log('RESULTS SUMMARY');
  console.log('═'.repeat(60));

  const accuracy = ((correct / total) * 100).toFixed(1);
  console.log(`\nOverall Accuracy: ${correct}/${total} = ${accuracy}%\n`);

  // Per-class precision and recall
  console.log('Per-class metrics:');
  console.log('─'.repeat(60));
  console.log('Class        | Precision | Recall  | F1      | Support');
  console.log('─'.repeat(60));

  for (const [cls, stats] of Object.entries(classStats)) {
    const precision = stats.tp + stats.fp > 0 ? (stats.tp / (stats.tp + stats.fp) * 100).toFixed(1) : 'N/A';
    const recall = stats.tp + stats.fn > 0 ? (stats.tp / (stats.tp + stats.fn) * 100).toFixed(1) : 'N/A';
    const f1 = precision !== 'N/A' && recall !== 'N/A'
      ? (2 * parseFloat(precision) * parseFloat(recall) / (parseFloat(precision) + parseFloat(recall))).toFixed(1)
      : 'N/A';
    const support = stats.tp + stats.fn;
    console.log(`${cls.padEnd(12)} | ${String(precision).padEnd(9)} | ${String(recall).padEnd(7)} | ${String(f1).padEnd(7)} | ${support}`);
  }

  // Per-category accuracy
  console.log('\nPer-category accuracy:');
  console.log('─'.repeat(60));
  const categories = [...new Set(results.map(r => r.category))];
  for (const cat of categories) {
    const catResults = results.filter(r => r.category === cat);
    const catCorrect = catResults.filter(r => r.isCorrect).length;
    const catAcc = ((catCorrect / catResults.length) * 100).toFixed(1);
    console.log(`  ${cat}: ${catCorrect}/${catResults.length} = ${catAcc}%`);
  }

  // Errors list
  const errors = results.filter(r => !r.isCorrect && r.predicted !== 'ERROR');
  if (errors.length > 0) {
    console.log(`\nMisclassified claims (${errors.length}):`);
    console.log('─'.repeat(60));
    for (const err of errors) {
      console.log(`  "${err.claim.slice(0, 60)}..."`);
      console.log(`    Expected: ${err.expected} | Got: ${err.predicted}`);
    }
  }

  // Save full results
  const output = {
    timestamp: new Date().toISOString(),
    totalClaims: total,
    correct,
    accuracy: parseFloat(accuracy),
    classStats,
    categoryAccuracy: Object.fromEntries(categories.map(cat => {
      const catResults = results.filter(r => r.category === cat);
      return [cat, { correct: catResults.filter(r => r.isCorrect).length, total: catResults.length }];
    })),
    results,
  };

  writeFileSync('eval/results.json', JSON.stringify(output, null, 2));
  console.log('\nFull results saved to eval/results.json');
}

main().catch(e => { console.error(e); process.exit(1); });
