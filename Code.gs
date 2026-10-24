/**
 * ระบบการเงินโรงเรียน — Code.gs (เฟส 1)
 * ตั้งค่า + ยอดยกมา + Ledger + ภาพรวม
 *
 * โครงไฟล์:
 *   1) ค่าคงที่ที่ผู้ใช้แก้เอง
 *   2) SCHEMA (หัวคอลัมน์ทุกชีทอยู่ที่นี่ที่เดียว)
 *   3) ฟังก์ชันคำนวณ (pure ไม่แตะชีท ทดสอบด้วย Node ได้)
 *   4) Router + handlers (ทำงานผ่าน "io" ไม่รู้จัก SpreadsheetApp)
 *   5) ส่วนอ่านเขียนชีทจริง + doPost + setupSheets
 */

/* ============ 1) ค่าคงที่ที่ผู้ใช้แก้เอง ============ */
var CLIENT_ID = 'ใส่ CLIENT_ID ของคุณที่นี่';
var FISCAL_YEAR = 2570; // ปีงบประมาณ (พ.ศ.) เริ่ม 1 ต.ค. ของปี พ.ศ. ก่อนหน้า

/* ============ 2) SCHEMA ============ */
var SCHEMA = {
  'ผู้ใช้':     ['อีเมล', 'ชื่อ', 'บทบาท', 'ใช้งาน'],
  'ประเภทเงิน': ['รหัส', 'ชื่อ', 'กลุ่ม', 'ที่เก็บหลัก', 'ใช้งาน'],
  'ที่เก็บเงิน': ['รหัส', 'ชื่อ', 'ชนิด'],
  'ยอดยกมา':    ['ปีงบ', 'ประเภทเงิน', 'ที่เก็บ', 'จำนวน'],
  'Ledger':     ['วันที่', 'เอกสารต้นทาง', 'ชนิด', 'ประเภทเงิน', 'ที่เก็บ', 'จำนวน +/-'],
  'ปิดวัน':     ['วันที่', 'ปิดโดย', 'เวลา', 'ปลดล็อก', 'เหตุผลปลดล็อก']
};
var ROLES = ['admin', 'การเงิน', 'พัสดุ', 'ผู้บริหาร'];
var KINDS = ['เงินสด', 'บัญชี', 'ฝากเขต'];

var ACTION_ROLES = {
  ping: null,
  getSchema: ROLES,
  me: ROLES,
  getSettings: ROLES,
  getBalances: ROLES,
  saveTypes: ['admin'],
  saveStores: ['admin'],
  saveOpening: ['admin'],
  rebuildLedger: ['admin']
};
var WRITE_ACTIONS = ['saveTypes', 'saveStores', 'saveOpening', 'rebuildLedger'];

/* ข้อมูลตั้งต้น (ไม่มีเลขบัญชีจริง) */
var SEED_STORES = [
  ['S01', 'เงินสด', 'เงินสด'],
  ['S02', 'บัญชีเงินรายได้', 'บัญชี'],
  ['S03', 'บัญชีเงินบริจาค E-donation', 'บัญชี'],
  ['S04', 'บัญชีเงิน บกศ.', 'บัญชี'],
  ['S05', 'ฝากเขต', 'ฝากเขต'],
  ['S06', 'บัญชีเงินอุดหนุน', 'บัญชี'],
  ['S07', 'บัญชีเงิน กสศ.', 'บัญชี'],
  ['S08', 'บัญชีเงินอื่นๆ', 'บัญชี']
];
var SEED_GROUPS = ['เงินรายได้สถานศึกษา', 'เงินบำรุงการศึกษา (บกศ.)', 'เงินอุดหนุน', 'ประเภทอื่นๆ'];
var SEED_TYPES = [ // [รหัส, ชื่อ, ลำดับกลุ่ม, ที่เก็บหลัก]
  ['T01', 'เงินรายได้ SMS (Student care)', 0, 'S02'],
  ['T02', 'เงินรายได้ ศูนย์สระว่ายน้ำ', 0, 'S02'],
  ['T03', 'เงินรายได้ อื่นๆ', 0, 'S02'],
  ['T04', 'E-donation', 0, 'S03'],
  ['T05', 'ก/20', 1, 'S04'],
  ['T06', 'จ/2', 1, 'S04'],
  ['T07', 'เงินปัจจัยพื้นฐานนักเรียนยากจน', 2, 'S06'],
  ['T08', 'เงินอุดหนุนรายหัว', 2, 'S06'],
  ['T09', 'เงินกิจกรรมพัฒนาผู้เรียน', 2, 'S06'],
  ['T10', 'เงินค่าหนังสือเรียน', 2, 'S06'],
  ['T11', 'เงินค่าอุปกรณ์การเรียน', 2, 'S06'],
  ['T12', 'เงินค่าเครื่องแบบนักเรียน', 2, 'S06'],
  ['T13', 'เงิน กสศ.', 2, 'S07'],
  ['T14', 'เงินบรรเทาภาระคชจ.โควิด19', 2, 'S06'],
  ['T15', 'เงินบำรุงลูกเสือ', 3, 'S08'],
  ['T16', 'เงินยุวกาชาด', 3, 'S08'],
  ['T17', 'เงินบริจาคเพื่อทุนการศึกษา', 3, 'S08'],
  ['T18', 'เงินทุนส่งเสริมอาชีพอิสระ', 3, 'S08'],
  ['T19', 'กองทุนโรงเรียนกาวิละวิทยาลัย', 3, 'S08'],
  ['T20', 'เงินประกันสัญญา', 3, 'S08'],
  ['T21', 'เงินบริจาคมีวัตถุประสงค์', 3, 'S08']
];

