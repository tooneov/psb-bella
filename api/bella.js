// /api/bella.js — Vercel serverless function
// Quick-return proxy: triggers the agent, returns a conversation_id,
// and lets the browser poll for the first assistant reply via status_only.

export default async function handler(req, res) {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const {
    message,
    thread_id,
    marketing_consent,
    customer,
    context,
    status_only,
    conversation_id
  } = req.body || {};

  const REGION   = process.env.RELEVANCE_REGION || "bcbe5a";
  const PROJECT  = process.env.RELEVANCE_PROJECT_ID;
  const API_KEY  = process.env.RELEVANCE_API_KEY;
  const AGENT_ID = process.env.RELEVANCE_AGENT_ID;

  const AUTH_FORMATS = [
    `${PROJECT}:${API_KEY}:${REGION}`,
    `${PROJECT}:${API_KEY}`,
    `${API_KEY}`
  ];

  async function tryFetch(url, init) {
    for (const auth of AUTH_FORMATS) {
      try {
        const r = await fetch(url, {
          ...init,
          headers: { ...(init.headers||{}), Authorization: auth }
        });
        // stop trying other formats unless 401
        if (r.status !== 401) return { r, auth };
      } catch (e) {
        // network error, try next format
      }
    }
    return { r: null, auth: null };
  }

  async function quickCheck(convId, auth) {
    // Single, quick pass over likely endpoints — no server-side long polling.
    const endpoints = [
      `https://api-${REGION}.stack.tryrelevance.com/latest/agents/conversations/${convId}`,
      `https://api-${REGION}.stack.tryrelevance.com/latest/agents/tasks/${convId}`,
      `https://api-${REGION}.stack.tryrelevance.com/latest/tasks/${convId}`
    ];
    for (const url of endpoints) {
      try {
        const r = await fetch(url, { headers: { Authorization: auth || AUTH_FORMATS[0], Accept: "application/json" }});
        const j = await r.json().catch(()=> ({}));
        const reply =
          (Array.isArray(j.messages) && j.messages.filter(m => (m.role||"").toLowerCase().includes("assistant")).slice(-1)[0]?.content) ||
          (j.latest_assistant_message && j.latest_assistant_message.content) ||
          (j.assistant && j.assistant.message) ||
          j.assistant_reply || j.reply || j.output ||
          (j.data && (j.data.reply || j.data.output));
        if (reply) return { reply };
      } catch {}
    }
    return { pending: true };
  }

  // ---------- Status-only: quick check for a reply ----------
  if (status_only) {
    if (!conversation_id) return res.status(400).json({ error: "Missing conversation_id for status_only" });
    const check = await quickCheck(conversation_id, AUTH_FORMATS[0]);
    if (check.reply) return res.status(200).json({ reply: check.reply, conversation_id, pending: false });
    return res.status(200).json({ pending: true, conversation_id });
  }

  // ---------- Trigger: fire and return quickly ----------
  if (!message) return res.status(400).json({ error: "Missing 'message' in body" });

  const triggerUrl = `https://api-${REGION}.stack.tryrelevance.com/latest/agents/trigger`;
  const body = {
    agent_id: AGENT_ID,
    message: { role: "user", content: message },
    conversation_id: thread_id,
    marketing_consent: !!marketing_consent,
    customer, context
  };

  const tried = await tryFetch(triggerUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });

  if (!tried.r) {
    return res.status(502).json({ error: "Failed to contact trigger endpoint" });
  }

  const text = await tried.r.text().catch(()=> "");
  let json = {};
  try { json = JSON.parse(text || "{}"); } catch {}

  // If the server says "already running", return pending so the client polls
  if (tried.r.status === 409) {
    const convId =
      json.conversation_id || json.conversationId || json.task_id || json.id || null;
    return res.status(200).json({ pending: true, conversation_id: convId });
  }

  // Hard error from server
  if (!tried.r.ok && tried.r.status !== 202) {
    return res.status(tried.r.status).json({ error: "Trigger failed", status: tried.r.status, body: text.slice(0, 800) });
  }

  // Inline reply (sometimes available)
  const inline =
    json.assistant_reply || json.reply || json.output ||
    (json.data && (json.data.reply || json.data.output));

  const convId =
    json.conversation_id || json.conversationId || json.task_id || json.id || null;

  if (inline) {
    return res.status(200).json({ reply: inline, conversation_id: convId, pending: false });
  }

  // No inline reply — tell the client to poll
  return res.status(200).json({ pending: true, conversation_id: convId });
}
