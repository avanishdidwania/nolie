/**
 * Export NoLie scan results as HTML report.
 */

export function generateHtmlReport(results) {
  const verdictColor = (v) => {
    if (v === 'TRUE') return '#059669';
    if (v === 'FALSE') return '#dc2626';
    if (v === 'MISLEADING') return '#d97706';
    return '#6b7280';
  };

  const scoreColor = results.score >= 70 ? '#059669' : results.score >= 40 ? '#d97706' : '#dc2626';

  const claimsHtml = (results.claims || []).map((c, i) => `
    <div class="claim">
      <div class="claim-head">
        <span class="num">#${i + 1}</span>
        <span class="verdict" style="color:${verdictColor(c.verdict)}">${esc(c.verdict)}</span>
        <span class="conf">${esc(c.confidence)}</span>
      </div>
      <p class="claim-text">"${esc(c.claim)}"</p>
      <p class="explanation">${esc(c.explanation)}</p>
      ${(c.sources || []).length > 0 ? `<div class="sources">${c.sources.map((s, j) => {
        const src = String(s);
        if (src.startsWith('http')) {
          const domain = (() => { try { return new URL(src).hostname; } catch { return src; } })();
          return `<a href="${esc(src)}" target="_blank">${esc(domain)}</a>`;
        }
        return `<a href="https://www.google.com/search?q=${encodeURIComponent(src)}" target="_blank">${esc(src)}</a>`;
      }).join(' ')}</div>` : ''}
    </div>`).join('');

  const imagesHtml = (results.images || []).length > 0 ? `
    <h2>Image Analysis</h2>
    ${results.images.map(img => `
      <div class="image-item">
        <span class="${img.flagged ? 'flagged' : 'ok'}">${img.flagged ? '⚠ Flagged' : '✓ OK'}</span>
        <p>${esc(img.analysis)}</p>
      </div>`).join('')}` : '';

  const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>NoLie Report - ${esc(results.domain || 'Unknown')}</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,sans-serif;max-width:700px;margin:0 auto;padding:40px 24px;color:#1a1a1a;font-size:14px;line-height:1.6}
h1{font-size:22px;margin-bottom:4px}
.meta{font-size:12px;color:#888;margin-bottom:24px}
.score-box{display:flex;align-items:center;gap:16px;padding:16px;background:#f9fafb;border-radius:10px;margin-bottom:24px;border:1px solid #e5e7eb}
.score-num{font-size:36px;font-weight:700}
.score-label{font-size:13px;color:#555}
.badge{display:inline-block;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:600;margin-right:6px}
h2{font-size:16px;margin:24px 0 12px;text-transform:uppercase;letter-spacing:0.04em;color:#555}
.claim{border:1px solid #e5e7eb;border-radius:8px;padding:14px;margin-bottom:10px}
.claim-head{display:flex;align-items:center;gap:10px;margin-bottom:6px}
.num{font-size:11px;color:#aaa;font-weight:600}
.verdict{font-size:12px;font-weight:700;text-transform:uppercase}
.conf{font-size:11px;color:#999}
.claim-text{font-size:13px;font-style:italic;margin-bottom:4px}
.explanation{font-size:12px;color:#555}
.sources{margin-top:6px}
.sources a{font-size:11px;color:#2563eb;margin-right:10px}
.image-item{border:1px solid #e5e7eb;border-radius:8px;padding:10px;margin-bottom:8px}
.flagged{color:#dc2626;font-weight:600;font-size:12px}
.ok{color:#059669;font-weight:600;font-size:12px}
@media print{body{padding:20px}.claim{page-break-inside:avoid}}
</style></head><body>
<h1>NoLie Fact-Check Report</h1>
<div class="meta">
  <span>${esc(results.domain || '')}</span> · 
  <span>${new Date(results.timestamp).toLocaleString()}</span> · 
  <span>${(results.claims || []).length} claims verified</span>
</div>
<div class="score-box">
  <div class="score-num" style="color:${scoreColor}">${results.score}</div>
  <div>
    <div class="score-label">Credibility Score</div>
    ${results.source ? `<span class="badge">${esc(results.source.rating)}</span>` : ''}
    ${results.bias ? `<span class="badge">${esc(results.bias)}</span>` : ''}
  </div>
</div>
<h2>Claims (${(results.claims || []).length})</h2>
${claimsHtml}
${imagesHtml}
</body></html>`;

  return html;
}

function esc(str) {
  if (!str) return '';
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