/* ============ 3) ฟังก์ชันคำนวณ (pure) ============ */

function fail(code, msg) {
  var e = new Error(msg);
  e.code = code;
  return e;
}

function normText(v) {
  return String(v === null || v === undefined ? '' : v).replace(/\s+/g, ' ').trim();
}

function isBlankRow(r) {
  for (var i = 0; i < r.length; i++) {
    if (normText(r[i]) !== '') return false;
  }
  return true;
}

function isActive(v) {
  if (v === false) return false;
  var s = normText(v).toLowerCase();
  return !(s === 'false' || s === '0' || s === 'no' || s === 'n' || s.indexOf('ไม่') === 0 || s === 'ปิด');
}

function pad2(n) { return (n < 10 ? '0' : '') + n; }

function makeISO(y, m, d) {
  var dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) {
    throw new Error('วันที่ไม่ถูกต้อง');
  }
  return y + '-' + pad2(m) + '-' + pad2(d);
}

function normYear(y) {
  if (y < 100) return y + 2500 - 543; // 69 -> 2569 พ.ศ.
  if (y >= 2400) return y - 543;      // พ.ศ. -> ค.ศ.
  return y;
}

/** รับ Date, เลข serial ของ Excel, "1/10/2569", "1/10/69", "2026-10-01" -> "YYYY-MM-DD" (ค.ศ.) */
function parseDate(v) {
  var m;
  if (v instanceof Date) {
    if (isNaN(v.getTime())) throw new Error('วันที่ไม่ถูกต้อง');
    return makeISO(v.getFullYear(), v.getMonth() + 1, v.getDate());
  }
  if (typeof v === 'number') {
    if (!(v > 20000 && v < 80000)) throw new Error('วันที่ "' + v + '" อ่านไม่ได้');
    var dt = new Date(Date.UTC(1899, 11, 30) + Math.floor(v) * 86400000);
    return makeISO(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
  }
  var s = normText(v);
  m = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ].*)?$/.exec(s);
  if (m) return makeISO(normYear(+m[1]), +m[2], +m[3]);
  m = /^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/.exec(s);
  if (m) return makeISO(normYear(+m[3]), +m[2], +m[1]);
  throw new Error('วันที่ "' + s + '" อ่านไม่ได้');
}

function fiscalRange(fy) {
  var ce = fy - 543;
  return { start: (ce - 1) + '-10-01', end: ce + '-09-30' };
}

function inFiscalYear(iso, fy) {
  var r = fiscalRange(fy);
  return iso >= r.start && iso <= r.end;
}

/** ตัด , และ บาท แล้วต้อง > 0 */
function parseAmount(v) {
  var n;
  if (typeof v === 'number') {
    n = v;
  } else {
    var s = normText(v).replace(/,/g, '').replace(/บาท/g, '').replace(/\s+/g, '');
    if (s === '') throw new Error('ยังไม่ได้กรอกจำนวนเงิน');
    n = Number(s);
  }
  if (!isFinite(n)) throw new Error('จำนวนเงิน "' + normText(v) + '" อ่านไม่ได้');
  if (!(n > 0)) throw new Error('จำนวนเงินต้องมากกว่า 0');
  return Math.round(n * 100) / 100;
}

