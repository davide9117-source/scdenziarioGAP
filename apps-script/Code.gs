/**
 * Libreria · Team — backend su Google Sheets.
 *
 * Da incollare nell'editor Apps Script del foglio Google (Estensioni → Apps Script),
 * insieme ad appsscript.json. Poi: esegui una volta `setup`, quindi Distribuisci → Nuova
 * distribuzione → App web (Esegui come: Me · Chi ha accesso: Chiunque). Vedi README.md.
 *
 * Dopo la prima installazione non serve più incollarlo: dall'app (Impostazioni →
 * Amministrazione → Script del foglio) lo script scarica da GitHub la versione nuova
 * e si aggiorna da solo.
 *
 * Ogni sezione dell'app è una scheda del foglio (Compiti, Turni, Eventi, …): una riga
 * per voce, una colonna per campo. Le celle si possono modificare anche a mano.
 */

// Da aumentare a ogni modifica di questo file: l'app la confronta per proporre l'aggiornamento.
const SCRIPT_VERSION = '2026-11-03b';
const CODE_URL = 'https://raw.githubusercontent.com/davide9117-source/scdenziarioGAP/main/apps-script/Code.gs';

const SHEET_OF = { task: 'Compiti', shift: 'Turni', event: 'Eventi', note: 'Note', client: 'Clienti', book: 'Letture', staff: 'Team' };
const OTHER = 'Altro';
const META = '_sistema';
const USERS = 'Utenti';
const CONF = 'Impostazioni';
// Ordine preferito delle colonne per ogni scheda (i campi nuovi vengono aggiunti in fondo).
const COLS = {
  task: ['id', 'text', 'note', 'who', 'grp', 'freq', 'days', 'nth', 'mday', 'dom', 'start', 'due', 'tfrom', 'tto', 'log', 'by', 'ts'],
  shift: ['id', 'date', 'who', 'from', 'to', 'abs', 'note', 'by', 'ts'],
  event: ['id', 'title', 'type', 'ptype', 'start', 'end', 'cstart', 'cend', 'goal', 'goalf', 'data', 'by', 'ts'],
  note: ['id', 'title', 'text', 'tag', 'pin', 'by', 'ts'],
  client: ['id', 'name', 'text', 'status', 'by', 'ts'],
  book: ['id', 'title', 'author', 'who', 'status', 'text', 'by', 'ts'],
  staff: ['id', 'name', 'role', 'active', 'uid', 'ts'],
  other: ['id', 'kind', 'ts']
};
// Campi che l'app usa come numeri: tutti gli altri numeri letti dal foglio diventano testo.
const NUMERIC = { ts: 1, nth: 1, dom: 1, goal: 1, goalf: 1 };
const USER_COLS = ['nome', 'hash', 'salt', 'cambioObbligatorio', 'versione', 'ultimoAccesso', 'permessi'];
const AI_KEY_LABEL = 'Chiave Gemini';
const AI_MODEL_LABEL = 'Modello Gemini';
const AI_DEFAULT_MODEL = 'gemini-flash-latest';
// Permessi che si possono dare dalla sezione Amministrazione dell'app.
const PERMS = ['email', 'manuale', 'app', 'admin'];
// Know How: il file del manuale, salvato a pezzi in una scheda nascosta (una cella tiene al massimo 50.000 caratteri).
// Anche l'app (scadenziario) modificata da Elisa si salva così, in una scheda separata.
const STORES = {
  manual: { sheet: '_manuale', perm: 'manuale', prop: 'man', label: /DATA_VERSION\s*=\s*["']([^"']+)["']/, name: 'Know How' },
  app: { sheet: '_app', perm: 'app', prop: 'app', label: /APP_VERSION\s*=\s*["']([^"']+)["']/, name: 'app' }
};
const CHUNK = 40000;
const KEEP_VERSIONS = 3;
const TOKEN_DAYS = 180;
const MIN_PW = 6;

/* ───────────── Installazione ───────────── */

function setup() {
  const ss = SpreadsheetApp.getActive();
  ss.setSpreadsheetTimeZone('Europe/Rome');
  let conf = ss.getSheetByName(CONF);
  if (!conf) {
    conf = ss.insertSheet(CONF);
    const code = Math.random().toString(36).slice(2, 8);
    conf.getRange(1, 1, 3, 2).setValues([
      ['Codice squadra', "'" + code],
      ['', ''],
      ['Il codice squadra serve per il primo accesso di ogni collega (poi ognuno sceglie la propria password).', '']
    ]);
    conf.getRange('B1').setNumberFormat('@');
    conf.setColumnWidth(1, 160);
  }
  let us = ss.getSheetByName(USERS);
  if (!us) {
    us = ss.insertSheet(USERS);
    us.getRange(1, 1, 1, USER_COLS.length).setValues([USER_COLS]).setFontWeight('bold');
    us.setFrozenRows(1);
    us.getRange(1, 8).setValue('Per azzerare la password di qualcuno: metti TRUE in cambioObbligatorio (entrerà con il codice squadra).');
  }
  ensureExtras_(ss);
  Object.keys(SHEET_OF).forEach(k => ensureSheet_(ss, SHEET_OF[k], COLS[k]));
  ensureSheet_(ss, OTHER, COLS.other);
  let meta = ss.getSheetByName(META);
  if (!meta) {
    meta = ss.insertSheet(META);
    meta.getRange(1, 1, 1, 2).setValues([['chiave', 'valore']]);
    meta.hideSheet();
  }
  const def = ss.getSheetByName('Foglio1') || ss.getSheetByName('Sheet1');
  if (def && def.getLastRow() === 0 && ss.getSheets().length > 1) ss.deleteSheet(def);
  secret_();
  Logger.log('Pronto. Codice squadra: ' + conf.getRange('B1').getDisplayValue());
}

