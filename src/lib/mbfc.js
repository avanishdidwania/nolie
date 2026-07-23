/**
 * MBFC (Media Bias/Fact Check) dataset lookup.
 * Provides source credibility rating and bias direction for domains.
 */

import mbfcData from '../data/mbfc.json';

// Bias labels mapping (raw → display)
const BIAS_LABELS = {
  'left': 'LEFT',
  'left-center': 'LEFT-CENTER',
  'neutral': 'CENTER',
  'right-center': 'RIGHT-CENTER',
  'right': 'RIGHT',
};

// Factual reporting labels mapping (raw → display)
const FACTUAL_LABELS = {
  'high': 'HIGH',
  'mixed': 'MIXED',
  'low': 'LOW',
};

/**
 * Look up a domain in the MBFC dataset.
 * Tries the full domain, then strips "www." and tries subdomains.
 * @param {string} domain - e.g. "www.cnn.com"
 * @returns {{ rating: string, bias: string, rawBias: string, rawFactual: string } | null}
 */
export function lookupDomain(domain) {
  if (!domain) return null;

  // Normalize domain
  let normalized = domain.toLowerCase().trim();
  if (normalized.startsWith('www.')) {
    normalized = normalized.slice(4);
  }

  // Direct lookup
  const entry = mbfcData[normalized];
  if (entry) {
    return formatEntry(entry, normalized);
  }

  // Try parent domain (e.g., "politics.cnn.com" → "cnn.com")
  const parts = normalized.split('.');
  if (parts.length > 2) {
    const parent = parts.slice(1).join('.');
    const parentEntry = mbfcData[parent];
    if (parentEntry) {
      return formatEntry(parentEntry, parent);
    }
  }

  return null;
}

function formatEntry(entry, domain) {
  return {
    domain,
    rating: FACTUAL_LABELS[entry.f] || entry.f?.toUpperCase() || 'UNKNOWN',
    bias: BIAS_LABELS[entry.b] || entry.b?.toUpperCase() || 'UNKNOWN',
    rawBias: entry.b,
    rawFactual: entry.f,
  };
}