/** กฎ 3: หัวคอลัมน์ไม่ตรง SCHEMA ต้องหยุดและบอกว่าคอลัมน์ไหนผิด */
function checkHeaders(sheetName, headerRow) {
  var want = SCHEMA[sheetName];
  var bad = [];
  for (var i = 0; i < want.length; i++) {
    var got = normText(headerRow ? headerRow[i] : '');
    if (got !== want[i]) {
      bad.push('คอลัมน์ที่ ' + (i + 1) + ' ต้องเป็น "' + want[i] + '" แต่พบ "' + (got || 'ว่าง') + '"');
    }
  }
  if (bad.length) throw fail('SCHEMA', 'หัวคอลัมน์ชีท "' + sheetName + '" ไม่ตรง: ' + bad.join('; '));
}

/** หา id จาก list (แถวละ [รหัส, ชื่อ, ...]) ด้วย รหัส หรือ ชื่อ (ตัดช่องว่าง) */
function resolveRef(list, v, what) {
  var key = normText(v);
  for (var i = 0; i < list.length; i++) {
    if (normText(list[i][0]) === key) return normText(list[i][0]);
  }
  for (var j = 0; j < list.length; j++) {
    if (normText(list[j][1]) === key) return normText(list[j][0]);
  }
  throw new Error(what + ' "' + key + '" ไม่ตรงกับชีทตั้งค่า');
}

function softRef(list, v) {
  try { return resolveRef(list, v, ''); } catch (e) { return normText(v); }
}

function validateStores(rows) {
  var out = [], ids = {}, names = {};
  rows.forEach(function (r, i) {
    if (isBlankRow(r)) return;
    var n = i + 1, id = normText(r[0]), name = normText(r[1]), kind = normText(r[2]);
    if (!id) throw new Error('ที่เก็บเงินแถวที่ ' + n + ': ต้องมีรหัส');
    if (!name) throw new Error('ที่เก็บเงินแถวที่ ' + n + ': ต้องมีชื่อ');
    if (KINDS.indexOf(kind) < 0) throw new Error('ที่เก็บเงินแถวที่ ' + n + ': ชนิด "' + kind + '" ต้องเป็น ' + KINDS.join(' / '));
    if (ids[id]) throw new Error('ที่เก็บเงิน: รหัส "' + id + '" ซ้ำ');
    if (names[name]) throw new Error('ที่เก็บเงิน: ชื่อ "' + name + '" ซ้ำ');
    ids[id] = names[name] = true;
    out.push([id, name, kind]);
  });
  return out;
}

function validateTypes(rows, stores) {
  var out = [], ids = {}, names = {};
  rows.forEach(function (r, i) {
    if (isBlankRow(r)) return;
    var n = i + 1, id = normText(r[0]), name = normText(r[1]), grp = normText(r[2]), main = normText(r[3]);
    if (!id) throw new Error('ประเภทเงินแถวที่ ' + n + ': ต้องมีรหัส');
    if (!name) throw new Error('ประเภทเงินแถวที่ ' + n + ': ต้องมีชื่อ');
    if (!grp) throw new Error('ประเภทเงินแถวที่ ' + n + ': ต้องมีกลุ่ม');
    if (ids[id]) throw new Error('ประเภทเงิน: รหัส "' + id + '" ซ้ำ');
    if (names[name]) throw new Error('ประเภทเงิน: ชื่อ "' + name + '" ซ้ำ');
    ids[id] = names[name] = true;
    if (main) main = resolveRef(stores, main, 'ที่เก็บหลัก (แถวที่ ' + n + ')');
    out.push([id, name, grp, main, isActive(r[4]) ? 'ใช่' : 'ไม่']);
  });
  return out;
}

/** รหัสที่ถูกใช้ใน Ledger แล้ว ห้ามลบหรือเปลี่ยนรหัส */
function assertUsedIdsKept(ledger, col, newRows, label) {
  var keep = {};
  newRows.forEach(function (r) { keep[r[0]] = true; });
  ledger.forEach(function (r) {
    var id = normText(r[col]);
    if (id && !keep[id]) {
      throw new Error(label + ' "' + id + '" ถูกใช้ใน Ledger แล้ว ลบหรือเปลี่ยนรหัสไม่ได้ (ให้ปิดใช้งานแทน)');
    }
  });
}