// Aggiunte successive alla prima installazione: colonna "permessi" in Utenti, riga "Chiave Gemini" in Impostazioni.
function ensureExtras_(ss) {
  const us = ss.getSheetByName(USERS);
  if (us && String(us.getRange(1, 7).getValue()).trim() !== 'permessi') us.getRange(1, 7).setValue('permessi').setFontWeight('bold');
  const conf = ss.getSheetByName(CONF);
  if (conf && !confRow_(conf, AI_KEY_LABEL)) {
    conf.getRange(2, 1, 1, 2).setValues([[AI_KEY_LABEL, '']]);
    conf.getRange(4, 1).setValue('La chiave Gemini serve per "Compiti da email" (solo per chi ha "email" nella colonna permessi della scheda Utenti).');
  }
}

function confRow_(sh, label) {
  const v = sh.getRange(1, 1, Math.max(sh.getLastRow(), 1), 1).getValues();
  for (let r = 0; r < v.length; r++) if (String(v[r][0]).trim().toLowerCase() === label.toLowerCase()) return r + 1;
  return 0;
}

// Scrive un valore nella scheda Impostazioni, accanto alla sua etichetta (aggiunge la riga se manca).
function confSet_(label, value) {
  const sh = SpreadsheetApp.getActive().getSheetByName(CONF);
  let r = confRow_(sh, label);
  if (!r) { r = sh.getLastRow() + 1; sh.getRange(r, 1).setValue(label); }
  sh.getRange(r, 2).setValue(value ? "'" + value : '');
}

function confValue_(label) {
  const sh = SpreadsheetApp.getActive().getSheetByName(CONF);
  const r = sh ? confRow_(sh, label) : 0;
  return r ? String(sh.getRange(r, 2).getDisplayValue()).trim() : '';
}

function ensureSheet_(ss, name, cols) {
  let sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.getRange(1, 1, 1, cols.length).setValues([cols]).setFontWeight('bold');
    sh.setFrozenRows(1);
  }
  return sh;
}

/* ───────────── Web app ───────────── */

function doGet() {
  return out_({ ok: true, app: 'libreria-team' });
}

function doPost(e) {
  let req;
  try { req = JSON.parse(e.postData.contents); } catch (x) { return out_({ ok: false, error: 'Richiesta non valida' }); }
  try {
    return out_(handle_(req));
  } catch (x) {
    return out_({ ok: false, error: String(x && x.message || x), code: x && x.code || 'ERROR' });
  }
}

function out_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}

function fail_(msg, code) {
  const e = new Error(msg);
  e.code = code;
  throw e;
}

function handle_(req) {
  const a = req.action;
  if (a === 'login') return withLock_(() => login_(req.name, req.password));
  if (a === 'setpw') return withLock_(() => setPassword_(req.token, req.password, req.newPassword));
  const u = auth_(req.token);
  if (u.mustChange) fail_('Devi prima cambiare la password', 'MUST_CHANGE');
  if (a === 'list') {
    const ver = version_();
    const extra = { perms: u.perms, mver: storeCur_('manual'), aver: storeCur_('app'), sv: SCRIPT_VERSION };
    if (req.ver && String(req.ver) === ver) return { ok: true, same: true, ver: ver, ...extra };
    return withLock_(() => ({ ok: true, ver: version_(), ...extra, ...loadAll_(SpreadsheetApp.getActive()).dump() }));
  }
  if (a === 'write') return withLock_(() => write_(req.ops || []));
  if (a === 'ai') return ai_(u, req);
  const sm = a.match(/^(manual|app)_(get|put|versions|restore|clear)$/);
  if (sm) {
    const k = sm[1], op = sm[2];
    if (op === 'get') return storeGet_(k, req);
    needPerm_(u, STORES[k].perm);
    if (op === 'put') return withLock_(() => storePut_(k, u, req.html));
    if (op === 'versions') return { ok: true, cur: storeCur_(k), list: storeList_(k).map(x => ({ vid: x.vid, label: x.label, by: x.by, at: x.at, len: x.len })) };
    if (op === 'restore') return withLock_(() => storeRestore_(k, req.vid));
    if (op === 'clear') { PropertiesService.getScriptProperties().setProperty(STORES[k].prop + '_cur', ''); return { ok: true }; }
  }
  if (a.indexOf('admin_') === 0) { needPerm_(u, 'admin'); return a === 'admin_ai_test' || a === 'admin_script_check' ? admin_(u, a, req) : withLock_(() => admin_(u, a, req)); }
  fail_('Azione sconosciuta', 'BAD_ACTION');
}

