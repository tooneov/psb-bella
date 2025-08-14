// /api/bella.js — Vercel serverless function
// Triggers your agent, then waits briefly for Bella’s first reply.
// Also supports status-only polling to fetch a late reply.

export default async function handler(req, res) {
  // CORS (so Strikingly can call it)
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  // Body
  const {
    message,
    thread_id,
    marketing_consent,
    customer,
    context,
    status_only,           // if true, skip trigger and just poll for a reply
    conversation_id        // used in status-only mode or after trigger returns it
  } = req.body || {};

  // Env vars (set these in Vercel → Project → Settings → Environment Variables)
  const REGION   = process.env.RELEVANCE_REGION || "usa";   // e.g. "bcbe5a" or "usa"
  const PROJECT  = process.env.RELEVANCE_PROJECT_ID;
  const API_KEY  = process.env.RELEVANCE_API_KEY;
  const AGENT_ID = process.env.RELEVANCE_AGENT_ID;

  // Build Authorization variants (we'll pick one that isn't 401)
  const AUTH_FORMATS = [
    `${PROJECT}:${API_KEY}:${REGION}`,
    `${PROJECT}:${API_KEY}`,
    `${API_KEY}`
  ];

  // ---- Helpers ----
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));

  function okJSON(obj, status = 200) {
    return res.status(status).json(obj);
  }

  async function doFetch(url, init, tryAuths = AUTH_FORMATS) {
    let last;
    for (const a of tryAuths) {
      try {
        const r = await fetch(url, {
          ...init,
          headers: { ...(init.headers || {}), Authorization: a }
        });
        // Save the one that got past the server (even if not 2xx)
        last = { response: r, authUsed: a };
        if (r.status !== 401) return last; // stop on anything except 401
      } catch (e) {
        last = { error: e, authUsed: a };
        // network error: keep looping
      }
    }
    return last;
  }

  async function pollForReply(convId, authUsed) {
    // Keep total under ~9–10s for Hobby plan limits
    const endpoints = [
      `https://api-${REGION}.stack.tryrelevance.com/latest/agents/conversations/${convId}`,
      `https://api-${REGION}.stack.tryrelevance.com/latest/agents/tasks/${convId}`,
      `https://api-${REGION}.stack.tryrelevance.com/latest/tasks/${convId}`
    ];
    for (let i = 0; i < 8; i++) {       // ~8s
      await sleep(1000);
      for (const url of endpoints) {
        try {
          const r = await fetch(url, {
            headers: { Authorization: authUsed || AUTH_FORMATS[0], Accept: "application/json" }
          });
          const j = await r.json().catch(() => ({}));
          const reply =
            (Array.isArray(j.messages) &&
              j.messages.filter(m => (m.role || "").toLowerCase().includes("assistant")).slice(-1)[0]?.content) ||
            (j.latest_assistant_message && j.latest_assistant_message.content) ||
            (j.assistant && j.assistant.message) ||
            j.assistant_reply || j.reply || j.output ||
            (j.data && (j.data.reply || j.data.output));
          if (reply) return { reply };
        } catch { /* ignore and continue */ }
      }
    }
    return { pending: true };
  }

  // ---- Status-only short path: just poll using provided conversation_id ----
  if (status_only) {
    if (!conversation_id) return okJSON({ error: "Missing conversation_id for status_only" }, 400);
    const { reply, pending } = await pollForReply(conversation_id, AUTH_FORMATS[0]);
    if (reply) return okJSON({ reply, conversation_id, pending: false });
    return okJSON({ pending: true, conversation_id });
  }

  // ---- Trigger path ----
  if (!message) return okJSON({ error: "Missing 'message' in body" }, 400);

  const triggerUrl = `https://api-${REGION}.stack.tryrelevance.com/latest/agents/trigger`;
  const triggerBody = {
    agent_id: AGENT_ID,
    message: { role: "user", content: message },
    conversation_id: thread_id,                 // keeps the same thread
    marketing_consent: !!marketing_consent,
    customer, context
  };

  const trig = await doFetch(triggerUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(triggerBody)
  });

  if (!trig || (!trig.response && !trig.error)) {
    return okJSON({ error: "Failed to contact trigger endpoint" }, 502);
  }

  if (trig.error) {
    return okJSON({ error: "Failed to contact trigger endpoint", detail: String(trig.error) }, 502);
  }

  const trigRaw = await trig.response.text().catch(() => "");
  let trigJson = {};
  try { trigJson = JSON.parse(trigRaw || "{}"); } catch {}

  // If server explicitly failed
  if (!trig.response.ok && trig.response.status !== 202) {
    return okJSON({
      error: "Trigger failed",
      status: trig.response.status,
      body: trigRaw.slice(0, 800)
    }, trig.response.status);
  }

  // Immediate reply if present
  let reply =
    trigJson.assistant_reply || trigJson.reply || trigJson.output ||
    (trigJson.data && (trigJson.data.reply || trigJson.data.output));

  const convId =
    trigJson.conversation_id || trigJson.conversationId ||
    trigJson.task_id || trigJson.id || null;

  if (reply) return okJSON({ reply, conversation_id: convId, pending: false });

  // No immediate reply — poll briefly
  if (convId) {
    const { reply: pr, pending } = await pollForReply(convId, trig.authUsed);
    if (pr) return okJSON({ reply: pr, conversation_id: convId, pending: false });
    return okJSON({ pending: true, conversation_id: convId });
  }

  // Nothing to poll; return pending so the UI can try again
  return okJSON({ pending: true, conversation_id: null });
}
