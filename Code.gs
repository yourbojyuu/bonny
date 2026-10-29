/**
 * Code.gs — ทางเข้า Web App, ตรวจสิทธิ์, อ่านเขียนชีทจริง, setupSheets
 *
 * ไฟล์ในโปรเจกต์ Apps Script (วางทุกไฟล์):
 *   Code.gs   ค่าคงที่ + router + เข้าระบบด้วยชื่อผู้ใช้/รหัสผ่าน + อ่านเขียนชีท + setupSheets
 *   Schema.gs หัวคอลัมน์ทุกชีท + ค่าตั้งต้น
 *   Util.gs   กติกาข้อมูล (วันที่ / จำนวนเงิน / หัวคอลัมน์ / ตัวอักษรไทย)
 *   Ledger.gs ตั้งค่า ยอดยกมา Ledger ยอดคงเหลือ
 *   Docs.gs   ขบ. → ขจ. → การจ่าย และข้อมูลพิมพ์เอกสาร
 *   Cheques.gs ทะเบียนคุมเช็ค (เช็คค้าง / ขึ้นเงินแล้ว แยกอุดหนุน บกศ. รายได้)
 *   Receipts.gs ใบเสร็จ (รายรับ) นำเข้าแบบวาง · ทะเบียนผู้รับเงิน · ชื่อย่อ
 */

/* ============ ค่าคงที่ที่ผู้ใช้แก้เอง ============ */
var FISCAL_YEAR = 2570; // ปีงบประมาณ (พ.ศ.) เริ่ม 1 ต.ค. ของปี พ.ศ. ก่อนหน้า
var APP_VERSION = '2026.10.28'; // ต้องตรงกับ APP_VERSION ใน app.js (หน้าเว็บเตือนถ้าไม่ตรง = ลืมอัปเดตฝั่งใดฝั่งหนึ่ง)

/* ============ ทะเบียน action (ที่เดียว) ============
 * action ใหม่ = เพิ่มแถวเดียวที่นี่: [ฟังก์ชัน, บทบาทที่ทำได้, เป็นการเขียนหรือไม่ (W = ใช้ LockService), ข้อมูลที่ส่งกลับให้หน้าเว็บหลังบันทึก]
 * ข้อมูลที่ส่งกลับ (D = เอกสาร, RC = ใบเสร็จ, ST = ตั้งค่า) ทำให้หน้าเว็บไม่ต้องยิงคำขอโหลดใหม่อีกรอบ
 * ครู: ส่งคำขอเบิกและติดตามของตัวเองเท่านั้น · ผู้บริหาร: อนุมัติ/ส่งกลับ ขบ. · การเงิน: รับเรื่องแล้วทำ ขจ. ต่อ */
