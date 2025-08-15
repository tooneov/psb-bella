<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Peach State Burgers — Live Chat Demo</title>
  <style>
    :root {
      --peach:#FFB07C;
      --peach-deep:#FF7A45;
      --ink:#1b1f23;
      --cloud:#f6f7f9;
      --line:#e6e8eb;
      --success:#16a34a;
      --navy:#001f3f;
      --card:#ffffff;
      --error:#ef4444;
      --ok:#16a34a;
    }
    /* Dark mode overrides */
    body.dark {
      --ink:#e6e8eb;
      --cloud:#0b1220;
      --line:#1c2740;
      --card:#0f172a;
      --success:#22c55e;
      --navy:#0b2856;
    }

    html, body { height:100%; }
    body { margin:0; font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial; color:var(--ink); background:var(--cloud); }

    .wrap { max-width:1100px; margin:24px auto; padding:16px; border: 2px solid var(--navy); border-radius: 8px; position:relative; }

    /* Topbar with theme toggle */
    .topbar { display:flex; justify-content:space-between; align-items:center; margin-bottom:12px; gap:8px; }
    .title { font-weight:800; letter-spacing:.2px; }
    .right-tools { display:flex; align-items:center; gap:10px; }
    .toggle { display:flex; align-items:center; gap:8px; font-size:13px; }
    .switch { position:relative; width:44px; height:24px; }
    .switch input { opacity:0; width:0; height:0; }
    .slider { position:absolute; cursor:pointer; inset:0; background:#c7d2fe; border-radius:999px; transition:.25s; }
    .slider:before { content:""; position:absolute; height:18px; width:18px; left:3px; top:3px; background:white; border-radius:50%; transition:.25s; box-shadow:0 1px 2px rgba(0,0,0,.25); }
    .switch input:checked + .slider { background:#0ea5e9; }
    .switch input:checked + .slider:before { transform:translateX(20px); }

    .menu-btn { border:1px solid var(--line); background:var(--card); padding:8px 12px; border-radius:10px; cursor:pointer; font-weight:600; }
    .menu-btn:hover { border-color:#cbd5e1; }
    .menu-btn:disabled { opacity:.55; pointer-events:none; }
    .chip:disabled { opacity:.55; pointer-events:none; }

    /* Top split layout */
    .grid-top { display:grid; grid-template-columns: 1.1fr 0.9fr; gap:18px; }
    @media (max-width: 960px) { .grid-top { grid-template-columns:1fr; } }

    /* Cards */
    .card { background:var(--card); border:1px solid var(--line); border-radius:16px; box-shadow:0 1px 2px rgba(0,0,0,.04); overflow:hidden; }
    .card h3 { margin:0 0 8px; }
    .pad { padding:16px; }

    /* Chat header */
    .chat-head { display:flex; align-items:center; gap:12px; padding:14px 16px; background:linear-gradient(180deg, var(--card), rgba(255,248,244,.9)); border-bottom:1px solid var(--line); }
    body.dark .chat-head { background:linear-gradient(180deg, var(--card), rgba(15,23,42,.85)); }
    .logo { width:40px; height:40px; border-radius:50%; background: radial-gradient(circle at 30% 30%, #ffd6ba, var(--peach)); display:grid; place-items:center; font-weight:800; color:#7a3b13; box-shadow: inset 0 0 0 2px rgba(0,0,0,.06); }
    .brand { font-weight:700; }
    .status { font-size:12px; color:#94a3b8; }
    .dot { width:8px; height:8px; border-radius:50%; background: var(--success); display:inline-block; margin-right:6px; box-shadow:0 0 0 2px rgba(22,163,74,.15); }

    /* Chat area */
    .chat { display:flex; flex-direction:column; height:560px; }
    .msgs { flex:1; overflow:auto; padding:16px; }
    .bubble { max-width:78%; padding:10px 12px; border-radius:16px; margin:6px 0; line-height:1.35; font-size:15px; box-shadow:0 1px 0 rgba(0,0,0,.04); }
    .ai { background:#fff4ec; border:1px solid #ffe3d1; color:#5a331f; border-top-left-radius:8px; }
    .me { background:#f1f5f9; border:1px solid #e2e8f0; color:#0f172a; margin-left:auto; border-top-right-radius:8px; }
    body.dark .ai { background:#1e293b; border-color:#334155; color:#e2e8f0; }
    body.dark .me { background:#0b1220; border-color:#1c2740; color:#e6e8eb; }

    .row { display:flex; gap:8px; align-items:center; border-top:1px solid var(--line); padding:10px; }
    .row input[type="text"] { flex:1; padding:12px 12px; border:1px solid var(--line); border-radius:12px; outline:none; font-size:15px; background:var(--card); color:var(--ink); }
    .row input[type="text"]:focus { border-color: var(--peach-deep); box-shadow: 0 0 0 3px rgba(255,122,69,.16); }

    .send { background:var(--peach-deep); color:#fff; border:0; padding:12px 14px; border-radius:12px; cursor:pointer; font-weight:700; transition: all .18s ease; }
    .send:hover { background: linear-gradient(135deg, var(--peach-deep) 65%, var(--peach) 100%); box-shadow:0 4px 10px rgba(255,122,69,.25); transform: translateY(-1px); }
    .send:active { transform: translateY(0); box-shadow:none; }
    .send:disabled { opacity:.6; cursor:not-allowed; }

    .chips { display:flex; flex-wrap:wrap; gap:8px; padding:8px 12px 12px; border-top:1px dashed var(--line); }
    .chip { font-size:13px; padding:6px 10px; border:1px solid var(--line); border-radius:999px; background:var(--card); cursor:pointer; }

    /* Typing */
    .typing { display:flex; align-items:center; gap:6px; margin:6px 0; }
    .dots span { width:6px; height:6px; display:inline-block; border-radius:50%; background:#c27d5a; opacity:.6; animation: bounce 1.1s infinite; }
    .dots span:nth-child(2){ animation-delay:.15s }
    .dots span:nth-child(3){ animation-delay:.3s }
    @keyframes bounce { 0%,80%,100%{ transform:translateY(0) } 40%{ transform:translateY(-4px) } }

    /* Lists */
    .list { margin:10px 0 0; padding-left:18px; }
    .list li { margin:8px 0; }

    /* FAQ full-width card */
    .faq { margin-top: 24px; }
    .faq h3 { margin:0 0 8px; }
    .faq-item { border-bottom: 1px solid var(--line); }
    .faq-question { cursor:pointer; padding:12px; background:#fff4ec; border:none; width:100%; text-align:left; font-weight:700; position:relative; }
    .faq-question::after { content:'▼'; position:absolute; right:16px; transition: transform 0.3s ease; }
    .faq-question.active::after { transform: rotate(180deg); }
    .faq-answer { display:none; padding:0 12px 12px; color:#334155; }
    body.dark .faq-question { background:#1e293b; color:#e6e8eb; }
    body.dark .faq-answer { color:#cbd5e1; }

    /* ===== Menu Drawer ===== */
    .drawer { position:fixed; top:0; right:0; height:100%; width:360px; max-width:92vw; background:var(--card); border-left:1px solid var(--line); box-shadow:-8px 0 24px rgba(0,0,0,.08); transform:translateX(100%); transition: transform .25s ease; z-index: 9998; display:flex; flex-direction:column; }
    .drawer.visible { transform:translateX(0); }
    .drawer-head { display:flex; align-items:center; justify-content:space-between; padding:14px 16px; border-bottom:1px solid var(--line); }
    .drawer-body { padding:12px 12px 80px; overflow:auto; }
    .menu-group { margin-bottom:12px; }
    .menu-group h4 { margin:8px 0; }
    .menu-item { display:flex; justify-content:space-between; align-items:center; gap:8px; border:1px solid var(--line); border-radius:12px; padding:10px; margin:8px 0; }
    .menu-item small { color:#64748b; }
    .add-btn { border:1px solid var(--line); background:var(--card); border-radius:10px; padding:6px 10px; cursor:pointer; font-weight:600; }

    .drawer-foot { position:absolute; bottom:0; left:0; right:0; border-top:1px solid var(--line); background:var(--card); padding:12px; display:flex; flex-direction:column; gap:10px; }
    .cart-line { display:flex; justify-content:space-between; font-weight:700; }
    .send-order { background:var(--peach-deep); color:#fff; border:0; padding:12px; border-radius:12px; cursor:pointer; font-weight:700; }

    /* ===== Toasts ===== */
    .toast-wrap { position:fixed; right:16px; bottom:16px; z-index: 9999; display:flex; flex-direction:column; gap:8px; }
    .toast { background:var(--card); color:var(--ink); border:1px solid var(--line); border-left:4px solid var(--error); padding:10px 12px; border-radius:12px; min-width:220px; max-width:360px; box-shadow:0 6px 18px rgba(0,0,0,.08); animation: toastIn .22s ease; }
    .toast.ok { border-left-color: var(--ok); }
    @keyframes toastIn { from { transform: translateY(10px); opacity: 0; } to { transform: translateY(0); opacity:1; } }
  </style>
</head>
<body>
  <div class="wrap">
    <div class="topbar">
      <div class="title">Peach State Burgers — Live Chat Demo</div>
      <div class="right-tools">
        <button id="menuBtn" class="menu-btn" type="button">Menu</button>
        <label class="toggle" title="Toggle dark mode">
          <span>Dark mode</span>
          <span class="switch"><input id="themeToggle" type="checkbox"><span class="slider"></span></span>
        </label>
      </div>
    </div>

    <div class="grid-top">
      <!-- Chat column -->
      <div class="card chat">
        <div class="chat-head">
          <div class="logo">PSB</div>
          <div>
            <div class="brand">Peach State Burgers — Bella</div>
            <div class="status"><span class="dot"></span>Online • Live Chat Demo</div>
          </div>
        </div>
        <div id="msgs" class="msgs" aria-live="polite">
          <div class="bubble ai">
            Hi! 👋 I’m Bella, your booking assistant for Peach State Burgers. I can help with reservations, orders, catering, and quick questions. What can I do for you today?
          </div>
        </div>
        <div class="chips" id="chips">
          <button class="chip" data-text="Show me the menu">Show me the menu</button>
          <button class="chip" data-text="Book a table for 2 tonight at 7pm">Book a table for 2 tonight at 7pm</button>
          <button class="chip" data-text="Do you do catering for 40 people next Saturday?">Catering for 40 next Saturday</button>
          <button class="chip" data-text="What are today’s specials?">Today’s specials</button>
        </div>
        <div class="row">
          <label class="toggle" title="Marketing consent">
            <input type="checkbox" id="consent" />
            <span>Consent to receive follow‑ups (optional)</span>
          </label>
        </div>
        <div class="row">
          <input id="input" type="text" placeholder="Type your message…" autocomplete="off" />
          <button id="send" class="send" type="button">Send</button>
        </div>
      </div>

      <!-- Capabilities column -->
      <div class="card pad">
        <h3>Capabilities — Live Chat Sales Agent</h3>
        <ul class="list">
          <li><strong>Reservations:</strong> checks real-time availability, collects party size/date/time, confirms via SMS, and can push to your POS.</li>
          <li><strong>Orders:</strong> guides guests through the current menu, handles mods, upsells intelligently, submits to kitchen, and sends confirmations.</li>
          <li><strong>Catering & Events:</strong> captures date, headcount, preferences; structures an inquiry for staff and schedules follow-ups.</li>
          <li><strong>CRM & Marketing:</strong> logs chats, sends thank-yous and review requests, and adds to marketing lists with consent.</li>
          <li><strong>Payments & Scheduling:</strong> supports taking payments, deposits, and booking calls/meetings when needed.</li>
          <li><strong>Social Selling:</strong> integrates with ManyChat for social media sales and trigger-word-activated conversations.</li>
          <li><strong>Loyalty Programs:</strong> enrolls customers into your loyalty program automatically and sends follow-up offers to keep them engaged.</li>
          <li><strong>Reputation Boost:</strong> prompts satisfied customers to leave Google reviews, improving rankings and attracting more guests.</li>
        </ul>
      </div>
    </div>

    <!-- FAQ full width -->
    <div class="card pad faq">
      <h3>FAQ</h3>
      <div class="faq-item">
        <button class="faq-question">Can the agent match my brand’s tone?</button>
        <div class="faq-answer">Yes. It can be configured to any tone: warm, playful, luxury, corporate; whatever fits your brand.</div>
      </div>
      <div class="faq-item">
        <button class="faq-question">Does it integrate with our systems?</button>
        <div class="faq-answer">It can connect with compatible systems for execution (e.g., POS, payments, calendars, SMS/Email, CRM).</div>
      </div>
      <div class="faq-item">
        <button class="faq-question">Can it schedule calls, meetings, and take payments?</button>
        <div class="faq-answer">Yes. It can place holds, collect deposits, and book calls/meetings when escalation is preferred.</div>
      </div>
      <div class="faq-item">
        <button class="faq-question">Can it power social DMs and live chats?</button>
        <div class="faq-answer">Yes. It can integrate with platforms like ManyChat to trigger live social media conversations via keywords.</div>
      </div>
      <div class="faq-item">
        <button class="faq-question">Is this only for the restaurant industry?</button>
        <div class="faq-answer">No. It is available for an array of industries, wherever products or services are sold or events need to be organized. It can be used for real estate, trucking, roofing, hotels, and more.</div>
      </div>
    </div>

    <!-- Drawer (hidden by default) -->
    <aside id="drawer" class="drawer" aria-hidden="true" role="dialog" aria-label="Menu Drawer">
      <div class="drawer-head">
        <strong>Order from Menu</strong>
        <button id="drawerClose" class="menu-btn" type="button">Close</button>
      </div>
      <div id="drawerBody" class="drawer-body"></div>
      <div class="drawer-foot">
        <div class="cart-line"><span>Total</span><span id="cartTotal">$0.00</span></div>
        <button id="sendOrder" class="send-order" type="button">Send Order to Bella</button>
      </div>
    </aside>

    <!-- Toasts -->
    <div id="toast" class="toast-wrap" aria-live="polite"></div>
  </div>

<script>
// ========= CONFIG =========
const WEBHOOK_URL = "https://api-bcbe5a.stack.tryrelevance.com/latest/agents/hooks/custom-trigger/1ecb9fa6-723e-4f5c-b5d8-051246d4cdf4/399c4008-630f-4f8d-a864-c47df0eefa4c";
// If you deploy the proxy (Vercel/Cloudflare Worker), set PROXY_URL below.
// The UI will prefer PROXY_URL and fall back to WEBHOOK_URL.
const PROXY_URL = "https://psb-bella-wbf6.vercel.app/api/bella"; // replace with your Vercel URL if you pick a different project name
const BRAND = { name: "Peach State Burgers", location: "Atlanta, GA" };

// ========= MINI KNOWLEDGE (optional context) =========
const MENU = [
  { group: "Burgers", items: [
    { name: "Classic Peach Burger", price: 11.99, desc: "Angus beef, peach chutney, cheddar, brioche." },
    { name: "Spicy Peach BBQ Burger", price: 12.99, desc: "Jalapeño, BBQ glaze, pepper jack." },
    { name: "Veggie Garden Burger", price: 10.99, desc: "Black bean patty, avocado, tomato, arugula." }
  ]},
  { group: "Sides", items: [
    { name: "Seasoned Fries", price: 3.99 },
    { name: "Sweet Potato Fries", price: 4.49 },
    { name: "House Slaw", price: 3.49 }
  ]},
  { group: "Drinks", items: [
    { name: "Peach Iced Tea", price: 2.99 },
    { name: "Fountain Drink", price: 2.49 }
  ]}
];
const POLICIES = {
  reservations: { hours: "Daily 11:00–22:00", groupMax: 8, holdsMinutes: 15 },
  catering: { leadDays: 3, minHeadcount: 15 },
  specialsNote: "Ask about today’s seasonal peach special."
};

// ========= STATE & HELPERS =========
const els = {
  msgs: document.getElementById('msgs'),
  input: document.getElementById('input'),
  send: document.getElementById('send'),
  chips: document.getElementById('chips'),
  consent: document.getElementById('consent'),
  themeToggle: document.getElementById('themeToggle'),
  toast: document.getElementById('toast'),
  menuBtn: document.getElementById('menuBtn'),
  drawer: document.getElementById('drawer'),
  drawerClose: document.getElementById('drawerClose'),
  drawerBody: document.getElementById('drawerBody'),
  cartTotal: document.getElementById('cartTotal'),
  sendOrder: document.getElementById('sendOrder'),
};

// Toasts
function showToast(message, type='error'){ 
  const div = document.createElement('div');
  div.className = 'toast' + (type==='ok' ? ' ok' : '');
  div.textContent = message;
  els.toast.appendChild(div);
  setTimeout(()=>{ div.remove(); }, 3200);
}

const THREAD_KEY = 'psb_thread_id_v4';
let threadId = localStorage.getItem(THREAD_KEY);
if(!threadId){ threadId = `psb_${Math.random().toString(36).slice(2)}_${Date.now()}`; localStorage.setItem(THREAD_KEY, threadId); }
function uniqueId(){ return `${threadId}_${Date.now()}_${Math.random().toString(36).slice(2,8)}`; }
const CONV_KEY = 'psb_conv_id_v1';
let convIdGlobal = localStorage.getItem(CONV_KEY) || null; // remember the current conversation id across requests

function addBubble(text, who='ai'){
  const div = document.createElement('div');
  div.className = `bubble ${who}`;
  div.textContent = text;
  els.msgs.appendChild(div);
  els.msgs.scrollTop = els.msgs.scrollHeight;
}
function addTyping(){
  if(document.getElementById('typing')) return;
  const wrap = document.createElement('div');
  wrap.id = 'typing';
  wrap.className = 'typing';
  wrap.innerHTML = `<div class="bubble ai" style="display:flex;align-items:center;gap:8px;">Bella is typing <span class="dots"><span></span><span></span><span></span></span></div>`;
  els.msgs.appendChild(wrap);
  els.msgs.scrollTop = els.msgs.scrollHeight;
}
function removeTyping(){ const t = document.getElementById('typing'); if(t) t.remove(); }
function setSending(v){
  els.send.disabled = v; 
  els.input.disabled = v; 
  document.querySelectorAll('.chip').forEach(c=>{ c.disabled = v; c.setAttribute('aria-disabled', v?'true':'false'); });
  if (els.menuBtn) els.menuBtn.disabled = v;
}

// ========= PROXY CALLS =========
// callAgent returns an object: { text, pending, conversationId }
async function callAgent(userText){
  const payload = {
    thread_id: threadId,
    unique_id: uniqueId(),
    channel: 'web_demo',
    message: userText,
    marketing_consent: !!els.consent.checked,
    customer: { source: 'Strikingly demo', locale: navigator.language || 'en-US' },
    context: {
      role: 'Bella',
      objective: 'Booking assistant for restaurant reservations, orders, and catering',
      brand: BRAND,
      menu: MENU,
      policies: POLICIES,
      response_rules: {
        tone: 'friendly, professional, concise',
        ask_one_question_at_a_time: true,
        confirm_before_finalizing: true,
        use_emojis_sparingly: true
      }
    }
  };

  let res, raw, data, contentType;
  try{
    res = await fetch(PROXY_URL || WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify(payload),
      mode: 'cors',
      credentials: 'omit'
    });
  } catch(err){
    showToast('Network error contacting assistant. Check your connection.', 'error');
    throw err;
  }

  contentType = res.headers.get('content-type') || '';
  raw = await res.text().catch(()=> '');
  if (contentType.includes('application/json')) { try { data = JSON.parse(raw); } catch(e){} }

  if (res.status === 409) {
    // Agent is already running on this conversation — wait and poll for the reply
    showToast('Agent is finishing a prior message. Waiting for reply…', 'ok');
    return { text: null, pending: true, conversationId: convIdGlobal };
  }

  if(!res.ok){
    const snippet = (raw || '').slice(0,160) || res.statusText || 'No response body';
    showToast(`Webhook error ${res.status}: ${res.statusText}`, 'error');
    return { text:`⚠️ Webhook error: HTTP ${res.status} ${res.statusText}
${snippet}`, pending:false, conversationId:null };
  }

  // New proxy returns { reply, pending, conversation_id }
  if (data && (data.reply || data.pending !== undefined)) {
    return {
      text: data.reply || null,
      pending: !!data.pending,
      conversationId: data.conversation_id || threadId
    };
  }

  // Back-compat for direct webhook or unexpected shapes
  const guess =
    (data && (data.assistant_reply || data.reply || data.output || data.message || data.text)) ||
    (data && data.data && (data.data.reply || data.data.output || data.data.message)) ||
    (typeof data === 'string' ? data : null) ||
    raw;

  if((String(guess)||'').toLowerCase().includes('event received') || (String(guess)||'').toLowerCase().includes('acknowledged')){
    showToast('Agent acknowledged the event. This endpoint did not return a chat reply. Set PROXY_URL (proxy) or enable synchronous reply in your trigger.', 'error');
  }

  return { text: guess || null, pending:false, conversationId:null };
}

// Poll status-only until we get the first assistant reply
async function pollStatus(conversationId, tries=35) {
  if (!conversationId) return null;
  try {
    const res = await fetch(PROXY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify({ status_only: true, conversation_id: conversationId })
    });
    const data = await res.json().catch(()=> ({}));
    if (data && data.reply) return data.reply;
    if (data && data.pending && tries > 0) {
      await new Promise(r => setTimeout(r, 1200));
      return await pollStatus(conversationId, tries-1);
    }
  } catch (e) {
    // stop polling on error
  }
  return null;
}

// ========= SEND PIPELINE (handles pending replies) =========
async function handleSend(text){
  if(!text) return;
  addBubble(text, 'me');
  els.input.value = '';
  setSending(true);
  addTyping();
  try {
    const result = await callAgent(text);
    if (result) { convIdGlobal = result.conversationId || convIdGlobal || threadId; localStorage.setItem(CONV_KEY, convIdGlobal); } // { text, pending, conversationId }
    if (result.text) {
      removeTyping();
      addBubble(result.text, 'ai');
    } else if (result.pending) {
      // keep typing while we poll
      const follow = await pollStatus(result.conversationId || convIdGlobal || threadId, 35);
      removeTyping();
      addBubble(follow || 'Thanks! Bella received your message.', 'ai');
    } else {
      removeTyping();
      addBubble('Thanks! Bella received your message.', 'ai');
    }
  } catch (err){
    console.error('Webhook error', err);
    removeTyping();
    addBubble('Hmm, I couldn’t reach the assistant just now. Please try again.', 'ai');
  } finally {
    setSending(false);
  }
}

// ========= EVENTS =========
els.send.addEventListener('click', () => handleSend(els.input.value.trim()));
els.input.addEventListener('keydown', (e)=>{ if(e.key === 'Enter'){ handleSend(els.input.value.trim()); }});
els.chips.addEventListener('click', (e)=>{
  const chip = e.target.closest('.chip');
  if(!chip) return;
  handleSend(chip.dataset.text || chip.textContent.trim());
});

// Theme toggle
const THEME_KEY = 'psb_theme_v1';
const savedTheme = localStorage.getItem(THEME_KEY);
if(savedTheme === 'dark'){ document.body.classList.add('dark'); els.themeToggle.checked = true; }
els.themeToggle.addEventListener('change', ()=>{
  document.body.classList.toggle('dark', els.themeToggle.checked);
  localStorage.setItem(THEME_KEY, els.themeToggle.checked ? 'dark' : 'light');
});

// ========= FAQ ACCORDIONS =========
const faqButtons = document.querySelectorAll('.faq-question');
faqButtons.forEach(btn => {
  btn.addEventListener('click', () => {
    btn.classList.toggle('active');
    const answer = btn.nextElementSibling;
    answer.style.display = (answer.style.display === 'block') ? 'none' : 'block';
  });
});

// ========= MENU DRAWER =========
let cart = [];
function formatUSD(n){ return `$${(Math.round(n*100)/100).toFixed(2)}`; }
function openDrawer(){ els.drawer.classList.add('visible'); els.drawer.setAttribute('aria-hidden','false'); }
function closeDrawer(){ els.drawer.classList.remove('visible'); els.drawer.setAttribute('aria-hidden','true'); }
function addToCart(item){
  const found = cart.find(i=> i.name === item.name);
  if(found){ found.qty += 1; }
  else { cart.push({ name:item.name, price:item.price, qty:1 }); }
  updateCart();
}
function updateCart(){
  const total = cart.reduce((s,i)=> s + i.price*i.qty, 0);
  els.cartTotal.textContent = formatUSD(total);
}
function renderMenuDrawer(){
  const body = els.drawerBody; body.innerHTML='';
  MENU.forEach(group=>{
    const g = document.createElement('div'); g.className='menu-group';
    g.innerHTML = `<h4>${group.group}</h4>`;
    group.items.forEach(item=>{
      const row = document.createElement('div'); row.className='menu-item';
      row.innerHTML = `<div><div><strong>${item.name}</strong> • ${formatUSD(item.price)}</div><small>${item.desc || ''}</small></div><button class="add-btn" type="button">Add</button>`;
      row.querySelector('button').addEventListener('click', ()=> addToCart(item));
      g.appendChild(row);
    });
    body.appendChild(g);
  });
}
function buildOrderMessage(){
  if(cart.length===0) return '';
  const lines = cart
    .map(i => `- ${i.name} x${i.qty} = ${formatUSD(i.price*i.qty)}`)
    .join('\n');
  const total = formatUSD(cart.reduce((s,i)=> s + i.price*i.qty, 0));
  return `I would like to place this order:
${lines}
Total: ${total}`;
}

els.menuBtn.addEventListener('click', ()=>{ renderMenuDrawer(); openDrawer(); });
els.drawerClose.addEventListener('click', closeDrawer);
els.sendOrder.addEventListener('click', ()=>{
  const msg = buildOrderMessage();
  if(!msg){ showToast('Your cart is empty.', 'error'); return; }
  closeDrawer();
  showToast('Order sent to Bella', 'ok');
  handleSend(msg);
});

</script>
</body>
</html>

