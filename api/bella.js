// /api/bella.js — Vercel serverless function
export default async function handler(req, res) {
  // CORS (so Strikingly can call it)
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(200).end()
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { message, thread_id, marketing_consent, customer, context } = req.body || {};
  if (!message) return res.status(400).json({ error: "Missing 'message' in body" });

  const REGION   = process.env.RELEVANCE_REGION || "bcbe5a";
  const PROJECT  = process.env.RELEVANCE_PROJECT_ID;
  const API_KEY  = process.env.RELEVANCE_API_KEY;
  const AGENT_ID = process.env.RELEVANCE_AGENT_ID;
  const AUTH     = [PROJECT, API_KEY, REGION].filter(Boolean).join(":");

  // 1) Trigger the agent
  const triggerUrl = `https://api-${REGION}.stack.tryrelevance.com/latest/agents/trigger`;
  const triggerBody = {
    agent_id: AGENT_ID,
    message: { role: "user", content: message },
    conversation_id: thread_id,
    marketing_consent: !!marketing_consent,
    customer, context
  };

  const trig = await fetch(triggerUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": AUTH },
    body: JSON.stringify(triggerBody)
  });

  const trigRaw = await trig.text();
  let trigJson = {};
  try { trigJson = JSON.parse(trigRaw || "{}"); } catch {}

  // Try immediate reply if provided
  let reply =
    trigJson.assistant_reply || trigJson.reply || trigJson.output ||
    (trigJson.data && (trigJson.data.reply || trigJson.data.output));

  const conversationId = trigJson.conversation_id || trigJson.conversationId || trigJson.task_id || trigJson.id;

  // 2) If none, poll briefly for the first assistant message
  if (!reply && conversationId) {
    const endpoints = [
      `https://api-${REGION}.stack.tryrelevance.com/latest/agents/conversations/${conversationId}`,
      `https://api-${REGION}.stack.tryrelevance.com/latest/agents/tasks/${conversationId}`,
      `https://api-${REGION}.stack.tryrelevance.com/latest/tasks/${conversationId}`
    ];
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));

    for (let i = 0; i < 8 && !reply; i++) { // ~12s max
      await sleep(1500);
      for (const url of endpoints) {
        try {
          const r = await fetch(url, { headers: { "Authorization": AUTH, "Accept": "application/json" } });
          const j = await r.json().catch(() => ({}));
          reply =
            (Array.isArray(j.messages) && j.messages.filter(m => (m.role||"").toLowerCase().includes("assistant")).slice(-1)[0]?.content) ||
            (j.latest_assistant_message && j.latest_assistant_message.content) ||
            (j.assistant && j.assistant.message) ||
            j.assistant_reply || j.reply || j.output ||
            (j.data && (j.data.reply || j.data.output));
          if (reply) break;
        } catch {}
      }
    }
  }

  return res.status(200).json({ reply: reply || "Thanks! Bella received your message." });
}
