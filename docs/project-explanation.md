# NoLie — Project Explanation for Mentor

## What is NoLie?

NoLie is an AI-powered Chrome extension that automatically analyzes digital content for credibility and factual accuracy. It extracts factual claims from news articles and YouTube videos, verifies them using AI, analyzes images for manipulation, and provides an overall credibility assessment with source reliability scoring.

It directly addresses the internship project topic: **"Generative AI-Powered Content Credibility and Fact Verification Platform"** — and goes beyond the reference project (Free Fact Checker) in several significant ways.

---

## How It Differs from Free Fact Checker (Reference Project)

| Free Fact Checker | NoLie |
|---|---|
| Manual — user must highlight text | Automatic — scans entire article with one click |
| Single claim at a time | Batch extraction of ALL verifiable claims |
| Text only | Text + Images + YouTube Videos |
| Simple TRUE/FALSE/MIXED verdict | Multi-dimensional: verdict + confidence + importance |
| No source assessment | MBFC-based source credibility scoring (3,920 domains) |
| No visual content analysis | AI-generated image detection, manipulation detection |
| No video support | YouTube transcript extraction + live real-time fact-checking |
| No history | Full scan history with detail view |
| No export | Downloadable HTML reports with citations |
| Single AI provider (Gemini) | Hybrid: Groq for text, Gemini for multimodal |

---

## Architecture

```
                    USER INTERACTION
                          |
            +-------------+-------------+
            |             |             |
      Scan Article   Scan YouTube   Live Mode
            |             |             |
            v             v             v
    +-----------------------------------------+
    |        CONTENT EXTRACTION LAYER          |
    |                                          |
    |  Articles: DOM parsing (headings,        |
    |    paragraphs, images, metadata)         |
    |  YouTube: Transcript panel DOM reading   |
    |  Live: Caption polling (1s interval)     |
    +-----------------------------------------+
                          |
                          v
    +-----------------------------------------+
    |        CLAIM EXTRACTION (Groq API)       |
    |                                          |
    |  Model: openai/gpt-oss-120b              |
    |  Structured JSON output                  |
    |  Filters: only verifiable factual claims |
    |  Ignores: opinions, predictions, filler  |
    +-----------------------------------------+
                          |
                          v
    +-----------------------------------------+
    |     CLAIM VERIFICATION (Groq API)        |
    |                                          |
    |  Each claim verified with full article   |
    |  context (WHO, WHERE, WHEN, WHAT)        |
    |  Returns: verdict, confidence,           |
    |  explanation, source citations           |
    +-----------------------------------------+
                          |
                          v
    +-----------------------------------------+
    |     IMAGE ANALYSIS (Gemini API)          |
    |                                          |
    |  Multimodal: sends image directly        |
    |  Detects: AI-generated, manipulated,     |
    |  misleading charts, caption mismatch     |
    +-----------------------------------------+
                          |
                          v
    +-----------------------------------------+
    |   SOURCE CREDIBILITY (MBFC Dataset)      |
    |                                          |
    |  3,920 domains rated for:                |
    |  - Factual reporting (HIGH/MIXED/LOW)    |
    |  - Bias direction (LEFT to RIGHT)        |
    |  Bundled offline — no API call needed    |
    +-----------------------------------------+
                          |
                          v
    +-----------------------------------------+
    |          SCORING & DISPLAY               |
    |                                          |
    |  Credibility Score (0-100) calculated    |
    |  from verdicts + confidence + source     |
    |  Results in Chrome Side Panel            |
    |  Heatmap overlay on article              |
    |  Exportable HTML reports                 |
    +-----------------------------------------+
```

---

## Key Technical Decisions

### 1. Hybrid AI Architecture (Groq + Gemini)

**Why not just one provider?**

- **Groq (openai/gpt-oss-120b)** is used for text analysis (claim extraction + verification) because:
  - Generous free tier
  - Extremely fast inference on Groq's LPU hardware
  - Great at structured JSON output
  - No billing required

- **Google Gemini** is used only for image/video analysis because:
  - Native multimodal capability (can process images directly)
  - Only provider that can detect AI-generated images reliably
  - Limited quota (used sparingly, only when needed)

This hybrid approach gives us: **cost = $0, privacy for text (no data stored), multimodal for images**.

### 2. Context-Aware Verification

