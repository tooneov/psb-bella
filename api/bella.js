// api/bella.js — Robust Node serverless proxy for Bella
// - Accepts text/plain or application/json
// - Tries multiple Relevance API hosts & auth formats
// - Triggers via tasks API, then classic agents API, then your custom-trigger webhook
// - Returns { reply } when available, else { pending:true, conversation_id }

const AGENT_ID  = process.env.RELEVANCE_AGENT_ID;           // e.g. "1ecb9fa6-723e-4f5c-b5d8-051246d4cdf4"
const PROJECT   = process.env.RELEVANCE_PROJECT;             // e.g. "bcbe5a"  (IMPORTANT: this is NOT "usa")
const REGION    = process.env.RELEVANCE_REGION || "usa";     // e.g. "usa" (or your cluster label)
const API_KEY   = process.env.RELEVANCE_API_KEY;             // project API key w/ agents:trigger permission
const CUSTOM_TRIGGER = process.env.RELEVANCE_CUSTOM_TRIGGER; // optional: your working custom-trigger URL

// Build candidate hosts (we'll try both)
const HOSTS = [];
if (PROJECT) HOSTS.push(`https://api-${PROJECT}.stack.tryrelevance.com`);
if (REGION)  HOSTS.push(`https://api-${REGION}.stack.tryrelevance.com`);

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, Accept",
  "Access-Control-Max-Age": "86400",
  "Vary": "Origin, Access-Control-Request-Headers, Access-Control-Request-Method",
};

module.exports = async (req, res) => {
  if (req.method === "OPTIONS") { setCors(res); res.statusCode = 204; return res.end(); }
  if (req.method !== "POST")     { return send(res, 405, { error: "Method not allowed" }); }

  try {
    const body = await readBody(req);
    const {
      message, thread_id, unique_id, channel, context, customer, marketing_consent,
      status_only, conversation_id
    } = body || {};

    // Validate env
    const missing = [];
    if (!API_KEY)  missing.push("RELEVANCE_API_KEY");
    if (!AGENT_ID) missing.push("RELEVANCE_AGENT_ID");
    if (!PROJECT)  missing.push("RELEVANCE_PROJECT"); // must be like "bcbe5a"
    if (missing.length) return send(res, 500, { error: "Missing environment variables", missing });

    // Status-only polling path
    if (status_only) {
      const convId = conversation_id || thread_id;
      if (!convId) return send(res, 400, { error: "Missing conversation_id" });
      const poll = await pollForReply({ convId });
      return send(res, 200, { pending: !poll.reply, reply: poll.reply || null, conversation_id: convId, debug: poll.debug || undefined });
    }

    // Trigger path
    if (!message) return send(res, 400, { error: "Missing 'message' in body" });

    const payload = {
      agent_id: AGENT_ID,
      message: typeof message === "string" ? { role: "user", content: message } : message,
      conversation_id: thread_id,
      unique_id, channel, context, customer,
      marketing_consent: !!marketing_consent,
    };

    const trig = await triggerAgent(payload);
    if (!trig.ok) return send(res, trig.status || 502, { error: "Trigger failed", detail: trig.error || trig.text || null });

    const convId = trig.conversation_id || thread_id || null;
    if (trig.reply) return send(res, 200, { reply: trig.reply, pending: false, conversation_id: convId });

    // No inline reply → client will poll using conversation_id (or thread fallback)
    return send(res, 200, { pending: true, conversation_id: convId });
  } catch (e) {
    return send(res, 500, { error: "Unhandled server error", details: String(e) });
  }
};

// ---------------- helpers ----------------
function setCors(res) {
  Object.entries(CORS).forEach(([k, v]) => res.setHeader(k, v));
}
function send(res, status, obj) {
  setCors(res);
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(obj));
}
async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw) return {};
  try { return JSON.parse(raw); } catch { return {}; }
}

function authVariants() {
  return [
    { Authorization: `${PROJECT}:${API_KEY}:${REGION}` },
    { Authorization: `${PROJECT}:${API_KEY}` },
    { Authorization: `Bearer ${API_KEY}` },
    { Authorization: API_KEY },
  ];
}
async function tryFetch(url, init) {
  try {
    const r = await fetch(url, init);
    const text = await r.text();
    let json = null; try { json = text ? JSON.parse(text) : null; } catch {}
    return { ok: r.ok, status: r.status, text, json };
  } catch (e) {
    return { ok: false, status: 0, text: String(e), json: null };
  }
}

