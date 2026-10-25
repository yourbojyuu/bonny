/**
 * Code.gs — ทางเข้า Web App, ตรวจสิทธิ์, อ่านเขียนชีทจริง, setupSheets
 *
 * ไฟล์ในโปรเจกต์ Apps Script (วางทุกไฟล์):
 *   Code.gs   ค่าคงที่ + router + ตรวจ token + อ่านเขียนชีท + setupSheets
 *   Schema.gs หัวคอลัมน์ทุกชีท + ค่าตั้งต้น
 *   Util.gs   กติกาข้อมูล (วันที่ / จำนวนเงิน / หัวคอลัมน์ / ตัวอักษรไทย)
 *   Ledger.gs ตั้งค่า ยอดยกมา Ledger ยอดคงเหลือ
 *   Docs.gs   ขบ. → ขจ. → การจ่าย และข้อมูลพิมพ์เอกสาร
 *   Receipts.gs ใบเสร็จ (รายรับ) นำเข้าแบบวาง · ทะเบียนผู้รับเงิน · ชื่อย่อ
 */

/* ============ ค่าคงที่ที่ผู้ใช้แก้เอง ============ */
var CLIENT_ID = 'ใส่ CLIENT_ID ของคุณที่นี่';
var FISCAL_YEAR = 2570; // ปีงบประมาณ (พ.ศ.) เริ่ม 1 ต.ค. ของปี พ.ศ. ก่อนหน้า

/* ============ สิทธิ์ของแต่ละ action ============ */
function actionRoles() {
  var ALL = ROLES, FIN = ['admin', 'การเงิน'], KHB = ['admin', 'การเงิน', 'พัสดุ'], ADMIN = ['admin'];
  return {
    ping: null,
    getSchema: ALL, me: ALL, getSettings: ALL, getBalances: ALL,
    getDocs: ALL, khbDoc: ALL, khjDoc: ALL, getReceipts: ALL,
    importReceipts: FIN, cancelReceipt: FIN, savePayees: KHB, saveAliases: ADMIN,
    saveKhb: KHB, cancelKhb: KHB,
    createKhj: FIN, savePayments: FIN, cancelKhj: FIN,
    saveTypes: ADMIN, saveStores: ADMIN, saveOpening: ADMIN, rebuildLedger: ADMIN, saveDocSettings: ADMIN
  };
}

function handlers() {
  return {
    getSchema: h_getSchema, me: h_me, getSettings: h_getSettings, getBalances: h_getBalances,
    saveStores: h_saveStores, saveTypes: h_saveTypes, saveOpening: h_saveOpening, rebuildLedger: h_rebuildLedger,
    saveDocSettings: h_saveDocSettings,
    getDocs: h_getDocs, saveKhb: h_saveKhb, cancelKhb: h_cancelKhb,
    createKhj: h_createKhj, savePayments: h_savePayments, cancelKhj: h_cancelKhj,
    khbDoc: h_khbDoc, khjDoc: h_khjDoc, getReceipts: h_getReceipts, importReceipts: h_importReceipts,
    cancelReceipt: h_cancelReceipt, savePayees: h_savePayees, saveAliases: h_saveAliases
  };
}

function isWriteAction(a) {
  return ['saveTypes', 'saveStores', 'saveOpening', 'rebuildLedger', 'saveDocSettings',
    'saveKhb', 'cancelKhb', 'createKhj', 'savePayments', 'cancelKhj', 'importReceipts', 'cancelReceipt', 'savePayees', 'saveAliases'].indexOf(a) >= 0;
}

/* ============ ตรวจสิทธิ์ (pure) ============ */

/** ตรวจ claims ของ Google ID token คืนอีเมล (ตัวพิมพ์เล็ก) */
function validateClaims(claims, clientId, nowSec) {
  if (!claims) throw fail('AUTH', 'token ไม่ถูกต้อง');
  if (String(claims.aud) !== String(clientId)) throw fail('AUTH', 'token ไม่ได้ออกให้แอปนี้');
  if (!(Number(claims.exp) > nowSec)) throw fail('AUTH', 'token หมดอายุ กรุณาเข้าสู่ระบบใหม่');
  if (claims.iss !== 'accounts.google.com' && claims.iss !== 'https://accounts.google.com') {
    throw fail('AUTH', 'token ไม่ได้ออกโดย Google');
  }
  if (!(claims.email_verified === true || claims.email_verified === 'true')) throw fail('AUTH', 'อีเมลยังไม่ยืนยัน');
  var email = normText(claims.email).toLowerCase();
  if (!email) throw fail('AUTH', 'ไม่พบอีเมลใน token');
  return email;
}

