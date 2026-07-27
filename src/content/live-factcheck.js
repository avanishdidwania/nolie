/**
 * Live YouTube fact-checking via MutationObserver.
 * Watches real-time captions/subtitles and sends batches for verification.
 */

let liveActive = false;
let observer = null;
let captionBuffer = [];
let fullTranscript = []; // Running full transcript for context
let lastSentText = '';
const BATCH_SIZE = 6; // Send every N caption segments
const MIN_BATCH_LENGTH = 80; // Minimum characters before sending

/**
 * Start live fact-checking on a YouTube video.
 */
export function startLiveFactCheck() {
  if (liveActive) return;
  liveActive = true;
  captionBuffer = [];
  fullTranscript = [];
  lastSentText = '';

  // Watch the caption overlay (subtitles displayed on video)
  observeCaptions();

  // Also watch the transcript panel if open
  observeTranscriptPanel();

  console.log('[NoLie] Live fact-check started');
}

/**
 * Stop live fact-checking.
 */
export function stopLiveFactCheck() {
  liveActive = false;
  if (observer) {
    observer.disconnect();
    observer = null;
  }
  captionBuffer = [];
  console.log('[NoLie] Live fact-check stopped');
}

/**
 * Observe YouTube's caption overlay (the subtitles on the video player).
 */
function observeCaptions() {
  // Try multiple selectors for the caption container
  const selectors = [
    '.ytp-caption-window-container',
    '.caption-window',
    '.ytp-caption-window-bottom',
    '#ytp-caption-window-container',
    '.captions-text',
    '#movie_player .ytp-caption-segment',
  ];

  let container = null;
  for (const sel of selectors) {
    container = document.querySelector(sel);
    if (container) break;
  }

  if (!container) {
    // Watch the whole player for caption elements to appear
    const player = document.querySelector('#movie_player') || document.querySelector('#player-container');
    if (player) {
      console.log('[NoLie Live] No caption container found yet, watching player for changes...');
      const watchForCaptions = new MutationObserver(() => {
        // Check for any caption-related element
        const captionEl = player.querySelector('.ytp-caption-segment')
          || player.querySelector('.caption-window')
          || player.querySelector('.ytp-caption-window-container')
          || player.querySelector('[class*="caption"]');
        if (captionEl) {
          console.log('[NoLie Live] Found caption element:', captionEl.className);
          watchForCaptions.disconnect();
          const captionContainer = captionEl.closest('.ytp-caption-window-container')
            || captionEl.closest('.caption-window')
            || captionEl.parentElement?.parentElement
            || captionEl.parentElement;
          attachCaptionObserver(captionContainer || captionEl);
        }
      });
      watchForCaptions.observe(player, { childList: true, subtree: true });
    }
  } else {
    console.log('[NoLie Live] Found caption container:', container.className);
    attachCaptionObserver(container);
  }
}

/**
 * Attach MutationObserver to the caption container.
 */
function attachCaptionObserver(container) {
  if (observer) observer.disconnect();

  console.log('[NoLie Live] Attaching observer to:', container.tagName, container.className);

  observer = new MutationObserver((mutations) => {
    if (!liveActive) return;

    // Get ALL text from the caption container on any change
    const segments = container.querySelectorAll('.ytp-caption-segment');
    if (segments.length > 0) {
      const currentText = Array.from(segments).map(s => s.textContent.trim()).join(' ');
      if (currentText && currentText.length > 3 && currentText !== captionBuffer[captionBuffer.length - 1]) {
        addCaptionText(currentText);
      }
      return;
    }

    // Fallback: just get innerText of the container
    const innerText = container.innerText?.trim();
    if (innerText && innerText.length > 3 && innerText !== captionBuffer[captionBuffer.length - 1]) {
      addCaptionText(innerText);
    }
  });

  observer.observe(container, {
    childList: true,
    subtree: true,
    characterData: true,
  });
}

/**
 * Observe the transcript panel for new entries (if panel is open).
 */
function observeTranscriptPanel() {
  const panels = document.querySelectorAll('ytd-engagement-panel-section-list-renderer');
  for (const panel of panels) {
    const targetId = panel.getAttribute('target-id') || '';
    if (!targetId.includes('transcript')) continue;

    const transcriptObserver = new MutationObserver(() => {
      if (!liveActive) return;
      // Check for new transcript segments
      const segments = panel.querySelectorAll('ytd-transcript-segment-renderer yt-formatted-string.segment-text');
      if (segments.length > 0) {
        const latest = segments[segments.length - 1]?.textContent?.trim();
        if (latest && latest !== captionBuffer[captionBuffer.length - 1]) {
          addCaptionText(latest);
        }
      }
    });

    transcriptObserver.observe(panel, { childList: true, subtree: true });
    break;
  }
}

/**
 * Add new caption text to the buffer and send batch if ready.
 */
function addCaptionText(text) {
  if (!text || text.length < 3) return;
  captionBuffer.push(text);
  fullTranscript.push(text);

  // Send batch when we have enough
  if (captionBuffer.length >= BATCH_SIZE) {
    const batchText = captionBuffer.join(' ');

    // Don't send if it's too similar to last sent text
    if (batchText.length >= MIN_BATCH_LENGTH && batchText !== lastSentText) {
      lastSentText = batchText;
      // Send batch text + last ~2 min of context (last 30 segments)
      const contextWindow = fullTranscript.slice(-30).join(' ');
      sendBatchForVerification(batchText, contextWindow);
      // Keep last 2 segments as overlap for context continuity
      captionBuffer = captionBuffer.slice(-2);
    }
  }
}

/**
 * Send a batch of transcript text to the service worker for fact-checking.
 */
function sendBatchForVerification(text, context) {
  chrome.runtime.sendMessage({
    type: 'LIVE_BATCH',
    text: text,
    context: context,
    timestamp: Date.now(),
  }).catch(() => {});
}
