// /api/bella.js — Vercel Edge Function
// Triggers the agent and LONG-POLLS (up to ~45s) for Bella's first reply.
// Returns the real reply in this same response whenever possible.

export const config = { runtime: 'edge' };

export default async function handler(req) {
  // CORS
  if (req.method === 'OPTIONS') return resp(null, 200, cors());
  if (req.method !== 'POST')   return resp({ error: 'Method not allowed' }, 405, cors());

  const { message, thread_id, marketing_consent, customer, context } = await safeJSON(req);
  if (!message) return resp({ error: "Missing 'message' in body" }, 400, cors());

  // Env (defined in Vercel → Project → Settings → Environment Variables)
  const REGION   = process.env.RELEVANCE_REGION || 'bcbe5a';
  const PROJECT  = process.env.RELEVANCE_PROJECT_ID;
  const API_KEY  = process.env.RELEVANCE_API_KEY;
  const AGENT_ID = process.env.RELEVANCE_AGENT_ID;

  const AUTHS = [
    `${PROJECT}:${API_KEY}:${REGION}`,
    `${PROJECT}:${API_KEY}`,
    `${API_KEY}`
  ];

  const triggerUrl = `https://api-${REGION}.stack.tryrelevance.com/latest/agents/trigger`;
  const triggerBody = {
    agent_id: AGENT_ID,
    message: { role: 'user', content: message },
    conversation_id: thread_id, // keep same thread across turns
    marketing_consent: !!marketing_consent,
    customer, context
  };

  // 1) Trigger (try common Authorization header formats)
  let trig, authUsed = AUTHS[0];
  for (const a of AUTHS) {
    const r = await fetch(triggerUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': a },
      body: JSON.stringify(triggerBody)
    }).catch(() => null);
    if (!r) continue;
    if (r.status !== 401) { trig = r; authUsed = a; break; }
  }
  if (!trig) return resp({ error: 'Failed to contact trigger endpoint' }, 502, cors());

  const trigText = await trig.text().catch(() => '');
  let trigJson = {};
  try { trigJson = JSON.parse(trigText || '{}'); } catch {}

  // Immediate failure
  if (!trig.ok && trig.status !== 202 && trig.status !== 409) {
    return resp({ error: 'Trigger failed', status: trig.status, body: trigText.slice(0, 800) }, trig.status, cors());
  }

  // If the agent is already running, wait a little and then start polling
  if (trig.status === 409) {
    await sleep(2500);
  }

  // Inline reply sometimes exists
  let reply =
    trigJson.assistant_reply || trigJson.reply || trigJson.output ||
    (trigJson.data && (trigJson.data.reply || trigJson.data.output));
  if (reply) return resp({ reply, pending: false }, 200, cors());

  // 2) Determine an id to poll with (best effort)
  let convId =
    trigJson.conversation_id || trigJson.conversationId ||
    trigJson.task_id || trigJson.id || null;

  // 3) Long-poll for up to ~45s (Edge runtime allows longer than Node)
  const started = Date.now();
  const maxMs   = 45000;
  while (Date.now() - started < maxMs) {
    const got = await quickCheck({ REGION, authUsed, convId });
    if (got && got.reply) return resp({ reply: got.reply, pending: false }, 200, cors());
    // If we still don't know convId, try to refresh from trigger text (some tenants lag)
    if (!convId) {
      // try to parse again or just keep looping; many tenants publish id a few seconds after trigger
    }
    await sleep(1500);
  }

  // Fallback: tell the UI to show a friendly pending message (should be rare now)
  return resp({ pending: true }, 200, cors());
}

// ---- helpers ----
function cors() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization'
  };
}
function resp(obj, status = 200, headers = {}) {
  const h = new Headers({ 'Content-Type': 'application/json', ...headers });
  return new Response(JSON.stringify(obj), { status, headers: h });
}
async function safeJSON(req) {
  try { return await req.json(); } catch { return {}; }
}
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function quickCheck({ REGION, authUsed, convId }) {
  if (!authUsed) return null;
  const endpoints = [];
  if (convId) {
    endpoints.push(
      `https://api-${REGION}.stack.tryrelevance.com/latest/agents/conversations/${convId}`,
      `https://api-${REGION}.stack.tryrelevance.com/latest/agents/tasks/${convId}`,
      `https://api-${REGION}.stack.tryrelevance.com/latest/tasks/${convId}`
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
    } catch {}
  }
  return null;
}

