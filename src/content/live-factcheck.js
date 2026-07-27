/**
 * Live YouTube fact-checking via MutationObserver.
 * Watches real-time captions/subtitles and sends batches for verification.
 */

let liveActive = false;
let observer = null;
let captionBuffer = [];
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
  // YouTube renders captions in .ytp-caption-segment elements
  // inside .ytp-caption-window-container
  const findCaptionContainer = () => {
    return document.querySelector('.ytp-caption-window-container')
      || document.querySelector('.caption-window')
      || document.querySelector('#movie_player .ytp-caption-segment')?.parentElement?.parentElement;
  };

  let container = findCaptionContainer();

  // If captions aren't visible yet, watch for them to appear
  if (!container) {
    const playerObserver = new MutationObserver(() => {
      container = findCaptionContainer();
      if (container) {
        playerObserver.disconnect();
        attachCaptionObserver(container);
      }
    });
    const player = document.querySelector('#movie_player') || document.querySelector('#player');
    if (player) {
      playerObserver.observe(player, { childList: true, subtree: true });
    }
  } else {
    attachCaptionObserver(container);
  }
}

/**
 * Attach MutationObserver to the caption container.
 */
function attachCaptionObserver(container) {
  if (observer) observer.disconnect();

  observer = new MutationObserver((mutations) => {
    if (!liveActive) return;

    for (const mutation of mutations) {
      // Look for new caption text
      if (mutation.type === 'childList' || mutation.type === 'characterData') {
        const segments = container.querySelectorAll('.ytp-caption-segment');
        if (segments.length > 0) {
          const currentText = Array.from(segments).map(s => s.textContent.trim()).join(' ');
          if (currentText && currentText !== captionBuffer[captionBuffer.length - 1]) {
            addCaptionText(currentText);
          }
        }
      }
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

  // Send batch when we have enough
  if (captionBuffer.length >= BATCH_SIZE) {
    const batchText = captionBuffer.join(' ');

    // Don't send if it's too similar to last sent text
    if (batchText.length >= MIN_BATCH_LENGTH && batchText !== lastSentText) {
      lastSentText = batchText;
      sendBatchForVerification(batchText);
      // Keep last 2 segments as overlap for context continuity
      captionBuffer = captionBuffer.slice(-2);
    }
  }
}

/**
 * Send a batch of transcript text to the service worker for fact-checking.
 */
function sendBatchForVerification(text) {
  chrome.runtime.sendMessage({
    type: 'LIVE_BATCH',
    text: text,
    timestamp: Date.now(),
  }).catch(() => {});
}