function findUser(userRows, email) {
  var key = normText(email).toLowerCase();
  for (var i = 0; i < userRows.length; i++) {
    var r = userRows[i];
    if (normText(r[0]).toLowerCase() === key && key !== '') {
      if (!isActive(r[3])) throw fail('AUTH', 'บัญชีนี้ถูกปิดการใช้งาน');
      return { email: key, name: normText(r[1]), role: normText(r[2]) };
    }
  }
  throw fail('AUTH', 'อีเมลนี้ไม่อยู่ในรายชื่อผู้ใช้');
}

function authorize(action, user) {
  var allowed = actionRoles()[action];
  if (ROLES.indexOf(user.role) < 0) throw fail('FORBIDDEN', 'บทบาท "' + user.role + '" ไม่ถูกต้อง');
  if (user.role === 'admin') return;
  if (!allowed || allowed.indexOf(user.role) < 0) throw fail('FORBIDDEN', 'บทบาท "' + user.role + '" ไม่มีสิทธิ์ทำรายการนี้');
}

/* ============ router (ผ่าน io ไม่รู้จัก SpreadsheetApp) ============
 * io = { verifyToken(idToken)->email, values(sheetName)->2D|null, write(sheetName, rows) }
 */
function dispatch(req, io) {
  try {
    var action = normText(req && req.action);
    var roles = actionRoles();
    if (!action || !roles.hasOwnProperty(action)) throw fail('BAD_ACTION', 'ไม่รู้จัก action "' + action + '"');
    if (action === 'ping') return { ok: true, data: { pong: true } };
    if (!req.idToken) throw fail('AUTH', 'ไม่มี token กรุณาเข้าสู่ระบบ');
    var email = io.verifyToken(req.idToken);
    var user = findUser(tableRows(io, 'ผู้ใช้'), email);
    authorize(action, user);
    return { ok: true, data: handlers()[action](req.payload || {}, io, user) };
  } catch (e) {
    return { ok: false, code: e.code || 'ERROR', error: String(e.message || e) };
  }
}

/* ============ ส่วนอ่านเขียนชีทจริง ============ */

function verifyGoogleToken(idToken) {
  if (!CLIENT_ID || CLIENT_ID.indexOf('ใส่') === 0) throw fail('CONFIG', 'ยังไม่ได้ตั้งค่า CLIENT_ID ใน Code.gs');
  var now = Math.floor(Date.now() / 1000);
  var cache = CacheService.getScriptCache();
  var key = 'tok_' + Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, idToken));
  var hit = cache.get(key);
  if (hit) return validateClaims(JSON.parse(hit), CLIENT_ID, now);

  var res = UrlFetchApp.fetch('https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(idToken),
    { muteHttpExceptions: true });
  if (res.getResponseCode() !== 200) throw fail('AUTH', 'token ไม่ถูกต้องหรือหมดอายุ');
  var claims = JSON.parse(res.getContentText());
  var email = validateClaims(claims, CLIENT_ID, now);
  var ttl = Math.max(1, Math.min(300, Number(claims.exp) - now));
  cache.put(key, JSON.stringify({ aud: claims.aud, exp: claims.exp, iss: claims.iss, email: claims.email, email_verified: claims.email_verified }), ttl);
  return email;
}

function makeSheetIO() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var memo = {};
  return {
    verifyToken: verifyGoogleToken,
    values: function (name) {
      if (memo.hasOwnProperty(name)) return memo[name];
      var sh = ss.getSheetByName(name);
      if (!sh) return (memo[name] = null);
      var lr = sh.getLastRow();
      if (lr < 1) return (memo[name] = [[]]);
      return (memo[name] = sh.getRange(1, 1, lr, Math.max(sh.getLastColumn(), SCHEMA[name].length)).getValues());
    },
    write: function (name, rows) {
      delete memo[name];
      var sh = ss.getSheetByName(name);
      var n = SCHEMA[name].length, last = sh.getLastRow();
      if (last > 1) sh.getRange(2, 1, last - 1, sh.getMaxColumns()).clearContent();
      if (!rows.length) return;
      (TEXT_COLS[name] || []).forEach(function (c) { sh.getRange(2, c, rows.length, 1).setNumberFormat('@'); });
      sh.getRange(2, 1, rows.length, n).setValues(rows.map(function (r) {
        var x = r.slice(0, n); while (x.length < n) x.push(''); return x;
      }));
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
    if (name === 'Ledger' || name === 'ปิดวัน') sh.protect().setWarningOnly(true); // ห้ามแก้มือ
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
  Logger.log('setupSheets เสร็จแล้ว — ตรวจชีท "ผู้ใช้" ว่ามีอีเมลของคุณ และกรอกชื่อผู้ลงนามในหน้า ตั้งค่า');
}