function withLock_(fn) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try { return fn(); } finally { lock.releaseLock(); }
}

function version_() {
  return PropertiesService.getScriptProperties().getProperty('ver') || '0';
}

function bump_() {
  PropertiesService.getScriptProperties().setProperty('ver', String(Date.now()));
}

/* ───────────── Accesso ───────────── */

function secret_() {
  const p = PropertiesService.getScriptProperties();
  let s = p.getProperty('secret');
  if (!s) {
    s = Utilities.getUuid() + Utilities.getUuid();
    p.setProperty('secret', s);
  }
  return s;
}

function teamCode_() {
  const sh = SpreadsheetApp.getActive().getSheetByName(CONF);
  const c = sh ? String(sh.getRange('B1').getDisplayValue()).trim() : '';
  if (!c) fail_('Codice squadra non impostato nel foglio "Impostazioni"', 'NO_CODE');
  return c;
}

function users_() {
  const sh = SpreadsheetApp.getActive().getSheetByName(USERS);
  const v = sh.getDataRange().getValues();
  const list = [];
  for (let r = 1; r < v.length; r++) {
    const nome = String(v[r][0] || '').trim();
    if (!nome) continue;
    list.push({
      row: r + 1, nome: nome, hash: String(v[r][1] || ''), salt: String(v[r][2] || ''),
      mustChange: v[r][3] === true || String(v[r][3]).toUpperCase() === 'TRUE' || !v[r][1],
      ver: Number(v[r][4]) || 0,
      last: Object.prototype.toString.call(v[r][5]) === '[object Date]' ? v[r][5].getTime() : 0,
      perms: String(v[r][6] || '').toLowerCase().split(/[\s,;]+/).filter(String)
    });
  }
  return { sheet: sh, list: list };
}

function findUser_(U, name) {
  const n = String(name || '').trim().toLowerCase();
  return U.list.find(u => u.nome.toLowerCase() === n);
}

function writeUser_(U, u) {
  const txt = x => x ? "'" + x : '';
  const row = [txt(u.nome), txt(u.hash), txt(u.salt), u.mustChange, u.ver, new Date()];
  if (u.row) U.sheet.getRange(u.row, 1, 1, row.length).setValues([row]);
  else { U.sheet.appendRow(row); u.row = U.sheet.getLastRow(); }
}

function hash_(salt, pw) {
  let h = salt + '|' + pw;
  for (let i = 0; i < 200; i++) {
    h = Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, h + '|' + salt, Utilities.Charset.UTF_8));
  }
  return h;
}

function sign_(s) {
  return Utilities.base64EncodeWebSafe(Utilities.computeHmacSha256Signature(s, secret_()));
}

function token_(u) {
  const body = Utilities.base64EncodeWebSafe(JSON.stringify({ n: u.nome, v: u.ver, e: Date.now() + TOKEN_DAYS * 864e5 }), Utilities.Charset.UTF_8);
  return body + '.' + sign_(body);
}

function auth_(token) {
  const parts = String(token || '').split('.');
  if (parts.length !== 2 || sign_(parts[0]) !== parts[1]) fail_('Accesso scaduto, entra di nuovo', 'AUTH');
  let p;
  try { p = JSON.parse(Utilities.newBlob(Utilities.base64DecodeWebSafe(parts[0])).getDataAsString('UTF-8')); } catch (x) { fail_('Accesso scaduto, entra di nuovo', 'AUTH'); }
  if (!p || p.e < Date.now()) fail_('Accesso scaduto, entra di nuovo', 'AUTH');
  const u = findUser_(users_(), p.n);
  if (!u || u.ver !== p.v) fail_('Accesso scaduto, entra di nuovo', 'AUTH');
  return u;
}

function tooMany_(name) {
  const c = CacheService.getScriptCache(), k = 'f_' + String(name).toLowerCase();
  return (Number(c.get(k)) || 0) >= 8;
}

function failed_(name) {
  const c = CacheService.getScriptCache(), k = 'f_' + String(name).toLowerCase();
  c.put(k, String((Number(c.get(k)) || 0) + 1), 900);
}

