/*
 * Collegamento tra l'app e il foglio Google (Apps Script).
 * Espone `claude.use('db' | 'user' | 'downloads')` con la stessa interfaccia usata dall'app,
 * più l'accesso con nome e password (window.teamAuth).
 * I dati restano anche sul telefono: l'app si apre offline e le modifiche fatte senza rete
 * vengono inviate appena torna la connessione.
 */
(function () {
  const POLL_MS = 30000, FULL_MS = 5 * 60000;
  const ls = {
    get: k => { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set: (k, v) => { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) { } },
    json: (k, d) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } }
  };
  const apiUrl = () => (ls.get('apiUrl') || (window.APP_CONFIG && window.APP_CONFIG.apiUrl) || '').trim();

  let token = ls.get('tk'), me = ls.get('tn') || '';
  let server = ls.json('cache', null);           // {items:[], meta:{}, ver}
  let queue = ls.json('queue', []);              // modifiche non ancora salvate sul foglio
  const listeners = new Set();
  let flushing = false, retryT = null, retryMs = 5000, lastFull = 0, pollT = null, notifyT = null, loggedIn = null;

  /* ── Rete ── */
  async function call(action, payload) {
    const url = apiUrl();
    if (!url) { const e = new Error('Indirizzo del server non configurato'); e.code = 'NO_URL'; throw e; }
    let r;
    try {
      r = await fetch(url, { method: 'POST', body: JSON.stringify(Object.assign({ action, token }, payload || {})) });
    } catch (x) { const e = new Error('Nessuna connessione'); e.code = 'OFFLINE'; throw e; }
    let j;
    try { j = await r.json(); } catch (x) { const e = new Error('Risposta non valida dal server'); e.code = 'BAD_RESPONSE'; throw e; }
    if (!j.ok) { const e = new Error(j.error || 'Errore'); e.code = j.code || 'ERROR'; throw e; }
    return j;
  }

  /* ── Stato locale ── */
  function applyOps(base, ops) {
    const items = new Map(base.items.map(i => [i.id, i])), meta = Object.assign({}, base.meta);
    for (const o of ops) {
      const m = /^items\/(.+)$/.exec(o.path);
      if (m) {
        const id = m[1];
        if (o.op === 'delete') items.delete(id);
        else if (o.op === 'update') { const c = items.get(id); if (c) items.set(id, Object.assign({}, c, o.data, { id })); }
        else items.set(id, Object.assign({}, o.data, { id }));
      } else if (o.op === 'delete') delete meta[o.path];
      else if (o.op === 'update') meta[o.path] = Object.assign({}, meta[o.path] || {}, o.data);
      else meta[o.path] = o.data;
    }
    return { items: [...items.values()], meta };
  }
  function view() { return applyOps(server || { items: [], meta: {} }, queue); }
  function setServer(j) {
    server = { items: j.items || [], meta: j.meta || {}, ver: j.ver };
    ls.set('cache', JSON.stringify(server));
  }
  function notify() {
    clearTimeout(notifyT);
    notifyT = setTimeout(() => {
      const docs = view().items.map(i => { const { id, ...rest } = i; return { id, data: () => rest }; });
      listeners.forEach(l => { try { l.cb({ docs: docs.slice(0, l.limit) }); } catch (e) { console.error(e); } });
      status();
    }, 0);
  }

  /* ── Sincronizzazione ── */
  function enqueue(op, path, data) {
    queue.push({ op, path, data: data === undefined ? undefined : JSON.parse(JSON.stringify(data)) });
    ls.set('queue', JSON.stringify(queue));
    notify();
    clearTimeout(retryT);
    retryT = setTimeout(flush, 400);
    return Promise.resolve();
  }
  async function flush() {
    if (flushing || !queue.length || !token) return;
    flushing = true;
    const batch = queue.slice(0, 300);
    try {
      const j = await call('write', { ops: batch });
      queue = queue.slice(batch.length);
      ls.set('queue', JSON.stringify(queue));
      setServer(j);
      lastFull = Date.now();
      retryMs = 5000;
      if ((j.results || []).includes('bad')) toast('Alcune modifiche non sono state accettate dal foglio.');
      notify();
      if (queue.length) setTimeout(flush, 50);
    } catch (e) {
      if (e.code === 'AUTH' || e.code === 'MUST_CHANGE') { needLogin(e.code); }
      else if (e.code === 'BAD_OPS') { queue = queue.slice(batch.length); ls.set('queue', JSON.stringify(queue)); toast('Modifica scartata: ' + e.message); }
      else { clearTimeout(retryT); retryT = setTimeout(flush, retryMs); retryMs = Math.min(retryMs * 2, 120000); }
      status();
    } finally { flushing = false; }
  }
  async function pull(full) {
    if (!token) return;
    if (queue.length) { flush(); return; }
    try {
      const j = await call('list', { ver: full || !server ? '' : server.ver });
      if (!j.same && !queue.length) { setServer(j); notify(); }
      if (!j.same || full) lastFull = Date.now();
      status(true);
    } catch (e) {
      if (e.code === 'AUTH' || e.code === 'MUST_CHANGE') needLogin(e.code);
      status();
    }
  }
  function startPolling() {
    clearInterval(pollT);
    pollT = setInterval(() => { if (document.visibilityState === 'visible') pull(Date.now() - lastFull > FULL_MS); }, POLL_MS);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') pull(true); });
    window.addEventListener('online', () => { flush(); pull(true); });
  }

  /* ── Indicatore di stato ── */
  let online = true;
  function status(ok) {
    if (ok === true) online = true;
    else if (ok === false) online = false;
    let b = document.getElementById('sync');
    if (!b) { b = document.createElement('div'); b.id = 'sync'; document.body.append(b); }
    const n = queue.length;
    const off = !navigator.onLine || (n && retryMs > 5000);
    b.textContent = off ? '⚠️ Offline' + (n ? ' · ' + n + ' modifiche da inviare' : '') : n ? '⏳ Salvataggio…' : '';
    b.style.display = b.textContent ? 'block' : 'none';
  }
  function toast(t) { if (typeof window.toast === 'function') window.toast(t); else alert(t); }

  /* ── Accesso ── */
  const CSS = `#login{position:fixed;inset:0;z-index:50;background:var(--bg);overflow:auto;padding:calc(24px + env(safe-area-inset-top,0px)) 16px 24px}
#login .box{max-width:420px;margin:0 auto}#login h1{margin:10px 0 4px}#login p{color:var(--mu);font-size:14px;margin:6px 0 16px}
#login form{display:grid;gap:10px}#login .err{color:#d64533;font-size:14px;min-height:1em}
#sync{display:none;position:fixed;left:50%;transform:translateX(-50%);bottom:calc(74px + env(safe-area-inset-bottom,0px));background:var(--tx);color:var(--bg);padding:4px 12px;border-radius:12px;font:13px system-ui,sans-serif;z-index:25;opacity:.9}`;
  function styleOnce() { if (!document.getElementById('loginCss')) { const s = document.createElement('style'); s.id = 'loginCss'; s.textContent = CSS; document.head.append(s); } }
  function h(tag, attrs, ...kids) {
    const e = document.createElement(tag);
    Object.entries(attrs || {}).forEach(([k, v]) => { if (k.startsWith('on')) e[k] = v; else e.setAttribute(k, v); });
    kids.forEach(k => k != null && e.append(k));
    return e;
  }
  function screen(build) {
    styleOnce();
    let s = document.getElementById('login');
    if (!s) { s = h('div', { id: 'login' }); document.body.append(s); }
    s.replaceChildren(h('div', { class: 'box' }, h('h1', {}, '📚 Libreria · Team'), ...build()));
    const f = s.querySelector('input'); if (f) setTimeout(() => f.focus(), 50);
  }
  function closeScreen() { const s = document.getElementById('login'); if (s) s.remove(); }
  function pwInput(ph, ac) { return h('input', { type: 'password', placeholder: ph, autocomplete: ac, required: '' }); }

  function urlScreen() {
    const u = h('input', { type: 'url', placeholder: 'https://script.google.com/macros/s/…/exec', value: apiUrl() }), err = h('div', { class: 'err' });
    return new Promise(res => screen(() => [
      h('p', {}, 'Manca l\'indirizzo del foglio Google (l\'URL dell\'app web di Apps Script). Incollalo qui: resterà salvato su questo dispositivo.'),
      h('form', { onsubmit: e => { e.preventDefault(); const v = u.value.trim(); if (!/^https:\/\/script\.google(usercontent)?\.com\//.test(v)) { err.textContent = 'Indirizzo non valido'; return; } ls.set('apiUrl', v); res(); } },
        u, err, h('button', { class: 'p', type: 'submit' }, 'Continua'))
    ]));
  }

  function loginScreen(msg) {
    const n = h('input', { placeholder: 'Il tuo nome', autocomplete: 'username', value: me, required: '' });
    const p = pwInput('Password (primo accesso: codice squadra)', 'current-password');
    const err = h('div', { class: 'err' }, msg || ''), btn = h('button', { class: 'p', type: 'submit' }, 'Entra');
    return new Promise(res => screen(() => [
      h('p', {}, 'Entra con il tuo nome e la tua password. La prima volta usa il codice squadra che ti ha dato il responsabile: dopo ti chiederò di scegliere una password personale.'),
      h('form', {
        onsubmit: async e => {
          e.preventDefault(); err.textContent = ''; btn.disabled = true; btn.textContent = 'Controllo…';
          try { const j = await call('login', { name: n.value, password: p.value }); gotToken(j); res(j); }
          catch (x) { err.textContent = x.message; btn.disabled = false; btn.textContent = 'Entra'; }
        }
      }, n, p, err, btn),
      apiUrl() && !(window.APP_CONFIG && window.APP_CONFIG.apiUrl) ? h('button', { class: 'x', type: 'button', onclick: () => { ls.set('apiUrl', null); location.reload(); } }, 'Cambia indirizzo del server') : null
    ]));
  }

  function changeScreen(forced) {
    const o = forced ? null : pwInput('Password attuale', 'current-password');
    const a = pwInput('Nuova password (almeno 6 caratteri)', 'new-password'), b = pwInput('Ripeti la nuova password', 'new-password');
    const err = h('div', { class: 'err' }), btn = h('button', { class: 'p', type: 'submit' }, 'Salva password');
    return new Promise(res => screen(() => [
      h('p', {}, forced ? 'Ciao ' + me + '! Per continuare scegli la tua password personale: da ora entrerai con questa, non più con il codice squadra.' : 'Cambia la tua password.'),
      h('form', {
        onsubmit: async e => {
          e.preventDefault(); err.textContent = '';
          if (a.value.length < 6) { err.textContent = 'Almeno 6 caratteri'; return; }
          if (a.value !== b.value) { err.textContent = 'Le due password non coincidono'; return; }
          btn.disabled = true; btn.textContent = 'Salvo…';
          try { const j = await call('setpw', { password: o ? o.value : '', newPassword: a.value }); gotToken(j); res(true); }
          catch (x) { if (x.code === 'AUTH') { res(false); return; } err.textContent = x.message; btn.disabled = false; btn.textContent = 'Salva password'; }
        }
      }, o, a, b, err, btn),
      forced ? null : h('button', { class: 'x', type: 'button', onclick: () => { closeScreen(); res(null); } }, 'Annulla')
    ]));
  }

  function gotToken(j) {
    token = j.token; ls.set('tk', token);
    if (j.name && j.name !== me) {
      if (me) { server = null; queue = []; ls.set('cache', null); ls.set('queue', null); }
      me = j.name; ls.set('tn', me);
    }
  }
  function logout() {
    token = null; me = ''; server = null; queue = [];
    ['tk', 'tn', 'cache', 'queue', 'pf', 'seen'].forEach(k => ls.set(k, null));
    location.reload();
  }
  let relogging = false;
  async function needLogin(code) {
    if (relogging) return;
    relogging = true;
    try {
      if (code === 'MUST_CHANGE') { if (!(await changeScreen(true))) { token = null; await loginFlow('Accesso scaduto, entra di nuovo'); } }
      else { token = null; ls.set('tk', null); await loginFlow('Accesso scaduto, entra di nuovo'); }
      closeScreen(); flush(); pull(true);
    } finally { relogging = false; }
  }
  async function loginFlow(msg) {
    if (!apiUrl()) await urlScreen();
    for (;;) {
      const j = await loginScreen(msg);
      if (!j.mustChange) return;
      const ok = await changeScreen(true);
      if (ok) return;
      msg = 'Accesso scaduto, entra di nuovo';
    }
  }

  async function ensureLogin() {
    if (loggedIn) return loggedIn;
    loggedIn = (async () => {
      if (!token || !me) { await loginFlow(); closeScreen(); }
      if (!server) {
        for (;;) {
          try { setServer(await call('list', { ver: '' })); lastFull = Date.now(); break; }
          catch (e) {
            if (e.code === 'MUST_CHANGE') { if (!(await changeScreen(true))) await loginFlow('Accesso scaduto, entra di nuovo'); }
            else if (e.code === 'AUTH') { token = null; await loginFlow(e.message); }
            else if (e.code === 'NO_URL') await urlScreen();
            else {
              await new Promise(res => screen(() => [h('p', {}, 'Non riesco a raggiungere il foglio Google (' + e.message + '). Controlla la connessione.'),
                h('button', { class: 'p', type: 'button', onclick: res }, 'Riprova'),
                h('button', { class: 'x', type: 'button', onclick: () => logout() }, 'Esci')]));
            }
            closeScreen();
          }
        }
      } else { pull(true); }
      closeScreen();
      flush();
      startPolling();
      status();
    })();
    return loggedIn;
  }

  /* ── API compatibile con l'app ── */
  const db = {
    doc(path) {
      return {
        id: path.split('/').pop(),
        async get() {
          const v = view(), m = /^items\/(.+)$/.exec(path);
          const d = m ? v.items.find(i => i.id === m[1]) : v.meta[path];
          const data = d && m ? (({ id, ...r }) => r)(d) : d;
          return { exists: d !== undefined, id: path.split('/').pop(), data: () => data };
        },
        set: d => enqueue('set', path, d),
        update: d => enqueue('update', path, d),
        delete: () => enqueue('delete', path)
      };
    },
    collection() {
      let limit = Infinity;
      const q = {
        limit(n) { limit = n; return q; },
        onSnapshot(cb) { const l = { cb, limit }; listeners.add(l); notify(); return () => listeners.delete(l); }
      };
      return q;
    }
  };
  const user = { me: async () => ({ id: me, name: me }) };
  const downloads = {
    async save({ filename, data }) {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([data], { type: 'application/json' }));
      a.download = filename; document.body.append(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    }
  };

  window.claude = {
    async use(name) {
      if (name === 'db') { await ensureLogin(); return db; }
      if (name === 'user') { await ensureLogin(); return user; }
      if (name === 'downloads') return downloads;
      throw Object.assign(new Error('Funzione non disponibile'), { code: 'UNAVAILABLE' });
    }
  };
  window.teamAuth = {
    name: () => me,
    logout,
    async changePassword() { const r = await changeScreen(false); closeScreen(); if (r) toast('Password cambiata'); },
    pending: () => queue.length,
    refresh: () => pull(true)
  };
})();
