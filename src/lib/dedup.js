/**
 * Claim Deduplication + Dependency Detection
 * 
 * 1. Deduplication: Merges claims that say the same thing in different words
 *    using word-overlap similarity (no API call needed)
 * 
 * 2. Dependency Detection: Identifies claims that depend on other claims
 *    (if Claim A is FALSE, claims that assume A is true are also suspect)
 */

const SIMILARITY_THRESHOLD = 0.7; // 70% word overlap = duplicate
const STOP_WORDS = new Set([
  'the', 'a', 'an', 'is', 'was', 'were', 'are', 'been', 'be', 'have', 'has',
  'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should', 'may',
  'might', 'shall', 'can', 'need', 'dare', 'to', 'of', 'in', 'for', 'on',
  'with', 'at', 'by', 'from', 'as', 'into', 'through', 'during', 'before',
  'after', 'above', 'below', 'between', 'under', 'that', 'this', 'these',
  'those', 'it', 'its', 'and', 'but', 'or', 'nor', 'not', 'so', 'yet',
  'both', 'either', 'neither', 'each', 'every', 'all', 'any', 'few',
  'more', 'most', 'other', 'some', 'such', 'than', 'too', 'very',
]);

/**
 * Extract meaningful words from a claim (remove stop words, lowercase)
 */
function getKeywords(text) {
  return text.toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .split(/\s+/)
    .filter(w => w.length > 2 && !STOP_WORDS.has(w));
}

/**
 * Calculate word-overlap similarity between two claims (0-1)
 */
function similarity(claim1, claim2) {
  const words1 = new Set(getKeywords(claim1));
  const words2 = new Set(getKeywords(claim2));
  if (words1.size === 0 || words2.size === 0) return 0;

  let overlap = 0;
  for (const word of words1) {
    if (words2.has(word)) overlap++;
  }

  // Jaccard-like similarity
  return overlap / Math.max(words1.size, words2.size);
}

/**
 * Deduplicate claims — merge similar ones, keep the more detailed version
 */
export function deduplicateClaims(claims) {
  if (!claims || claims.length <= 1) return claims;

  const kept = [];
  const merged = new Set();

  for (let i = 0; i < claims.length; i++) {
    if (merged.has(i)) continue;

    let bestClaim = claims[i];

    for (let j = i + 1; j < claims.length; j++) {
      if (merged.has(j)) continue;

      const sim = similarity(claims[i].claim, claims[j].claim);
      if (sim >= SIMILARITY_THRESHOLD) {
        // Keep the longer/more detailed claim
        if (claims[j].claim.length > bestClaim.claim.length) {
          bestClaim = claims[j];
        }
        merged.add(j);
      }
    }

    kept.push(bestClaim);
  }

  return kept;
}

/**
 * Detect dependencies between verified claims.
 * If a claim is FALSE/MISLEADING and another claim references similar entities,
 * the dependent claim gets a lower confidence.
 * 
 * Returns claims with added `dependsOn` and `dependencyNote` fields.
 */
export function detectDependencies(verifiedClaims) {
  if (!verifiedClaims || verifiedClaims.length <= 1) return verifiedClaims;

  // Find claims that are FALSE or MISLEADING
  const falseClaims = verifiedClaims.filter(c =>
    c.verdict === 'FALSE' || c.verdict === 'MISLEADING'
  );

  if (falseClaims.length === 0) return verifiedClaims;

  // For each non-false claim, check if it shares entities with a false claim
  return verifiedClaims.map(claim => {
    if (claim.verdict === 'FALSE' || claim.verdict === 'MISLEADING') {
      return claim; // Don't modify the false claims themselves
    }

    // Check if this claim overlaps with any false/misleading claim
    for (const falseClaim of falseClaims) {
      const shared = getSharedEntities(claim.claim, falseClaim.claim);
      if (shared.length > 0) {
        return {
          ...claim,
          dependsOn: falseClaim.claim,
          dependencyNote: `This claim shares context with a disputed claim (${shared.join(', ')}). Verify independently.`,
          confidence: claim.confidence === 'HIGH' ? 'MEDIUM' : 'LOW',
        };
      }
    }

    return claim;
  });
}

/**
 * Find shared named entities (proper nouns, numbers, dates) between two claims
 */
function getSharedEntities(claim1, claim2) {
  const entities1 = extractEntities(claim1);
  const entities2 = extractEntities(claim2);

  return entities1.filter(e => entities2.includes(e));
}

/**
 * Simple entity extraction — finds capitalized words, numbers, years, percentages
 */
function extractEntities(text) {
  const entities = [];

  // Capitalized words (proper nouns) — 2+ chars
  const properNouns = text.match(/\b[A-Z][a-z]{2,}\b/g) || [];
  entities.push(...properNouns.map(n => n.toLowerCase()));

  // Numbers and percentages
  const numbers = text.match(/\d+[\d,.]*%?/g) || [];
  entities.push(...numbers);

  // Years (4-digit numbers between 1800-2030)
  const years = text.match(/\b(1[89]\d{2}|20[0-3]\d)\b/g) || [];
  entities.push(...years);

  return [...new Set(entities)];
}