function extractReply(payload) {
  if (!payload) return null;
  // steps[]
  if (Array.isArray(payload.steps)) {
    for (let i = payload.steps.length - 1; i >= 0; i--) {
      const s = payload.steps[i];
      const cand = s?.assistant_reply || s?.output || s?.message || s?.text;
      const str = typeof cand === "string" ? cand : (cand && cand.text);
      if (str && String(str).trim()) return String(str).trim();
    }
  }
  // messages[]
  if (Array.isArray(payload.messages)) {
    for (let i = payload.messages.length - 1; i >= 0; i--) {
      const m = payload.messages[i];
      const role = (m.role || m.sender || "").toLowerCase();
      if (role.includes("assistant")) {
        const cand = m.text || m.message || m.content || m.output;
        if (cand && String(cand).trim()) return String(cand).trim();
      }
    }
  }
  const flat = payload.assistant_reply || payload.reply || payload.output || payload.message || payload.text;
  if (flat && String(flat).trim()) return String(flat).trim();
  return null;
}

async function triggerAgent(body) {
  const tries = [];
  // 1) Tasks API trigger
  for (const host of HOSTS) {
    if (!host) continue;
    for (const a of authVariants()) {
      const r = await tryFetch(`${host}/latest/agents/tasks/trigger`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...a },
        body: JSON.stringify(body),
      });
      tries.push({ host, path: "/latest/agents/tasks/trigger", status: r.status });
      if (r.ok || r.status === 202 || r.status === 409) {
        const reply = extractReply(r.json || {});
        const convId = (r.json && (r.json.conversation_id || r.json.task_id || r.json.id)) || body.conversation_id || null;
        return { ok: true, status: r.status, reply, conversation_id: convId, debug: tries };
      }
      if (r.status === 401 || r.status === 403) continue; // try next auth
    }
  }
  // 2) Classic agents trigger
  for (const host of HOSTS) {
    if (!host) continue;
    for (const a of authVariants()) {
      const r = await tryFetch(`${host}/latest/agents/trigger`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...a },
        body: JSON.stringify(body),
      });
      tries.push({ host, path: "/latest/agents/trigger", status: r.status });
      if (r.ok || r.status === 202 || r.status === 409) {
        const reply = extractReply(r.json || {});
        const convId = (r.json && (r.json.conversation_id || r.json.task_id || r.json.id)) || body.conversation_id || null;
        return { ok: true, status: r.status, reply, conversation_id: convId, debug: tries };
      }
      if (r.status === 401 || r.status === 403) continue;
    }
  }
  // 3) Fallback: your custom-trigger webhook (fire-and-forget)
  if (CUSTOM_TRIGGER) {
    const r = await tryFetch(CUSTOM_TRIGGER, {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: JSON.stringify(body),
    });
    tries.push({ host: CUSTOM_TRIGGER, path: "custom-trigger", status: r.status });
    if (r.ok) {
      return { ok: true, status: r.status, reply: null, conversation_id: body.conversation_id || null, debug: tries };
    }
    return { ok: false, status: r.status || 502, error: r.text || "Custom-trigger failed", debug: tries };
  }
  return { ok: false, status: 502, error: "Failed to contact trigger endpoint", debug: tries };
}

async function pollForReply({ convId }) {
  const tries = [];
  for (const host of HOSTS) {
    if (!host) continue;
    for (const a of authVariants()) {
      const urls = [
        `${host}/latest/agents/${AGENT_ID}/tasks/${convId}/steps`,
        `${host}/latest/agents/tasks/view?agent_id=${encodeURIComponent(AGENT_ID)}&conversation_id=${encodeURIComponent(convId)}`,
        `${host}/latest/agents/conversations/${convId}`,
        `${host}/latest/agents/tasks/${convId}`,
        `${host}/latest/tasks/${convId}`,
      ];
      for (const url of urls) {
        const r = await tryFetch(url, { method: "GET", headers: { Accept: "application/json", ...a } });
        tries.push({ url, status: r.status });
        if (!r.ok) continue;
        const reply = extractReply(r.json || {});
        if (reply) return { reply, debug: tries };
      }
    }
  }
  return { reply: null, debug: tries };
}
