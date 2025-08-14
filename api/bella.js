// /api/bella.js — Vercel serverless function that triggers your agent,
// waits briefly for Bella’s first reply, and returns it to the browser.
export default async function handler(req, res) {
  // CORS (so Strikingly can call it)
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  // Body
  const { message, thread_id, marketing_consent, customer, context } = req.body || {};
  if (!message) return res.status(400).json({ error: "Missing 'message' in body" });

  // Env vars (set these in Vercel → Project → Settings → Environment Variables)
  const REGION   = process.env.RELEVANCE_REGION || "usa";   // e.g. "usa"
  const PROJECT  = process.env.RELEVANCE_PROJECT_ID;         // your project id
  const API_KEY  = process.env.RELEVANCE_API_KEY;            // your API key
  const AGENT_ID  = process.env.RELEVANCE_AGENT_ID;          // Bella's agent id

  // Build trigger payload
  const triggerUrl = `https://api-${REGION}.stack.tryrelevance.com/latest/agents/trigger`;
  const triggerBody = {
    agent_id: AGENT_ID,
    message: { role: "user", content: message },
    conversation_id: thread_id,                 // keeps the same thread
    marketing_consent: !!marketing_consent,
    customer, context
  };

  // Try common Authorization header formats until one works
  const authFormats = [
    `${PROJECT}:${API_KEY}:${REGION}`,
    `${PROJECT}:${API_KEY}`,
    `${API_KEY}`
  ];

  async function triggerOnce(authHeader) {
    return fetch(triggerUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": authHeader
      },
      body: JSON.stringify(triggerBody)
    });
  }

  let trig, trigRaw, trigJson = {};
  for (const auth of authFormats) {
    try {
      trig = await triggerOnce(auth);
      if (trig.status !== 401) break; // stop trying other formats unless unauthorized
    } catch (e) { /* try next format */ }
  }

  if (!trig) {
    return res.status(502).json({ error: "Failed to contact trigger endpoint" });
  }

  trigRaw = await trig.text().catch(() => "");
  try { trigJson = JSON.parse(trigRaw || "{}"); } catch {}

  if (!trig.ok && trig.status !== 202) {
    return res.status(trig.status).json({ error: "Trigger failed", body: trigRaw.slice(0, 500) });
  }

  // Immediate reply if present
  let reply =
    trigJson.assistant_reply || trigJson.reply || trigJson.output ||
    (trigJson.data && (trigJson.data.reply || trigJson.data.output));

  // If no inline reply, poll for a short window for first assistant message
  const conversationId =
    trigJson.conversation_id || trigJson.conversationId || trigJson.task_id || trigJson.id;

  if (!reply && conversationId) {
    const endpoints = [
      `https://api-${REGION}.stack.tryrelevance.com/latest/agents/conversations/${conversationId}`,
      `https://api-${REGION}.stack.tryrelevance.com/latest/agents/tasks/${conversationId}`,
      `https://api-${REGION}.stack.tryrelevance.com/latest/tasks/${conversationId}`
    ];
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));

    // Poll up to ~12 seconds total
    for (let i = 0; i < 8 && !reply; i++) {
      await sleep(1500);
      for (const url of endpoints) {
        try {
          const r = await fetch(url, {
            headers: {
              "Authorization": `${PROJECT}:${API_KEY}:${REGION}`,
              "Accept": "application/json"
            }
          });
          const j = await r.json().catch(() => ({}));
          reply =
            (Array.isArray(j.messages) &&
              j.messages.filter(m => (m.role || "").toLowerCase().includes("assistant")).slice(-1)[0]?.content) ||
            (j.latest_assistant_message && j.latest_assistant_message.content) ||
            (j.assistant && j.assistant.message) ||
            j.assistant_reply || j.reply || j.output ||
            (j.data && (j.data.reply || j.data.output));
          if (reply) break;
        } catch {
          // ignore individual poll failures and keep trying
        }
      }
    }
  }

  return res.status(200).json({ reply: reply || "Thanks! Bella received your message." });
}