function actions() {
  var ALL = ROLES, STAFF = ['admin', 'การเงิน', 'พัสดุ', 'ผู้บริหาร'], FIN = ['admin', 'การเงิน'], KHB = ['admin', 'การเงิน', 'พัสดุ'], ADMIN = ['admin'];
  var PUBLIC = 'PUBLIC', R = false, W = true, D = ['docs'], RC = ['receipts'], ST = ['settings'], DS = ['docs', 'settings'], DC = ['docs', 'cheques'], CQ = ['cheques'];
  return {
    // เข้าระบบ (PUBLIC = ไม่ต้องมีโทเคน)
    authStatus: [h_authStatus, PUBLIC, R], login: [h_login, PUBLIC, W], setupAdmin: [h_setupAdmin, PUBLIC, W],
    changePassword: [h_changePassword, ALL, W], getUsers: [h_getUsers, ADMIN, R], saveUser: [h_saveUser, ADMIN, W],
    boot: [h_boot, ALL, R], getSchema: [h_getSchema, ALL, R], me: [h_me, ALL, R], getSettings: [h_getSettings, ALL, R],
    getBalances: [h_getBalances, STAFF, R], getLedger: [h_getLedger, STAFF, R],
    getDocs: [h_getDocs, ALL, R], getCheques: [h_getCheques, STAFF, R], saveChequeClear: [h_saveChequeClear, FIN, W, CQ], voidChequeClear: [h_voidChequeClear, FIN, W, CQ], khbDoc: [h_khbDoc, ALL, R], khjDoc: [h_khjDoc, STAFF, R], getReceipts: [h_getReceipts, STAFF, R],
    importReceipts: [h_importReceipts, FIN, W, RC], cancelReceipt: [h_cancelReceipt, FIN, W, RC], voidReceipts: [h_voidReceipts, FIN, W, RC],
    savePayees: [h_savePayees, KHB, W, DS], saveAliases: [h_saveAliases, ADMIN, W, ST], savePackages: [h_savePackages, FIN, W, ST],
    saveKhb: [h_saveKhb, KHB.concat(['ครู']), W, DS], cancelKhb: [h_cancelKhb, KHB.concat(['ครู']), W, D],
    approveKhb: [h_approveKhb, ['admin', 'ผู้บริหาร'], W, D], receiveKhb: [h_receiveKhb, FIN, W, D],
    createKhj: [h_createKhj, FIN, W, D], savePayments: [h_savePayments, FIN, W, DC], cancelKhj: [h_cancelKhj, FIN, W, DC],
    saveTypes: [h_saveTypes, ADMIN, W, ST], saveStores: [h_saveStores, ADMIN, W, ST], saveOpening: [h_saveOpening, ADMIN, W, ST],
    rebuildLedger: [h_rebuildLedger, ADMIN, W], saveDocSettings: [h_saveDocSettings, ADMIN, W, ST]
  };
}

/** โหลดข้อมูลตอนเข้าระบบในคำขอเดียว: me + schema + settings + docs + receipts (+ ยอดคงเหลือหน้าภาพรวม)
 *  คำขอเดียว = ตรวจโทเคนครั้งเดียว อ่านชีทซ้ำน้อยลง (io.values จำผลไว้ในรอบเดียวกัน) จึงเร็วกว่าเรียกทีละ action มาก */
function h_boot(p, io, user) {
  var out = { version: APP_VERSION, me: user, schema: h_getSchema(), settings: h_getSettings(p, io), docs: h_getDocs(p, io, user) };
  if (user.role !== 'ครู') {
    out.receipts = h_getReceipts(p, io);
    try { out.cheques = h_getCheques(p, io); } catch (e) { out.cheques = null; }
    if (p.date) { try { out.balances = h_getBalances({ date: p.date }, io); } catch (e) { out.balances = null; } }
  }
  return out;
}

/** ตั้ง Trigger (ทุก 5 นาที) ให้เรียกฟังก์ชันนี้เพื่อลดอาการ "ตื่นช้า" ครั้งแรกหลังไม่มีคนใช้ */
function keepWarm() { SpreadsheetApp.getActiveSpreadsheet().getName(); return 'ok'; }

function isWriteAction(a) { var x = actions()[a]; return !!(x && x[2]); }

/** ข้อมูลล่าสุดหลังบันทึก (อ่านจาก memo ที่เพิ่งเขียน จึงแทบไม่เสียเวลา) · ส่งเฉพาะที่ผู้ใช้มีสิทธิ์ดู · พลาดก็ไม่ทำให้การบันทึกล้ม */
function freshData(keys, io, user, acts) {
  var fn = { docs: ['getDocs', h_getDocs], receipts: ['getReceipts', h_getReceipts], settings: ['getSettings', h_getSettings], cheques: ['getCheques', h_getCheques] }, out = {};
  keys.forEach(function (k) {
    var a = fn[k][0];
    if (user.role !== 'admin' && acts[a][1].indexOf(user.role) < 0) return;
    try { out[k] = fn[k][1]({}, io, user); } catch (e) { /* หน้าเว็บจะโหลดเองตามปกติ */ }
  });
  return out;
}

/* ============ ตรวจสิทธิ์ (pure) ============ */

