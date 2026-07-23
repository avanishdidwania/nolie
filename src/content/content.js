import { MSG } from '../lib/constants.js';

// Mark this script as loaded
window.__nolie_loaded = true;

// Listen for messages from service worker
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === MSG.EXTRACT_CONTENT) {
    const content = extractPageContent();
    sendResponse(content);
    return true;
  }

  if (msg.type === MSG.APPLY_HEATMAP) {
    applyHeatmap(msg.claims);
    return true;
  }
});

function extractPageContent() {
  const result = {
    text: '',
    images: [],
    videos: [],
    metadata: {},
  };

  // Metadata
  result.metadata.title = document.title;
  result.metadata.url = window.location.href;
  result.metadata.domain = window.location.hostname;
  result.metadata.date = getArticleDate();
  result.metadata.author = getArticleAuthor();

  // Text extraction - prioritize article content
  const article = document.querySelector('article') ||
    document.querySelector('[role="main"]') ||
    document.querySelector('.post-content') ||
    document.querySelector('.article-body') ||
    document.querySelector('.entry-content') ||
    document.querySelector('main');

  const container = article || document.body;

  const textElements = container.querySelectorAll('h1, h2, h3, h4, h5, h6, p, blockquote, li, figcaption');
  const textParts = [];
  textElements.forEach(el => {
    const text = el.textContent.trim();
    if (text.length > 20) textParts.push(text);
  });
  result.text = textParts.join('\n\n');

  // Images
  const images = container.querySelectorAll('img');
  images.forEach(img => {
    if (img.naturalWidth < 100 || img.naturalHeight < 100) return; // skip tiny images
    if (img.src.includes('avatar') || img.src.includes('logo') || img.src.includes('icon')) return;
    result.images.push({
      url: img.src,
      alt: img.alt || '',
      caption: getImageCaption(img),
    });
  });

  // Videos (YouTube embeds and HTML5 video)
  const iframes = container.querySelectorAll('iframe[src*="youtube"], iframe[src*="youtu.be"]');
  iframes.forEach(iframe => {
    const src = iframe.src;
    const videoId = extractYouTubeId(src);
    if (videoId) {
      result.videos.push({
        type: 'youtube',
        id: videoId,
        thumbnail: `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`,
        title: iframe.title || '',
      });
    }
  });

  const videoElements = container.querySelectorAll('video');
  videoElements.forEach(video => {
    result.videos.push({
      type: 'html5',
      poster: video.poster || '',
      title: video.title || '',
    });
  });

  return result;
}

function getArticleDate() {
  const selectors = [
    'meta[property="article:published_time"]',
    'meta[name="date"]',
    'meta[name="pubdate"]',
    'time[datetime]',
    '.date', '.published', '.post-date',
  ];
  for (const sel of selectors) {
    const el = document.querySelector(sel);
    if (el) {
      return el.getAttribute('content') || el.getAttribute('datetime') || el.textContent.trim();
    }
  }
  return '';
}

function getArticleAuthor() {
  const selectors = [
    'meta[name="author"]',
    'meta[property="article:author"]',
    '.author', '.byline', '[rel="author"]',
  ];
  for (const sel of selectors) {
    const el = document.querySelector(sel);
    if (el) return el.getAttribute('content') || el.textContent.trim();
  }
  return '';
}

function getImageCaption(img) {
  const figure = img.closest('figure');
  if (figure) {
    const caption = figure.querySelector('figcaption');
    if (caption) return caption.textContent.trim();
  }
  return '';
}

function extractYouTubeId(url) {
  const match = url.match(/(?:embed\/|v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
  return match ? match[1] : null;
}

// Heatmap overlay
function applyHeatmap(claims) {
  // Remove existing heatmap
  document.querySelectorAll('.nolie-highlight').forEach(el => {
    const parent = el.parentNode;
    parent.replaceChild(document.createTextNode(el.textContent), el);
    parent.normalize();
  });

  if (!claims || claims.length === 0) return;

  const article = document.querySelector('article') ||
    document.querySelector('[role="main"]') ||
    document.querySelector('main') ||
    document.body;

  const walker = document.createTreeWalker(article, NodeFilter.SHOW_TEXT, null);
  const textNodes = [];
  while (walker.nextNode()) textNodes.push(walker.currentNode);

  claims.forEach(claim => {
    const claimText = claim.claim.toLowerCase();
    const words = claimText.split(/\s+/).filter(w => w.length > 4);
    if (words.length === 0) return;

    for (const node of textNodes) {
      const nodeText = node.textContent.toLowerCase();
      const matchCount = words.filter(w => nodeText.includes(w)).length;
      if (matchCount / words.length >= 0.5 && node.textContent.trim().length > 20) {
        const span = document.createElement('span');
        span.className = 'nolie-highlight nolie-' + claim.verdict.toLowerCase();
        span.title = `${claim.verdict}: ${claim.explanation}`;
        node.parentNode.replaceChild(span, node);
        span.appendChild(document.createTextNode(node.textContent));
        break;
      }
    }
  });
}
