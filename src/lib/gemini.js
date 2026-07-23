/**
 * Gemini API wrapper for NoLie.
 * Handles all AI calls: claim extraction, verification, image analysis, video analysis.
 */

import { MODEL } from './constants.js';

const API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

/**
 * Call Gemini API with a prompt and get a text response.
 */
async function callGemini(apiKey, prompt, options = {}) {
  const model = options.model || MODEL;
  const url = `${API_BASE}/${model}:generateContent?key=${apiKey}`;

  const body = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: 0,
      maxOutputTokens: options.maxTokens || 4096,
      responseMimeType: 'application/json',
    },
  };

  // Add tools (Google Search grounding) if requested
  if (options.grounding) {
    body.tools = [{ googleSearch: {} }];
    // When using tools, responseMimeType must not be set
    delete body.generationConfig.responseMimeType;
  }

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.error?.message || `Gemini API error: ${res.status}`);
  }

  const data = await res.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';

  return {
    text,
    groundingMetadata: data.candidates?.[0]?.groundingMetadata || null,
  };
}

/**
 * Call Gemini with an image (multimodal).
 */
async function callGeminiWithImage(apiKey, prompt, imageUrl) {
  const model = MODEL;
  const url = `${API_BASE}/${model}:generateContent?key=${apiKey}`;

  // Fetch image and convert to base64
  let imagePart;
  try {
    const imgRes = await fetch(imageUrl);
    const blob = await imgRes.blob();
    const buffer = await blob.arrayBuffer();
    const base64 = arrayBufferToBase64(buffer);
    const mimeType = blob.type || 'image/jpeg';
    imagePart = { inlineData: { mimeType, data: base64 } };
  } catch (e) {
    // If image fetch fails, fall back to text-only analysis with URL
    return callGemini(apiKey, prompt + `\n\nImage URL: ${imageUrl}`);
  }

  const body = {
    contents: [{
      parts: [
        { text: prompt },
        imagePart,
      ],
    }],
    generationConfig: {
      temperature: 0,
      maxOutputTokens: 2048,
      responseMimeType: 'application/json',
    },
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.error?.message || `Gemini Vision error: ${res.status}`);
  }

  const data = await res.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
  return { text };
}

function arrayBufferToBase64(buffer) {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

// ─── CLAIM EXTRACTION ────────────────────────────────────────────────────────

const EXTRACT_CLAIMS_PROMPT = `You are a fact-checking assistant. Analyze the following article text and extract all factual claims that can be verified.

Rules:
- Extract only specific, verifiable factual claims (statistics, dates, events, named actions)
- Ignore opinions, predictions, subjective statements, and rhetorical questions
- Each claim should be a single, self-contained statement
- Extract a maximum of {maxClaims} claims, prioritizing the most important/checkworthy ones
- Return ONLY a JSON array

Output format (JSON array):
[
  {"claim": "The exact factual claim as stated", "importance": "HIGH|MEDIUM|LOW"},
  ...
]

Article text:
---
{text}
---`;

export async function extractClaims(text, apiKey, maxClaims = 10) {
  // Truncate text to avoid hitting token limits
  const truncated = text.slice(0, 15000);
  const prompt = EXTRACT_CLAIMS_PROMPT
    .replace('{text}', truncated)
    .replace('{maxClaims}', String(maxClaims));

  const { text: response } = await callGemini(apiKey, prompt);

  try {
    const claims = JSON.parse(response);
    if (Array.isArray(claims)) {
      return claims.slice(0, maxClaims);
    }
  } catch (e) {
    // Try to extract JSON from response
    const match = response.match(/\[[\s\S]*\]/);
    if (match) {
      try { return JSON.parse(match[0]).slice(0, maxClaims); } catch {}
    }
  }
  return [];
}

// ─── CLAIM VERIFICATION ──────────────────────────────────────────────────────

const VERIFY_CLAIM_PROMPT = `You are a fact-checking assistant. Verify the following claim using your knowledge and any available information.

Claim: "{claim}"

Respond with a JSON object in this exact format:
{
  "verdict": "TRUE" | "FALSE" | "MISLEADING" | "UNVERIFIABLE",
  "confidence": "HIGH" | "MEDIUM" | "LOW",
  "explanation": "2-3 sentences explaining your assessment with specific evidence",
  "sources": ["URL or source name that supports your verdict"]
}

Be objective. If you cannot verify the claim with confidence, use UNVERIFIABLE.`;

export async function verifyClaim(claim, apiKey) {
  const prompt = VERIFY_CLAIM_PROMPT.replace('{claim}', claim);

  // Use grounding only if available (higher quota needed)
  // For free tier, fall back to non-grounded verification
  let response, groundingMetadata;
  try {
    const result = await callGemini(apiKey, prompt, { grounding: true });
    response = result.text;
    groundingMetadata = result.groundingMetadata;
  } catch (e) {
    // If grounding fails (quota), try without grounding
    if (e.message.includes('quota') || e.message.includes('429') || e.message.includes('exceeded')) {
      const result = await callGemini(apiKey, prompt);
      response = result.text;
      groundingMetadata = null;
    } else {
      throw e;
    }
  }

  try {
    // When grounding is used, response might not be JSON
    // Try parsing directly first
    const result = JSON.parse(response);
    // Add grounding sources if available
    if (groundingMetadata?.groundingChunks) {
      const groundingSources = groundingMetadata.groundingChunks
        .filter(c => c.web?.uri)
        .map(c => c.web.uri);
      if (groundingSources.length > 0) {
        result.sources = groundingSources;
      }
    }
    return result;
  } catch {
    // Try to extract JSON from mixed response
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try { return JSON.parse(jsonMatch[0]); } catch {}
    }
    // Fallback
    return {
      verdict: 'UNVERIFIABLE',
      confidence: 'LOW',
      explanation: 'Could not parse verification result.',
      sources: [],
    };
  }
}

