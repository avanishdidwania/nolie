import { MSG, STORAGE_KEY, MODEL } from '../lib/constants.js';
import { extractClaims as groqExtractClaims, verifyClaims as groqVerifyClaims, extractLiveClaims as groqExtractLiveClaims } from '../lib/groq.js';
import { analyzeImages as aiAnalyzeImages, analyzeVideos as aiAnalyzeVideos } from '../lib/gemini.js';
import { crossVerifyClaims } from '../lib/cross-verify.js';
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
  if (msg.type === 'START_LIVE') {
    handleStartLive(msg.tabId);
  }
  if (msg.type === 'STOP_LIVE') {
    handleStopLive(msg.tabId);
  }
  if (msg.type === 'LIVE_BATCH') {
    handleLiveBatch(msg.text, msg.timestamp, msg.context);
  }
  if (msg.type === 'TRANSCRIPT_FINAL') {
    handleTranscriptSentence(msg.text);
  }
  if (msg.type === 'TRANSCRIPT_INTERIM') {
    broadcast({ type: 'LIVE_INTERIM', text: msg.text });
  }
  if (msg.type === 'LIVE_CONNECTED') {
    broadcast({ type: 'LIVE_CONNECTED' });
  }
  if (msg.type === 'LIVE_ERROR') {
    broadcast({ type: MSG.SCAN_ERROR, error: msg.message });
  }
  if (msg.type === 'LIVE_LOG') {
    console.log('[NoLie]', msg.message);
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
          if (p.getAttribute('target-id')?.includes('transcript')) {
            if (p.getAttribute('visibility') === 'ENGAGEMENT_PANEL_VISIBILITY_EXPANDED') return;
          }
        }

        // Method 1: Find the "Show transcript" button in the description area
        const transcriptSection = document.querySelector('ytd-video-description-transcript-section-renderer');
        if (transcriptSection) {
          const btn = transcriptSection.querySelector('button');
          if (btn) { btn.click(); return; }
        }

        // Method 2: Simulate what YouTube does internally to open transcript
        // Dispatch a custom event that YouTube's app listens to
        const evt = new CustomEvent('yt-action', {
          bubbles: true,
          composed: true,
          detail: {
            actionName: 'yt-open-engagement-panel-endpoint',
            args: [{ engagementPanelPresentationConfigs: { panelIdentifier: 'engagement-panel-searchable-transcript' } }],
          },
        });
        document.querySelector('ytd-app')?.dispatchEvent(evt);

        // Method 3: Click the description "more" to expand, then find transcript
        const expandBtn = document.querySelector('#expand, tp-yt-paper-button#expand, #description-inline-expander #expand');
        if (expandBtn && !expandBtn.hidden) {
          expandBtn.click();
          await new Promise(r => setTimeout(r, 500));
          const section = document.querySelector('ytd-video-description-transcript-section-renderer');
          if (section) {
            const b = section.querySelector('button');
            if (b) b.click();
          }
        }
      },
    });
  } catch (e) {
    // Continue anyway
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
          // Check if the transcript panel is actually open and has content
          const panels = document.querySelectorAll('ytd-engagement-panel-section-list-renderer');
          for (const p of panels) {
            const targetId = p.getAttribute('target-id') || '';
            if (!targetId.includes('transcript')) continue;
            
            const innerText = p.innerText;
            if (innerText && innerText.length > 200) {
              const lines = innerText.split('\n')
                .map(l => l.trim())
                .filter(l => l.length > 2
                  && !l.match(/^\d+:\d+/)
                  && !l.match(/^\d+\s*seconds?$/i)
                  && !l.match(/^\d+\s*minutes?$/i)
                  && !l.match(/^Transcript$/i)
                  && !l.match(/^Search transcript$/i)
                  && !l.match(/^Search in video$/i)
                  && !l.match(/^Follow along/i)
                  && !l.match(/^Auto-scroll/i)
                );
              if (lines.length > 5) {
                return { text: lines.join(' '), method: 'panel-innertext', lines: lines.length };
              }
            }
          }

          return { error: 'no-panel' };
        } catch (e) { return { error: e.message }; }
      },
      args: [],
    });
    const fetchData = fetchResult?.result;
    console.log('[NoLie] Transcript fetch result:', fetchData);
    if (fetchData?.text) {
      transcript = fetchData.text;
    } else if (fetchData?.error === 'no-panel') {
      broadcast({ type: MSG.SCAN_ERROR, error: 'Could not open transcript automatically. Please click "Show transcript" under the video description, then try scanning again.' });
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
    let verifiedClaims = await verifyClaims(claims, apiKey, content.text);

    // Step 2b: Cross-verification (if enabled)
    const settings = await getSettings();
    if (settings.crossVerify) {
      broadcast({ type: MSG.SCAN_PROGRESS, text: 'Cross-verifying claims...', progress: 60 });
      const groqKey = await getGroqKey();
      if (groqKey) {
        verifiedClaims = await crossVerifyClaims(verifiedClaims, groqKey, content.text);
      }
    }

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

// -- Live Fact-Checking --

let liveMode = false;
let liveCheckedClaims = new Set();
let liveQueue = [];
let liveProcessing = false;
let liveTabId = null;
let liveSentences = []; // Rolling transcript for context
const LIVE_WINDOW_SIZE = 5; // Sentences before triggering verification

async function handleStartLive(tabId) {
  liveMode = true;
  liveCheckedClaims = new Set();
  liveQueue = [];
  liveProcessing = false;
  liveTabId = tabId;
  liveSentences = [];

  // Delay broadcast to let side panel load
  setTimeout(() => broadcast({ type: 'LIVE_STARTED' }), 1000);

  // Check if this is a YouTube page — use caption polling
  const tab = await chrome.tabs.get(tabId);
  const isYouTube = tab.url?.includes('youtube.com/watch');

  if (isYouTube) {
    // Use caption polling (existing approach)
    try {
      await chrome.tabs.sendMessage(tabId, { type: 'START_LIVE' });
    } catch (e) {
      broadcast({ type: MSG.SCAN_ERROR, error: 'Could not start live mode. Refresh the page and try again.' });
    }
  } else {
    // Use Deepgram audio capture
    await startAudioCapture(tabId);
  }
}

async function handleStopLive(tabId) {
  liveMode = false;
  liveQueue = [];
  broadcast({ type: 'LIVE_STOPPED' });

  // Stop caption polling
  try {
    await chrome.tabs.sendMessage(tabId || liveTabId, { type: 'STOP_LIVE' });
  } catch {}

  // Stop audio capture
  await stopAudioCapture();
  liveTabId = null;
}

// Handle incoming transcribed sentences from Deepgram
function handleTranscriptSentence(text) {
  if (!liveMode || !text) return;

  liveSentences.push(text);
  broadcast({ type: 'LIVE_TRANSCRIPT', text: text });

  // Trigger verification based on accumulated text length OR sentence count
  const recentText = liveSentences.slice(-LIVE_WINDOW_SIZE).join(' ');
  const totalChars = recentText.length;

  // Send batch if we have enough text (200+ chars) OR enough sentences (5+)
  if (totalChars >= 200 || liveSentences.length % LIVE_WINDOW_SIZE === 0) {
    if (liveSentences.length > 0 && !liveProcessing) {
      const batchText = liveSentences.slice(-LIVE_WINDOW_SIZE).join(' ');
      const contextWindow = liveSentences.join(' ');
      // Reset sentence counter to prevent immediate re-trigger
      const sentencesCopy = [...liveSentences];
      liveSentences = liveSentences.slice(-2); // Keep last 2 for context overlap
      handleLiveBatch(batchText, Date.now(), contextWindow);
    }
  }
}

// -- Audio Capture via Offscreen Document --

async function startAudioCapture(tabId) {
  try {
    console.log('[NoLie] Starting audio capture for tab:', tabId);

    const streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tabId });
    console.log('[NoLie] Got stream ID');

    // Create offscreen document
    const existingContexts = await chrome.runtime.getContexts({
      contextTypes: ['OFFSCREEN_DOCUMENT'],
    });
    if (existingContexts.length === 0) {
      await chrome.offscreen.createDocument({
        url: 'src/offscreen/offscreen.html',
        reasons: ['USER_MEDIA'],
        justification: 'Audio capture and transcription',
      });
      await new Promise(r => setTimeout(r, 300));
    }

    // Tell offscreen to start — it fetches its own token
    const response = await chrome.runtime.sendMessage({
      type: 'START_CAPTURE',
      streamId,
      language: 'en',
    });
    console.log('[NoLie] START_CAPTURE response:', response);
  } catch (e) {
    console.error('[NoLie] Audio capture error:', e);
    broadcast({ type: MSG.SCAN_ERROR, error: 'Audio capture failed: ' + e.message });
  }
}

