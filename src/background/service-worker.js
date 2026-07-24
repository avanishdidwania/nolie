import { MSG, STORAGE_KEY, MODEL } from '../lib/constants.js';
import { extractClaims as groqExtractClaims, verifyClaims as groqVerifyClaims } from '../lib/groq.js';
import { analyzeImages as aiAnalyzeImages, analyzeVideos as aiAnalyzeVideos } from '../lib/gemini.js';
import { lookupDomain } from '../lib/mbfc.js';

// Context menu for manual fact-checking
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'factCheckSelection',
    title: 'Fact Check This',
    contexts: ['selection'],
  });
});

// Context menu click handler
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === 'factCheckSelection' && info.selectionText) {
    await chrome.sidePanel.open({ tabId: tab.id });
    setTimeout(() => {
      handleSelectionScan(info.selectionText, tab);
    }, 500);
  }
});

// Keyboard shortcut
chrome.commands.onCommand.addListener(async (command, tab) => {
  if (command === 'scan-page') {
    await chrome.sidePanel.open({ tabId: tab.id });
    handlePageScan(tab.id);
  }
});

// Message handler
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === MSG.SCAN_PAGE) {
    handlePageScan(msg.tabId);
  }
  if (msg.type === MSG.SCAN_SELECTION) {
    handleSelectionScan(msg.text, { id: msg.tabId });
  }
});

async function handlePageScan(tabId) {
  try {
    broadcast({ type: MSG.SCAN_PROGRESS, text: 'Extracting content...', progress: 10 });

    // Inject content script if not already loaded
    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        func: () => {
          return !!window.__nolie_loaded;
        },
      });
    } catch (e) {
      broadcast({ type: MSG.SCAN_ERROR, error: 'Cannot scan this page. Try refreshing or navigate to a regular web page.' });
      return;
    }

    // Small delay to ensure content script is ready
    await new Promise(r => setTimeout(r, 300));

    // Check if this is a YouTube page
    const tab = await chrome.tabs.get(tabId);
    const isYouTube = tab.url && tab.url.includes('youtube.com/watch');

    if (isYouTube) {
      await handleYouTubeScan(tabId, tab);
      return;
    }

    // Regular article scan
    const content = await chrome.tabs.sendMessage(tabId, { type: MSG.EXTRACT_CONTENT });

    if (!content || !content.text) {
      broadcast({ type: MSG.SCAN_ERROR, error: 'Could not extract content from this page. Make sure you are on a news article.' });
      return;
    }

    if (content.text.length < 100) {
      broadcast({ type: MSG.SCAN_ERROR, error: 'Not enough text content found on this page to analyze.' });
      return;
    }

    await runPipeline(content);
  } catch (e) {
    if (e.message.includes('Cannot access') || e.message.includes('chrome://')) {
      broadcast({ type: MSG.SCAN_ERROR, error: 'Cannot scan this page. NoLie works on regular web pages (not browser internal pages).' });
    } else {
      broadcast({ type: MSG.SCAN_ERROR, error: 'Failed to scan page: ' + e.message });
    }
  }
}

