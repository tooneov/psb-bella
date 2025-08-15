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

  const trigText = await trig.text().catch(() => '');
  let trigJson = {};
  try { trigJson = JSON.parse(trigText || '{}'); } catch {}

  // Hard error (other than accepted 202 or 409 busy)
  if (!trig.ok && trig.status !== 202 && trig.status !== 409) {
    return json({ error: 'Trigger failed', status: trig.status, body: trigText.slice(0, 800) }, trig.status, baseCors);
  }

  // Inline reply sometimes exists — return it immediately
  const inline =
    trigJson.assistant_reply || trigJson.reply || trigJson.output ||
    (trigJson.data && (trigJson.data.reply || trigJson.data.output));
  if (inline) return json({ reply: inline, pending: false }, 200, baseCors);

  // Conversation/task id (best-effort)
  let convId =
    trigJson.conversation_id || trigJson.conversationId || trigJson.task_id || trigJson.id || null;

  // If agent is already running, wait a moment before polling to avoid immediate 409 churn
  if (trig.status === 409) {
    await sleep(2500);
  }

  // 2) Long-poll (up to ~45s) for first assistant reply
  const started = Date.now();
  const maxMs = 45000;
  while (Date.now() - started < maxMs) {
    const got = await quickCheck({ REGION, authUsed, convId });
    if (got && got.reply) return json({ reply: got.reply, pending: false }, 200, baseCors);
    await sleep(1500);
  }

  // Fallback: client can keep polling via status_only if you add that feature later
  return json({ pending: true }, 200, baseCors);
}

// ----- helpers -----
function json(obj, status = 200, extra = {}) {
  const headers = new Headers({ 'Content-Type': 'application/json', ...extra });
  return new Response(JSON.stringify(obj), { status, headers });
}
async function safeJSON(req) { try { return await req.json(); } catch { return {}; } }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function quickCheck({ REGION, authUsed, convId }) {
  if (!authUsed) return null;
  const endpoints = [];
  if (convId) {
    endpoints.push(
      `https://api-${REGION}.stack.tryrelevance.com/latest/agents/conversations/${convId}`,
      `https://api-${REGION}.stack.tryrelevance.com/latest/agents/tasks/${convId}`,
      `https://api-${REGION}.stack.tryrelevance.com/latest/tasks/${convId}`,
    );
  }
  for (const url of endpoints) {
    try {
      const r = await fetch(url, { headers: { 'Authorization': authUsed, 'Accept': 'application/json' } });
      const j = await r.json().catch(() => ({}));
      const reply =
        (Array.isArray(j.messages) && j.messages.filter(m => (m.role || '').toLowerCase().includes('assistant')).slice(-1)[0]?.content) ||
        (j.latest_assistant_message && j.latest_assistant_message.content) ||
        (j.assistant && j.assistant.message) ||
        j.assistant_reply || j.reply || j.output ||
        (j.data && (j.data.reply || j.data.output));
      if (reply) return { reply };
    } catch { /* keep checking */ }
  }
  return null;
}

