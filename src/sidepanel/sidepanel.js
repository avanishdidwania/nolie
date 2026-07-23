import { MSG, STORAGE_KEY } from '../lib/constants.js';
import { generateHtmlReport } from '../lib/export.js';

// Suppress Vite module preload polyfill error in extension side panel
window.addEventListener('unhandledrejection', (e) => {
  if (e.reason?.message?.includes('replaceChild')) e.preventDefault();
});

// DOM references
const emptyState = document.getElementById('emptyState');
const loadingState = document.getElementById('loadingState');
const resultsContainer = document.getElementById('resultsContainer');
const progressFill = document.getElementById('progressFill');
const progressText = document.getElementById('progressText');
const scoreValue = document.getElementById('scoreValue');
const sourceBadge = document.getElementById('sourceBadge');
const biasBadge = document.getElementById('biasBadge');
const articleInfo = document.getElementById('articleInfo');
const articleDomain = document.getElementById('articleDomain');
const claimCount = document.getElementById('claimCount');
const claimsList = document.getElementById('claimsList');
const imagesSection = document.getElementById('imagesSection');
const imageCount = document.getElementById('imageCount');
const imagesList = document.getElementById('imagesList');
const videosSection = document.getElementById('videosSection');
const videoCount = document.getElementById('videoCount');
const videosList = document.getElementById('videosList');
const exportBtn = document.getElementById('exportBtn');
const settingsBtn = document.getElementById('settingsBtn');
const exportResultsBtn = document.getElementById('exportResultsBtn');
const tabs = document.querySelectorAll('.tab');
const historyTab = document.getElementById('historyTab');
const resultsTab = document.getElementById('resultsTab');

let currentResults = null;

// Tab switching
tabs.forEach(tab => {
  tab.addEventListener('click', () => {
    tabs.forEach(t => t.classList.remove('active'));
    tab.classList.add('active');

    const target = tab.dataset.tab;
    if (target === 'results') {
      resultsTab.classList.add('active');
      resultsTab.classList.remove('hidden');
      historyTab.classList.remove('active');
      historyTab.classList.add('hidden');
    } else {
      historyTab.classList.add('active');
      historyTab.classList.remove('hidden');
      resultsTab.classList.remove('active');
      resultsTab.classList.add('hidden');
      loadHistory();
    }
  });
});

// Settings button
settingsBtn.addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
});

// Message listener
chrome.runtime.onMessage.addListener((message) => {
  switch (message.type) {
    case MSG.SCAN_PROGRESS:
      showLoading(message.text, message.progress);
      break;
    case MSG.SCAN_COMPLETE:
      showResults(message.results);
      break;
    case MSG.SCAN_ERROR:
      showError(message.error);
      break;
    case MSG.GET_HISTORY:
      switchToHistoryTab();
      break;
  }
});

function switchToHistoryTab() {
  tabs.forEach(t => t.classList.remove('active'));
  document.querySelector('[data-tab="history"]').classList.add('active');
  resultsTab.classList.remove('active');
  resultsTab.classList.add('hidden');
  historyTab.classList.add('active');
  historyTab.classList.remove('hidden');
  loadHistory();
}

function showLoading(text, progress) {
  emptyState.classList.add('hidden');
  resultsContainer.classList.add('hidden');
  loadingState.classList.remove('hidden');

  if (text) {
    progressText.textContent = text;
  }
  if (progress !== undefined) {
    progressFill.style.width = `${progress}%`;
  }
}

function showResults(results) {
  currentResults = results;
  loadingState.classList.add('hidden');
  emptyState.classList.add('hidden');
  resultsContainer.classList.remove('hidden');

  // Score
  const score = results.score ?? 0;
  scoreValue.textContent = score;
  scoreValue.className = `score-value ${getScoreClass(score)}`;

  // Source badge
  if (results.source) {
    sourceBadge.textContent = results.source;
    sourceBadge.classList.remove('hidden');
  } else {
    sourceBadge.classList.add('hidden');
  }

  // Bias badge
  if (results.bias) {
    biasBadge.textContent = results.bias;
    biasBadge.classList.remove('hidden');
  } else {
    biasBadge.classList.add('hidden');
  }

  // Article info
  if (results.domain) {
    articleDomain.textContent = 'Source: ' + results.domain;
    articleInfo.classList.remove('hidden');
  } else {
    articleInfo.classList.add('hidden');
  }

  // Claims
  const claims = results.claims || [];
  claimCount.textContent = claims.length;
  claimsList.innerHTML = claims.map((c, i) => renderClaim(c, i)).join('');

  // Images
  const images = results.images || [];
  if (images.length > 0) {
    imagesSection.classList.remove('hidden');
    imageCount.textContent = images.length;
    imagesList.innerHTML = images.map(renderImage).join('');
  } else {
    imagesSection.classList.add('hidden');
  }

  // Videos
  const videos = results.videos || [];
  if (videos.length > 0) {
    videosSection.classList.remove('hidden');
    videoCount.textContent = videos.length;
    videosList.innerHTML = videos.map(renderVideo).join('');
  } else {
    videosSection.classList.add('hidden');
  }

  // Auto-apply heatmap
  chrome.tabs.query({ active: true, lastFocusedWindow: true }).then(([tab]) => {
    if (tab && results.claims) {
      chrome.tabs.sendMessage(tab.id, { type: MSG.APPLY_HEATMAP, claims: results.claims }).catch(() => {});
    }
  });
}

