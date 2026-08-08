/**
 * RAG (Retrieval-Augmented Generation) cache layer.
 * 
 * Before verifying a claim with Groq, checks if a similar claim
 * was already verified and cached in the vector database (Supabase pgvector).
 * 
 * After verification, stores HIGH confidence results for future use.
 * The system gets smarter over time — self-learning RAG.
 */

import { MODEL, STORAGE_KEY } from './constants.js';

const BACKEND_URL = 'https://nolie-backend.vercel.app';
const GEMINI_EMBED_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent';

/**
 * Get embedding for a text string using Gemini gemini-embedding-001
 * Output: 768 dimensions (configured via outputDimensionality)
 */
export async function getEmbedding(text, geminiKey) {
  const res = await fetch(`${GEMINI_EMBED_URL}?key=${geminiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      content: { parts: [{ text }] },
      taskType: 'SEMANTIC_SIMILARITY',
      outputDimensionality: 768,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error('Embedding failed: ' + res.status + ' ' + err.slice(0, 100));
  }

  const data = await res.json();
  return data.embedding?.values || null;
}

/**
 * Search the RAG cache for a similar claim.
 * Returns the cached verification if found, null otherwise.
 */
export async function searchCache(embedding) {
  try {
    const res = await fetch(`${BACKEND_URL}/api/rag-search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ embedding }),
    });

    if (!res.ok) return null;
    const data = await res.json();
    return data.match || null;
  } catch (e) {
    console.error('[RAG] Search failed:', e.message);
    return null;
  }
}

/**
 * Store a verified claim in the RAG cache.
 * Only stores HIGH confidence, non-disputed claims.
 */
export async function storeVerification(claim, embedding, verification, domain) {
  // Only cache HIGH confidence results
  if (verification.confidence !== 'HIGH') return;

  try {
    await fetch(`${BACKEND_URL}/api/rag-store`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        claim: claim,
        embedding: embedding,
        verdict: verification.verdict,
        confidence: verification.confidence,
        explanation: verification.explanation || '',
        sources: verification.sources || [],
        domain: domain || '',
      }),
    });
  } catch (e) {
    console.error('[RAG] Store failed:', e.message);
  }
}

/**
 * Full RAG check: embed the claim, search cache, return match or null.
 */
export async function checkRAGCache(claimText, geminiKey) {
  if (!geminiKey) return null;

  try {
    const embedding = await getEmbedding(claimText, geminiKey);
    if (!embedding) return null;

    console.log('[RAG] Got embedding, searching cache for:', claimText.slice(0, 50));
    const match = await searchCache(embedding);
    if (match) {
      console.log('[RAG] Cache HIT! Similarity:', match.similarity, 'Verdict:', match.verdict);
      return {
        ...match,
        fromCache: true,
        embedding,
      };
    }

    console.log('[RAG] Cache MISS — will verify fresh');
    return { fromCache: false, embedding };
  } catch (e) {
    console.error('[RAG] Cache check failed:', e.message);
    return null;
  }
}
