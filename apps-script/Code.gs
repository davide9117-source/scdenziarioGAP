/**
 * Libreria · Team — backend su Google Sheets.
 *
 * Da incollare nell'editor Apps Script del foglio Google (Estensioni → Apps Script).
 * Poi: esegui una volta `setup`, quindi Distribuisci → Nuova distribuzione → App web
 * (Esegui come: Me · Chi ha accesso: Chiunque). Vedi README.md.
 *
 * Ogni sezione dell'app è una scheda del foglio (Compiti, Turni, Eventi, …): una riga
 * per voce, una colonna per campo. Le celle si possono modificare anche a mano.
 */

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
const USER_COLS = ['nome', 'hash', 'salt', 'cambioObbligatorio', 'versione', 'ultimoAccesso'];
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
    if (req.ver && String(req.ver) === ver) return { ok: true, same: true, ver: ver };
    return withLock_(() => ({ ok: true, ver: version_(), ...loadAll_(SpreadsheetApp.getActive()).dump() }));
  }
  if (a === 'write') return withLock_(() => write_(req.ops || []));
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
      ver: Number(v[r][4]) || 0
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
  return { ok: true, token: token_(u), name: u.nome, mustChange: u.mustChange };
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
  return { ok: true, token: token_(cur), name: cur.nome, mustChange: false };
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
  return { ok: true, results: res, ver: version_() };
}

// Modifiche fatte a mano nel foglio: segnalo che i dati sono cambiati, così le app aperte li ricaricano al prossimo giro.
function onEdit(e) {
  try {
    const n = e && e.range && e.range.getSheet().getName();
    if (n !== USERS && n !== CONF) bump_();
  } catch (x) { }
}
