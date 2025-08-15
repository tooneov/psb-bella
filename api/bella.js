// api/bella.js — Node serverless (NOT edge)
// Uses blocking trigger when possible; otherwise polls multiple read endpoints.
// ENV REQUIRED:
//   RELEVANCE_PROJECT_ID=bcbe5a
//   RELEVANCE_AGENT_ID=be2c3f28-bb2f-4361-a2df-cfc7cf7add52
//   RELEVANCE_API_KEY=<your key>
//   RELEVANCE_REGION=usa            (ok to keep; used in auth variants)
//   RELEVANCE_CUSTOM_TRIGGER=<optional webhook fallback>

const PROJECT_ID = process.env.RELEVANCE_PROJECT_ID;   // "bcbe5a"
const AGENT_ID   = process.env.RELEVANCE_AGENT_ID;     // "be2c3f28-...add52"
const API_KEY    = process.env.RELEVANCE_API_KEY;
const REGION     = process.env.RELEVANCE_REGION || "usa";
const CUSTOM_TRIGGER = process.env.RELEVANCE_CUSTOM_TRIGGER || null;

const HOSTS = [
  `https://api-${PROJECT_ID}.stack.tryrelevance.com`,
  `https://api-${REGION}.stack.tryrelevance.com`,
];

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

  const body = await readBody(req).catch(() => ({}));
  const { message, thread_id, unique_id, channel, context, customer, marketing_consent, status_only, conversation_id } = body || {};

  // env sanity
  const missing = [];
  if (!PROJECT_ID) missing.push("RELEVANCE_PROJECT_ID");
  if (!AGENT_ID)   missing.push("RELEVANCE_AGENT_ID");
  if (!API_KEY)    missing.push("RELEVANCE_API_KEY");
  if (missing.length) return send(res, 500, { error: "Missing env vars", missing });

  // status-only poll from client
  if (status_only) {
    const convId = conversation_id || thread_id;
    if (!convId) return send(res, 400, { error: "Missing conversation_id" });
    const out = await pollForReply({ convId });
    return send(res, 200, { pending: !out.reply, reply: out.reply || null, conversation_id: convId });
  }

  // trigger
  if (!message) return send(res, 400, { error: "Missing 'message' in body" });

  const payload = {
    agent_id: AGENT_ID,
    // accepts either plain string or {role,content}
    message: typeof message === "string" ? { role: "user", content: message } : message,
    conversation_id: thread_id,      // keep threads sticky across turns
    unique_id, channel, context, customer,
    marketing_consent: !!marketing_consent,

    // ------- try synchronous reply knobs (some deployments honor these) -------
    blocking: true,
    wait: true,
    response_mode: "blocking",
    return_messages: true,
    timeout_ms: 25000
  };

  const trig = await triggerBlockingThenFallback(payload);
  if (!trig.ok) return send(res, trig.status || 502, { error: "Trigger failed", detail: trig.error || trig.text || null });

  const convId = trig.conversation_id || thread_id || null;
  if (trig.reply) return send(res, 200, { reply: trig.reply, pending: false, conversation_id: convId });

  // still no inline reply → let client poll
  return send(res, 200, { pending: true, conversation_id: convId });
};

/* ---------------- helpers ---------------- */
function setCors(res){ Object.entries(CORS).forEach(([k,v]) => res.setHeader(k,v)); }
function send(res, status, obj){ setCors(res); res.statusCode = status; res.setHeader("Content-Type","application/json"); res.end(JSON.stringify(obj)); }
async function readBody(req){ const chunks=[]; for await (const c of req) chunks.push(c); const raw=Buffer.concat(chunks).toString("utf8"); if(!raw) return {}; try{ return JSON.parse(raw); }catch{ return {}; } }

function authVariants() {
  // Try several formats Relevance accepts (project+key, bearer, etc.)
  const base = [
    { Authorization: `${PROJECT_ID}:${API_KEY}:${REGION}` },
    { Authorization: `${PROJECT_ID}:${API_KEY}` },
    { Authorization: `Bearer ${API_KEY}` },
    { Authorization: API_KEY }
  ];
  return base.map(h => ({
    ...h,
    "x-project-id": PROJECT_ID,
    "x-region": REGION,
    Accept: "application/json",
    "Content-Type": "application/json",
  }));
}
async function tryFetch(url, init){ try{ const r=await fetch(url, init); const t=await r.text(); let j=null; try{ j=t?JSON.parse(t):null }catch{} return {ok:r.ok,status:r.status,text:t,json:j}; }catch(e){ return {ok:false,status:0,text:String(e),json:null}; } }

