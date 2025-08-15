// api/bella.js — Node runtime (not Edge)
// ENV (Production):
//   RELEVANCE_CLUSTER     = bcbe5a
//   RELEVANCE_TENANT_ID   = 1ecb9fa6-723e-4f5c-b5d8-051246d4cdf4
//   RELEVANCE_AGENT_ID    = be2c3f28-bb2f-4361-a2df-cfc7cf7add52
//   RELEVANCE_API_KEY     = sk-XXXXXXXX   (secret ONLY, no tenant prefix)
//   RELEVANCE_REGION      = usa           (optional)
//   RELEVANCE_CUSTOM_TRIGGER = <optional webhook fallback>

const CLUSTER   = process.env.RELEVANCE_CLUSTER;
const TENANT_ID = process.env.RELEVANCE_TENANT_ID;
const AGENT_ID  = process.env.RELEVANCE_AGENT_ID;
const API_KEY   = process.env.RELEVANCE_API_KEY;
const REGION    = process.env.RELEVANCE_REGION || "usa";
const CUSTOM_TRIGGER = process.env.RELEVANCE_CUSTOM_TRIGGER || null;

const HOSTS = [
  CLUSTER ? `https://api-${CLUSTER}.stack.tryrelevance.com` : null,
  REGION  ? `https://api-${REGION}.stack.tryrelevance.com`  : null,
].filter(Boolean);

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, Accept, x-project-id, x-region",
  "Access-Control-Max-Age": "86400",
  "Vary": "Origin, Access-Control-Request-Headers, Access-Control-Request-Method",
};

module.exports = async (req, res) => {
  if (req.method === "OPTIONS") { setCors(res); res.statusCode = 204; return res.end(); }
  if (req.method !== "POST")     return send(res, 405, { error: "Method not allowed" });

  const body = await readBody(req);
  const { message, thread_id, unique_id, channel, context, customer, marketing_consent, status_only, conversation_id } = body || {};

  const missing=[];
  if (!CLUSTER)   missing.push("RELEVANCE_CLUSTER");
  if (!TENANT_ID) missing.push("RELEVANCE_TENANT_ID");
  if (!AGENT_ID)  missing.push("RELEVANCE_AGENT_ID");
  if (!API_KEY)   missing.push("RELEVANCE_API_KEY (sk-… only)");
  if (missing.length) return send(res, 500, { error:"Missing env vars", missing });

  if (status_only) {
    const convId = conversation_id || thread_id;
    if (!convId) return send(res, 400, { error:"Missing conversation_id" });
    const out = await pollForReply({ convId });
    return send(res, 200, { pending: !out.reply, reply: out.reply || null, conversation_id: convId, debug: out.debug });
  }

  if (!message) return send(res, 400, { error:"Missing 'message' in body" });

  const payload = {
    agent_id: AGENT_ID,
    message: typeof message === "string" ? { role: "user", content: message } : message,
    conversation_id: thread_id,
    unique_id, channel, context, customer,
    marketing_consent: !!marketing_consent,
    blocking: true, return_messages: true, wait: true, response_mode: "blocking", timeout_ms: 22000
  };

  const trig = await triggerAgent(payload);
  if (!trig.ok) return send(res, trig.status || 502, { error:"Trigger failed", detail: trig.error || trig.text || null, debug: trig.debug });

  const convId = trig.conversation_id || thread_id || null;
  if (trig.reply) return send(res, 200, { reply: trig.reply, pending: false, conversation_id: convId });
  return send(res, 200, { pending: true, conversation_id: convId });
};

/* ---------- helpers ---------- */
function setCors(res){ Object.entries(CORS).forEach(([k,v]) => res.setHeader(k,v)); }
function send(res, status, obj){ setCors(res); res.statusCode = status; res.setHeader("Content-Type","application/json"); res.end(JSON.stringify(obj)); }
async function readBody(req){ const chunks=[]; for await (const c of req) chunks.push(c); const raw=Buffer.concat(chunks).toString("utf8"); try{ return raw?JSON.parse(raw):{} }catch{ return {}; } }

function authVariants() {
  const base = [
    { Authorization: `${TENANT_ID}:${API_KEY}:${REGION}` },
    { Authorization: `${TENANT_ID}:${API_KEY}` },
    { Authorization: `Bearer ${API_KEY}` },
    { Authorization: API_KEY },
  ];
  return base.map(h => ({
    ...h,
    "x-project-id": TENANT_ID,
    "x-region": REGION,
    Accept: "application/json",
    "Content-Type": "application/json",
  }));
}

async function tryFetch(url, init){
  try{
    const r = await fetch(url, init);
    const text = await r.text();
    let json = null; try { json = text ? JSON.parse(text) : null; } catch {}
    return { ok:r.ok, status:r.status, text, json };
  } catch (e) {
    return { ok:false, status:0, text:String(e), json:null };
  }
}

