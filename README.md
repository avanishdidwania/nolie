# NoLie — AI-Powered Content Credibility & Fact Verification

## Overview

NoLie is a Chrome extension that automatically scans news articles and YouTube videos, extracts factual claims, verifies them using AI, analyzes images for manipulation, and provides credibility scores. Built as part of a Gen AI internship project focused on content credibility and fact verification.

It supports two verification paths: a fast **standard pipeline** (extract → verify → optional cross-verify) and an optional **Agent Mode** that routes each claim through a LangGraph agent (hosted on Railway) which autonomously classifies the claim, checks source credibility, searches a verification cache, runs web search, and produces a verdict with a full reasoning trail.

## Features

- **Full article scanning** — one-click scan extracts and verifies all factual claims from any news article
- **Real-time audio fact-checking** — captures tab audio via Deepgram (Nova-2) for any page: podcasts, live streams, Twitter Spaces, Instagram reels. Uses YouTube caption polling for YouTube videos.
- **YouTube video fact-checking** — automatically extracts video transcript (auto-generated or manual captions) and verifies claims from spoken content
- **AI-powered claim extraction** — identifies specific, verifiable factual statements, filtering out opinions and predictions
- **Context-aware verification** — each claim is verified with full article/transcript context for accurate assessment
- **Agentic verification (Agent Mode)** — optional mode that routes each claim through a LangGraph agent on Railway. The agent autonomously classifies the claim, checks source credibility, searches the RAG cache, runs web search (Tavily), and verifies with context — returning a verdict plus a reasoning trail and the tools it used. Protected by a circuit breaker: after 3 consecutive failures it disables itself and falls back to standard verification.
- **Self-learning RAG cache** — verified claims are stored in a vector database (Supabase pgvector). Future similar claims are answered instantly from cache without API calls. Only stores cross-verified HIGH confidence results to prevent poisoning.
- **Image analysis** — detects AI-generated images, manipulation, and misleading visuals using Gemini multimodal AI
- **Source credibility scoring** — rates 3,920+ news domains using the MBFC (Media Bias/Fact Check) dataset for bias and factual reporting
- **Credibility heatmap** — automatically highlights claims on the page (green = true, yellow = unverifiable, red = false)
- **Manual fact-check mode** — select any text on a page, right-click, and choose "Fact Check This"
- **Scan history** — stores past scans with full results, clickable to review any previous analysis
- **Exportable HTML reports** — download a styled report with all claims, verdicts, sources, and scores
- **Customizable verification prompt** — tailor how NoLie verifies claims via the settings page
- **Dark Notion-style UI** — clean, minimal side panel interface

## Architecture

```
User clicks "Scan This Page"
        |
        v
Content Extraction (article text, images, video transcript)
        |
        v
Claim Extraction (Groq - openai/gpt-oss-120b)
        |
        v
RAG Cache Check (Supabase pgvector) → [HIT: instant answer] / [MISS: continue]
        |
        v
Verification:
   ├─ Standard Mode: Claim verified with full context (Groq) → optional cross-verify
   └─ Agent Mode:    LangGraph agent on Railway (classify → source check →
                     cache search → web search → verify) with circuit-breaker fallback
        |
        v
Image Analysis (Google Gemini - multimodal)
        |
        v
Source Credibility (MBFC dataset - offline lookup)
        |
        v
Score Calculation + Results Display + Heatmap Overlay
```

### Agent Mode (optional)

```
Claim → agentVerifyClaim() → POST https://nolie-agent-production.up.railway.app/verify
                                   │
                                   ▼
        LangGraph agent autonomously calls tools:
        classify_claim_type → check_source_credibility → search_verified_claims
        → web_search (Tavily) → verify_claim_with_context   (max 7 tool calls)
                                   │
                                   ▼
        { verdict, confidence, explanation, reasoning_trail, tools_used }

Circuit breaker: 3 consecutive agent failures → agent disabled for the session,
remaining claims fall back to standard verification.
```

### Live Mode (Non-YouTube)

```
User clicks "Start Live" → tabCapture gets audio stream → Offscreen document captures audio
→ Audio streamed to Deepgram (Nova-2) via WebSocket → Real-time transcription
→ Sentences accumulated → Groq extracts + verifies claims → Side panel displays verdicts
```

### Provider Responsibilities

| Provider | Role | Why |
|----------|------|-----|
| Groq (openai/gpt-oss-120b) | Claim extraction + verification | Fast, generous free tier, great at structured JSON output |
| NoLie Agent (LangGraph on Railway) | Agentic verification (Agent Mode) | Autonomous multi-tool reasoning: classify, source check, cache, web search |
| Google Gemini (3.6 Flash) | Image/video multimodal analysis | Handles images natively, detects AI-generated content |
| Deepgram (Nova-2) | Real-time audio transcription | Accurate, fast, supports 30+ languages, $200 free credit |
| MBFC Dataset | Source credibility + bias scoring | Bundled offline (3,920 domains), no API needed |
| Supabase (pgvector) | Self-learning verification cache | Vector similarity search, persistent storage, free tier (500MB) |
| Tavily | Web search (Agent Mode) | Current information for recent events and statistics |
| Gemini Embedding (gemini-embedding-001) | Claim embedding for semantic search | 768-dim vectors, free tier (1,500 req/day) |

