/**
 * Agent client — calls the LangGraph verification agent on Railway.
 * Used when "Agent Mode" is enabled in settings.
 * 
 * Guardrail E: Circuit breaker — after 3 consecutive failures,
 * the agent is marked as unavailable for the rest of the session.
 * The caller (service-worker) should fall back to standard mode.
 */

const AGENT_URL = 'https://nolie-agent-production.up.railway.app';

// Circuit breaker state
let consecutiveFailures = 0;
const MAX_CONSECUTIVE_FAILURES = 3;
let circuitOpen = false; // true = agent is disabled, fall back to standard

/**
 * Check if the circuit breaker has tripped.
 * Returns true if agent mode should be skipped.
 */
export function isAgentUnavailable() {
  return circuitOpen;
}

/**
 * Reset the circuit breaker (e.g. when user manually re-enables agent mode).
 */
export function resetCircuitBreaker() {
  consecutiveFailures = 0;
  circuitOpen = false;
}

/**
 * Verify a single claim using the LangGraph agent.
 * Returns: { verdict, confidence, explanation, reasoning_trail, tools_used }
 */
export async function agentVerifyClaim(claim, context, domain) {
  const res = await fetch(`${AGENT_URL}/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ claim, context: context || '', domain: domain || '' }),
  });

  if (!res.ok) {
    throw new Error(`Agent error: ${res.status}`);
  }

  return await res.json();
}

/**
 * Verify multiple claims using the agent (sequential).
 * Returns array of results with reasoning trails.
 * 
 * Circuit breaker: tracks consecutive failures. If 3 in a row,
 * returns a special result signaling the caller to fall back.
 */
export async function agentVerifyClaims(claims, context, domain) {
  // If circuit is already open, signal immediately
  if (circuitOpen) {
    return { fallback: true, reason: 'Agent circuit breaker is open — too many consecutive failures.' };
  }

  const results = [];

  for (const claim of claims) {
    // Check circuit breaker before each call
    if (circuitOpen) {
      results.push({
        claim: claim.claim,
        importance: claim.importance,
        verdict: 'UNVERIFIABLE',
        confidence: 'LOW',
        explanation: 'Agent unavailable — falling back to standard verification.',
        sources: [],
        agentMode: true,
        reasoningTrail: [],
        toolsUsed: [],
      });
      continue;
    }

    try {
      const result = await agentVerifyClaim(claim.claim, context, domain);
      // Success — reset failure counter
      consecutiveFailures = 0;
      results.push({
        claim: claim.claim,
        importance: claim.importance,
        verdict: result.verdict || 'UNVERIFIABLE',
        confidence: result.confidence || 'LOW',
        explanation: result.explanation || '',
        sources: [],
        agentMode: true,
        reasoningTrail: result.reasoning_trail || [],
        toolsUsed: result.tools_used || [],
      });
    } catch (e) {
      consecutiveFailures++;
      console.warn(`[NoLie] Agent failure ${consecutiveFailures}/${MAX_CONSECUTIVE_FAILURES}: ${e.message}`);

      if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
        circuitOpen = true;
        console.error('[NoLie] Circuit breaker OPEN — agent disabled for this session.');
        // Return fallback signal so service-worker can re-verify remaining claims with standard mode
        return {
          fallback: true,
          reason: `Agent failed ${MAX_CONSECUTIVE_FAILURES} times consecutively. Falling back to standard mode.`,
          partialResults: results,
          remainingClaims: claims.slice(results.length),
        };
      }

      results.push({
        claim: claim.claim,
        importance: claim.importance,
        verdict: 'UNVERIFIABLE',
        confidence: 'LOW',
        explanation: 'Agent verification failed: ' + e.message,
        sources: [],
        agentMode: true,
        reasoningTrail: [],
        toolsUsed: [],
      });
    }
  }

  return results;
}