async function handleYouTubeScan(tabId, tab) {
  broadcast({ type: MSG.SCAN_PROGRESS, text: 'Extracting YouTube transcript...', progress: 15 });

  // Use executeScript with MAIN world to access YouTube's global variables
  let captionUrl = null;
  try {
    const [result] = await chrome.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      func: () => {
        try {
          // Try multiple sources for player response
          const sources = [
            window.ytInitialPlayerResponse,
            document.querySelector('#movie_player')?.getPlayerResponse?.(),
          ].filter(Boolean);

          for (const pr of sources) {
            const tracks = pr?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
            if (tracks && tracks.length > 0) {
              const en = tracks.find(t => t.languageCode === 'en')
                || tracks.find(t => t.languageCode?.startsWith('en'))
                || tracks[0];
              if (en?.baseUrl) return { url: en.baseUrl, lang: en.languageCode, kind: en.kind || 'manual' };
            }
          }

          // Last resort: search for it in page source
          const html = document.documentElement.innerHTML;
          const m = html.match(/"captionTracks":(\[.*?\])/);
          if (m) {
            const tracks = JSON.parse(m[1].replace(/\\u0026/g, '&'));
            const en = tracks.find(t => t.languageCode === 'en') || tracks[0];
            if (en?.baseUrl) return { url: en.baseUrl.replace(/\\u0026/g, '&'), lang: en.languageCode, kind: en.kind || 'unknown' };
          }

          return null;
        } catch (e) { return { error: e.message }; }
      },
    });
    const data = result?.result;
    if (data?.error) {
      broadcast({ type: MSG.SCAN_ERROR, error: 'YouTube data access error: ' + data.error });
      return;
    }
    captionUrl = data?.url;
    console.log('[NoLie] Caption data:', data);
  } catch (e) {
    broadcast({ type: MSG.SCAN_ERROR, error: 'Cannot access YouTube page data. Try refreshing the page.' });
    return;
  }

  if (!captionUrl) {
    broadcast({ type: MSG.SCAN_ERROR, error: 'Could not find captions for this video. It may not have subtitles available.' });
    return;
  }

  // Fetch transcript by auto-opening the transcript panel then reading DOM
  broadcast({ type: MSG.SCAN_PROGRESS, text: 'Opening transcript panel...', progress: 15 });
  
  // First, auto-open the transcript panel
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      func: async () => {
        // Check if transcript panel is already open
        const panels = document.querySelectorAll('ytd-engagement-panel-section-list-renderer');
        for (const p of panels) {
          if (p.innerText && p.innerText.length > 200 && p.getAttribute('target-id')?.includes('transcript')) {
            return; // Already open
          }
        }

        // Try to find and click the transcript button
        // Method 1: Click "Show transcript" in description
        const descButtons = document.querySelectorAll('ytd-video-description-transcript-section-renderer button');
        if (descButtons.length > 0) {
          descButtons[0].click();
          return;
        }

        // Method 2: Click via the "..." menu under the video
        const moreBtn = document.querySelector('#button-shape > button[aria-label="More actions"]') 
          || document.querySelector('ytd-menu-renderer yt-button-shape button');
        if (moreBtn) {
          moreBtn.click();
          await new Promise(r => setTimeout(r, 500));
          const menuItems = document.querySelectorAll('tp-yt-paper-listbox ytd-menu-service-item-renderer, ytd-menu-popup-renderer tp-yt-paper-item');
          for (const item of menuItems) {
            if (item.textContent?.toLowerCase().includes('transcript')) {
              item.click();
              return;
            }
          }
          // Close menu if transcript not found
          document.body.click();
        }

        // Method 3: Use keyboard shortcut or direct engagement panel trigger
        const showTranscriptBtn = document.querySelector('[button-renderer][icon-name="yt-icons:transcript"]');
        if (showTranscriptBtn) {
          showTranscriptBtn.click();
        }
      },
    });
  } catch (e) {
    // Continue anyway — maybe panel is already open
  }

  // Wait for transcript panel to load
  await new Promise(r => setTimeout(r, 2500));

  broadcast({ type: MSG.SCAN_PROGRESS, text: 'Extracting transcript...', progress: 20 });
  let transcript = null;
  try {
    const [fetchResult] = await chrome.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      func: async () => {
        try {
          // Debug: find all possible transcript-related elements
          const selectors = [
            'ytd-transcript-segment-renderer',
            'ytd-transcript-segment-list-renderer',
            '[target-id="engagement-panel-searchable-transcript"]',
            '#segments-container',
            '.segment-text',
            'yt-formatted-string.segment-text',
            '.ytd-transcript-segment-renderer',
            'ytd-engagement-panel-section-list-renderer[target-id*="transcript"]',
            '.cue-group',
            '[class*="transcript"]',
            '[class*="caption"]',
          ];

          const found = {};
          for (const sel of selectors) {
            const els = document.querySelectorAll(sel);
            if (els.length > 0) {
              found[sel] = els.length;
            }
          }

          // Try to get text from any matching elements
          // Strategy: find the transcript panel and get all text segments
          const panel = document.querySelector('[target-id="engagement-panel-searchable-transcript"]')
            || document.querySelector('ytd-engagement-panel-section-list-renderer[target-id*="transcript"]');

          if (panel) {
            // Get ALL yt-formatted-string inside the panel
            const allText = panel.querySelectorAll('yt-formatted-string');
            const texts = Array.from(allText)
              .map(el => el.textContent.trim())
              .filter(t => t.length > 0 && !t.match(/^\d+:\d+/)); // filter out timestamps

            if (texts.length > 5) {
              return { text: texts.join(' '), method: 'panel-text', lines: texts.length };
            }
          }

          // Broader search: any element with segment in the class
          const segEls = document.querySelectorAll('[class*="segment"] yt-formatted-string, [class*="cue"] yt-formatted-string');
          if (segEls.length > 0) {
            const text = Array.from(segEls).map(el => el.textContent.trim()).filter(t => t && !t.match(/^\d+:\d+/)).join(' ');
            if (text.length > 50) return { text, method: 'segment-search', lines: segEls.length };
          }

          // Last resort: get inner text from the transcript panel area
          const panels = document.querySelectorAll('ytd-engagement-panel-section-list-renderer');
          for (const p of panels) {
            const innerText = p.innerText;
            if (innerText && innerText.length > 200 && (innerText.includes('\n') || innerText.includes('  '))) {
              // Filter out timestamps, UI text, and clean up
              const lines = innerText.split('\n')
                .map(l => l.trim())
                .filter(l => l.length > 0
                  && !l.match(/^\d+:\d+/)
                  && !l.match(/^\d+\s*seconds?$/i)
                  && !l.match(/^\d+\s*minutes?$/i)
                  && !l.match(/^Transcript$/i)
                  && !l.match(/^Search transcript$/i)
                  && !l.match(/^Search in video$/i)
                  && !l.match(/^Follow along/i)
                  && !l.match(/^Auto-scroll/i)
                  && l.length > 2
                );
              if (lines.length > 5) {
                return { text: lines.join(' '), method: 'panel-innertext', lines: lines.length };
              }
            }
          }

          return { error: 'No transcript found', foundSelectors: JSON.stringify(found) };
        } catch (e) { return { error: e.message }; }
      },
      args: [],
    });
    const fetchData = fetchResult?.result;
    console.log('[NoLie] Transcript fetch result:', fetchData);
    if (fetchData?.text) {
      transcript = fetchData.text;
    } else if (fetchData?.error) {
      broadcast({ type: MSG.SCAN_ERROR, error: 'Could not extract transcript. Try clicking "Show transcript" under the video first, then scan again.' });
      return;
    }
  } catch (e) {
    broadcast({ type: MSG.SCAN_ERROR, error: 'Failed to extract transcript: ' + e.message });
    return;
  }

  if (!transcript || transcript.length < 50) {
    broadcast({ type: MSG.SCAN_ERROR, error: 'Transcript is empty or too short to analyze.' });
    return;
  }

  // Get video title from tab
  const videoId = new URL(tab.url).searchParams.get('v');
  broadcast({ type: MSG.SCAN_PROGRESS, text: `Transcript extracted (${transcript.split(' ').length} words). Analyzing...`, progress: 25 });

  const content = {
    text: transcript,
    images: [],
    videos: [{
      type: 'youtube',
      id: videoId,
      title: tab.title?.replace(' - YouTube', '') || '',
      thumbnail: videoId ? `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg` : '',
    }],
    metadata: {
      domain: 'youtube.com',
      url: tab.url,
      title: tab.title?.replace(' - YouTube', '') || '',
    },
  };

  await runPipeline(content);
}