The biggest quality improvement over simple fact-checking. When verifying a claim like "The incident happened 1.5km inside the tunnel", we send the FULL article context along with it. So the AI knows:
- Which tunnel (Teesta hydropower project in Sikkim)
- When (Monday's collapse)
- Who reported it (NDRF)
- What happened (gas explosion, 14 killed)

Without context, the same claim would be UNVERIFIABLE. With context, it's TRUE with HIGH confidence.

### 3. MBFC Dataset (Offline Source Scoring)

Instead of calling another API to assess source reliability, we bundle the Media Bias/Fact Check dataset directly in the extension (180KB JSON). This gives us instant, free, offline lookups for 3,920 news domains — their factual reporting rating and political bias direction.

### 4. YouTube Transcript Extraction (No Deepgram/Whisper)

For YouTube videos, we don't need expensive audio transcription because YouTube already provides captions. Our approach:
- Auto-opens the transcript panel via the page DOM
- Reads transcript text directly from YouTube's UI elements
- Works with auto-generated captions in any language
- Zero cost, no additional API

### 5. Live Real-Time Fact-Checking

For the live mode, we poll YouTube's caption elements every second:
- `.ytp-caption-segment` elements contain real-time subtitle text
- Text accumulates in a rolling buffer (6 segments per batch)
- Every batch goes through claim extraction + verification
- Claims appear in the side panel as the video plays
- Queue system with rate limit recovery prevents API overload

---

## Credibility Scoring Formula

```
Score (0-100) = Weighted average of claim verdicts
              + Source credibility adjustment
              - Image flag penalties

Verdict weights:
  TRUE = 100, MISLEADING = 40, UNVERIFIABLE = 50, FALSE = 0

Confidence multiplier:
  HIGH = 1.0x, MEDIUM = 0.8x, LOW = 0.5x

Importance multiplier:
  HIGH = 1.5x, MEDIUM = 1.0x, LOW = 0.7x

Source adjustment:
  HIGH credibility = +5, MIXED = -5, LOW = -15, VERY LOW = -25

Image penalties:
  Each flagged image = -10 points
```

---

## Features Summary

### Article Scanning
- One-click full page analysis
- Extracts all factual claims automatically
- Verifies each with web sources
- Color-coded credibility heatmap overlaid on article
- Source credibility badge + bias indicator

### YouTube Video Fact-Checking
- Extracts transcript from video (auto-generated or manual captions)
- Verifies claims from spoken content
- Works with any language YouTube supports

### Live Real-Time Mode
- Watches captions as video plays
- Claims verified and displayed in real-time (~10-15 second delay)
- Session persists after stopping (export, history)
- Queue-based rate limit management

### Manual Mode
- Select any text → right-click → "Fact Check This"
- Works on any webpage

### Image Analysis
- AI-generated detection
- Manipulation/editing detection
- Caption mismatch detection
- Misleading chart/graph detection

### History & Export
- All scans saved with full results
- Click any history item to review past analysis
- Export as HTML report with citations
- Clear history button

### Settings
- Customizable fact-check prompt
- Toggle image analysis on/off
- Adjustable max claims per scan
- Dual API key management (Groq + Gemini)

---

## Tech Stack

| Layer | Technology | Why |
|-------|-----------|-----|
| Extension | Chrome Manifest V3 | Industry standard, side panel API |
| Build | Vite + @crxjs/vite-plugin | Fast builds, ES module support |
| UI | Vanilla JS + CSS (dark theme) | No framework overhead, clean |
| Text AI | Groq API (openai/gpt-oss-120b) | Free, fast, structured output |
| Agentic verification | LangGraph agent on Railway (Agent Mode) | Autonomous multi-tool reasoning + web search |
| Vision AI | Google Gemini (3.6 Flash) | Multimodal, image analysis |
| Source Data | MBFC Dataset (bundled JSON) | Offline, 3,920 domains |
| Styling | Notion-inspired dark theme | Clean, professional |

---

## Limitations & Future Work

### Current Limitations
- Groq free tier: 100K tokens/day (enough for ~20-30 article scans)
- Live mode hits rate limits on longer videos (>5 min)
- YouTube transcript requires transcript panel to be open
- Image analysis depends on Gemini quota
- MBFC dataset covers primarily English-language sources

### Future Roadmap (V2)
- Deepgram integration for non-YouTube audio/video
- Backend server for team collaboration
- Custom trusted source lists per organization
- Multi-language UI
- Cross-reference checker (same story on multiple sites)
- Browser notifications on scan completion
- CMS integration for editorial workflows

---

## Project Statistics

- Total source files: 29
- Lines of code: ~4,800
- MBFC domains covered: 3,920
- API providers integrated: 2 (Groq + Gemini)
- Zero backend dependencies
- Zero cost to run (free tier APIs)
- Build time: ~300ms
- Extension size: ~185KB (compressed)

---

## How to Demo

1. **Article scan:** Open any BBC/CNN article → click NoLie → "Scan This Page" → show claims, verdicts, score, heatmap
2. **YouTube scan:** Open a news video → open transcript → scan → show transcript-based verification
3. **Live mode:** Play a video with captions → Live tab → Start → watch claims appear in real-time
4. **Manual mode:** Select text on any page → right-click → "Fact Check This"
5. **History:** Show past scans, click one to view full results
6. **Export:** Download HTML report with all citations
7. **Settings:** Show customizable prompt, dual API keys, preferences
