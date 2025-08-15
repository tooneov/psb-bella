// /api/bella.js — Edge Function (quick-return + robust errors)
export const config = { runtime: 'edge' };

export default async function handler(req) {
  // ----- CORS -----
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

  try {
    const body = await readBody(req); // supports text/plain or application/json
    const {
      message, thread_id, marketing_consent, customer, context,
      status_only, conversation_id
    } = body || {};

    // ----- ENV (validate clearly) -----
    const env = (globalThis.process && process.env) ? process.env : {};
    const REGION   = env.RELEVANCE_REGION || '';       // e.g. "bcbe5a" (must match your webhook host)
    const PROJECT  = env.RELEVANCE_PROJECT_ID || '';   // your real project id (NOT the region)
    const API_KEY  = env.RELEVANCE_API_KEY || '';      // your API key
    const AGENT_ID = env.RELEVANCE_AGENT_ID || '';     // your agent id (UUID)

    const missing = [];
    if (!REGION)   missing.push('RELEVANCE_REGION');
    if (!PROJECT)  missing.push('RELEVANCE_PROJECT_ID');
    if (!API_KEY)  missing.push('RELEVANCE_API_KEY');
    if (!AGENT_ID) missing.push('RELEVANCE_AGENT_ID');
    if (missing.length) {
      return json(
        { error: 'Missing required environment variables', missing, hint:
          'REGION must match your webhook subdomain; PROJECT is your actual project id; AGENT_ID is your agent UUID.' },
        500, cors
      );
    }

    // Common misconfig checks with actionable hints
    if (PROJECT === 'bcbe5a' || PROJECT.toLowerCase() === 'usa') {
      return json(
        { error: 'RELEVANCE_PROJECT_ID looks wrong',
          got: PROJECT,
          hint: 'PROJECT_ID is NOT the region. Grab it from your Relevance dashboard (Project settings).'
        },
        500, cors
      );
    }

    const AUTHS = [
      `${PROJECT}:${API_KEY}:${REGION}`,
      `${PROJECT}:${API_KEY}`,
      `${API_KEY}`,
    ];

    // ----- Client polling path -----
    if (status_only) {
      const convId = conversation_id || thread_id; // allow thread fallback
      if (!convId) return json({ error: 'Missing conversation_id' }, 400, cors);
      const got = await quickCheck({ REGION, auths: AUTHS, convId });
      if (got.reply) return json({ reply: got.reply, conversation_id: convId, pending: false }, 200, cors);
      return json({ pending: true, conversation_id: convId }, 200, cors);
    }

    // ----- Trigger path (fire-and-return quickly) -----
    if (!message) return json({ error: "Missing 'message' in body" }, 400, cors);

    const triggerUrl = `https://api-${REGION}.stack.tryrelevance.com/latest/agents/trigger`;
    const triggerBody = {
      agent_id: AGENT_ID,
      message: { role: 'user', content: message },
      conversation_id: thread_id, // keeps thread sticky
      marketing_consent: !!marketing_consent,
      customer, context,
    };

    let trig, authUsed = AUTHS[0];
    for (const a of AUTHS) {
      try {
        const r = await fetch(triggerUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': a },
          body: JSON.stringify(triggerBody),
        });
        if (r.status !== 401) { trig = r; authUsed = a; break; }
      } catch { /* try next */ }
    }
    if (!trig) return json({ error: 'Failed to contact trigger endpoint' }, 502, cors);

    const trigText = await trig.text().catch(()=> '');
    let trigJson = {}; try { trigJson = JSON.parse(trigText || '{}'); } catch {}

    // Inline reply (sometimes present)
    const inline =
      trigJson.assistant_reply || trigJson.reply || trigJson.output ||
      (trigJson.data && (trigJson.data.reply || trigJson.data.output));
    if (inline) return json({ reply: inline, pending: false }, 200, cors);

    // Not inline → give client something to poll with
    const convId =
      trigJson.conversation_id || trigJson.conversationId || trigJson.task_id || trigJson.id || thread_id || null;

    if (!trig.ok && trig.status !== 202 && trig.status !== 409) {
      return json({ error: 'Trigger failed', status: trig.status, body: trigText.slice(0,800) }, trig.status, cors);
    }

    return json({ pending: true, conversation_id: convId }, 200, cors);
  } catch (err) {
    return json({ error: 'Unhandled server error', details: String(err) }, 500, cors);
  }
}

// ------------- helpers -------------
function json(obj, status=200, extra={}) {
  return new Response(JSON.stringify(obj), {
    status, headers: new Headers({ 'Content-Type': 'application/json', ...extra })
  });
}

async function readBody(req) {
  const ct = req.headers.get('content-type') || '';
  if (ct.includes('application/json')) { try { return await req.json(); } catch {} }
  try { const t = await req.text(); return JSON.parse(t || '{}'); } catch { return {}; }
}

async function quickCheck({ REGION, auths, convId }) {
  const urls = [
    `https://api-${REGION}.stack.tryrelevance.com/latest/agents/conversations/${convId}`,
    `https://api-${REGION}.stack.tryrelevance.com/latest/agents/tasks/${convId}`,
    `https://api-${REGION}.stack.tryrelevance.com/latest/tasks/${convId}`,
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