async function handleSelectionScan(text, tab) {
  let domain = '';
  try {
    if (tab?.url) domain = new URL(tab.url).hostname;
  } catch {}

  broadcast({ type: MSG.SCAN_PROGRESS, text: 'Verifying selected text...', progress: 20 });

  const content = {
    text: text,
    images: [],
    videos: [],
    metadata: { domain, url: tab?.url || '', title: '' },
  };
  await runPipeline(content);
}

async function runPipeline(content) {
  const apiKey = await getApiKey();
  if (!apiKey) {
    broadcast({ type: MSG.SCAN_ERROR, error: 'No API key set. Go to Settings to add your Gemini key.' });
    return;
  }

  try {
    // Step 1: Extract claims
    broadcast({ type: MSG.SCAN_PROGRESS, text: 'Extracting claims...', progress: 25 });
    const claims = await extractClaims(content.text, apiKey);

    // Step 2: Verify claims
    broadcast({ type: MSG.SCAN_PROGRESS, text: 'Verifying claims...', progress: 50 });
    const verifiedClaims = await verifyClaims(claims, apiKey, content.text);

    // Step 3: Analyze images (Gemini - optional, skip on failure)
    let imageResults = [];
    const settings = await getSettings();
    if (content.images.length > 0 && apiKey && settings.analyzeImages !== false) {
      broadcast({ type: MSG.SCAN_PROGRESS, text: 'Analyzing images...', progress: 70 });
      try {
        const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 30000));
        imageResults = await Promise.race([analyzeImages(content.images, apiKey), timeoutPromise]);
      } catch (e) {
        imageResults = content.images.map(img => ({
          url: img.url, alt: img.alt, caption: img.caption,
          flagged: false, analysis: 'Image analysis unavailable (Gemini quota exceeded). Try again later.', aiGenerated: false, manipulated: false,
        }));
      }
    }

    // Step 4: Analyze videos (Gemini - optional, skip on failure)
    let videoResults = [];
    if (content.videos.length > 0 && apiKey && settings.analyzeImages !== false) {
      broadcast({ type: MSG.SCAN_PROGRESS, text: 'Analyzing videos...', progress: 80 });
      try {
        const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 30000));
        videoResults = await Promise.race([analyzeVideos(content.videos, apiKey), timeoutPromise]);
      } catch (e) {
        videoResults = content.videos.map(v => ({
          title: v.title || 'Video', flagged: false, analysis: 'Video analysis unavailable (Gemini quota exceeded).', clickbait: false,
        }));
      }
    }

    // Step 5: Source credibility
    broadcast({ type: MSG.SCAN_PROGRESS, text: 'Assessing source credibility...', progress: 90 });
    const sourceInfo = await getSourceCredibility(content.metadata.domain);

    // Step 6: Calculate score
    const score = calculateScore(verifiedClaims, imageResults, sourceInfo);

    const results = {
      score,
      claims: verifiedClaims,
      images: imageResults,
      videos: videoResults,
      source: sourceInfo,
      bias: sourceInfo?.bias || null,
      domain: content.metadata.domain,
      url: content.metadata.url,
      title: content.metadata.title,
      timestamp: Date.now(),
    };

    // Save to history
    await saveToHistory(results);

    broadcast({ type: MSG.SCAN_COMPLETE, results });
  } catch (e) {
    broadcast({ type: MSG.SCAN_ERROR, error: 'Pipeline error: ' + e.message });
  }
}

