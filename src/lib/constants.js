// Message types for chrome.runtime messaging
export const MSG = {
  SCAN_PAGE: 'scanPage',
  SCAN_SELECTION: 'scanSelection',
  EXTRACT_CONTENT: 'extractContent',
  CONTENT_EXTRACTED: 'contentExtracted',
  CLAIMS_EXTRACTED: 'claimsExtracted',
  CLAIM_VERIFIED: 'claimVerified',
  IMAGE_ANALYZED: 'imageAnalyzed',
  VIDEO_ANALYZED: 'videoAnalyzed',
  SCAN_COMPLETE: 'scanComplete',
  SCAN_PROGRESS: 'scanProgress',
  SCAN_ERROR: 'scanError',
  APPLY_HEATMAP: 'applyHeatmap',
  OPEN_OPTIONS: 'openOptions',
  TEST_API_KEY: 'testApiKey',
  GET_HISTORY: 'getHistory',
  CLEAR_HISTORY: 'clearHistory',
};

export const STORAGE_KEY = {
  API_KEY: 'nolie_apiKey',
  GROQ_KEY: 'nolie_groqKey',
  SETTINGS: 'nolie_settings',
  HISTORY: 'nolie_history',
};

// Gemini model (image/video analysis only)
export const MODEL = 'gemini-3.6-flash';

// Groq model (claim extraction + verification)
export const GROQ_MODEL = 'openai/gpt-oss-120b';
export const GROQ_BASE_URL = 'https://api.groq.com/openai/v1/chat/completions';

export const VERDICT = {
  TRUE: 'TRUE',
  FALSE: 'FALSE',
  MISLEADING: 'MISLEADING',
  UNVERIFIABLE: 'UNVERIFIABLE',
};

export const CONFIDENCE = {
  HIGH: 'HIGH',
  MEDIUM: 'MEDIUM',
  LOW: 'LOW',
};

// Default verification prompt (customizable by user)
export const DEFAULT_VERIFY_PROMPT = `Article context:
---
[[context]]
---

Verify this claim from the article above: "[[claim]]"

Respond with a JSON object:
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
- Prefer specific source names (e.g. "BBC News", "Reuters") over generic ones`;