function login_(name, pw) {
  name = String(name || '').trim().replace(/\s+/g, ' ');
  pw = String(pw || '');
  if (!name || !pw) fail_('Scrivi nome e password', 'BAD_LOGIN');
  if (name.length > 40) fail_('Nome troppo lungo', 'BAD_LOGIN');
  if (tooMany_(name)) fail_('Troppi tentativi: riprova tra 15 minuti', 'LOCKED');
  const U = users_(), code = teamCode_();
  let u = findUser_(U, name);
  let ok;
  if (!u) {
    ok = pw === code;
    if (ok) { u = { nome: name, hash: '', salt: '', mustChange: true, ver: 1 }; writeUser_(U, u); }
  } else if (u.mustChange) {
    ok = pw === code || (!!u.hash && hash_(u.salt, pw) === u.hash);
    if (ok && !u.ver) { u.ver = 1; writeUser_(U, u); }
  } else {
    ok = hash_(u.salt, pw) === u.hash;
  }
  if (!ok) {
    failed_(name);
    fail_(u ? 'Password errata' : 'Nome non registrato: per il primo accesso usa il codice squadra', 'BAD_LOGIN');
  }
  if (!u.mustChange) { U.sheet.getRange(u.row, 6).setValue(new Date()); }
  return { ok: true, token: token_(u), name: u.nome, mustChange: u.mustChange, perms: u.perms || [] };
}

function setPassword_(token, oldPw, newPw) {
  const u = auth_(token);
  newPw = String(newPw || '');
  if (newPw.length < MIN_PW) fail_('La password deve avere almeno ' + MIN_PW + ' caratteri', 'WEAK');
  if (newPw === teamCode_()) fail_('La password non può essere il codice squadra', 'WEAK');
  if (!u.mustChange && hash_(u.salt, String(oldPw || '')) !== u.hash) fail_('La password attuale non è corretta', 'BAD_LOGIN');
  const U = users_(), cur = findUser_(U, u.nome);
  cur.salt = Utilities.getUuid();
  cur.hash = hash_(cur.salt, newPw);
  cur.mustChange = false;
  cur.ver = (cur.ver || 0) + 1;
  writeUser_(U, cur);
  return { ok: true, token: token_(cur), name: cur.nome, mustChange: false, perms: cur.perms || [] };
}

/* ───────────── Dati ───────────── */

function enc_(v) {
  if (v === undefined || v === null || v === '') return '';
  if (typeof v === 'number' || typeof v === 'boolean') return v;
  if (typeof v === 'object') return "'" + JSON.stringify(v);
  const s = String(v);
  return "'" + s;
}

function dec_(k, v, tz) {
  if (v === '' || v === null || v === undefined) return undefined;
  if (Object.prototype.toString.call(v) === '[object Date]') {
    if (isNaN(v.getTime())) return undefined;
    return v.getFullYear() < 1900 ? Utilities.formatDate(v, tz, 'HH:mm') : Utilities.formatDate(v, tz, 'yyyy-MM-dd');
  }
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return NUMERIC[k] ? v : String(v);
  const s = String(v);
  if (NUMERIC[k] && /^-?\d+(\.\d+)?$/.test(s.trim())) return Number(s);
  if (s === 'TRUE' || s === 'FALSE') return s === 'TRUE';
  const c = s.charAt(0);
  if (c === '[' || c === '{') { try { return JSON.parse(s); } catch (x) { } }
  return s;
}

function loadAll_(ss) {
  const tz = ss.getSpreadsheetTimeZone() || 'Europe/Rome';
  const tabs = [];
  Object.keys(SHEET_OF).forEach(k => tabs.push({ kind: k, name: SHEET_OF[k] }));
  tabs.push({ kind: null, name: OTHER });
  tabs.forEach(t => {
    t.sheet = ensureSheet_(ss, t.name, t.kind ? COLS[t.kind] : COLS.other);
    const v = t.sheet.getDataRange().getValues();
    t.head = (v[0] || []).map(h => String(h).trim());
    if (t.head.indexOf('id') < 0) { t.head.unshift('id'); v.forEach((r, i) => { if (i) r.unshift(''); }); t.dirty = true; }
    t.rows = [];
    for (let r = 1; r < v.length; r++) {
      const o = {};
      let any = false;
      t.head.forEach((h, c) => { if (!h) return; const x = dec_(h, v[r][c], tz); if (x !== undefined) { o[h] = x; any = true; } });
      if (!any) continue;
      if (!o.id) { o.id = 'g' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); t.dirty = true; }
      o.id = String(o.id);
      if (t.kind) o.kind = t.kind;
      if (t.kind === 'task' && !o.freq) o.freq = 'none';
      else if (!o.kind) o.kind = 'other';
      t.rows.push(o);
    }
  });
  const meta = ss.getSheetByName(META) || (() => { const s = ss.insertSheet(META); s.getRange(1, 1, 1, 2).setValues([['chiave', 'valore']]); s.hideSheet(); return s; })();
  const mv = meta.getDataRange().getValues(), M = {};
  for (let r = 1; r < mv.length; r++) {
    const k = String(mv[r][0] || '');
    if (!k) continue;
    try { M[k] = JSON.parse(String(mv[r][1])); } catch (x) { }
  }
  const db = {
    tabs: tabs, meta: M, metaSheet: meta, metaDirty: false,
    tabOf: kind => tabs.find(t => t.kind === kind) || tabs[tabs.length - 1],
    find: id => { for (const t of tabs) { const i = t.rows.findIndex(o => o.id === id); if (i >= 0) return { t: t, i: i }; } return null; },
    dump: () => ({ items: [].concat.apply([], tabs.map(t => t.rows)), meta: M })
  };
  if (tabs.some(t => t.dirty)) save_(db);
  return db;
}