// -- AI calls --

async function extractClaims(text, apiKey) {
  const settings = await getSettings();
  const maxClaims = parseInt(settings.maxClaims) || 10;
  const groqKey = await getGroqKey();
  if (!groqKey) {
    broadcast({ type: MSG.SCAN_ERROR, error: 'No Groq API key set. Go to Settings to add it.' });
    return [];
  }
  return groqExtractClaims(text, groqKey, maxClaims);
}

async function verifyClaims(claims, apiKey, articleText) {
  const groqKey = await getGroqKey();
  if (!groqKey) return claims.map(c => ({ ...c, verdict: 'UNVERIFIABLE', confidence: 'LOW', explanation: 'No Groq key', sources: [] }));
  return groqVerifyClaims(claims, groqKey, articleText);
}

async function analyzeImages(images, apiKey) {
  return aiAnalyzeImages(images, apiKey);
}

async function analyzeVideos(videos, apiKey) {
  return aiAnalyzeVideos(videos, apiKey);
}

async function getSourceCredibility(domain) {
  return lookupDomain(domain);
}

function calculateScore(claims, images, source) {
  if (!claims || claims.length === 0) return 50;

  // Weights: verdict-based scoring
  const verdictScores = { TRUE: 100, MISLEADING: 40, UNVERIFIABLE: 50, FALSE: 0 };
  const confidenceMultiplier = { HIGH: 1.0, MEDIUM: 0.8, LOW: 0.5 };

  let totalWeight = 0;
  let weightedScore = 0;

  claims.forEach(claim => {
    const base = verdictScores[claim.verdict] ?? 50;
    const mult = confidenceMultiplier[claim.confidence] ?? 0.7;
    const importance = claim.importance === 'HIGH' ? 1.5 : claim.importance === 'MEDIUM' ? 1.0 : 0.7;
    const weight = mult * importance;
    weightedScore += base * weight;
    totalWeight += weight;
  });

  let score = totalWeight > 0 ? Math.round(weightedScore / totalWeight) : 50;

  // Penalize for flagged images
  const flaggedImages = images.filter(img => img.flagged).length;
  if (flaggedImages > 0) {
    score = Math.max(0, score - (flaggedImages * 10));
  }

  // Source credibility adjustment
  if (source) {
    const sourceAdjust = { HIGH: 5, 'MOSTLY FACTUAL': 2, MIXED: -5, LOW: -15, 'VERY LOW': -25 };
    score = Math.max(0, Math.min(100, score + (sourceAdjust[source.rating] || 0)));
  }

  return Math.max(0, Math.min(100, score));
}

async function getSettings() {
  const data = await chrome.storage.local.get(STORAGE_KEY.SETTINGS);
  return data[STORAGE_KEY.SETTINGS] || {};
}

// -- Utilities --

async function getApiKey() {
  const data = await chrome.storage.local.get(STORAGE_KEY.API_KEY);
  return data[STORAGE_KEY.API_KEY] || null;
}

async function getGroqKey() {
  const data = await chrome.storage.local.get(STORAGE_KEY.GROQ_KEY);
  return data[STORAGE_KEY.GROQ_KEY] || null;
}

async function saveToHistory(results) {
  const data = await chrome.storage.local.get([STORAGE_KEY.HISTORY, STORAGE_KEY.SETTINGS]);
  const settings = data[STORAGE_KEY.SETTINGS] || {};
  if (settings.saveHistory === false) return;

  const history = data[STORAGE_KEY.HISTORY] || [];
  history.unshift({
    score: results.score,
    domain: results.domain,
    url: results.url,
    title: results.title,
    claimCount: results.claims.length,
    timestamp: results.timestamp,
    fullResults: results,
  });

  // Keep last 20 entries (full results are larger)
  if (history.length > 20) history.length = 20;
  await chrome.storage.local.set({ [STORAGE_KEY.HISTORY]: history });
}

function broadcast(msg) {
  chrome.runtime.sendMessage(msg).catch(() => {});
}
