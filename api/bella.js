// /api/bella.js — Vercel Edge Function (quick-return)
// Triggers your agent and returns immediately with a conversation_id.
// The client polls this same URL with { status_only:true, conversation_id }.
// CORS is permissive and body parser accepts text/plain JSON.

export const config = { runtime: 'edge' };

export default async function handler(req) {
  // --- CORS (permissive, avoids editor sandboxes blocking) ---
  const origin = req.headers.get('Origin') || '*';
  const reqAllow = req.headers.get('Access-Control-Request-Headers') || 'Content-Type, Authorization, Accept';
  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': reqAllow,
    'Access-Control-Expose-Headers': 'Content-Type',
    'Vary': 'Origin, Access-Control-Request-Headers, Access-Control-Request-Method',
  };
  if (req.method === 'OPTIONS') return new Response(null, { status: 200, headers: cors });
  if (req.method !== 'POST')   return json({ error: 'Method not allowed' }, 405, cors);

  const body = await readBody(req); // supports text/plain or application/json
  const {
    message, thread_id, marketing_consent, customer, context,
    status_only, conversation_id
  } = body || {};

  // --- ENV ---
  const env = (globalThis.process && process.env) ? process.env : {};
  const REGION   = env.RELEVANCE_REGION || 'bcbe5a';       // e.g. "bcbe5a"
  const PROJECT  = env.RELEVANCE_PROJECT_ID;               // your Project ID
  const API_KEY  = env.RELEVANCE_API_KEY;                  // your API key
  const AGENT_ID = env.RELEVANCE_AGENT_ID;                 // your Agent ID

  const AUTHS = [
    `${PROJECT}:${API_KEY}:${REGION}`,
    `${PROJECT}:${API_KEY}`,
    `${API_KEY}`
  ];

  // -------- status_only quick check (client polling) --------
  if (status_only) {
    const convId = conversation_id || thread_id; // fallback to thread id if needed
    if (!convId) return json({ error: 'Missing conversation_id' }, 400, cors);
    const got = await quickCheck({ REGION, auths: AUTHS, convId });
    if (got.reply) return json({ reply: got.reply, conversation_id: convId, pending: false }, 200, cors);
    return json({ pending: true, conversation_id: convId }, 200, cors);
  }

  // -------- trigger (fire-and-return) --------
  if (!message) return json({ error: "Missing 'message' in body" }, 400, cors);

  const triggerUrl = `https://api-${REGION}.stack.tryrelevance.com/latest/agents/trigger`;
  const triggerBody = {
    agent_id: AGENT_ID,
    message: { role: 'user', content: message },
    conversation_id: thread_id, // keep threads sticky
    marketing_consent: !!marketing_consent,
    customer, context
  };

  // Try common Authorization header formats
  let trig, authUsed = AUTHS[0];
  for (const a of AUTHS) {
    try {
      const r = await fetch(triggerUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': a },
        body: JSON.stringify(triggerBody)
      });
      if (r.status !== 401) { trig = r; authUsed = a; break; }
    } catch { /* try next */ }
  }
  if (!trig) return json({ error: 'Failed to contact trigger endpoint' }, 502, cors);

  const trigText = await trig.text().catch(()=>'');
  let trigJson = {}; try { trigJson = JSON.parse(trigText || '{}'); } catch {}

  // Inline reply sometimes exists → return it right away
  const inline =
    trigJson.assistant_reply || trigJson.reply || trigJson.output ||
    (trigJson.data && (trigJson.data.reply || trigJson.data.output));
  if (inline) return json({ reply: inline, pending: false }, 200, cors);

  // Otherwise return pending + some id the client can poll with
  const convId =
    trigJson.conversation_id || trigJson.conversationId || trigJson.task_id || trigJson.id || thread_id || null;

  // If trigger hard-failed (not accepted/busy), surface it
  if (!trig.ok && trig.status !== 202 && trig.status !== 409) {
    return json({ error: 'Trigger failed', status: trig.status, body: trigText.slice(0,800) }, trig.status, cors);
  }

  // Busy or accepted — quick return; client will poll
  return json({ pending: true, conversation_id: convId }, 200, cors);
}

// ---------------- helpers ----------------
function json(obj, status=200, extra={}) {
  return new Response(JSON.stringify(obj), { status, headers: new Headers({ 'Content-Type':'application/json', ...extra }) });
}
async function readBody(req) {
  // accept text/plain JSON (to avoid preflight in some builders) or application/json
  const ct = req.headers.get('content-type') || '';
  if (ct.includes('application/json')) { try { return await req.json(); } catch {} }
  try { const t = await req.text(); return JSON.parse(t || '{}'); } catch { return {}; }
}
async function quickCheck({ REGION, auths, convId }) {
  const urls = [
    `https://api-${REGION}.stack.tryrelevance.com/latest/agents/conversations/${convId}`,
    `https://api-${REGION}.stack.tryrelevance.com/latest/agents/tasks/${convId}`,
    `https://api-${REGION}.stack.tryrelevance.com/latest/tasks/${convId}`
  ];
  for (const a of auths) {
    for (const url of urls) {
      try {
        const r = await fetch(url, { headers: { 'Authorization': a, 'Accept': 'application/json' } });
        if (!r.ok) continue;
        const j = await r.json().catch(()=> ({}));
        const reply =
          (Array.isArray(j.messages) && j.messages.filter(m => (m.role||'').toLowerCase().includes('assistant')).slice(-1)[0]?.content) ||
          (j.latest_assistant_message && j.latest_assistant_message.content) ||
          (j.assistant && j.assistant.message) ||
          j.assistant_reply || j.reply || j.output ||
          (j.data && (j.data.reply || j.data.output));
        if (reply) return { reply };
      } catch { /* try next */ }
    }
  }
  return {};
}
