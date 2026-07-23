# NoLie -- AI-Powered Content Credibility & Fact Verification

## Overview

NoLie is a Chrome extension that automatically scans news articles, extracts factual claims, verifies them using AI, analyzes images for manipulation, and provides credibility scores. Built as part of a Gen AI internship project focused on content credibility and fact verification.

## Features

- **Auto-scan full articles** with one click from the extension popup
- **AI-powered claim extraction** -- identifies verifiable factual statements from article text
- **Claim verification with article context** -- each claim verified individually with full surrounding context
- **Image analysis** -- detects AI-generated images and manipulation using multimodal AI
- **Source credibility scoring** -- uses MBFC dataset (3,920+ domains) for bias and factual reporting ratings
- **Credibility heatmap overlay** -- highlights claims directly on the article (green/yellow/red)
- **Manual fact-check mode** -- select text, right-click, "Fact Check This"
- **Scan history with detail view** -- click any past scan to see full results
- **Exportable HTML reports** -- downloadable reports with clickable source citations
- **Customizable verification prompts** -- tailor how NoLie verifies claims
- **Dark Notion-style UI** -- clean, minimal side panel interface

## Architecture

```
Content Extraction -> Claim Extraction (Groq) -> Verification (Groq) -> Image Analysis (Gemini) -> MBFC Scoring -> Results Display
```

- **Groq API (Llama 3.3 70B):** claim extraction and verification (fast, free tier available)
- **Google Gemini (2.5 Flash):** multimodal image/video analysis
- **MBFC Dataset:** source credibility and bias assessment (bundled offline, no network needed)
- **Chrome Side Panel API:** results display
- **Vite + @crxjs/vite-plugin:** build tooling

## Tech Stack

- Chrome Extension (Manifest V3)
- Vanilla JS + CSS (Notion-style dark theme)
- Vite (build tool with @crxjs/vite-plugin)
- Groq API -- claim extraction and verification
- Google Gemini API -- image/video multimodal analysis
- MBFC Dataset -- source credibility (3,920 domains)

## Setup

1. Clone the repo
2. `npm install`
3. `npm run build`
4. Open `chrome://extensions` -> Enable Developer Mode -> Load Unpacked -> select `dist/`
5. Click the NoLie icon -> Settings -> Add your API keys:
   - Groq API key (free at [console.groq.com](https://console.groq.com))
   - Gemini API key (free at [aistudio.google.com](https://aistudio.google.com))
6. Navigate to any news article -> click NoLie -> "Scan This Page"

## Project Structure

```
nolie/
├── src/
│   ├── manifest.json
│   ├── assets/          # Icons, logo
│   ├── background/      # Service worker - pipeline orchestration
│   ├── content/         # Page extraction + heatmap overlay
│   ├── data/            # MBFC dataset (3,920 domains)
│   ├── lib/             # AI modules: groq.js, gemini.js, mbfc.js, export.js
│   ├── options/         # Settings page
│   ├── popup/           # Extension popup
│   └── sidepanel/       # Results display
├── scripts/             # Icon generation
├── package.json
└── vite.config.js
```

## How It Works

1. User clicks "Scan This Page" on a news article
2. Content script extracts article text, images, videos, and metadata
3. Text sent to Groq (Llama 3.3 70B) to extract verifiable factual claims
4. Each claim verified individually with full article context
5. Images analyzed by Gemini for AI-generation and manipulation
6. Domain checked against MBFC dataset for source reliability
7. Credibility score calculated (weighted by verdicts, confidence, source rating)
8. Results displayed in side panel and heatmap applied to article

## Screenshots

(Add later)

## API Limits (Free Tier)

| Provider | Free Limit | Used For |
|----------|-----------|----------|
| Groq | 14,400 req/day, 30 RPM | Claim extraction + verification |
| Gemini | ~20 grounded req/day | Image/video analysis |

## License

MIT