/** กฎ 5: วันที่ปิดแล้ว (ยังไม่ปลดล็อก) ห้ามบันทึกย้อน */
function isDateClosed(closedRows, iso) {
  for (var i = 0; i < closedRows.length; i++) {
    var r = closedRows[i];
    if (isBlankRow(r)) continue;
    var d;
    try { d = parseDate(r[0]); } catch (e) { continue; }
    if (d === iso && normText(r[3]) === '') return true;
  }
  return false;
}

/**
 * สร้าง Ledger ทั้งหมดจากเอกสารต้นทาง (เฟสนี้มีแค่ยอดยกมา)
 * คืน [[วันที่, เอกสารต้นทาง, ชนิด, ประเภทเงิน(รหัส), ที่เก็บ(รหัส), จำนวน]]
 */
function buildLedger(openingRows, types, stores, fy) {
  var out = [], seen = {}, date = fiscalRange(fy).start;
  openingRows.forEach(function (r, i) {
    if (isBlankRow(r)) return;
    if (Number(normText(r[0])) !== fy) return;
    var n = i + 1;
    try {
      var t = resolveRef(types, r[1], 'ประเภทเงิน');
      var s = resolveRef(stores, r[2], 'ที่เก็บ');
      var a = parseAmount(r[3]);
      var key = t + '|' + s;
      if (seen[key]) throw new Error('ประเภทเงินและที่เก็บซ้ำกัน');
      seen[key] = true;
      out.push([date, 'ยอดยกมา/' + fy, 'ยอดยกมา', t, s, a]);
    } catch (e) {
      throw new Error('ยอดยกมาแถวที่ ' + n + ': ' + e.message);
    }
  });
  return out;
}

/**
 * คงเหลือ(ประเภท, ที่เก็บ, วัน D) = ผลรวม Ledger ที่วันที่ <= D
 * (ยอดยกมาอยู่ใน Ledger แล้วในรูปรายการ "ยอดยกมา" จึงไม่บวกซ้ำ — กฎ 1)
 * คิดเป็นสตางค์เพื่อไม่ให้เศษทศนิยมคลาดเคลื่อน
 */
function computeBalances(ledger, types, stores, dateISO) {
  var tIdx = {}, sIdx = {};
  types.forEach(function (t, k) { tIdx[normText(t[0])] = k; });
  stores.forEach(function (s, k) { sIdx[normText(s[0])] = k; });
  var sat = types.map(function () { return stores.map(function () { return 0; }); });

  ledger.forEach(function (r, i) {
    var n = i + 2, d, t, s, a;
    try {
      d = parseDate(r[0]);
      t = tIdx[resolveRef(types, r[3], 'ประเภทเงิน')];
      s = sIdx[resolveRef(stores, r[4], 'ที่เก็บ')];
      if (normText(r[5]) === '') throw new Error('จำนวนว่าง');
      a = typeof r[5] === 'number' ? r[5] : Number(normText(r[5]).replace(/,/g, ''));
      if (!isFinite(a)) throw new Error('จำนวน "' + normText(r[5]) + '" อ่านไม่ได้');
    } catch (e) {
      throw new Error('Ledger แถวที่ ' + n + ': ' + e.message);
    }
    if (d <= dateISO) sat[t][s] += Math.round(a * 100);
  });

  var shown = [], cells = [], rowSat = [], colSat = stores.map(function () { return 0; }), grandSat = 0;
  types.forEach(function (t, k) {
    var rs = 0, any = false;
    sat[k].forEach(function (v, j) { rs += v; colSat[j] += v; if (v !== 0) any = true; });
    grandSat += rs;
    if (!isActive(t[4]) && !any) return;
    shown.push({ id: normText(t[0]), name: normText(t[1]), group: normText(t[2]) });
    cells.push(sat[k].map(function (v) { return v / 100; }));
    rowSat.push(rs / 100);
  });
  return {
    date: dateISO,
    types: shown,
    stores: stores.map(function (s) { return { id: normText(s[0]), name: normText(s[1]), kind: normText(s[2]) }; }),
    cells: cells,
    rowTotals: rowSat,
    colTotals: colSat.map(function (v) { return v / 100; }),
    grand: grandSat / 100
  };
}

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
  var allowed = ACTION_ROLES[action];
  if (ROLES.indexOf(user.role) < 0) throw fail('FORBIDDEN', 'บทบาท "' + user.role + '" ไม่ถูกต้อง');
  if (user.role === 'admin') return;
  if (!allowed || allowed.indexOf(user.role) < 0) throw fail('FORBIDDEN', 'บทบาท "' + user.role + '" ไม่มีสิทธิ์ทำรายการนี้');
}

