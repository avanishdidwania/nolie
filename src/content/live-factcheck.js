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
 * Uses polling since captions appear/disappear and MutationObserver
 * can miss the initial container creation.
 */
function observeCaptions() {
  let lastCaptionText = '';

  // Poll every 1 second for caption text
  const pollInterval = setInterval(() => {
    if (!liveActive) {
      clearInterval(pollInterval);
      return;
    }

    const segments = document.querySelectorAll('.ytp-caption-segment');
    if (segments.length === 0) return;

    const currentText = Array.from(segments).map(s => s.textContent.trim()).join(' ');
    if (currentText && currentText.length > 3 && currentText !== lastCaptionText) {
      lastCaptionText = currentText;
      addCaptionText(currentText);
    }
  }, 1000);

  console.log('[NoLie Live] Caption polling started');
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
