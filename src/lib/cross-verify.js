/**
 * Cross-verification module.
 * Performs adversarial second-pass verification to detect hallucinated verdicts.
 * Uses a skeptical prompt that tries to disprove the initial verdict.
 */

import { GROQ_MODEL, GROQ_BASE_URL } from './constants.js';

const ADVERSARIAL_SYSTEM = `You are a skeptical fact-checker performing a quality check on a verification result. Your job is to catch genuine errors — NOT to nitpick well-established facts. Be skeptical but fair. Return ONLY a JSON object.`;

const ADVERSARIAL_USER = `A fact-checking AI verified this claim and produced the following result:

Claim: "{claim}"
Initial Verdict: {verdict}
Initial Explanation: "{explanation}"

Your job: Check if the initial verdict is CORRECT. Only challenge it if you find a genuine problem:
1. Is the claim actually factually wrong or misleading? (Not just "lacks citation" — if it's a well-known fact, that's fine)
2. Does the explanation contain fabricated details or hallucinated sources?
3. Is there important missing context that changes the meaning?

DO NOT downgrade confidence just because:
- The claim is a well-known historical fact without a citation
- The explanation doesn't cite primary sources for universally accepted facts
- The claim is simple/obvious
- There are minor spelling errors or typos (e.g. "Vermacht" vs "Wehrmacht")
- Names are slightly misspelled due to transcription errors

Only challenge if you find a REAL factual error or genuinely misleading framing.

Article context for reference:
---
{context}
---

Return JSON:
{
  "challenge": "Your counter-argument (empty string if you agree with the verdict)",
  "agrees_with_verdict": true/false,
  "confidence_adjustment": "UP" or "DOWN" or "SAME",
  "revised_verdict": "TRUE" or "FALSE" or "MISLEADING" or "UNVERIFIABLE" (only if you disagree),
  "reason": "Brief explanation"
}`;

/**
 * Perform adversarial cross-verification on a single verified claim.
 * Returns the original claim enhanced with cross-verification data.
 */
export async function crossVerifyClaim(claim, apiKey, articleContext) {
  const context = (articleContext || '').slice(0, 2000);
  const userMsg = ADVERSARIAL_USER
    .replace('{claim}', claim.claim)
    .replace('{verdict}', claim.verdict)
    .replace('{explanation}', claim.explanation || '')
    .replace('{context}', context);

  try {
    const res = await fetch(GROQ_BASE_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: GROQ_MODEL,
        messages: [
          { role: 'system', content: ADVERSARIAL_SYSTEM },
          { role: 'user', content: userMsg },
        ],
        temperature: 0.1, // Slightly higher temp for diversity of thought
        response_format: { type: 'json_object' },
      }),
    });

    if (!res.ok) {
      // If rate limited or error, just return original claim unchanged
      return { ...claim, crossVerified: false };
    }

    const data = await res.json();
    const response = data.choices?.[0]?.message?.content || '';
    const result = JSON.parse(response);

    // Enhance the claim with cross-verification data
    return {
      ...claim,
      crossVerified: true,
      crossVerification: {
        agreesWithVerdict: result.agrees_with_verdict,
        challenge: result.challenge || '',
        confidenceAdjustment: result.confidence_adjustment || 'SAME',
        revisedVerdict: result.revised_verdict || null,
        reason: result.reason || '',
      },
      // Adjust confidence based on cross-verification
      confidence: adjustConfidence(claim.confidence, result),
      // If verdicts disagree, mark as disputed
      disputed: !result.agrees_with_verdict,
      verdict: result.agrees_with_verdict ? claim.verdict : (result.revised_verdict || claim.verdict),
    };
  } catch (e) {
    // On any error, return original claim unchanged
    return { ...claim, crossVerified: false };
  }
}

/**
 * Cross-verify all claims in a batch.
 */
export async function crossVerifyClaims(claims, apiKey, articleContext) {
  const results = [];
  for (let i = 0; i < claims.length; i++) {
    const claim = claims[i];
    // 2 second delay between calls to respect rate limits
    if (i > 0) await new Promise(r => setTimeout(r, 2000));
    const verified = await crossVerifyClaim(claim, apiKey, articleContext);
    results.push(verified);
  }
  return results;
}

function adjustConfidence(originalConfidence, crossResult) {
  if (!crossResult.agrees_with_verdict) return 'LOW';
  if (crossResult.confidence_adjustment === 'UP') {
    if (originalConfidence === 'MEDIUM') return 'HIGH';
    return originalConfidence;
  }
  if (crossResult.confidence_adjustment === 'DOWN') {
    if (originalConfidence === 'HIGH') return 'MEDIUM';
    if (originalConfidence === 'MEDIUM') return 'LOW';
    return 'LOW';
  }
  return originalConfidence;
}