async function stopAudioCapture() {
  try { chrome.runtime.sendMessage({ type: 'STOP_CAPTURE' }); } catch {}
  try { await chrome.offscreen.closeDocument(); } catch {}
}

async function handleLiveBatch(text, timestamp, context) {
  if (!liveMode || !text) return;

  // Add to queue instead of processing immediately
  liveQueue.push({ text, timestamp, context });

  // Start processing if not already running
  if (!liveProcessing) {
    processLiveQueue();
  }
}

async function processLiveQueue() {
  if (liveProcessing || liveQueue.length === 0) return;
  liveProcessing = true;

  while (liveQueue.length > 0 && liveMode) {
    const batch = liveQueue.shift();

    const groqKey = await getGroqKey();
    if (!groqKey) break;

    try {
      // Extract claims
      const claims = await groqExtractLiveClaims(batch.text, groqKey);

      if (!claims || claims.length === 0 || !liveMode) {
        // Short wait then move to next batch
        await new Promise(r => setTimeout(r, 2000));
        continue;
      }

      // Filter duplicates
      const newClaims = claims.filter(c => {
        const key = c.claim.toLowerCase().trim().slice(0, 50);
        if (liveCheckedClaims.has(key)) return false;
        liveCheckedClaims.add(key);
        return true;
      });

      if (newClaims.length === 0) {
        await new Promise(r => setTimeout(r, 2000));
        continue;
      }

      // Wait 2 seconds between extract and verify
      await new Promise(r => setTimeout(r, 2000));

      // Verify ALL claims in one call (much faster than one-by-one)
      try {
        const verified = await groqVerifyClaims(newClaims, groqKey, batch.context || batch.text);
        if (verified.length > 0) {
          broadcast({
            type: 'LIVE_CLAIMS',
            claims: verified,
            timestamp: batch.timestamp,
          });
        }
      } catch (e) {
        if (e.message.includes('Rate limit') || e.message.includes('429')) {
          // Hit rate limit — wait 30 seconds and retry
          await new Promise(r => setTimeout(r, 30000));
          try {
            const verified = await groqVerifyClaims(newClaims, groqKey, batch.context || batch.text);
            if (verified.length > 0) {
              broadcast({ type: 'LIVE_CLAIMS', claims: verified, timestamp: batch.timestamp });
            }
          } catch { /* skip this batch */ }
        }
      }
    } catch (e) {
      console.error('[NoLie] Live batch error:', e);
      if (e.message.includes('Rate limit') || e.message.includes('429')) {
        liveQueue.unshift(batch);
        await new Promise(r => setTimeout(r, 30000));
      }
    }

    // Wait 3 seconds between batches
    await new Promise(r => setTimeout(r, 3000));
  }

  liveProcessing = false;
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