function save_(db) {
  db.tabs.forEach(t => {
    if (!t.dirty) return;
    const sh = t.sheet;
    t.rows.forEach(o => Object.keys(o).forEach(k => { if (k !== 'kind' || !t.kind) { if (t.head.indexOf(k) < 0) t.head.push(k); } }));
    const W = t.head.length;
    const data = [t.head].concat(t.rows.map(o => t.head.map(h => h ? enc_(o[h]) : '')));
    const oldR = sh.getLastRow(), oldC = sh.getLastColumn();
    if (sh.getMaxColumns() < W) sh.insertColumnsAfter(sh.getMaxColumns(), W - sh.getMaxColumns());
    if (sh.getMaxRows() < data.length + 1) sh.insertRowsAfter(sh.getMaxRows(), data.length + 1 - sh.getMaxRows());
    if (oldR > data.length) sh.getRange(data.length + 1, 1, oldR - data.length, Math.max(oldC, W)).clearContent();
    if (oldC > W) sh.getRange(1, W + 1, Math.max(oldR, 1), oldC - W).clearContent();
    sh.getRange(1, 1, data.length, W).setValues(data);
    sh.getRange(1, 1, 1, W).setFontWeight('bold');
    t.dirty = false;
  });
  if (db.metaDirty) {
    const keys = Object.keys(db.meta);
    const data = [['chiave', 'valore']].concat(keys.map(k => ["'" + k, "'" + JSON.stringify(db.meta[k])]));
    const sh = db.metaSheet, oldR = sh.getLastRow();
    if (oldR > data.length) sh.getRange(data.length + 1, 1, oldR - data.length, 2).clearContent();
    sh.getRange(1, 1, data.length, 2).setValues(data);
    db.metaDirty = false;
  }
}

function clean_(d) {
  const o = {};
  Object.keys(d || {}).forEach(k => { if (k !== 'id' && /^[A-Za-z_][A-Za-z0-9_]{0,40}$/.test(k)) o[k] = d[k]; });
  return o;
}

function write_(ops) {
  if (!Array.isArray(ops) || ops.length > 2000) fail_('Troppe modifiche in una volta', 'BAD_OPS');
  const db = loadAll_(SpreadsheetApp.getActive());
  const base = version_();
  const res = [];
  ops.forEach(op => {
    const path = String(op.path || '');
    const m = path.match(/^items\/([A-Za-z0-9_\-.]{1,80})$/);
    if (!m) {
      if (!/^[^\x00-\x1f]{1,160}$/.test(path)) { res.push('bad'); return; }
      if (op.op === 'delete') delete db.meta[path];
      else if (op.op === 'update') db.meta[path] = Object.assign({}, db.meta[path] || {}, op.data || {});
      else db.meta[path] = op.data || {};
      db.metaDirty = true;
      res.push('ok');
      return;
    }
    const id = m[1], f = db.find(id);
    if (op.op === 'delete') {
      if (f) { f.t.rows.splice(f.i, 1); f.t.dirty = true; }
      res.push('ok');
      return;
    }
    let obj;
    if (op.op === 'update') {
      if (!f) { res.push('missing'); return; }
      obj = Object.assign({}, f.t.rows[f.i], clean_(op.data));
    } else {
      obj = clean_(op.data);
    }
    obj.id = id;
    if (!obj.kind) obj.kind = 'other';
    const t = db.tabOf(obj.kind);
    if (f && f.t !== t) { f.t.rows.splice(f.i, 1); f.t.dirty = true; }
    if (f && f.t === t) t.rows[f.i] = obj;
    else t.rows.push(obj);
    t.dirty = true;
    res.push('ok');
  });
  save_(db);
  bump_();
  return { ok: true, results: res, base: base, ver: version_() };
}

/* ───────────── Know How e app: file HTML salvati nel foglio, con le ultime versioni ───────────── */

function needPerm_(u, p) {
  if (u.perms.indexOf(p) < 0) fail_('Non hai il permesso per questa funzione', 'FORBIDDEN');
}

function storeSheet_(k) {
  const ss = SpreadsheetApp.getActive(), name = STORES[k].sheet;
  let sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.getRange(1, 1, 1, 3).setValues([['versione', 'parte', 'testo']]);
    sh.hideSheet();
  }
  return sh;
}

function storeCur_(k) {
  return PropertiesService.getScriptProperties().getProperty(STORES[k].prop + '_cur') || '';
}

