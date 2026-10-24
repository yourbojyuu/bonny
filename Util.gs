/**
 * Util.gs — ฟังก์ชันช่วยแบบ pure (ไม่แตะชีท) ใช้ร่วมกันทุกไฟล์
 * กติกาข้อมูล: วันที่ / จำนวนเงิน / หัวคอลัมน์ / การอ้างอิงรหัส / ตัวอักษรไทยของจำนวนเงิน
 *
 * หมายเหตุ: ทุกไฟล์ .gs ใช้ global scope ร่วมกัน แต่ลำดับโหลดไฟล์ไม่แน่นอน
 * จึงห้ามอ้างถึงตัวแปรของไฟล์อื่นตอนโหลด (top-level) ให้อ้างได้เฉพาะในฟังก์ชัน
 */

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

function isCancelled(v) {
  return normText(v) === 'ยกเลิก';
}

function pad2(n) { return (n < 10 ? '0' : '') + n; }

function round2(n) { return Math.round(n * 100) / 100; }

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

/** วันที่ต้องอยู่ในปีงบ */
function parseFyDate(v, fy, label) {
  var iso;
  try { iso = parseDate(v); } catch (e) { throw new Error(label + ': ' + e.message); }
  if (!inFiscalYear(iso, fy)) {
    var r = fiscalRange(fy);
    throw new Error(label + ': วันที่ ' + thaiShortDate(iso) + ' อยู่นอกปีงบ ' + fy +
      ' (' + thaiShortDate(r.start) + ' – ' + thaiShortDate(r.end) + ')');
  }
  return iso;
}

function cleanMoneyText(v) {
  return normText(v).replace(/,/g, '').replace(/บาท/g, '').replace(/\s+/g, '');
}

/** ตัด , และ บาท แล้วต้อง > 0 */
function parseAmount(v) {
  var n;
  if (typeof v === 'number') {
    n = v;
  } else {
    var s = cleanMoneyText(v);
    if (s === '') throw new Error('ยังไม่ได้กรอกจำนวนเงิน');
    n = Number(s);
  }
  if (!isFinite(n)) throw new Error('จำนวนเงิน "' + normText(v) + '" อ่านไม่ได้');
  if (!(n > 0)) throw new Error('จำนวนเงินต้องมากกว่า 0');
  return round2(n);
}

/** จำนวนเงินที่เป็น 0 ได้ (เช่น ภาษี) ว่าง = 0 */
function parseMoney0(v) {
  if (typeof v === 'number') {
    if (!isFinite(v) || v < 0) throw new Error('จำนวนเงินต้องไม่ติดลบ');
    return round2(v);
  }
  var s = cleanMoneyText(v);
  if (s === '' || s === '-') return 0;
  var n = Number(s);
  if (!isFinite(n)) throw new Error('จำนวนเงิน "' + normText(v) + '" อ่านไม่ได้');
  if (n < 0) throw new Error('จำนวนเงินต้องไม่ติดลบ');
  return round2(n);
}

/** อ่านตัวเลขจากชีท (ติดลบได้) ว่าง/อ่านไม่ได้ = error */
function sheetNumber(v, label) {
  if (typeof v === 'number' && isFinite(v)) return v;
  var s = cleanMoneyText(v);
  var n = Number(s);
  if (s === '' || !isFinite(n)) throw new Error(label + ' "' + normText(v) + '" อ่านไม่ได้');
  return n;
}

function toInt(v) {
  var n = Number(normText(v));
  return isFinite(n) ? Math.round(n) : NaN;
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

/** อ่านแถวข้อมูลของชีท (ตรวจหัวคอลัมน์ทุกครั้ง) */
function tableRows(io, name) {
  var v = io.values(name);
  if (!v) throw fail('SCHEMA', 'ไม่พบชีท "' + name + '" กรุณารัน setupSheets() อีกครั้ง');
  checkHeaders(name, v[0]);
  return v.slice(1).filter(function (r) { return !isBlankRow(r); });
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

function findById(list, id) {
  for (var i = 0; i < list.length; i++) if (normText(list[i][0]) === id) return list[i];
  return null;
}

/** กฎ 5: วันที่ปิดแล้ว (ยังไม่ปลดล็อก) */
function closedDates(closedRows) {
  var out = {};
  closedRows.forEach(function (r) {
    if (isBlankRow(r)) return;
    var d;
    try { d = parseDate(r[0]); } catch (e) { return; }
    if (normText(r[3]) === '') out[d] = true;
    else delete out[d];
  });
  return out;
}

function isDateClosed(closedRows, iso) {
  return !!closedDates(closedRows)[iso];
}

var TH_MONTHS_LONG = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
  'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];
var TH_MONTHS_SHORT = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.',
  'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];

/** "2026-10-22" -> "22 ตุลาคม 2569" */
function thaiLongDate(iso) {
  var p = String(iso).split('-');
  if (p.length !== 3) return '';
  return Number(p[2]) + ' ' + TH_MONTHS_LONG[Number(p[1]) - 1] + ' ' + (Number(p[0]) + 543);
}

/** "2026-10-22" -> "22 ต.ค. 69" */
function thaiShortDate(iso) {
  var p = String(iso).split('-');
  if (p.length !== 3) return '';
  return Number(p[2]) + ' ' + TH_MONTHS_SHORT[Number(p[1]) - 1] + ' ' + String(Number(p[0]) + 543).slice(-2);
}

/** จำนวนเงินเป็นตัวอักษรไทย เช่น 30542.25 -> "สามหมื่นห้าร้อยสี่สิบสองบาทยี่สิบห้าสตางค์" */
function bahtText(n) {
  n = Math.round(Math.abs(n) * 100) / 100;
  var baht = Math.floor(n + 1e-9), satang = Math.round((n - baht) * 100);
  var D = ['ศูนย์', 'หนึ่ง', 'สอง', 'สาม', 'สี่', 'ห้า', 'หก', 'เจ็ด', 'แปด', 'เก้า'];
  var P = ['', 'สิบ', 'ร้อย', 'พัน', 'หมื่น', 'แสน'];
  function rd(x, hasHigher) {
    if (x === 0) return '';
    if (x >= 1e6) return rd(Math.floor(x / 1e6), false) + 'ล้าน' + rd(x % 1e6, true);
    var s = '', str = String(x), len = str.length;
    for (var i = 0; i < len; i++) {
      var dg = +str[i], pos = len - i - 1;
      if (dg === 0) continue;
      if (pos === 1 && dg === 1) s += 'สิบ';
      else if (pos === 1 && dg === 2) s += 'ยี่สิบ';
      else if (pos === 0 && dg === 1 && (len > 1 || hasHigher)) s += 'เอ็ด';
      else s += D[dg] + P[pos];
    }
    return s;
  }
  if (baht === 0 && satang === 0) return 'ศูนย์บาทถ้วน';
  return (baht ? rd(baht, false) + 'บาท' : '') + (satang ? rd(satang, false) + 'สตางค์' : 'ถ้วน');
}

function fmtMoney(n) {
  var s = round2(n).toFixed(2).split('.');
  return s[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',') + '.' + s[1];
}
