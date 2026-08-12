/**
 * Agent client — calls the LangGraph verification agent on Railway.
 * Used when "Agent Mode" is enabled in settings.
 */

const AGENT_URL = 'https://nolie-agent-production.up.railway.app';

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
 */
export async function agentVerifyClaims(claims, context, domain) {
  const results = [];

  for (const claim of claims) {
    try {
      const result = await agentVerifyClaim(claim.claim, context, domain);
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