// Pull a human reply string from many possible payload shapes
function extractReply(p){
  if (!p) return null;

  // 1) Try explicit message containers
  if (Array.isArray(p.steps)) {
    for (let i=p.steps.length-1;i>=0;i--){
      const s=p.steps[i];
      const cand = s?.assistant_reply || s?.output || s?.message || s?.text || s?.delta;
      const str = typeof cand==="string" ? cand : (cand && cand.text) || (cand && cand.content);
      if (str && String(str).trim()) return String(str).trim();
      // look inside nested tool outputs
      const outs = s?.outputs || s?.tool_outputs;
      if (Array.isArray(outs)) {
        for (const o of outs) {
          const c2 = o?.text || o?.content || o?.message;
          if (c2 && String(c2).trim()) return String(c2).trim();
        }
      }
    }
  }
  if (Array.isArray(p.messages)) {
    for (let i=p.messages.length-1;i>=0;i--){
      const m=p.messages[i];
      const role = (m.role||m.sender||"").toLowerCase();
      if (role.includes("assistant")) {
        const cand = m.text || m.message || m.content || m.output;
        if (cand && String(cand).trim()) return String(cand).trim();
      }
    }
  }

  // 2) Known flat fields
  const flat = p.assistant_reply || p.reply || p.output || p.message || p.text;
  if (flat && String(flat).trim()) return String(flat).trim();

  // 3) Last resort: shallow scan of objects for a likely string
  const queue = [p], seen = new Set();
  while (queue.length) {
    const cur = queue.shift();
    if (cur && typeof cur === "object" && !seen.has(cur)) {
      seen.add(cur);
      for (const k of Object.keys(cur)) {
        const v = cur[k];
        if (typeof v === "string" && v.trim().length > 12 && /[.,!?]/.test(v)) return v.trim();
        if (v && typeof v === "object") queue.push(v);
        if (Array.isArray(v)) for (const it of v) if (it && typeof it === "object") queue.push(it);
      }
    }
  }
  return null;
}

async function triggerBlockingThenFallback(body){
  const tries = [];

  // 1) tasks/trigger with blocking query + flags in body
  for (const host of HOSTS){
    for (const h of authVariants()){
      const url = `${host}/latest/agents/tasks/trigger?blocking=true&return_messages=true`;
      const r = await tryFetch(url, { method:"POST", headers:h, body:JSON.stringify(body) });
      tries.push({ url, status:r.status });
      if (r.ok || r.status===202 || r.status===409) {
        const reply = extractReply(r.json || {});
        const convId = (r.json && (r.json.conversation_id || r.json.task_id || r.json.id)) || body.conversation_id || null;
        if (reply) return { ok:true, status:r.status, reply, conversation_id: convId };
        // accepted but no inline → still return ok so client can poll
        return { ok:true, status:r.status, reply:null, conversation_id: convId };
      }
      if (r.status===401 || r.status===403) continue; // try next auth variant
    }
  }

  // 2) classic /agents/trigger with blocking
  for (const host of HOSTS){
    for (const h of authVariants()){
      const url = `${host}/latest/agents/trigger?blocking=true&return_messages=true`;
      const r = await tryFetch(url, { method:"POST", headers:h, body:JSON.stringify(body) });
      tries.push({ url, status:r.status });
      if (r.ok || r.status===202 || r.status===409) {
        const reply = extractReply(r.json || {});
        const convId = (r.json && (r.json.conversation_id || r.json.task_id || r.json.id)) || body.conversation_id || null;
        if (reply) return { ok:true, status:r.status, reply, conversation_id: convId };
        return { ok:true, status:r.status, reply:null, conversation_id: convId };
      }
      if (r.status===401 || r.status===403) continue;
    }
  }

  // 3) fallback to your custom-trigger webhook (fire-and-forget)
  if (CUSTOM_TRIGGER){
    const r = await tryFetch(CUSTOM_TRIGGER, { method:"POST", headers:{ "Content-Type":"text/plain" }, body: JSON.stringify(body) });
    tries.push({ url: CUSTOM_TRIGGER, status: r.status });
    if (r.ok) return { ok:true, status:r.status, reply:null, conversation_id: body.conversation_id || null };
    return { ok:false, status:r.status||502, error:r.text||"Custom-trigger failed", debug: tries };
  }

  return { ok:false, status:502, error:"Failed to contact trigger endpoint", debug: tries };
}

async function pollForReply({ convId }){
  // One quick pass; the browser keeps polling this route.
  const tries = [];
  for (const host of HOSTS){
    for (const h of authVariants()){
      const urls = [
        `${host}/latest/agents/${AGENT_ID}/tasks/${convId}/steps`,
        `${host}/latest/agents/tasks/view?agent_id=${encodeURIComponent(AGENT_ID)}&conversation_id=${encodeURIComponent(convId)}`,
        `${host}/latest/agents/conversations/${convId}`,
        `${host}/latest/agents/tasks/${convId}`,
        `${host}/latest/tasks/${convId}`,
      ];
      for (const url of urls){
        const r = await tryFetch(url, { method:"GET", headers:h });
        tries.push({ url, status:r.status });
        if (!r.ok) continue;
        const reply = extractReply(r.json || {});
        if (reply) return { reply };
      }
    }
  }
  return { reply: null };
}