function storeList_(k) {
  try { return JSON.parse(PropertiesService.getScriptProperties().getProperty(STORES[k].prop + '_list') || '[]'); } catch (x) { return []; }
}

function digest_(s) {
  return Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, s, Utilities.Charset.UTF_8));
}

function storeRead_(k, vid) {
  const v = storeSheet_(k).getDataRange().getValues();
  return v.slice(1).filter(r => String(r[0]) === vid).sort((a, b) => Number(a[1]) - Number(b[1])).map(r => String(r[2])).join('');
}

// Tiene solo le righe delle versioni indicate.
function storePrune_(k, keep) {
  const sh = storeSheet_(k), v = sh.getDataRange().getValues();
  const rows = v.slice(1).filter(r => keep.indexOf(String(r[0])) >= 0);
  if (rows.length === v.length - 1) return;
  if (v.length > 1) sh.getRange(2, 1, v.length - 1, 3).clearContent();
  if (rows.length) sh.getRange(2, 1, rows.length, 3).setValues(rows.map(r => [String(r[0]), r[1], "'" + String(r[2])]));
}

function storeGet_(k, req) {
  const cur = storeCur_(k);
  if (!cur) return { ok: true, none: true };
  if (req.ver && String(req.ver) === cur) return { ok: true, same: true, ver: cur };
  const info = storeList_(k).find(x => x.vid === cur) || { vid: cur };
  const html = storeRead_(k, cur);
  if (!html || (info.hash && digest_(html) !== info.hash)) fail_('Il file salvato nel foglio (' + STORES[k].name + ') non è integro: chi ha il permesso può ripristinare una versione precedente', 'CORRUPT');
  return { ok: true, ver: cur, info: { vid: cur, label: info.label || '', by: info.by || '', at: info.at || 0, len: html.length }, html: html };
}

function storePut_(k, u, html) {
  html = String(html || '').replace(/\r\n?/g, '\n');
  if (html.length < 500 || html.length > 8000000) fail_('Il file non sembra valido (dimensione)', 'BAD_FILE');
  const m = html.match(STORES[k].label);
  const vid = 'v' + Date.now();
  const rows = [];
  for (let i = 0, n = 0; i < html.length; n++) {
    let j = Math.min(i + CHUNK, html.length);
    const c = html.charCodeAt(j - 1);
    if (j < html.length && c >= 0xD800 && c <= 0xDBFF) j--; // non spezzo le emoji a metà
    rows.push([vid, n, "'" + html.slice(i, j)]);
    i = j;
  }
  const sh = storeSheet_(k), start = sh.getLastRow() + 1;
  if (sh.getMaxRows() < start + rows.length) sh.insertRowsAfter(sh.getMaxRows(), start + rows.length - sh.getMaxRows());
  sh.getRange(start, 1, rows.length, 3).setValues(rows);
  SpreadsheetApp.flush();
  // Rileggo e confronto: pubblico solo se il foglio contiene esattamente il file caricato.
  if (storeRead_(k, vid) !== html) {
    storePrune_(k, storeList_(k).map(x => x.vid));
    fail_('Il salvataggio nel foglio non è andato a buon fine: niente è cambiato, riprova', 'SAVE_FAILED');
  }
  const info = { vid: vid, label: m ? m[1] : '', by: u.nome, at: Date.now(), len: html.length, hash: digest_(html) };
  const list = [info].concat(storeList_(k)).slice(0, KEEP_VERSIONS);
  const p = PropertiesService.getScriptProperties();
  p.setProperty(STORES[k].prop + '_list', JSON.stringify(list));
  p.setProperty(STORES[k].prop + '_cur', vid);
  storePrune_(k, list.map(x => x.vid));
  return { ok: true, info: { vid: vid, label: info.label, by: info.by, at: info.at, len: info.len } };
}

function storeRestore_(k, vid) {
  if (!storeList_(k).some(x => x.vid === vid)) fail_('Versione non trovata', 'NOT_FOUND');
  PropertiesService.getScriptProperties().setProperty(STORES[k].prop + '_cur', String(vid));
  return { ok: true };
}

/* ───────────── IA (Gemini) ───────────── */

function aiModel_() {
  return confValue_(AI_MODEL_LABEL) || PropertiesService.getScriptProperties().getProperty('GEMINI_MODEL') || AI_DEFAULT_MODEL;
}

function ai_(u, req) {
  if (u.perms.indexOf('email') < 0) fail_('Non hai il permesso per questa funzione', 'FORBIDDEN');
  const key = confValue_(AI_KEY_LABEL);
  if (!key) fail_('Manca la chiave Gemini: chi gestisce l\'app la inserisce da Impostazioni → Amministrazione → Gemini', 'NO_AI_KEY');
  const parts = [{ text: String(req.prompt || '').slice(0, 200000) }];
  (req.images || []).slice(0, 6).forEach(i => { if (i && i.data) parts.push({ inlineData: { mimeType: i.mime || 'image/jpeg', data: String(i.data) } }); });
  return { ok: true, result: gemini_(key, aiModel_(), parts) };
}

