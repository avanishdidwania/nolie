/**
 * YouTube transcript extraction.
 * Works with both manual and auto-generated captions.
 * No API key needed. No script injection (avoids CSP issues).
 * Fetches the page source directly and parses caption URLs from it.
 */

export function isYouTubePage() {
  return window.location.hostname === 'www.youtube.com' &&
    window.location.pathname === '/watch';
}

export function getVideoId() {
  const params = new URLSearchParams(window.location.search);
  return params.get('v');
}

/**
 * Main entry: extract transcript from current YouTube video.
 */
export async function extractTranscript() {
  const videoId = getVideoId();
  if (!videoId) return null;

  try {
    // Fetch the YouTube page HTML to extract caption track URL
    const pageUrl = `https://www.youtube.com/watch?v=${videoId}`;
    const res = await fetch(pageUrl);
    if (!res.ok) return null;
    const html = await res.text();

    // Extract caption tracks from the page source
    const captionUrl = extractCaptionUrl(html);
    if (!captionUrl) {
      console.log('[NoLie] No caption tracks found in page source');
      return null;
    }

    console.log('[NoLie] Found caption URL, fetching transcript...');

    // Fetch transcript in JSON3 format
    const transcript = await fetchTranscript(captionUrl);
    return transcript;
  } catch (e) {
    console.error('[NoLie] Transcript extraction failed:', e);
    return null;
  }
}

/**
 * Extract caption URL from raw YouTube page HTML.
 * Looks for captionTracks in the ytInitialPlayerResponse JSON.
 */
function extractCaptionUrl(html) {
  // Look for captionTracks in the page source
  const captionMatch = html.match(/"captionTracks":(\[.*?\])/);
  if (captionMatch) {
    try {
      // Fix escaped characters
      const raw = captionMatch[1].replace(/\\u0026/g, '&').replace(/\\"/g, '"');
      const tracks = JSON.parse(raw);
      if (tracks.length > 0) {
        // Prefer English
        const en = tracks.find(t => t.languageCode === 'en')
          || tracks.find(t => t.languageCode && t.languageCode.startsWith('en'))
          || tracks[0];
        if (en && en.baseUrl) {
          return en.baseUrl.replace(/\\u0026/g, '&');
        }
      }
    } catch (e) {
      console.error('[NoLie] Failed to parse captionTracks:', e);
    }
  }

  // Fallback: look for timedtext URL directly
  const timedtextMatch = html.match(/https:\/\/www\.youtube\.com\/api\/timedtext[^"\\]+/);
  if (timedtextMatch) {
    return timedtextMatch[0].replace(/\\u0026/g, '&');
  }

  return null;
}

/**
 * Fetch transcript from caption URL. Tries JSON3 first, then XML.
 */
async function fetchTranscript(baseUrl) {
  // Try JSON3 format
  try {
    const url = baseUrl + (baseUrl.includes('?') ? '&' : '?') + 'fmt=json3';
    const res = await fetch(url);
    if (res.ok) {
      const data = await res.json();
      if (data.events) {
        const lines = data.events
          .filter(e => e.segs)
          .map(e => e.segs.map(s => s.utf8 || '').join(''))
          .map(t => t.replace(/\n/g, ' ').trim())
          .filter(t => t.length > 0);
        if (lines.length > 0) {
          return lines.join(' ');
        }
      }
    }
  } catch (e) {
    console.log('[NoLie] JSON3 fetch failed, trying XML...');
  }

  // Fallback: XML format
  try {
    const res = await fetch(baseUrl);
    if (res.ok) {
      const xml = await res.text();
      const parser = new DOMParser();
      const doc = parser.parseFromString(xml, 'text/xml');
      const nodes = doc.querySelectorAll('text');
      if (nodes.length > 0) {
        const lines = [];
        for (const node of nodes) {
          let text = node.textContent || '';
          text = text.replace(/\n/g, ' ').trim();
          if (text) lines.push(text);
        }
        return lines.join(' ');
      }
    }
  } catch (e) {
    console.log('[NoLie] XML fetch also failed');
  }

  return null;
}

/**
 * Get video metadata from the page.
 */
export function getVideoMetadata() {
  const title = document.querySelector('#title h1 yt-formatted-string')?.textContent
    || document.querySelector('h1.ytd-video-primary-info-renderer yt-formatted-string')?.textContent
    || document.querySelector('meta[name="title"]')?.content
    || document.title.replace(' - YouTube', '');

  const channel = document.querySelector('#channel-name yt-formatted-string a')?.textContent
    || document.querySelector('meta[itemprop="author"]')?.content
    || '';

  const description = document.querySelector('meta[name="description"]')?.content || '';

  return { title, channel, description };
}