function findUser(userRows, email) {
  var key = normText(email).toLowerCase();
  for (var i = 0; i < userRows.length; i++) {
    var r = userRows[i];
    if (normText(r[0]).toLowerCase() === key && key !== '') {
      if (!isActive(r[3])) throw fail('AUTH', 'บัญชีนี้ถูกปิดการใช้งาน');
      return { email: key, name: normText(r[1]), role: normText(r[2]) };
    }
  }
  throw fail('AUTH', 'ไม่พบชื่อผู้ใช้นี้ในรายชื่อผู้ใช้');
}

function authorize(action, user) {
  var allowed = actions()[action][1];
  if (ROLES.indexOf(user.role) < 0) throw fail('FORBIDDEN', 'บทบาท "' + user.role + '" ไม่ถูกต้อง');
  if (user.role === 'admin') return;
  if (!allowed || allowed.indexOf(user.role) < 0) throw fail('FORBIDDEN', 'บทบาท "' + user.role + '" ไม่มีสิทธิ์ทำรายการนี้');
}

/* ============ router (ผ่าน io ไม่รู้จัก SpreadsheetApp) ============
 * io = { verifyToken(idToken)->email, values(sheetName)->2D|null, write(sheetName, rows) }
 */
/** ตรวจรูปร่างข้อมูลที่ส่งมาก่อนถึง handler (กันข้อมูลเสียที่ทำให้โปรแกรมพัง แล้วตอบเป็นข้อความไทยที่อ่านรู้เรื่อง)
 *  - payload ต้องเป็นอ็อบเจ็กต์ · ค่าทั่วไปต้องเป็นข้อความ/ตัวเลข · เฉพาะคีย์รายการ (items rows lines batch nos values) เป็นอาร์เรย์/อ็อบเจ็กต์ได้
 *  - ในอาร์เรย์ห้ามมีช่องว่าง (null) และสมาชิกของ items/rows/lines/batch ต้องเป็นอ็อบเจ็กต์หรืออาร์เรย์ */
var LIST_KEYS = { items: 1, rows: 1, lines: 1, batch: 1, nos: 1, values: 1 };
function validatePayload(p) {
  if (p === null || p === undefined) return {};
  if (typeof p !== 'object' || Array.isArray(p)) throw fail('BAD_INPUT', 'ข้อมูลที่ส่งมาไม่ถูกต้อง');
  Object.keys(p).forEach(function (k) {
    var v = p[k];
    if (v === null || typeof v !== 'object') return;
    if (!LIST_KEYS[k]) throw fail('BAD_INPUT', 'ข้อมูล "' + k + '" ต้องเป็นข้อความหรือตัวเลข');
    if (!Array.isArray(v)) return;
    v.forEach(function (e, i) {
      if (e === null || e === undefined) throw fail('BAD_INPUT', 'รายการที่ ' + (i + 1) + ' ใน "' + k + '" ว่างเปล่า');
      if (k !== 'nos' && typeof e !== 'object') throw fail('BAD_INPUT', 'รายการที่ ' + (i + 1) + ' ใน "' + k + '" รูปแบบไม่ถูกต้อง');
    });
  });
  return p;
}

function dispatch(req, io) {
  try {
    var action = normText(req && req.action);
    var payload = validatePayload(req && req.payload);
    var acts = actions();
    if (action === 'ping') return { ok: true, data: { pong: true, version: APP_VERSION } };
    if (!action || !acts.hasOwnProperty(action)) throw fail('BAD_ACTION', 'ไม่รู้จัก action "' + action + '"');
    if (acts[action][1] === 'PUBLIC') return { ok: true, data: acts[action][0](payload, io) };
    var token = req.token || req.idToken;
    if (!token) throw fail('AUTH', 'กรุณาเข้าสู่ระบบ');
    // io.verifyToken ใช้เฉพาะในเทสต์ (โทเคนจำลอง) · ของจริงตรวจลายเซ็นโทเคนด้วย verifySession
    var ses = io.verifyToken ? { user: io.verifyToken(token), mustChange: false } : verifySession(token, io);
    var user = findUser(tableRows(io, 'ผู้ใช้'), ses.user);
    if (ses.mustChange && ['changePassword', 'me'].indexOf(action) < 0) throw fail('MUSTCHANGE', 'กรุณาตั้งรหัสผ่านใหม่ก่อนใช้งาน');
    authorize(action, user);
    var data = acts[action][0](payload, io, user);
    if (acts[action][3] && data && typeof data === 'object') data._fresh = freshData(acts[action][3], io, user, acts);
    return { ok: true, data: data };
  } catch (e) {
    return { ok: false, code: e.code || 'ERROR', error: String(e.message || e) };
  }
}