// Chiama Gemini e restituisce la risposta già letta come JSON.
function gemini_(key, model, parts) {
  const r = UrlFetchApp.fetch('https://generativelanguage.googleapis.com/v1beta/models/' + encodeURIComponent(model) + ':generateContent', {
    method: 'post', contentType: 'application/json', muteHttpExceptions: true,
    headers: { 'x-goog-api-key': key },
    payload: JSON.stringify({ contents: [{ role: 'user', parts: parts }], generationConfig: { responseMimeType: 'application/json', temperature: 0.2 } })
  });
  const code = r.getResponseCode(), body = r.getContentText();
  if (code !== 200) {
    let msg;
    try { msg = JSON.parse(body).error.message; } catch (x) { msg = body.slice(0, 200); }
    fail_('Gemini ha risposto con un errore (' + code + '): ' + msg, 'AI_ERROR');
  }
  const j = JSON.parse(body), c = (j.candidates || [])[0] || {};
  const txt = ((c.content || {}).parts || []).map(p => p.text || '').join('').trim();
  if (!txt) fail_('Gemini non ha restituito una risposta' + (c.finishReason ? ' (' + c.finishReason + ')' : ''), 'AI_EMPTY');
  try { return JSON.parse(txt.replace(/^```(?:json)?\s*|\s*```$/g, '')); }
  catch (x) { fail_('La risposta di Gemini non è leggibile, riprova', 'AI_BAD'); }
}

/* ───────────── Aggiornamento automatico dello script ─────────────
   Scarica Code.gs da GitHub, lo mette al posto di questo file, crea una nuova versione e
   la assegna alla distribuzione usata dall'app (l'indirizzo /exec resta lo stesso).
   Serve l'API Apps Script attiva (script.google.com/home/usersettings) e i permessi
   elencati in appsscript.json. */

function latestCode_() {
  const r = UrlFetchApp.fetch(CODE_URL + '?t=' + Date.now(), { muteHttpExceptions: true });
  if (r.getResponseCode() !== 200) fail_('Non riesco a scaricare lo script nuovo da GitHub (' + r.getResponseCode() + ')', 'NO_CODE_SOURCE');
  const src = r.getContentText();
  const m = src.match(/SCRIPT_VERSION\s*=\s*'([^']+)'/);
  if (!m || src.indexOf('function doPost(') < 0 || src.indexOf('function selfUpdate_(') < 0 || src.length > 1000000) fail_('Il file scaricato da GitHub non sembra lo script dell\'app: non lo installo', 'BAD_SOURCE');
  return { source: src, version: m[1] };
}

function scriptApi_(method, path, body) {
  const params = { method: method, muteHttpExceptions: true, headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() } };
  if (body) { params.contentType = 'application/json'; params.payload = JSON.stringify(body); }
  const r = UrlFetchApp.fetch('https://script.googleapis.com/v1/projects/' + ScriptApp.getScriptId() + path, params);
  const code = r.getResponseCode(), text = r.getContentText();
  if (code >= 200 && code < 300) return text ? JSON.parse(text) : {};
  let msg = text.slice(0, 300);
  try { msg = JSON.parse(text).error.message; } catch (x) { }
  if (/Apps Script API/i.test(msg) && /enable|attiva/i.test(msg)) fail_('Va attivata l\'API Apps Script: apri script.google.com/home/usersettings con l\'account libreriateam e metti "API Google Apps Script" su Attiva, poi riprova', 'API_OFF');
  if (/insufficient.*scope|scope/i.test(msg)) fail_('Allo script mancano i permessi per aggiornarsi: controlla che appsscript.json sia quello del README e riesegui "setup" per autorizzarlo (' + msg + ')', 'SCOPES');
  fail_('Google ha risposto con un errore (' + code + '): ' + msg, 'SCRIPT_API');
}