function showError(error) {
  loadingState.classList.add('hidden');
  emptyState.classList.remove('hidden');
  resultsContainer.classList.add('hidden');
  emptyState.innerHTML = `
    <div class="empty-icon">⚠️</div>
    <h2>Error</h2>
    <p>${escapeHtml(error || 'An unexpected error occurred.')}</p>
  `;
}

function renderClaim(claim, index) {
  const verdictClass = getVerdictClass(claim.verdict);
  const sources = (claim.sources || []).map((s, i) => {
    const src = String(s);
    if (src.startsWith('http')) {
      // Direct URL — make it a clickable link
      const domain = (() => { try { return new URL(src).hostname; } catch { return src; } })();
      return `<a href="${escapeHtml(src)}" target="_blank" class="source-link">${escapeHtml(domain)}</a>`;
    }
    // Source name — make it a Google search link so it's useful
    const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(src)}`;
    return `<a href="${searchUrl}" target="_blank" class="source-link">${escapeHtml(src)}</a>`;
  }).join('');

  return `
    <div class="claim-card">
      <div class="claim-header">
        <span class="claim-number">#${index + 1}</span>
        <span class="verdict-badge ${verdictClass}">${escapeHtml(claim.verdict || 'UNKNOWN')}</span>
        <span class="confidence conf-${(claim.confidence || '').toLowerCase()}">${escapeHtml(claim.confidence || '')}</span>
      </div>
      <p class="claim-text">"${escapeHtml(claim.claim || '')}"</p>
      <p class="claim-explanation">${escapeHtml(claim.explanation || '')}</p>
      ${sources ? `<div class="claim-sources">${sources}</div>` : ''}
    </div>
  `;
}

function renderImage(img) {
  const status = img.flagged ? 'flagged' : 'ok';
  const statusClass = img.flagged ? 'flagged' : 'ok';

  return `
    <div class="image-card">
      <img src="${escapeHtml(img.thumbnail || img.url || '')}" alt="Analyzed image" class="image-thumbnail">
      <div class="image-info">
        <span class="status-badge ${statusClass}">${status}</span>
        <p class="image-analysis">${escapeHtml(img.analysis || '')}</p>
      </div>
    </div>
  `;
}

function renderVideo(video) {
  const status = video.flagged ? 'flagged' : 'ok';
  const statusClass = video.flagged ? 'flagged' : 'ok';

  return `
    <div class="video-card">
      <div class="video-info">
        <h4 class="video-title">${escapeHtml(video.title || 'Untitled video')}</h4>
        <span class="status-badge ${statusClass}">${status}</span>
        <p class="video-analysis">${escapeHtml(video.analysis || '')}</p>
      </div>
    </div>
  `;
}

// Export button
function exportReport() {
  if (!currentResults) return;

  // Export as HTML report
  const html = generateHtmlReport(currentResults);
  const blob = new Blob([html], { type: 'text/html' });
  const url = URL.createObjectURL(blob);
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const a = document.createElement('a');
  a.href = url;
  a.download = `nolie-report-${timestamp}.html`;
  a.click();
  URL.revokeObjectURL(url);
}

exportBtn.addEventListener('click', exportReport);
exportResultsBtn.addEventListener('click', exportReport);

// History
async function loadHistory() {
  const data = await chrome.storage.local.get(STORAGE_KEY.HISTORY);
  const history = data[STORAGE_KEY.HISTORY] || [];

  const historyList = document.getElementById('historyList');
  const historyEmpty = document.getElementById('historyEmpty');

  if (history.length === 0) {
    historyList.classList.add('hidden');
    historyEmpty.classList.remove('hidden');
    return;
  }

  historyEmpty.classList.add('hidden');
  historyList.classList.remove('hidden');

  historyList.innerHTML = history.map((item, index) => {
    const scoreClass = getScoreClass(item.score);
    const date = new Date(item.timestamp).toLocaleDateString();
    const time = new Date(item.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const claimNum = item.claimCount || 0;

    return `
      <div class="history-item" data-index="${index}">
        <div class="history-score ${scoreClass}">${item.score}</div>
        <div class="history-details">
          <span class="history-domain">${escapeHtml(item.domain || 'Unknown')}</span>
          <span class="history-date">${date} · ${time}</span>
          <span class="history-claims">${claimNum} claim${claimNum !== 1 ? 's' : ''} verified</span>
        </div>
        <span class="history-arrow">→</span>
      </div>
    `;
  }).join('');

  // Click handler for history items
  historyList.querySelectorAll('.history-item').forEach(item => {
    item.addEventListener('click', () => {
      const index = parseInt(item.dataset.index);
      const entry = history[index];
      if (entry && entry.fullResults) {
        // Switch to results tab and show the historical results
        tabs.forEach(t => t.classList.remove('active'));
        document.querySelector('[data-tab="results"]').classList.add('active');
        resultsTab.classList.add('active');
        resultsTab.classList.remove('hidden');
        historyTab.classList.remove('active');
        historyTab.classList.add('hidden');
        showResults(entry.fullResults);
      }
    });
  });
}

// Helpers
function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function getScoreClass(score) {
  if (score >= 70) return 'high';
  if (score >= 40) return 'medium';
  return 'low';
}

function getVerdictClass(verdict) {
  switch (verdict) {
    case 'TRUE': return 'verdict-true';
    case 'FALSE': return 'verdict-false';
    case 'MISLEADING': return 'verdict-misleading';
    case 'UNVERIFIABLE': return 'verdict-unverifiable';
    default: return 'verdict-unknown';
  }
}