/* ============ เข้าระบบด้วยชื่อผู้ใช้/รหัสผ่าน (pure: ใช้ io.sha256 / io.hmac / io.now) ============
 * ชีท "รหัสผ่าน" เก็บแฮชผสมเกลือ ไม่เก็บรหัสจริง · โทเคน = ผู้ใช้|รุ่น|หมดอายุ|ลายเซ็น(HMAC ด้วยกุญแจลับใน Script Properties)
 * เปลี่ยน/รีเซ็ตรหัส = รุ่น+1 โทเคนเก่าทุกเครื่องใช้ไม่ได้ทันที */
var PW_ITER = 1000, PW_MIN = 8, LOCK_FAILS = 5, LOCK_MS = 15 * 60 * 1000;
var TOKEN_MS = 12 * 3600 * 1000, TOKEN_REMEMBER_MS = 30 * 24 * 3600 * 1000;

function pwHash(io, salt, pw) {
  var h = io.sha256(salt + '|' + pw);
  for (var i = 0; i < PW_ITER; i++) h = io.sha256(h + salt);
  return PW_ITER + '$' + salt + '$' + h;
}
function pwCheck(io, stored, pw) {
  var p = String(stored || '').split('$');
  if (p.length !== 3) return false;
  return sameText(pwHash(io, p[1], pw), stored);
}
function sameText(a, b) { // เทียบแบบใช้เวลาเท่ากัน
  a = String(a); b = String(b); var d = a.length ^ b.length;
  for (var i = 0; i < Math.min(a.length, b.length); i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}
function checkNewPassword(pw) {
  pw = String(pw || '');
  if (pw.length < PW_MIN) throw new Error('รหัสผ่านต้องยาวอย่างน้อย ' + PW_MIN + ' ตัวอักษร');
  if (!/[0-9]/.test(pw) || !/[^0-9]/.test(pw)) throw new Error('รหัสผ่านต้องมีทั้งตัวเลขและตัวอักษร');
  return pw;
}
function userKey(u) { return normText(u).toLowerCase(); }

/** แถวในชีท รหัสผ่าน -> { rows, idx: {ผู้ใช้: ตำแหน่ง} } */
function credTable(io) {
  var rows = tableRows(io, 'รหัสผ่าน').map(function (r) { return r.slice(); }), idx = {};
  rows.forEach(function (r, i) { idx[userKey(r[0])] = i; });
  return { rows: rows, idx: idx };
}
function credOf(t, u) {
  var i = t.idx[userKey(u)];
  if (i === undefined) return null;
  var r = t.rows[i];
  return { i: i, hash: normText(r[1]), must: isActive(r[2]), fails: Number(r[3]) || 0, lockUntil: Number(r[4]) || 0, ver: Number(r[5]) || 1 };
}
function putCred(t, u, c) {
  var row = [userKey(u), c.hash, c.must ? 'ใช่' : 'ไม่', c.fails || 0, c.lockUntil || 0, c.ver || 1];
  if (t.idx[userKey(u)] === undefined) { t.idx[userKey(u)] = t.rows.length; t.rows.push(row); } else t.rows[t.idx[userKey(u)]] = row;
}

function makeToken(io, u, ver, remember) {
  var body = encodeURIComponent(userKey(u)) + '|' + ver + '|' + (io.now() + (remember ? TOKEN_REMEMBER_MS : TOKEN_MS));
  return body + '|' + io.hmac(body);
}
function verifySession(token, io) {
  var p = String(token || '').split('|'); // ชื่อผู้ใช้ถูก encodeURIComponent ไว้ จึงไม่มี | ปน
  if (p.length !== 4 || !sameText(io.hmac(p.slice(0, 3).join('|')), p[3])) throw fail('AUTH', 'กรุณาเข้าสู่ระบบใหม่');
  if (!(Number(p[2]) > io.now())) throw fail('AUTH', 'หมดเวลาใช้งาน กรุณาเข้าสู่ระบบใหม่');
  var u = decodeURIComponent(p[0]), c = credOf(credTable(io), u);
  if (!c || c.ver !== Number(p[1])) throw fail('AUTH', 'รหัสผ่านถูกเปลี่ยนแล้ว กรุณาเข้าสู่ระบบใหม่');
  return { user: u, mustChange: c.must };
}

function h_authStatus(p, io) {
  var t = credTable(io);
  return { version: APP_VERSION, needsSetup: !t.rows.some(function (r) { return normText(r[1]); }) };
}

/** ติดตั้งครั้งแรก: ตั้งรหัสผ่านให้ admin ในชีท ผู้ใช้ — ทำได้เฉพาะตอนที่ยังไม่มีใครมีรหัสผ่านเลย */
function h_setupAdmin(p, io) {
  if (!h_authStatus(p, io).needsSetup) throw new Error('ระบบตั้งค่าไปแล้ว — เข้าสู่ระบบตามปกติ');
  var u = findUser(tableRows(io, 'ผู้ใช้'), p.user);
  if (u.role !== 'admin') throw new Error('ชื่อผู้ใช้นี้ไม่ใช่ admin ในชีท "ผู้ใช้"');
  var t = credTable(io);
  putCred(t, u.email, { hash: pwHash(io, io.random(), checkNewPassword(p.pass)), must: false, ver: 1 });
  io.write('รหัสผ่าน', t.rows);
  return { token: makeToken(io, u.email, 1, !!p.remember), mustChange: false };
}

function h_login(p, io) {
  var BAD = 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง';
  var uk = userKey(p.user), t = credTable(io), c = credOf(t, uk), now = io.now();
  var user = null;
  try { user = findUser(tableRows(io, 'ผู้ใช้'), uk); } catch (e) { if (/ปิดการใช้งาน/.test(e.message)) throw e; }
  if (!user || !c || !c.hash) throw fail('LOGIN', BAD);
  if (c.lockUntil > now) throw fail('LOGIN', 'ใส่รหัสผิดหลายครั้ง บัญชีถูกล็อกชั่วคราว ลองใหม่อีก ' + Math.ceil((c.lockUntil - now) / 60000) + ' นาที');
  if (!pwCheck(io, c.hash, String(p.pass || ''))) {
    c.fails++; if (c.fails >= LOCK_FAILS) { c.lockUntil = now + LOCK_MS; c.fails = 0; }
    putCred(t, uk, c); io.write('รหัสผ่าน', t.rows);
    throw fail('LOGIN', c.lockUntil > now ? 'ใส่รหัสผิด ' + LOCK_FAILS + ' ครั้ง บัญชีถูกล็อก 15 นาที' : BAD);
  }
  if (c.fails || c.lockUntil) { c.fails = 0; c.lockUntil = 0; putCred(t, uk, c); io.write('รหัสผ่าน', t.rows); }
  return { token: makeToken(io, uk, c.ver, !!p.remember), mustChange: c.must };
}

function h_changePassword(p, io, user) {
  var t = credTable(io), c = credOf(t, user.email);
  if (!c || !pwCheck(io, c.hash, String(p.old || ''))) throw new Error('รหัสผ่านเดิมไม่ถูกต้อง');
  var pw = checkNewPassword(p.pass);
  if (pw === String(p.old)) throw new Error('รหัสผ่านใหม่ต้องไม่ซ้ำกับรหัสเดิม');
  c.hash = pwHash(io, io.random(), pw); c.must = false; c.fails = 0; c.lockUntil = 0; c.ver++;
  putCred(t, user.email, c); io.write('รหัสผ่าน', t.rows);
  return { token: makeToken(io, user.email, c.ver, !!p.remember) };
}

/** รายชื่อผู้ใช้สำหรับหน้า ตั้งค่า (admin) — ไม่ส่งแฮชออกไป */
function h_getUsers(p, io) {
  var t = credTable(io), now = io.now();
  return tableRows(io, 'ผู้ใช้').map(function (r) {
    var c = credOf(t, r[0]);
    return { user: userKey(r[0]), name: normText(r[1]), role: normText(r[2]), active: isActive(r[3]),
      hasPass: !!(c && c.hash), mustChange: !!(c && c.must), locked: !!(c && c.lockUntil > now) };
  });
}

/** เพิ่ม/แก้ผู้ใช้ และตั้งรหัสชั่วคราว (ผู้ใช้ต้องเปลี่ยนเองตอนเข้าครั้งแรก) */
function h_saveUser(p, io, me) {
  var u = userKey(p.user);
  if (!u || /\s/.test(u)) throw new Error('ชื่อผู้ใช้ต้องไม่ว่างและไม่มีช่องว่าง');
  if (ROLES.indexOf(normText(p.role)) < 0) throw new Error('บทบาทต้องเป็น ' + ROLES.join(' / '));
  if (u === me.email && (normText(p.role) !== 'admin' || p.active === false)) throw new Error('ปิดหรือลดสิทธิ์บัญชีของตัวเองไม่ได้');
  var rows = tableRows(io, 'ผู้ใช้').map(function (r) { return r.slice(); }), hit = false;
  var row = [u, normText(p.name) || u, normText(p.role), p.active === false ? 'ไม่' : 'ใช่'];
  rows = rows.map(function (r) { if (userKey(r[0]) === u) { hit = true; return row; } return r; });
  if (!hit) rows.push(row);
  var t = credTable(io), c = credOf(t, u);
  if (!hit && !p.tempPass) throw new Error('ผู้ใช้ใหม่ต้องตั้งรหัสผ่านชั่วคราว');
  if (p.tempPass) putCred(t, u, { hash: pwHash(io, io.random(), checkNewPassword(p.tempPass)), must: true, fails: 0, lockUntil: 0, ver: (c ? c.ver : 0) + 1 });
  else if (p.unlock && c) { c.fails = 0; c.lockUntil = 0; putCred(t, u, c); }
  io.write('ผู้ใช้', rows);
  if (p.tempPass || p.unlock) io.write('รหัสผ่าน', t.rows);
  return { user: u, users: h_getUsers({}, io) };
}

/* ============ ส่วนอ่านเขียนชีทจริง ============ */

/** กุญแจลับสำหรับเซ็นโทเคน สร้างเองครั้งแรกแล้วเก็บใน Script Properties (ไม่อยู่ในโค้ด/ชีท) */
function authSecret() {
  var props = PropertiesService.getScriptProperties(), k = props.getProperty('AUTH_SECRET');
  if (!k) { k = Utilities.getUuid() + Utilities.getUuid(); props.setProperty('AUTH_SECRET', k); }
  return k;
}
function hexOf(bytes) { return bytes.map(function (b) { return ('0' + (b & 255).toString(16)).slice(-2); }).join(''); }

function makeSheetIO() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var memo = {};
  var secret = null;
  return {
    now: function () { return Date.now(); },
    random: function () { return Utilities.getUuid().replace(/-/g, ''); },
    sha256: function (t) { return hexOf(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, t, Utilities.Charset.UTF_8)); },
    hmac: function (t) { return Utilities.base64EncodeWebSafe(Utilities.computeHmacSha256Signature(t, secret || (secret = authSecret()), Utilities.Charset.UTF_8)).replace(/=+$/, ''); },
    values: function (name) {
      if (memo.hasOwnProperty(name)) return memo[name];
      var sh = ss.getSheetByName(name);
      if (!sh) return (memo[name] = null);
      var lr = sh.getLastRow();
      if (lr < 1) return (memo[name] = [[]]);
      return (memo[name] = sh.getRange(1, 1, lr, Math.max(sh.getLastColumn(), SCHEMA[name].length)).getValues());
    },
    write: function (name, rows) {
      var sh = ss.getSheetByName(name);
      var n = SCHEMA[name].length, w = Math.max(sh.getMaxColumns(), n);
      var fixed = rows.map(function (r) { var x = r.slice(0, n); while (x.length < n) x.push(''); return x; });
      var cur = this.values(name), d = diffRows(cur ? cur.slice(1) : [], fixed, n);
      // เขียนเฉพาะตั้งแต่แถวแรกที่ต่าง และล้างเฉพาะแถวที่เกินท้าย (ไม่เขียนทั้งชีทใหม่ทุกครั้ง)
      if (d.rows.length) {
        var r0 = 2 + d.start;
        (TEXT_COLS[name] || []).forEach(function (c) { sh.getRange(r0, c, d.rows.length, 1).setNumberFormat('@'); });
        sh.getRange(r0, 1, d.rows.length, n).setValues(d.rows);
      }
      if (d.clear) sh.getRange(2 + fixed.length, 1, d.clear, w).clearContent();
      memo[name] = [SCHEMA[name].slice()].concat(fixed); // อ่านซ้ำในคำขอเดียวกันได้โดยไม่ต้องดึงชีทใหม่
    }
  };
}