/* ============ 4) Router + handlers (ผ่าน io) ============
 * io = { verifyToken(idToken)->email, values(sheetName)->2D|null, write(sheetName, rows) }
 */

function tableRows(io, name) {
  var v = io.values(name);
  if (!v) throw fail('SCHEMA', 'ไม่พบชีท "' + name + '" กรุณารัน setupSheets()');
  checkHeaders(name, v[0]);
  return v.slice(1).filter(function (r) { return !isBlankRow(r); });
}

function dispatch(req, io) {
  try {
    var action = normText(req && req.action);
    if (!action || !ACTION_ROLES.hasOwnProperty(action)) throw fail('BAD_ACTION', 'ไม่รู้จัก action "' + action + '"');
    if (action === 'ping') return { ok: true, data: { pong: true } };
    if (!req.idToken) throw fail('AUTH', 'ไม่มี token กรุณาเข้าสู่ระบบ');
    var email = io.verifyToken(req.idToken);
    var user = findUser(tableRows(io, 'ผู้ใช้'), email);
    authorize(action, user);
    return { ok: true, data: HANDLERS[action](req.payload || {}, io, user) };
  } catch (e) {
    return { ok: false, code: e.code || 'ERROR', error: String(e.message || e) };
  }
}

function h_getSchema() { return { schema: SCHEMA, kinds: KINDS, roles: ROLES }; }

function h_me(p, io, user) { return user; }

function h_getSettings(p, io) {
  var stores = tableRows(io, 'ที่เก็บเงิน');
  var types = tableRows(io, 'ประเภทเงิน');
  var opening = tableRows(io, 'ยอดยกมา');
  var range = fiscalRange(FISCAL_YEAR);
  var op = [];
  opening.forEach(function (r) {
    if (Number(normText(r[0])) === FISCAL_YEAR) op.push([softRef(types, r[1]), softRef(stores, r[2]), r[3]]);
  });
  return {
    fy: FISCAL_YEAR, fyStart: range.start, fyEnd: range.end, kinds: KINDS,
    stores: stores.map(function (r) { return [normText(r[0]), normText(r[1]), normText(r[2])]; }),
    types: types.map(function (r) {
      return [normText(r[0]), normText(r[1]), normText(r[2]), softRef(stores, r[3]), isActive(r[4]) ? 'ใช่' : 'ไม่'];
    }),
    opening: op
  };
}

function h_saveStores(p, io) {
  if (!Array.isArray(p.rows)) throw new Error('ไม่มีข้อมูลที่เก็บเงิน');
  var rows = validateStores(p.rows);
  assertUsedIdsKept(tableRows(io, 'Ledger'), 4, rows, 'ที่เก็บ');
  var types = tableRows(io, 'ประเภทเงิน');
  types.forEach(function (t) {
    var m = normText(t[3]);
    if (m) {
      try { resolveRef(rows, m, ''); } catch (e) {
        throw new Error('ที่เก็บหลักของประเภทเงิน "' + normText(t[1]) + '" ("' + m + '") ถูกลบ กรุณาแก้ประเภทเงินก่อน');
      }
    }
  });
  io.write('ที่เก็บเงิน', rows);
  return { saved: rows.length };
}

function h_saveTypes(p, io) {
  if (!Array.isArray(p.rows)) throw new Error('ไม่มีข้อมูลประเภทเงิน');
  var stores = tableRows(io, 'ที่เก็บเงิน');
  var rows = validateTypes(p.rows, stores);
  assertUsedIdsKept(tableRows(io, 'Ledger'), 3, rows, 'ประเภทเงิน');
  io.write('ประเภทเงิน', rows);
  return { saved: rows.length };
}

function writeOpeningAndLedger(io, otherFyRows, ledger, fy) {
  var opening = otherFyRows.concat(ledger.map(function (r) { return [fy, r[3], r[4], r[5]]; }));
  io.write('ยอดยกมา', opening);
  io.write('Ledger', ledger);
}

