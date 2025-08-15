// /api/bella.js — Vercel Edge Function with robust CORS + long-poll (~45s)
export const config = { runtime: 'edge' };

export default async function handler(req) {
  // ----- CORS helper -----
  const origin = req.headers.get('Origin') || '*';
  const reqAllowHeaders =
    req.headers.get('Access-Control-Request-Headers') || 'Content-Type, Authorization, Accept';
  const baseCors = {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': reqAllowHeaders,
    'Access-Control-Expose-Headers': 'Content-Type',
    'Vary': 'Origin, Access-Control-Request-Headers, Access-Control-Request-Method',
  };

  if (req.method === 'OPTIONS') return new Response(null, { status: 200, headers: baseCors });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405, baseCors);

  // Body
  const { message, thread_id, marketing_consent, customer, context } = await safeJSON(req);
  if (!message) return json({ error: "Missing 'message' in body" }, 400, baseCors);

  // Env (Edge-safe access)
  const env = (globalThis.process && process.env) ? process.env : {};
  const REGION   = env.RELEVANCE_REGION || 'bcbe5a';                // must match your webhook subdomain
  const PROJECT  = env.RELEVANCE_PROJECT_ID;                         // your Project ID
  const API_KEY  = env.RELEVANCE_API_KEY;                            // your API key
  const AGENT_ID = env.RELEVANCE_AGENT_ID;                           // your Agent ID

  const AUTHS = [
    `${PROJECT}:${API_KEY}:${REGION}`,
    `${PROJECT}:${API_KEY}`,
    `${API_KEY}`,
  ];

  const triggerUrl = `https://api-${REGION}.stack.tryrelevance.com/latest/agents/trigger`;
  const triggerBody = {
    agent_id: AGENT_ID,
    message: { role: 'user', content: message },
    conversation_id: thread_id,
    marketing_consent: !!marketing_consent,
    customer, context,
  };

  // 1) Trigger the agent (try common Authorization formats)
  let trig, authUsed = AUTHS[0];
  for (const a of AUTHS) {
    try {
      const r = await fetch(triggerUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': a },
        body: JSON.stringify(triggerBody),
      });
      if (r.status !== 401) { trig = r; authUsed = a; break; }
    } catch {
      // network hiccup: try next format
    }
  }
  if (!trig) return json({ error: 'Failed to contact trigger endpoint' }, 502, baseCors);

  const t
