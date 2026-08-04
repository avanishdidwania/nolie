/**
 * Groq API wrapper for NoLie.
 * Handles text-based AI calls: claim extraction and verification.
 * Uses Llama 3.3 70B — free tier: 30 RPM, 1000 RPD, 12K TPM.
 */

import { GROQ_MODEL, GROQ_BASE_URL } from './constants.js';

async function callGroq(apiKey, systemPrompt, userMessage) {
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
        { role: 'user', content: userMessage },
      ],
      temperature: 0,
      response_format: { type: 'json_object' },
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.error?.message || `Groq API error: ${res.status}`);
  }

  const data = await res.json();
  return data.choices?.[0]?.message?.content || '';
}

// ─── CLAIM EXTRACTION ────────────────────────────────────────────────────────

const EXTRACT_SYSTEM = `You are a fact-checking assistant. Extract verifiable factual claims from article text. Return ONLY a JSON object with a "claims" array.`;

const EXTRACT_USER = `Analyze this article and extract up to {maxClaims} specific, verifiable factual claims.

CRITICAL RULES:
- ONLY extract claims that are EXPLICITLY STATED in the text below
- NEVER generate claims from your own knowledge about the topic
- NEVER infer or assume facts that aren't directly written in the text
- If a claim is partially stated, extract only what's actually written
- Each claim must be traceable to a specific sentence in the text
- FIX any spelling errors, grammar issues, or transcription mistakes in the claims (e.g. misspelled names, places, or words from auto-generated captions)

Extract ONLY:
- Specific, verifiable statements (statistics, dates, events, named actions)
- Ignore opinions, predictions, subjective statements, rhetorical questions

Return JSON: {"claims": [{"claim": "exact factual claim with spelling corrected", "importance": "HIGH|MEDIUM|LOW"}]}

Text to analyze:
---
{text}
---`;

export async function extractClaims(text, apiKey, maxClaims = 10) {
  const truncated = text.slice(0, 12000);
  const userMsg = EXTRACT_USER
    .replace('{text}', truncated)
    .replace('{maxClaims}', String(maxClaims));

  const response = await callGroq(apiKey, EXTRACT_SYSTEM, userMsg);

  try {
    const parsed = JSON.parse(response);
    const claims = parsed.claims || parsed;
    if (Array.isArray(claims)) return claims.slice(0, maxClaims);
  } catch {
    const match = response.match(/\[[\s\S]*\]/);
    if (match) {
      try { return JSON.parse(match[0]).slice(0, maxClaims); } catch {}
    }
  }
  return [];
}

// ─── LIVE CLAIM EXTRACTION (stricter) ─────────────────────────────────────────

const LIVE_EXTRACT_SYSTEM = `You are a fact-checking assistant monitoring live speech. You ONLY extract claims that are genuinely check-worthy. Be VERY selective — most speech contains no verifiable claims. Return ONLY a JSON object.`;

const LIVE_EXTRACT_USER = `This is a short segment from live speech/video. Extract ONLY genuinely check-worthy factual claims — if there are NONE, return an empty array.

EXTRACT only:
- Specific statistics or numbers ("unemployment is 5%", "40 people died")
- Named events with details ("the bill passed in 2021")
- Government/official actions ("PM announced a new policy")
- Historical facts being stated ("India got independence in 1947")
- Scientific/medical claims ("this drug cures cancer")

DO NOT extract:
- Greetings, introductions, pleasantries
- Opinions ("I think this is bad")
- Vague statements without specifics ("things are getting worse")
- Predictions or promises ("we will do better")
- Questions being asked
- Commentary or analysis without specific facts
- Self-referential statements ("I've been doing this for years")
- Channel/video promotions

If nothing is check-worthy, return: {"claims": []}

Return JSON: {"claims": [{"claim": "exact factual claim with spelling corrected", "importance": "HIGH|MEDIUM|LOW"}]}

Speech segment:
---
{text}
---`;

export async function extractLiveClaims(text, apiKey) {
  const userMsg = LIVE_EXTRACT_USER.replace('{text}', text);
  const response = await callGroq(apiKey, LIVE_EXTRACT_SYSTEM, userMsg);

  try {
    const parsed = JSON.parse(response);
    const claims = parsed.claims || parsed;
    if (Array.isArray(claims)) return claims.slice(0, 3);
  } catch {
    const match = response.match(/\[[\s\S]*\]/);
    if (match) {
      try { return JSON.parse(match[0]).slice(0, 3); } catch {}
    }
  }
  return [];
}

// ─── CLAIM VERIFICATION ──────────────────────────────────────────────────────

const VERIFY_SYSTEM = `You are a fact-checking assistant. You will be given a claim extracted from a news article, along with the article context. Use the context plus your knowledge to verify the claim. Be objective and evidence-based. Return ONLY a JSON object.`;

const VERIFY_USER = `Article context (for reference):
---
{context}
---

Verify this specific claim from the article above: "{claim}"

Return JSON:
{
  "verdict": "TRUE" or "FALSE" or "MISLEADING" or "UNVERIFIABLE",
  "confidence": "HIGH" or "MEDIUM" or "LOW",
  "explanation": "2-3 sentences with specific evidence. Reference the location, date, organizations, and people involved.",
  "sources": ["name of authoritative source or news outlet that covered this"]
}

Important:
- Use the article context to understand WHO, WHERE, WHEN, and WHAT the claim refers to
- A claim is TRUE if it matches known facts/reports about this specific event
- Only use UNVERIFIABLE if the event is too recent or obscure to have any coverage
- Prefer specific source names (e.g. "BBC News", "Reuters", "NDRF official statement") over generic ones`;

export async function verifyClaim(claim, apiKey, articleContext) {
  const context = (articleContext || '').slice(0, 3000);

  // Check for custom prompt
  let userMsg;
  try {
    const data = await chrome.storage.local.get('nolie_settings');
    const settings = data.nolie_settings || {};
    if (settings.customPrompt && settings.customPrompt.includes('[[claim]]')) {
      userMsg = settings.customPrompt
        .replace('[[claim]]', claim)
        .replace('[[context]]', context);
    }
  } catch {}

  if (!userMsg) {
    userMsg = VERIFY_USER.replace('{claim}', claim).replace('{context}', context);
  }

  const response = await callGroq(apiKey, VERIFY_SYSTEM, userMsg);

  try {
    return JSON.parse(response);
  } catch {
    const match = response.match(/\{[\s\S]*\}/);
    if (match) {
      try { return JSON.parse(match[0]); } catch {}
    }
    return {
      verdict: 'UNVERIFIABLE',
      confidence: 'LOW',
      explanation: 'Could not parse verification result.',
      sources: [],
    };
  }
}

export async function verifyClaims(claims, apiKey, articleContext) {
  const results = [];
  for (let i = 0; i < claims.length; i++) {
    const claim = claims[i];
    // Small delay between calls to respect rate limits
    if (i > 0) await new Promise(r => setTimeout(r, 2000));
    try {
      const result = await verifyClaim(claim.claim, apiKey, articleContext);
      results.push({
        claim: claim.claim,
        importance: claim.importance,
        verdict: result.verdict || 'UNVERIFIABLE',
        confidence: result.confidence || 'LOW',
        explanation: result.explanation || '',
        sources: result.sources || [],
      });
    } catch (e) {
      results.push({
        claim: claim.claim,
        importance: claim.importance,
        verdict: 'UNVERIFIABLE',
        confidence: 'LOW',
        explanation: 'Verification failed: ' + e.message,
        sources: [],
      });
    }
  }
  return results;
}