function extractReply(p){
  if (!p) return null;
  // steps
  if (Array.isArray(p.steps)) {
    for (let i=p.steps.length-1; i>=0; i--){
      const s=p.steps[i];
      const cand = s?.assistant_reply || s?.output || s?.message || s?.text || s?.delta;
      const str = typeof cand==="string" ? cand : (cand && (cand.text || cand.content));
      if (str && String(str).trim()) return String(str).trim();
      const outs = s?.outputs || s?.tool_outputs;
      if (Array.isArray(outs)) for (const o of outs) {
        const c2 = o?.text || o?.content || o?.message;
        if (c2 && String(c2).trim()) return String(c2).trim();
      }
    }
  }
  // messages
  if (Array.isArray(p.messages)) {
    for (let i=p.messages.length-1; i>=0; i--){
      const m=p.messages[i];
      const role=(m.role||m.sender||"").toLowerCase();
      if (role.includes("assistant")) {
        const cand = m.text || m.message || m.content || m.output;
        if (cand && String(cand).trim()) return String(cand).trim();
      }
    }
  }
  const flat = p.assistant_reply || p.reply || p.output || p.message || p.text;
  if (flat && String(flat).trim()) return String(flat).trim();
  return null;
}

// find any plausible id returned
function extractId(p){
  if (!p || typeof p !== 'object') return null;
  const keys = ["conversation_id","task_id","id","run_id","job_id"];
  for (const k of keys) if (p[k]) return String(p[k]);
  // sometimes wrapped
  if (p.data && typeof p.data === 'object') {
    for (const k of keys) if (p.data[k]) return String(p.data[k]);
  }
  return null;
}

async function triggerAgent(body){
  const tries = [];

  // 1) tasks trigger (blocking)
  for (const host of HOSTS){
    for (const h of authVariants()){
      const url = `${host}/latest/agents/tasks/trigger?blocking=true&return_messages=true`;
      const r = await tryFetch(url, { method:"POST", headers:h, body: JSON.stringify(body) });
      tries.push({ url, status: r.status });
      if (r.ok || r.status===202 || r.status===409) {
        const reply = extractReply(r.json || {});
        const convId = extractId(r.json) || body.conversation_id || null;
        return { ok:true, status:r.status, reply, conversation_id: convId, debug: tries };
      }
      if (r.status===401 || r.status===403) continue;
    }
  }

  // 2) classic trigger (blocking)
  for (const host of HOSTS){
    for (const h of authVariants()){
      const url = `${host}/latest/agents/trigger?blocking=true&return_messages=true`;
      const r = await tryFetch(url, { method:"POST", headers:h, body: JSON.stringify(body) });
      tries.push({ url, status: r.status });
      if (r.ok || r.status===202 || r.status===409) {
        const reply = extractReply(r.json || {});
        const convId = extractId(r.json) || body.conversation_id || null;
        return { ok:true, status:r.status, reply, conversation_id: convId, debug: tries };
      }
      if (r.status===401 || r.status===403) continue;
    }
  }

  // 3) fallback to your custom-trigger
  if (CUSTOM_TRIGGER){
    const r = await tryFetch(CUSTOM_TRIGGER, { method:"POST", headers:{ "Content-Type":"text/plain" }, body: JSON.stringify(body) });
    tries.push({ url: CUSTOM_TRIGGER, status: r.status });
    if (r.ok) return { ok:true, status:r.status, reply:null, conversation_id: body.conversation_id || null, debug: tries };
    return { ok:false, status:r.status||502, error:r.text||"Custom-trigger failed", debug: tries };
  }

  return { ok:false, status:502, error:"Failed to contact trigger endpoint", debug: tries };
}

async function pollForReply({ convId }){
  const tries = [];
  for (const host of HOSTS){
    for (const h of authVariants()){
      const urls = [
        `${host}/latest/agents/${AGENT_ID}/tasks/${convId}/steps`,
        `${host}/latest/agents/tasks/view?agent_id=${encodeURIComponent(AGENT_ID)}&conversation_id=${encodeURIComponent(convId)}`,
        `${host}/latest/agents/conversations/${convId}`,
        `${host}/latest/agents/${AGENT_ID}/conversations/${convId}`,
        `${host}/latest/agents/tasks/${convId}`,
        `${host}/latest/tasks/${convId}`,
      ];
      for (const url of urls){
        const r = await tryFetch(url, { method:"GET", headers:h });
        tries.push({ url, status: r.status });
        if (!r.ok) continue;
        const reply = extractReply(r.json || {});
        if (reply) return { reply, debug: tries };
      }
    }
  }
  return { reply: null, debug: tries };
}