export async function verifyClaims(claims, apiKey) {
  const results = [];
  for (let i = 0; i < claims.length; i++) {
    const claim = claims[i];
    // Rate limit: wait 3 seconds between verification calls to avoid quota errors
    if (i > 0) await new Promise(r => setTimeout(r, 3000));
    try {
      const result = await verifyClaim(claim.claim, apiKey);
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

// ─── IMAGE ANALYSIS ──────────────────────────────────────────────────────────

const IMAGE_ANALYSIS_PROMPT = `Analyze this image from a news article. Determine if it raises any credibility concerns.

Check for:
1. Signs of AI generation (artifacts, unnatural features, inconsistent lighting)
2. Signs of manipulation or editing (splicing, clone stamping, warped elements)
3. Whether the image content matches its caption/context: "{caption}"
4. Misleading visual elements (deceptive charts, cherry-picked framing)

Respond with a JSON object:
{
  "flagged": true/false,
  "issues": ["list of specific issues found, empty if none"],
  "analysis": "Brief 1-2 sentence summary of findings",
  "aiGenerated": true/false,
  "manipulated": true/false
}`;

export async function analyzeImage(image, apiKey) {
  const prompt = IMAGE_ANALYSIS_PROMPT.replace('{caption}', image.caption || image.alt || 'No caption');

  try {
    const { text: response } = await callGeminiWithImage(apiKey, prompt, image.url);
    const result = JSON.parse(response);
    return {
      url: image.url,
      alt: image.alt,
      caption: image.caption,
      flagged: result.flagged || false,
      issues: result.issues || [],
      analysis: result.analysis || 'No issues detected.',
      aiGenerated: result.aiGenerated || false,
      manipulated: result.manipulated || false,
    };
  } catch (e) {
    return {
      url: image.url,
      alt: image.alt,
      caption: image.caption,
      flagged: false,
      issues: [],
      analysis: 'Could not analyze image: ' + e.message,
      aiGenerated: false,
      manipulated: false,
    };
  }
}

export async function analyzeImages(images, apiKey) {
  // Limit to 5 images to avoid rate limits
  const toAnalyze = images.slice(0, 5);
  const results = [];
  for (const img of toAnalyze) {
    const result = await analyzeImage(img, apiKey);
    results.push(result);
  }
  return results;
}

// ─── VIDEO ANALYSIS ──────────────────────────────────────────────────────────

const VIDEO_ANALYSIS_PROMPT = `Analyze this video's thumbnail image and metadata from a news article.

Video title: "{title}"
Video context: Embedded in an article on this page.

Check the thumbnail for:
1. Clickbait or misleading imagery
2. Signs of manipulation
3. Whether the thumbnail accurately represents the likely video content based on the title

Respond with a JSON object:
{
  "flagged": true/false,
  "analysis": "Brief 1-2 sentence assessment",
  "clickbait": true/false
}`;

export async function analyzeVideo(video, apiKey) {
  const thumbnailUrl = video.thumbnail || video.poster;

  if (!thumbnailUrl) {
    return {
      title: video.title || 'Untitled video',
      flagged: false,
      analysis: 'No thumbnail available for analysis.',
      clickbait: false,
    };
  }

  const prompt = VIDEO_ANALYSIS_PROMPT.replace('{title}', video.title || 'Unknown');

  try {
    const { text: response } = await callGeminiWithImage(apiKey, prompt, thumbnailUrl);
    const result = JSON.parse(response);
    return {
      title: video.title || 'Untitled video',
      thumbnail: thumbnailUrl,
      flagged: result.flagged || false,
      analysis: result.analysis || 'No issues detected.',
      clickbait: result.clickbait || false,
    };
  } catch (e) {
    return {
      title: video.title || 'Untitled video',
      thumbnail: thumbnailUrl,
      flagged: false,
      analysis: 'Could not analyze video: ' + e.message,
      clickbait: false,
    };
  }
}

export async function analyzeVideos(videos, apiKey) {
  const results = [];
  for (const video of videos.slice(0, 3)) {
    const result = await analyzeVideo(video, apiKey);
    results.push(result);
  }
  return results;
}
