# NoLie — AI-Powered Content Credibility & Fact Verification

## Overview

NoLie is a Chrome extension that automatically scans news articles and YouTube videos, extracts factual claims, verifies them using AI, analyzes images for manipulation, and provides credibility scores. Built as part of a Gen AI internship project focused on content credibility and fact verification.

## Features

- **Full article scanning** — one-click scan extracts and verifies all factual claims from any news article
- **YouTube video fact-checking** — automatically extracts video transcript (auto-generated or manual captions) and verifies claims from spoken content
- **AI-powered claim extraction** — identifies specific, verifiable factual statements, filtering out opinions and predictions
- **Context-aware verification** — each claim is verified with full article/transcript context for accurate assessment
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
Claim Extraction (Groq - Llama 3.3 70B)
        |
        v
Claim Verification with full context (Groq - Llama 3.3 70B)
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

### Provider Responsibilities

| Provider | Role | Why |
|----------|------|-----|
| Groq (Llama 3.3 70B) | Claim extraction + verification | Fast, free tier (14,400 req/day), great at structured JSON output |
| Google Gemini (3.6 Flash) | Image/video multimodal analysis | Handles images natively, detects AI-generated content |
| MBFC Dataset | Source credibility + bias scoring | Bundled offline (3,920 domains), no API needed |

## Tech Stack

- Chrome Extension (Manifest V3)
- Vanilla JS + CSS (dark Notion-style theme)
- Vite + @crxjs/vite-plugin (build tooling)
- Groq API (Llama 3.3 70B) — text analysis
- Google Gemini API (3.6 Flash) — multimodal image analysis
- MBFC Dataset — source credibility (bundled JSON, 3,920 domains)
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

## How It Works

### News Articles
1. User clicks "Scan This Page" from the extension popup
2. Content script extracts article text, images, embedded videos, and metadata (domain, date, author)
3. Article text sent to Groq (Llama 3.3 70B) to extract verifiable factual claims
4. Each claim verified individually with full article context provided
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
│   │   └── heatmap.css        # Inline highlight styles (green/yellow/red)
│   ├── data/
│   │   └── mbfc.json          # Media Bias/Fact Check dataset (3,920 domains)
│   ├── lib/
│   │   ├── constants.js       # Message types, storage keys, prompts
│   │   ├── groq.js            # Groq API: claim extraction + verification
│   │   ├── gemini.js          # Gemini API: image/video multimodal analysis
│   │   ├── mbfc.js            # MBFC domain lookup with subdomain fallback
│   │   └── export.js          # HTML report generation
│   ├── options/               # Settings page (API keys, preferences, custom prompt)
│   ├── popup/                 # Extension popup ("Scan This Page" button)
│   └── sidepanel/             # Results display (score, claims, history, export)
├── scripts/
│   └── generate-icons.js      # PNG icon generation from SVG
├── package.json
├── vite.config.js
└── .gitignore
```

## Credibility Scoring

The overall credibility score (0-100) is calculated using:

- **Claim verdicts** — TRUE (100), MISLEADING (40), UNVERIFIABLE (50), FALSE (0)
- **Confidence weighting** — HIGH (1.0x), MEDIUM (0.8x), LOW (0.5x)
- **Claim importance** — HIGH (1.5x), MEDIUM (1.0x), LOW (0.7x)
- **Image penalties** — each flagged image reduces score by 10 points
- **Source credibility adjustment** — HIGH (+5), MIXED (-5), LOW (-15), VERY LOW (-25)

## API Limits (Free Tier)

| Provider | Free Limit | Used For |
|----------|-----------|----------|
| Groq | 14,400 req/day, 30 RPM | Claim extraction + verification |
| Gemini | Limited (varies by model) | Image/video analysis (optional) |

## Limitations

- YouTube transcript extraction requires the transcript panel to be open (auto-opened when possible)
- Image analysis depends on Gemini quota availability
- Groq's Llama 3.3 70B has a knowledge cutoff — very recent events may be marked UNVERIFIABLE
- Auto-generated YouTube captions may have transcription errors that affect claim accuracy
- MBFC dataset covers English-language news sources primarily

## Development

```
npm run dev    # Build with watch mode
npm run build  # Production build
```

After building, reload the extension in `chrome://extensions` to see changes.

## License

MIT