function selfUpdate_(deployment) {
  const src = latestCode_();
  if (src.version === SCRIPT_VERSION) return { ok: true, same: true, version: SCRIPT_VERSION };
  // 1. Sostituisco il codice (lascio com'è il resto del progetto, manifest compreso).
  const content = scriptApi_('get', '/content');
  const files = content.files || [];
  const target = files.find(f => f.type === 'SERVER_JS' && /function doPost\(/.test(f.source || '')) || files.find(f => f.type === 'SERVER_JS');
  if (!target) fail_('Non trovo il file dello script nel progetto', 'NO_TARGET');
  target.source = src.source;
  scriptApi_('put', '/content', { scriptId: ScriptApp.getScriptId(), files: files.map(f => ({ name: f.name, type: f.type, source: f.source })) });
  // 2. Nuova versione e 3. la assegno alla distribuzione dell'app.
  const v = scriptApi_('post', '/versions', { description: 'App libreria ' + src.version });
  const deps = (scriptApi_('get', '/deployments').deployments || []).filter(d => d.deploymentConfig && d.deploymentConfig.versionNumber);
  const dep = deps.find(d => d.deploymentId === deployment) ||
    (deps.length === 1 ? deps[0] : null);
  if (!dep) fail_('Codice aggiornato, ma non trovo la distribuzione dell\'app: in Apps Script fai Distribuisci → Gestisci distribuzioni → ✎ → Nuova versione', 'NO_DEPLOYMENT');
  scriptApi_('put', '/deployments/' + dep.deploymentId, { deploymentConfig: { scriptId: ScriptApp.getScriptId(), versionNumber: v.versionNumber, manifestFileName: 'appsscript', description: 'App libreria ' + src.version } });
  return { ok: true, from: SCRIPT_VERSION, to: src.version };
}

/* ───────────── Amministrazione (dall'app, solo con il permesso "admin") ───────────── */

function mask_(k) {
  return k ? (k.length > 10 ? k.slice(0, 4) + '…' + k.slice(-4) : '••••') : '';
}

function admin_(u, a, req) {
  const U = users_();
  const state = () => ({
    ok: true,
    code: teamCode_(),
    ai: { key: mask_(confValue_(AI_KEY_LABEL)), model: aiModel_(), defaultModel: AI_DEFAULT_MODEL },
    users: U.list.map(x => ({ nome: x.nome, perms: x.perms, mustChange: x.mustChange, last: x.last })),
    sv: SCRIPT_VERSION
  });
  if (a === 'admin_get') return state();
  if (a === 'admin_perms') {
    const t = findUser_(U, req.nome);
    if (!t) fail_('Persona non trovata', 'NOT_FOUND');
    const perms = (req.perms || []).map(String).filter(p => PERMS.indexOf(p) >= 0);
    // Deve restare almeno una persona che può amministrare, altrimenti nessuno potrebbe più farlo dall'app.
    if (perms.indexOf('admin') < 0 && t.perms.indexOf('admin') >= 0 && !U.list.some(x => x !== t && x.perms.indexOf('admin') >= 0))
      fail_('Deve restare almeno una persona con il permesso di amministrare', 'LAST_ADMIN');
    U.sheet.getRange(t.row, 7).setValue(perms.join(' '));
    t.perms = perms;
    return state();
  }
  if (a === 'admin_reset') {
    const t = findUser_(U, req.nome);
    if (!t) fail_('Persona non trovata', 'NOT_FOUND');
    if (t.nome === u.nome) fail_('Per la tua password usa "Cambia password"', 'SELF');
    // Esce da tutti i dispositivi e rientra con il codice squadra, poi sceglie una password nuova.
    // La vecchia password non vale più: si entra solo con il codice squadra.
    U.sheet.getRange(t.row, 2, 1, 4).setValues([['', '', true, (t.ver || 0) + 1]]);
    t.mustChange = true;
    return state();
  }
  if (a === 'admin_code') {
    const c = String(req.code || '').trim();
    if (!/^\S{4,30}$/.test(c)) fail_('Il codice deve avere da 4 a 30 caratteri, senza spazi', 'BAD_CODE');
    const sh = SpreadsheetApp.getActive().getSheetByName(CONF);
    sh.getRange('B1').setValue("'" + c);
    return state();
  }
  if (a === 'admin_ai') {
    if ('key' in req) {
      const k = String(req.key || '').trim();
      if (k && !/^[A-Za-z0-9_\-]{20,100}$/.test(k)) fail_('Questa non sembra una chiave Gemini: di solito inizia con "AIza" ed è lunga una quarantina di caratteri', 'BAD_KEY');
      confSet_(AI_KEY_LABEL, k);
    }
    if ('model' in req) {
      const m = String(req.model || '').trim();
      if (m && !/^[a-z0-9.\-]{3,60}$/.test(m)) fail_('Nome del modello non valido', 'BAD_MODEL');
      confSet_(AI_MODEL_LABEL, m);
    }
    return state();
  }
  if (a === 'admin_ai_test') {
    const key = confValue_(AI_KEY_LABEL);
    if (!key) fail_('Prima inserisci la chiave Gemini', 'NO_AI_KEY');
    const t0 = Date.now(), model = aiModel_();
    gemini_(key, model, [{ text: 'Rispondi solo con questo JSON: {"ok": true}' }]);
    return { ok: true, model: model, ms: Date.now() - t0 };
  }
  if (a === 'admin_script_check') {
    const src = latestCode_();
    return { ok: true, current: SCRIPT_VERSION, latest: src.version };
  }
  if (a === 'admin_script_update') return selfUpdate_(req.deployment);
  fail_('Azione sconosciuta', 'BAD_ACTION');
}

// Modifiche fatte a mano nel foglio: segnalo che i dati sono cambiati, così le app aperte li ricaricano al prossimo giro.
function onEdit(e) {
  try {
    const n = e && e.range && e.range.getSheet().getName();
    if (n !== USERS && n !== CONF) bump_();
  } catch (x) { }
}
