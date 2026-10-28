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

/* ============ ทะเบียน action (ที่เดียว) ============
 * action ใหม่ = เพิ่มแถวเดียวที่นี่: [ฟังก์ชัน, บทบาทที่ทำได้, เป็นการเขียนหรือไม่ (W = ใช้ LockService)]
 * ครู: ส่งคำขอเบิกและติดตามของตัวเองเท่านั้น · ผู้บริหาร: อนุมัติ/ส่งกลับ ขบ. · การเงิน: รับเรื่องแล้วทำ ขจ. ต่อ */
function actions() {
  var ALL = ROLES, STAFF = ['admin', 'การเงิน', 'พัสดุ', 'ผู้บริหาร'], FIN = ['admin', 'การเงิน'], KHB = ['admin', 'การเงิน', 'พัสดุ'], ADMIN = ['admin'];
  var R = false, W = true;
  return {
    boot: [h_boot, ALL, R], getSchema: [h_getSchema, ALL, R], me: [h_me, ALL, R], getSettings: [h_getSettings, ALL, R],
    getBalances: [h_getBalances, STAFF, R], getLedger: [h_getLedger, STAFF, R],
    getDocs: [h_getDocs, ALL, R], khbDoc: [h_khbDoc, ALL, R], khjDoc: [h_khjDoc, STAFF, R], getReceipts: [h_getReceipts, STAFF, R],
    importReceipts: [h_importReceipts, FIN, W], cancelReceipt: [h_cancelReceipt, FIN, W], voidReceipts: [h_voidReceipts, FIN, W],
    savePayees: [h_savePayees, KHB, W], saveAliases: [h_saveAliases, ADMIN, W], savePackages: [h_savePackages, FIN, W],
    saveKhb: [h_saveKhb, KHB.concat(['ครู']), W], cancelKhb: [h_cancelKhb, KHB.concat(['ครู']), W],
    approveKhb: [h_approveKhb, ['admin', 'ผู้บริหาร'], W], receiveKhb: [h_receiveKhb, FIN, W],
    createKhj: [h_createKhj, FIN, W], savePayments: [h_savePayments, FIN, W], cancelKhj: [h_cancelKhj, FIN, W],
    saveTypes: [h_saveTypes, ADMIN, W], saveStores: [h_saveStores, ADMIN, W], saveOpening: [h_saveOpening, ADMIN, W],
    rebuildLedger: [h_rebuildLedger, ADMIN, W], saveDocSettings: [h_saveDocSettings, ADMIN, W]
  };
}

/** โหลดข้อมูลตอนเข้าระบบในคำขอเดียว: me + schema + settings + docs + receipts (+ ยอดคงเหลือหน้าภาพรวม)
 *  คำขอเดียว = ตรวจโทเคนครั้งเดียว อ่านชีทซ้ำน้อยลง (io.values จำผลไว้ในรอบเดียวกัน) จึงเร็วกว่าเรียกทีละ action มาก */
function h_boot(p, io, user) {
  var out = { me: user, schema: h_getSchema(), settings: h_getSettings(p, io), docs: h_getDocs(p, io, user) };
  if (user.role !== 'ครู') {
    out.receipts = h_getReceipts(p, io);
    if (p.date) { try { out.balances = h_getBalances({ date: p.date }, io); } catch (e) { out.balances = null; } }
  }
  return out;
}

/** ตั้ง Trigger (ทุก 5 นาที) ให้เรียกฟังก์ชันนี้เพื่อลดอาการ "ตื่นช้า" ครั้งแรกหลังไม่มีคนใช้ */
function keepWarm() { SpreadsheetApp.getActiveSpreadsheet().getName(); return 'ok'; }

function isWriteAction(a) { var x = actions()[a]; return !!(x && x[2]); }

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
  var allowed = actions()[action][1];
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
    var acts = actions();
    if (action !== 'ping' && (!action || !acts.hasOwnProperty(action))) throw fail('BAD_ACTION', 'ไม่รู้จัก action "' + action + '"');
    if (action === 'ping') return { ok: true, data: { pong: true } };
    if (!req.idToken) throw fail('AUTH', 'ไม่มี token กรุณาเข้าสู่ระบบ');
    var email = io.verifyToken(req.idToken);
    var user = findUser(tableRows(io, 'ผู้ใช้'), email);
    authorize(action, user);
    return { ok: true, data: acts[action][0](req.payload || {}, io, user) };
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