## Tech Stack

- Chrome Extension (Manifest V3)
- Vanilla JS + CSS (dark Notion-style theme)
- Vite + @crxjs/vite-plugin (build tooling)
- Groq API (openai/gpt-oss-120b) — claim extraction + verification
- NoLie Agent — LangGraph agent (Groq + Tavily + Supabase), hosted on Railway, for Agent Mode
- Google Gemini API (3.6 Flash) — multimodal image analysis
- MBFC Dataset — source credibility (bundled JSON, 3,920 domains)
- Deepgram API (Nova-2) — real-time audio-to-text transcription
- Supabase (PostgreSQL + pgvector) — self-learning RAG cache for verified claims
- Gemini Embedding API — semantic embeddings for claim similarity matching
- Vercel Serverless Functions — backend for secure Deepgram token issuance + RAG cache read/write
- Chrome Side Panel API — results display

## Setup

1. Clone the repo
   ```
   git clone https://github.com/avanishdidwania/nolie.git
   cd nolie
   ```
2. Install dependencies
   ```
   npm install
   ```
3. Build
   ```
   npm run build
   ```
4. Load in Chrome
   - Open `chrome://extensions`
   - Enable Developer Mode (top right)
   - Click "Load Unpacked" and select the `dist/` folder
5. Configure API keys
   - Click the NoLie icon → Settings
   - Add your **Groq API key** (free at [console.groq.com](https://console.groq.com))
   - Add your **Gemini API key** (free at [aistudio.google.com](https://aistudio.google.com)) — only needed for image analysis
6. Start fact-checking
   - Navigate to any news article → click NoLie → "Scan This Page"
   - Or go to a YouTube video → open transcript panel → scan

## Backend

The extension uses a Vercel serverless backend (`nolie-backend`) to securely issue Deepgram API tokens. This keeps the Deepgram key server-side and never exposed in client code.

- Endpoint: `POST /api/deepgram-token`
- Returns: Deepgram API key for WebSocket authentication
- Hosted at: `https://nolie-backend.vercel.app`

To deploy your own backend:
1. Clone `nolie-backend/`
2. `vercel login`
3. `vercel env add DEEPGRAM_API_KEY` (paste your Deepgram key)
4. `vercel --prod`

## How It Works

### News Articles
1. User clicks "Scan This Page" from the extension popup
2. Content script extracts article text, images, embedded videos, and metadata (domain, date, author)
3. Article text sent to Groq (openai/gpt-oss-120b) to extract verifiable factual claims
4. Each claim checked against RAG cache first (instant if similar claim was previously verified). Cache misses verified via Groq with full article context.
5. Images optionally analyzed by Gemini for AI-generation and manipulation
6. Article domain checked against MBFC dataset for source reliability and bias
7. Credibility score calculated (weighted by verdicts, confidence, source rating, flagged images)
8. Results displayed in side panel + heatmap applied to article text

### YouTube Videos
1. User opens a YouTube video and clicks "Scan This Page"
2. Extension automatically opens the transcript panel (or prompts user to open it)
3. Transcript text extracted from the panel DOM (works with auto-generated captions in any language)
4. Transcript runs through the same claim extraction → verification pipeline
5. Results displayed with video metadata

### Live Mode (Audio — Non-YouTube)
1. User clicks "Start Live Fact-Check" on any page with audio
2. Service worker gets tab audio stream via `chrome.tabCapture`
3. Offscreen document captures audio at 16kHz, converts to Int16 PCM
4. Audio streamed to Deepgram Nova-2 via WebSocket in real-time
5. Deepgram returns transcribed sentences
6. Every 5 sentences → Groq extracts check-worthy claims
7. Claims verified with rolling transcript context
8. Verdicts appear in side panel as video/audio plays

### Manual Mode
1. Select any text on any webpage
2. Right-click → "Fact Check This"
3. Side panel opens with verification results for the selected text

## Project Structure

```
nolie/
├── src/
│   ├── manifest.json          # Extension manifest (MV3)
│   ├── assets/                # Icons (NL monogram), logo SVG
│   ├── background/
│   │   └── service-worker.js  # Pipeline orchestration, message routing, YouTube handling
│   ├── content/
│   │   ├── content.js         # Page text/image extraction + heatmap overlay
│   │   ├── youtube.js         # YouTube transcript extraction utilities
│   │   ├── live-factcheck.js  # Live caption polling for real-time fact-checking
│   │   └── heatmap.css        # Inline highlight styles (green/yellow/red)
│   ├── data/
│   │   └── mbfc.json          # Media Bias/Fact Check dataset (3,920 domains)
│   ├── lib/
│   │   ├── constants.js       # Message types, storage keys, model names, prompts
│   │   ├── groq.js            # Groq API: claim extraction + verification
│   │   ├── agent.js           # Agent Mode client: calls LangGraph agent on Railway + circuit breaker
│   │   ├── cross-verify.js    # Adversarial second-pass cross-verification
│   │   ├── dedup.js           # Semantic claim deduplication
│   │   ├── gemini.js          # Gemini API: image/video multimodal analysis
│   │   ├── mbfc.js            # MBFC domain lookup with subdomain fallback
│   │   ├── rag.js             # Self-learning RAG: embed, search, store verified claims
│   │   └── export.js          # HTML report generation
│   ├── offscreen/
│   │   ├── offscreen.html   # Hidden document for audio capture
│   │   └── offscreen.js     # Tab audio capture + Deepgram WebSocket streaming
│   ├── options/               # Settings page (API keys, preferences, custom prompt)
│   ├── popup/                 # Extension popup ("Scan This Page" button)
│   └── sidepanel/             # Results display (score, claims, history, export)
├── scripts/
│   └── generate-icons.js      # PNG icon generation from SVG
├── package.json
├── vite.config.js
└── .gitignore
```

## Self-Learning RAG Cache

NoLie maintains a growing knowledge base of verified claims using Retrieval-Augmented Generation (RAG):

1. Every claim is embedded using Gemini's embedding model (768-dimensional vectors)
2. Before verification, the system searches Supabase pgvector for semantically similar claims (threshold: 0.92)
3. If a match is found → return cached verdict instantly (zero API cost, zero latency)
4. If no match → verify with Groq as usual
5. After cross-verification, HIGH confidence + non-disputed claims are stored for future use

**Safety mechanisms:**
- Only cross-verified claims are stored (prevents caching wrong answers)
- Similarity threshold of 0.92 prevents false cache hits
- Cache is read-only when cross-verification is disabled (prevents poisoning)

**Result:** The system gets faster and cheaper over time as the knowledge base grows.

## Credibility Scoring

The overall credibility score (0-100) is calculated using:

- **Claim verdicts** — TRUE (100), MISLEADING (40), UNVERIFIABLE (50), FALSE (0)
- **Confidence weighting** — HIGH (1.0x), MEDIUM (0.8x), LOW (0.5x)
- **Claim importance** — HIGH (1.5x), MEDIUM (1.0x), LOW (0.7x)
- **Image penalties** — each flagged image reduces score by 10 points
- **Source credibility adjustment** — HIGH (+5), MIXED (-5), LOW (-15), VERY LOW (-25)

## Evaluation Results

An ablation study was conducted on 50 claims across 3 pipeline configurations:

| Configuration | Accuracy | vs Baseline |
|---|---|---|
| A. Bare model (naive prompt) | 84% | — |
| B. Structured verification prompt | 82% | -2% |
| C. Full pipeline (structured + article context) | **90%** | **+6%** |

Key finding: Context-aware verification achieves 90% accuracy — a 6 percentage point improvement over the naive baseline. The improvement comes specifically from nuanced/misleading claims where article context provides necessary information (updated statistics, technical precision, historical context).
"Note: Config B's dip reflects a real tradeoff — stricter prompting reduced hallucinated claims (claims invented by the model that weren't in the source text) but became slightly more conservative in judgment. Config C's two-step cross-verification recovers this cost and improves further by explicitly checking each claim against the source before scoring.

The evaluation script and full results are in `eval/`.

## API Limits (Free Tier)

| Provider | Free Limit | Used For |
|----------|-----------|----------|
| Groq | 14,400 req/day, 30 RPM | Claim extraction + verification |
| Gemini | Limited (varies by model) | Image/video analysis (optional) |
| Deepgram | $200 free credit (~200 hours of audio) | Real-time audio transcription |
| Supabase | 500MB, 50K rows free | RAG vector cache |
| Gemini Embedding | 1,500 req/day | Claim embeddings |

## Limitations

- YouTube transcript extraction requires the transcript panel to be open (auto-opened when possible)
- Image analysis depends on Gemini quota availability
- In standard mode, Groq's model has a knowledge cutoff — very recent events may be marked UNVERIFIABLE (Agent Mode mitigates this via web search)
- Auto-generated YouTube captions may have transcription errors that affect claim accuracy
- MBFC dataset covers English-language news sources primarily
- Deepgram real-time mode requires the backend to be deployed (for token issuance)
- Tab audio capture mutes briefly on start (Chrome limitation), then resumes

## Development

```
npm run dev    # Build with watch mode
npm run build  # Production build
```

After building, reload the extension in `chrome://extensions` to see changes.

## License

MIT