function h_saveOpening(p, io) {
  if (!Array.isArray(p.rows)) throw new Error('ไม่มีข้อมูลยอดยกมา');
  var stores = tableRows(io, 'ที่เก็บเงิน'), types = tableRows(io, 'ประเภทเงิน');
  var closed = tableRows(io, 'ปิดวัน');
  var start = fiscalRange(FISCAL_YEAR).start;
  if (isDateClosed(closed, start)) {
    throw fail('CLOSED', 'วันที่ ' + start + ' ปิดแล้ว ต้องให้ admin ปลดล็อกพร้อมเหตุผลก่อน');
  }
  var mine = p.rows.map(function (r) { return [FISCAL_YEAR, r[0], r[1], r[2]]; });
  var ledger = buildLedger(mine, types, stores, FISCAL_YEAR);
  var other = tableRows(io, 'ยอดยกมา').filter(function (r) { return Number(normText(r[0])) !== FISCAL_YEAR; });
  writeOpeningAndLedger(io, other, ledger, FISCAL_YEAR);
  return { saved: ledger.length };
}

function h_rebuildLedger(p, io) {
  var stores = tableRows(io, 'ที่เก็บเงิน'), types = tableRows(io, 'ประเภทเงิน');
  var opening = tableRows(io, 'ยอดยกมา');
  if (isDateClosed(tableRows(io, 'ปิดวัน'), fiscalRange(FISCAL_YEAR).start)) {
    throw fail('CLOSED', 'วันเริ่มปีงบปิดแล้ว ต้องให้ admin ปลดล็อกก่อนสร้าง Ledger ใหม่');
  }
  var ledger = buildLedger(opening, types, stores, FISCAL_YEAR);
  io.write('Ledger', ledger);
  return { rows: ledger.length };
}

function h_getBalances(p, io) {
  var iso = parseDate(p.date);
  if (!inFiscalYear(iso, FISCAL_YEAR)) {
    var r = fiscalRange(FISCAL_YEAR);
    throw new Error('วันที่ ' + iso + ' อยู่นอกปีงบ ' + FISCAL_YEAR + ' (' + r.start + ' ถึง ' + r.end + ')');
  }
  var stores = tableRows(io, 'ที่เก็บเงิน'), types = tableRows(io, 'ประเภทเงิน');
  var ledger = tableRows(io, 'Ledger');
  var res = computeBalances(ledger, types, stores, iso);
  res.ledgerRows = ledger.length;
  return res;
}

var HANDLERS = {
  getSchema: h_getSchema,
  me: h_me,
  getSettings: h_getSettings,
  saveStores: h_saveStores,
  saveTypes: h_saveTypes,
  saveOpening: h_saveOpening,
  rebuildLedger: h_rebuildLedger,
  getBalances: h_getBalances
};

/* ============ 5) ส่วนอ่านเขียนชีทจริง ============ */

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
  return {
    verifyToken: verifyGoogleToken,
    values: function (name) {
      var sh = ss.getSheetByName(name);
      if (!sh) return null;
      var lr = sh.getLastRow();
      if (lr < 1) return [[]];
      return sh.getRange(1, 1, lr, Math.max(sh.getLastColumn(), SCHEMA[name].length)).getValues();
    },
    write: function (name, rows) {
      var sh = ss.getSheetByName(name);
      var n = SCHEMA[name].length, last = sh.getLastRow();
      if (last > 1) sh.getRange(2, 1, last - 1, sh.getMaxColumns()).clearContent();
      if (!rows.length) return;
      if (name === 'Ledger' || name === 'ปิดวัน') sh.getRange(2, 1, rows.length, 1).setNumberFormat('@');
      sh.getRange(2, 1, rows.length, n).setValues(rows);
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
  if (req && WRITE_ACTIONS.indexOf(req.action) >= 0) {
    lock = LockService.getScriptLock();
    lock.waitLock(20000);
  }
  try {
    return jsonOut(dispatch(req, makeSheetIO()));
  } finally {
    if (lock) lock.releaseLock();
  }
}

/** กดรันเองครั้งเดียว: สร้างชีท หัวคอลัมน์ และ seed */
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
  Logger.log('setupSheets เสร็จแล้ว — ตรวจชีท "ผู้ใช้" ว่ามีอีเมลของคุณ');
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    SCHEMA: SCHEMA, ROLES: ROLES, KINDS: KINDS, FISCAL_YEAR: FISCAL_YEAR, CLIENT_ID: CLIENT_ID,
    SEED_STORES: SEED_STORES, SEED_TYPES: SEED_TYPES, SEED_GROUPS: SEED_GROUPS,
    parseDate: parseDate, parseAmount: parseAmount, fiscalRange: fiscalRange, inFiscalYear: inFiscalYear,
    checkHeaders: checkHeaders, buildLedger: buildLedger, computeBalances: computeBalances,
    validateClaims: validateClaims, findUser: findUser, isDateClosed: isDateClosed,
    dispatch: dispatch, fail: fail
  };
}
