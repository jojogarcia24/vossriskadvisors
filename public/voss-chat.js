/* voss-chat.js · Voss Risk Advisors
   The site's chat bubble. An AI assistant (netlify/functions/chat.js) answers
   insurance questions, points to the right page, can open the quote form
   pre-filled, and turns the chat into a lead once the visitor leaves a name and
   a phone or email. The conversation is kept for the browser tab
   (sessionStorage). A "Text us" link is always one tap away. */
(function () {
  if (window.__VOSS_CHAT__) return;
  window.__VOSS_CHAT__ = true;

  var SMS = 'sms:+19454078370', TEL = 'tel:+19454078370', PHONE = '(945) 407-8370';
  var KEY = 'voss_chat_v1';
  var state = { open: false, msgs: [], leadId: null, leadToken: null, leadSaved: false, busy: false };
  try { var saved = JSON.parse(sessionStorage.getItem(KEY) || 'null'); if (saved && Array.isArray(saved.msgs)) state = Object.assign(state, saved, { busy: false }); } catch (e) {}
  function save() { try { sessionStorage.setItem(KEY, JSON.stringify({ open: state.open, msgs: state.msgs.slice(-60), leadId: state.leadId, leadToken: state.leadToken, leadSaved: state.leadSaved })); } catch (e) {} }

  var PAGE_LABEL = { homeowners: 'Homeowners', auto: 'Auto', renters: 'Renters', landlord: 'Landlord & Rental', flood: 'Flood', umbrella: 'Umbrella',
    'private-client': 'Private Client', commercial: 'Commercial', life: 'Life', disability: 'Disability', health: 'Health (waitlist)', coverage: 'All coverage',
    carriers: 'Our carriers', support: 'Claims & payments', service: 'Policy service', about: 'About us', resources: 'Guides', faq: 'FAQ', contact: 'Contact', book: 'Book a call', es: 'Página en español', realtors: 'For realtors' };

  var css = '' +
    '.vc-bub{position:fixed;right:22px;bottom:22px;z-index:9000;height:58px;padding:0 22px 0 7px;border-radius:999px;border:0;cursor:pointer;background:#0C2340;color:#fff;box-shadow:0 16px 36px -12px rgba(0,24,48,.55);display:flex;align-items:center;gap:11px;font:500 14px Montserrat,system-ui,sans-serif;letter-spacing:.02em;transition:transform .2s,box-shadow .2s}' +
    '.vc-bub:hover{transform:translateY(-2px);box-shadow:0 20px 44px -12px rgba(0,24,48,.6)}' +
    '.vc-mono{position:relative;width:44px;height:44px;border-radius:50%;background:#C09C48;color:#001830;display:flex;align-items:center;justify-content:center;font:600 22px "Cormorant Garamond",Georgia,serif;flex:none}' +
    '.vc-mono i{position:absolute;right:0;bottom:1px;width:11px;height:11px;border-radius:50%;background:#22c55e;border:2px solid #0C2340}' +
    '.vc-tease{position:fixed;right:22px;bottom:92px;z-index:9000;background:#fff;color:#1C2433;border-radius:14px;padding:12px 16px;font:400 14px/1.45 Montserrat,system-ui,sans-serif;box-shadow:0 16px 40px -14px rgba(0,24,48,.35);border:1px solid #E7E1D6;max-width:250px;cursor:pointer}' +
    '.vc-pan{position:fixed;right:22px;bottom:92px;z-index:9001;width:390px;max-width:calc(100vw - 32px);height:600px;max-height:calc(100vh - 124px);background:#fff;border-radius:18px;border:1px solid #E7E1D6;box-shadow:0 30px 80px -24px rgba(0,24,48,.5);display:flex;flex-direction:column;overflow:hidden;font-family:Montserrat,system-ui,sans-serif;opacity:0;transform:translateY(12px);pointer-events:none;transition:opacity .2s,transform .2s}' +
    '.vc-pan.on{opacity:1;transform:none;pointer-events:auto}' +
    '.vc-hd{background:#0C2340;color:#fff;padding:16px 16px 16px 18px;display:flex;gap:12px;align-items:center}' +
    '.vc-hd .vc-mono{width:42px;height:42px;font-size:21px}.vc-hd .vc-mono i{border-color:#0C2340}' +
    '.vc-nm{font:600 19px "Cormorant Garamond",Georgia,serif;letter-spacing:.02em}.vc-st{font-size:11.5px;color:#C9D0DB;margin-top:1px}' +
    '.vc-hact{margin-left:auto;display:flex;gap:6px}' +
    '.vc-ic{width:34px;height:34px;border-radius:50%;background:rgba(255,255,255,.1);border:0;color:#fff;cursor:pointer;display:flex;align-items:center;justify-content:center;text-decoration:none}.vc-ic:hover{background:rgba(255,255,255,.2)}.vc-ic svg{width:17px;height:17px}' +
    '.vc-bd{flex:1;overflow-y:auto;padding:18px 16px 8px;background:#FBFAF7;display:flex;flex-direction:column;gap:8px}' +
    '.vc-m{flex:none;padding:11px 14px;border-radius:16px;font-size:14px;line-height:1.55;white-space:pre-wrap;word-wrap:break-word;max-width:86%}' +
    '.vc-m.a{background:#fff;color:#1C2433;border:1px solid #E7E1D6;border-bottom-left-radius:5px;align-self:flex-start}' +
    '.vc-m.u{background:#0C2340;color:#fff;border-bottom-right-radius:5px;align-self:flex-end}' +
    '.vc-typ{align-self:flex-start;background:#fff;border:1px solid #E7E1D6;border-radius:16px;border-bottom-left-radius:5px;padding:13px 16px;display:flex;gap:5px}.vc-typ b{width:7px;height:7px;border-radius:50%;background:#C09C48;animation:vcb 1s infinite}.vc-typ b:nth-child(2){animation-delay:.15s}.vc-typ b:nth-child(3){animation-delay:.3s}' +
    '@keyframes vcb{0%,60%,100%{opacity:.3;transform:none}30%{opacity:1;transform:translateY(-3px)}}' +
    '.vc-acts{flex:none;display:flex;flex-wrap:wrap;gap:6px;align-self:flex-start;margin:-2px 0 4px}' +
    '.vc-act{border:1px solid #0C2340;background:#fff;color:#0C2340;border-radius:999px;padding:7px 13px;font:500 12.5px Montserrat,system-ui,sans-serif;cursor:pointer;text-decoration:none}.vc-act:hover{background:#0C2340;color:#fff}' +
    '.vc-act.gold{background:#C09C48;border-color:#C09C48;color:#001830}.vc-act.gold:hover{background:#b0873a}' +
    '.vc-ok{flex:none;align-self:center;font-size:12px;color:#4F7A28;background:#EEF5E6;border:1px solid #CFE3BC;border-radius:999px;padding:6px 12px;margin:2px 0}' +
    '.vc-chips{display:flex;flex-wrap:wrap;gap:7px;padding:8px 14px 10px;background:#FBFAF7}.vc-chip{border:1px solid #DFE3EA;background:#fff;color:#0C2340;border-radius:999px;padding:8px 13px;font:500 12.5px Montserrat,system-ui,sans-serif;cursor:pointer}.vc-chip:hover{border-color:#0C2340}' +
    '.vc-ft{display:flex;align-items:center;gap:6px;margin:8px 12px 6px;padding:5px 5px 5px 14px;border:1px solid #DFE3EA;border-radius:14px;background:#fff}.vc-ft:focus-within{border-color:#0C2340}' +
    '.vc-in{flex:1;border:0;padding:9px 0;font:15px Montserrat,system-ui,sans-serif;outline:none;background:transparent;color:#1C2433;min-width:0}' +
    '.vc-go{width:38px;height:38px;border-radius:11px;border:0;background:#0C2340;color:#fff;cursor:pointer;flex:none;display:flex;align-items:center;justify-content:center}.vc-go svg{width:18px;height:18px}.vc-go:disabled{opacity:.35}' +
    '.vc-fine{font-size:10.5px;color:#6B665B;text-align:center;padding:0 16px 10px;background:#fff;line-height:1.5}.vc-fine a{color:#0C2340}' +
    '@media(max-width:980px){.vc-bub{bottom:78px;right:14px;padding:0 7px}.vc-bub .vc-lbl{display:none}.vc-tease{right:14px;bottom:146px}}' +
    '@media(max-width:560px){.vc-pan{right:0;bottom:0;width:100vw;max-width:100vw;height:100%;max-height:100%;border-radius:0;border:0}}' +
    '@media (prefers-reduced-motion:reduce){.vc-pan,.vc-bub{transition:none}.vc-typ b{animation:none}}';
  var st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);

  function el(tag, cls, html) { var e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  var ICON_SMS = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/></svg>';
  var ICON_TEL = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2"/></svg>';

  var bub = el('button', 'vc-bub', '<span class="vc-mono">V<i></i></span><span class="vc-lbl">Questions? Chat with us</span>');
  bub.setAttribute('aria-label', 'Chat with us');
  var pan = el('div', 'vc-pan');
  pan.setAttribute('role', 'dialog'); pan.setAttribute('aria-label', 'Chat with Voss Risk Advisors');
  pan.innerHTML = '<div class="vc-hd"><span class="vc-mono">V<i></i></span><div><div class="vc-nm">Voss Risk Advisors</div><div class="vc-st">AI assistant · replies instantly</div></div>' +
    '<div class="vc-hact"><a class="vc-ic" href="' + SMS + '" aria-label="Text us" title="Text us ' + PHONE + '">' + ICON_SMS + '</a><a class="vc-ic" href="' + TEL + '" aria-label="Call us" title="Call ' + PHONE + '">' + ICON_TEL + '</a><button class="vc-ic vc-x" aria-label="Close" style="font-size:20px">&times;</button></div></div>' +
    '<div class="vc-bd" aria-live="polite"></div><div class="vc-chips"></div>' +
    '<form class="vc-ft"><input class="vc-in" placeholder="Ask about coverage…" maxlength="1000" autocomplete="off" aria-label="Message"><button class="vc-go" type="submit" aria-label="Send"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg></button></form>' +
    '<div class="vc-fine">AI assistant, general info only. It can\'t bind coverage. Please don\'t share SSNs or account numbers. By chatting you agree we may contact you about your request. <a href="/privacy">Privacy</a></div>';
  document.body.appendChild(pan); document.body.appendChild(bub);
  var body = pan.querySelector('.vc-bd'), chips = pan.querySelector('.vc-chips'), form = pan.querySelector('.vc-ft'), input = pan.querySelector('.vc-in'), goBtn = pan.querySelector('.vc-go');

  var GREETING = 'Hi! I\'m the Voss Risk Advisors assistant. Ask me anything about home, auto, renters, umbrella, business, or life coverage, or I can have a licensed advisor shop a quote for you.';
  var GREETING_ES = '¡Hola! Soy el asistente de Voss Risk Advisors. Pregúnteme sobre seguros de casa, auto, inquilino, negocio o vida, o un asesor con licencia puede cotizar su seguro.';
  function isEs() { return /^\/es\/?$/.test(location.pathname); }

  function nav(page) { if (typeof window.go === 'function') { window.go(page); if (window.innerWidth <= 560) setOpen(false); } else location.href = '/' + page; }
  function openQuote(cov) { if (typeof window.quote === 'function') { window.quote(cov); if (window.innerWidth <= 560) setOpen(false); } else location.href = '/contact'; }

  function render() {
    body.innerHTML = '';
    body.appendChild(el('div', 'vc-m a', esc(isEs() ? GREETING_ES : GREETING)));
    state.msgs.forEach(function (m) {
      if (m.role === 'user') { body.appendChild(el('div', 'vc-m u', esc(m.content))); return; }
      body.appendChild(el('div', 'vc-m a', esc(m.content)));
      if (m.saved) body.appendChild(el('div', 'vc-ok', '✓ Sent to a licensed advisor · reply within 1 business day'));
      if (m.page || m.quote) {
        var acts = el('div', 'vc-acts');
        if (m.quote) { var q = el('button', 'vc-act gold', 'Open quote form →'); q.type = 'button'; q.onclick = function () { openQuote(m.quote); }; acts.appendChild(q); }
        if (m.page && PAGE_LABEL[m.page]) { var p = el('button', 'vc-act', esc(PAGE_LABEL[m.page]) + ' →'); p.type = 'button'; p.onclick = function () { nav(m.page); }; acts.appendChild(p); }
        body.appendChild(acts);
      }
    });
    if (state.busy) body.appendChild(el('div', 'vc-typ', '<b></b><b></b><b></b>'));
    chips.innerHTML = '';
    if (!state.msgs.length) (isEs() ? ['Quiero una cotización', '¿Necesito seguro de inundación?', '¿Qué cubre el seguro de inquilino?', 'Hablar con un asesor'] : ['Get a quote', 'Do I need flood insurance?', 'What does renters cover?', 'How much umbrella do I need?', 'Talk to an advisor']).forEach(function (t) {
      var c = el('button', 'vc-chip', esc(t)); c.type = 'button'; c.onclick = function () { send(t); }; chips.appendChild(c);
    });
    body.scrollTop = body.scrollHeight;
    goBtn.disabled = state.busy;
  }
  function setOpen(on) {
    state.open = on; pan.classList.toggle('on', on); save();
    var t = document.querySelector('.vc-tease'); if (t) t.remove();
    if (on) { render(); if (window.innerWidth > 560) setTimeout(function () { input.focus(); }, 150); if (window.gtag) gtag('event', 'chat_open'); }
  }
  bub.onclick = function () { setOpen(!state.open); };
  pan.querySelector('.vc-x').onclick = function () { setOpen(false); };
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && state.open) setOpen(false); });

  async function send(text) {
    text = String(text || '').trim(); if (!text || state.busy) return;
    state.msgs.push({ role: 'user', content: text.slice(0, 1000) }); state.busy = true; input.value = ''; render(); save();
    try {
      var r = await fetch('/.netlify/functions/chat', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: state.msgs.map(function (m) { return { role: m.role, content: m.content }; }),
          page_url: location.href, lead_id: state.leadId, lead_token: state.leadToken, lead_saved: state.leadSaved,
        }),
      });
      var j = await r.json().catch(function () { return {}; });
      var msg = { role: 'assistant', content: j.reply || ('Sorry, something went wrong. Call or text ' + PHONE + ' and we\'ll help right away.') };
      if (j.page) msg.page = j.page;
      if (j.quote) msg.quote = j.quote;
      if (j.lead_saved) { msg.saved = true; state.leadSaved = true; if (window.gtag) gtag('event', 'generate_lead', { source: 'chat' }); }
      if (j.lead_id) { state.leadId = j.lead_id; state.leadToken = j.lead_token; }
      state.msgs.push(msg);
    } catch (e) {
      state.msgs.push({ role: 'assistant', content: 'I can\'t reach the server right now. Call or text ' + PHONE + ' and we\'ll help right away.' });
    }
    state.busy = false; render(); save();
  }
  form.addEventListener('submit', function (e) { e.preventDefault(); send(input.value); });

  window.VossChat = { open: function (prefill) { setOpen(true); if (prefill) send(prefill); } };

  if (state.open) setOpen(true);
  else {
    var teased = false; try { teased = !!sessionStorage.getItem('voss_chat_teased'); } catch (e) {}
    if (!teased) setTimeout(function () {
      if (state.open || document.querySelector('.vc-tease')) return;
      var t = el('div', 'vc-tease', 'Questions about coverage? I can help right now, or text us at ' + PHONE + '.');
      t.onclick = function () { setOpen(true); };
      document.body.appendChild(t);
      try { sessionStorage.setItem('voss_chat_teased', '1'); } catch (e) {}
      setTimeout(function () { if (t.parentNode) t.remove(); }, 12000);
    }, 12000);
  }
})();
