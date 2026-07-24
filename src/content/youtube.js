/**
 * YouTube transcript extraction.
 * Extracts captions/transcript from a YouTube video page
 * by reading the embedded player data (no API key needed).
 */

/**
 * Check if we're on a YouTube video page
 */
export function isYouTubePage() {
  return window.location.hostname === 'www.youtube.com' &&
    window.location.pathname === '/watch';
}

/**
 * Get the video ID from the current YouTube page
 */
export function getVideoId() {
  const params = new URLSearchParams(window.location.search);
  return params.get('v');
}

/**
 * Extract transcript from the current YouTube page.
 * Returns the full transcript text or null if unavailable.
 */
export async function extractTranscript() {
  try {
    // Method 1: Extract from ytInitialPlayerResponse in page scripts
    const captionUrl = getCaptionUrlFromPage();
    if (captionUrl) {
      const transcript = await fetchTranscriptFromUrl(captionUrl);
      if (transcript) return transcript;
    }

    // Method 2: Try fetching from the timedtext endpoint directly
    const videoId = getVideoId();
    if (videoId) {
      const transcript = await fetchTranscriptDirect(videoId);
      if (transcript) return transcript;
    }

    return null;
  } catch (e) {
    console.error('[NoLie] Transcript extraction failed:', e);
    return null;
  }
}

/**
 * Extract caption track URL from page's embedded player data
 */
function getCaptionUrlFromPage() {
  try {
    // YouTube stores player data in script tags
    const scripts = document.querySelectorAll('script');
    for (const script of scripts) {
      const text = script.textContent;
      if (text && text.includes('captionTracks')) {
        // Extract the caption tracks JSON
        const match = text.match(/"captionTracks":\s*(\[.*?\])/);
        if (match) {
          const tracks = JSON.parse(match[1]);
          // Prefer English, fall back to first available
          const enTrack = tracks.find(t =>
            t.languageCode === 'en' || t.languageCode?.startsWith('en')
          );
          const track = enTrack || tracks[0];
          if (track && track.baseUrl) {
            return track.baseUrl;
          }
        }
      }
    }
  } catch (e) {
    console.error('[NoLie] Caption URL extraction error:', e);
  }
  return null;
}

/**
 * Fetch and parse transcript XML from a caption URL
 */
async function fetchTranscriptFromUrl(url) {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const xml = await res.text();
    return parseTranscriptXml(xml);
  } catch (e) {
    return null;
  }
}

/**
 * Try fetching transcript directly via timedtext endpoint
 */
async function fetchTranscriptDirect(videoId) {
  const url = `https://www.youtube.com/api/timedtext?lang=en&v=${videoId}`;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const xml = await res.text();
    if (!xml || xml.length < 50) return null;
    return parseTranscriptXml(xml);
  } catch (e) {
    return null;
  }
}

/**
 * Parse YouTube's TimedText XML format into plain text
 */
function parseTranscriptXml(xml) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xml, 'text/xml');
  const textElements = doc.querySelectorAll('text');

  if (textElements.length === 0) return null;

  const lines = [];
  for (const el of textElements) {
    let text = el.textContent || '';
    // Decode HTML entities
    text = text.replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/\n/g, ' ')
      .trim();
    if (text) lines.push(text);
  }

  return lines.join(' ');
}

/**
 * Get video metadata from the page
 */
export function getVideoMetadata() {
  const title = document.querySelector('h1.ytd-video-primary-info-renderer yt-formatted-string')?.textContent
    || document.querySelector('meta[name="title"]')?.content
    || document.title.replace(' - YouTube', '');

  const channel = document.querySelector('#channel-name yt-formatted-string a')?.textContent
    || document.querySelector('meta[itemprop="author"]')?.content
    || '';

  const description = document.querySelector('meta[name="description"]')?.content || '';

  return { title, channel, description };
}