function jsonOut(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function doGet() { return jsonOut({ ok: true, data: { pong: true, note: 'ใช้ POST' } }); }

function doPost(e) {
  var req;
  try {
    req = JSON.parse(e.postData.contents);
  } catch (err) {
    return jsonOut({ ok: false, code: 'BAD_REQUEST', error: 'ข้อมูลที่ส่งมาไม่ใช่ JSON' });
  }
  var lock = null;
  if (req && isWriteAction(req.action)) {
    lock = LockService.getScriptLock();
    if (!lock.tryLock(20000)) return jsonOut({ ok: false, code: 'BUSY', error: 'มีผู้ใช้อื่นกำลังบันทึกอยู่ กรุณาลองใหม่อีกครั้ง' });
  }
  try {
    return jsonOut(dispatch(req, makeSheetIO()));
  } finally {
    if (lock) lock.releaseLock();
  }
}

/** กดรันเองครั้งเดียว (รันซ้ำได้ ไม่ทับข้อมูลเดิม): สร้างชีท หัวคอลัมน์ และ seed */
function setupSheets() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  Object.keys(SCHEMA).forEach(function (name) {
    var sh = ss.getSheetByName(name) || ss.insertSheet(name);
    if (sh.getLastRow() > 0) {
      checkHeaders(name, sh.getRange(1, 1, 1, Math.max(sh.getLastColumn(), 1)).getValues()[0]);
    } else {
      sh.getRange(1, 1, 1, SCHEMA[name].length).setValues([SCHEMA[name]]).setFontWeight('bold').setBackground('#e3f2fd');
      sh.setFrozenRows(1);
    }
    if (name === 'Ledger' || name === 'ปิดวัน' || name === 'รหัสผ่าน') sh.protect().setWarningOnly(true); // ห้ามแก้มือ
  });

  var io = makeSheetIO();
  function seed(name, rows) {
    if (ss.getSheetByName(name).getLastRow() <= 1) io.write(name, rows);
  }
  var me = '';
  try { me = Session.getActiveUser().getEmail() || Session.getEffectiveUser().getEmail(); } catch (err) { me = ''; }
  seed('ผู้ใช้', [[me || 'ใส่อีเมลของคุณที่นี่', 'ผู้ดูแลระบบ', 'admin', 'ใช่']]);
  seed('ที่เก็บเงิน', SEED_STORES);
  seed('ประเภทเงิน', SEED_TYPES.map(function (t) { return [t[0], t[1], SEED_GROUPS[t[2]], t[3], 'ใช่']; }));
  seed('ตั้งค่าเอกสาร', DOC_SETTING_SEED);
  seed('ชื่อย่อ', ALIAS_SEED);
  Logger.log('setupSheets เสร็จแล้ว — ตรวจชีท "ผู้ใช้" ว่ามีชื่อผู้ใช้ของคุณ (บทบาท admin) แล้วเปิดหน้าเว็บเพื่อตั้งรหัสผ่านครั้งแรก');
}
