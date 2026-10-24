// รัน: node test.js   (ข้อมูลทั้งหมดในไฟล์นี้เป็นข้อมูลจำลอง)
// โหลดไฟล์ .gs ทุกไฟล์รวมกันใน context เดียว เหมือน Apps Script (ลำดับไฟล์สลับได้)
var fs = require('fs'), vm = require('vm'), path = require('path');
var FILES = ['Docs.gs', 'Code.gs', 'Ledger.gs', 'Util.gs', 'Schema.gs']; // ตั้งใจสลับลำดับ
var C = vm.createContext({ console: console, Date: Date, Math: Math, JSON: JSON });
FILES.forEach(function (f) { vm.runInContext(fs.readFileSync(path.join(__dirname, f), 'utf8'), C, { filename: f }); });

var passed = 0, failed = 0;
function ok(cond, name) {
  if (cond) { passed++; console.log('  ผ่าน  ' + name); }
  else { failed++; console.log('  ไม่ผ่าน  ' + name); }
}
function sat(x) { return Math.round(x * 100); }
function threws(fn, re) { try { fn(); } catch (e) { return re ? re.test(e.message) : true; } return false; }

/* ---------- ชีทจำลองในหน่วยความจำ ---------- */
function makeMemIO() {
  var sheets = {};
  Object.keys(C.SCHEMA).forEach(function (n) { sheets[n] = [C.SCHEMA[n].slice()]; });
  sheets['ผู้ใช้'].push(['admin@example.com', 'แอดมิน', 'admin', 'ใช่']);
  sheets['ผู้ใช้'].push(['fin@example.com', 'การเงิน', 'การเงิน', 'ใช่']);
  sheets['ผู้ใช้'].push(['sup@example.com', 'พัสดุ', 'พัสดุ', 'ใช่']);
  sheets['ผู้ใช้'].push(['boss@example.com', 'ผอ.', 'ผู้บริหาร', 'ใช่']);
  sheets['ผู้ใช้'].push(['off@example.com', 'ปิดแล้ว', 'การเงิน', 'ไม่']);
  C.SEED_STORES.forEach(function (s) { sheets['ที่เก็บเงิน'].push(s.slice()); });
  C.SEED_TYPES.forEach(function (t) { sheets['ประเภทเงิน'].push([t[0], t[1], C.SEED_GROUPS[t[2]], t[3], 'ใช่']); });
  var tokens = {
    'tok-admin': 'admin@example.com', 'tok-fin': 'fin@example.com', 'tok-sup': 'sup@example.com',
    'tok-boss': 'boss@example.com', 'tok-off': 'off@example.com', 'tok-stranger': 'stranger@example.com'
  };
  return {
    sheets: sheets,
    verifyToken: function (t) { if (!tokens[t]) throw C.fail('AUTH', 'token ไม่ถูกต้อง'); return tokens[t]; },
    values: function (n) { return sheets[n] ? sheets[n].map(function (r) { return r.slice(); }) : null; },
    write: function (n, rows) { sheets[n] = [sheets[n][0]].concat(rows.map(function (r) { return r.slice(); })); }
  };
}
function call(io, token, action, payload) {
  return C.dispatch({ action: action, idToken: token, payload: payload || {} }, io);
}
function grandOf(io, date) { return call(io, 'tok-admin', 'getBalances', { date: date }).data; }

if (require.main === module) {
  var FY = C.FISCAL_YEAR, R = C.fiscalRange(FY);

  console.log('1) วันที่ / จำนวนเงิน / token / ตัวอักษรไทย');
  ok(R.start === '2026-10-01' && R.end === '2027-09-30', 'ช่วงปีงบ 2570');
  ok(C.parseDate('1/10/2569') === '2026-10-01' && C.parseDate('1/10/69') === '2026-10-01', 'วันที่ 1/10/2569 และ 1/10/69');
  ok(C.parseDate(new Date(2026, 9, 1)) === '2026-10-01', 'วันที่แบบ Date');
  ok(C.parseDate((Date.UTC(2026, 9, 1) - Date.UTC(1899, 11, 30)) / 86400000) === '2026-10-01', 'วันที่แบบเลข Excel');
  ok(threws(function () { C.parseDate('31/2/2569'); }), 'วันที่ที่ไม่มีจริงต้อง error');
  ok(C.parseAmount('1,234.50 บาท') === 1234.5, 'จำนวนเงินตัด , และ บาท');
  ok(threws(function () { C.parseAmount('0'); }) && threws(function () { C.parseAmount('abc'); }), 'จำนวนเงิน 0 / อ่านไม่ได้ ต้อง error');
  var good = { aud: 'cid', exp: 2000, iss: 'accounts.google.com', email: 'A@x.com', email_verified: 'true' };
  ok(C.validateClaims(good, 'cid', 1000) === 'a@x.com', 'claims ถูกต้อง');
  ok(threws(function () { C.validateClaims(good, 'other', 1000); }) && threws(function () { C.validateClaims(good, 'cid', 3000); }), 'aud ผิด / หมดอายุ ถูกปฏิเสธ');
  ok(C.bahtText(52000) === 'ห้าหมื่นสองพันบาทถ้วน', 'ตัวอักษร 52,000');
  ok(C.bahtText(30542.25) === 'สามหมื่นห้าร้อยสี่สิบสองบาทยี่สิบห้าสตางค์', 'ตัวอักษร 30,542.25 ตรงเอกสารจริง');
  ok(C.bahtText(76240.2) === 'เจ็ดหมื่นหกพันสองร้อยสี่สิบบาทยี่สิบสตางค์', 'ตัวอักษร 76,240.20');
  ok(C.bahtText(1000001) === 'หนึ่งล้านเอ็ดบาทถ้วน' && C.bahtText(21.21) === 'ยี่สิบเอ็ดบาทยี่สิบเอ็ดสตางค์', 'ตัวอักษร เอ็ด/ยี่');
  ok(C.thaiLongDate('2026-10-22') === '22 ตุลาคม 2569' && C.thaiShortDate('2026-10-22') === '22 ต.ค. 69', 'วันที่ไทย');
  ok(C.calcWithholding(9351, 1, true) === 87.39, 'ภาษี 1% ของฐานก่อน VAT ตรงเอกสารจริง (9,351 → 87.39)');

  console.log('2) สิทธิ์');
  var io = makeMemIO();
  ok(call(io, null, 'ping').ok, 'ping ไม่ต้องมี token');
  var r = call(io, '', 'getBalances', { date: R.start });
  ok(!r.ok && r.code === 'AUTH', 'ไม่มี token ถูกปฏิเสธ');
  ok(call(io, 'tok-stranger', 'getDocs').code === 'AUTH', 'อีเมลไม่อยู่ในชีท ผู้ใช้ ถูกปฏิเสธ');
  ok(call(io, 'tok-off', 'getDocs').code === 'AUTH', 'ผู้ใช้ที่ปิดใช้งานถูกปฏิเสธ');
  ok(call(io, 'tok-boss', 'saveKhb', {}).code === 'FORBIDDEN', 'ผู้บริหารสร้าง ขบ. ไม่ได้');
  ok(call(io, 'tok-sup', 'createKhj', {}).code === 'FORBIDDEN', 'พัสดุสร้าง ขจ. ไม่ได้');
  ok(call(io, 'tok-fin', 'saveTypes', { rows: [] }).code === 'FORBIDDEN', 'การเงินแก้ตั้งค่าไม่ได้');
  ok(call(io, 'tok-boss', 'getDocs').ok, 'ผู้บริหารดูเอกสารได้');

  console.log('3) ยอดยกมา -> Ledger -> ภาพรวม');
  var opening = [['T08', 'S06', '1,433,468'], ['T06', 'S04', 1946874.55], ['T01', 'S02', 95618], ['T03', 'S01', '1,000.07 บาท'],
    ['เงินรายได้ ศูนย์สระว่ายน้ำ', 'บัญชีเงินรายได้', 369067], ['T09', 'S06', 868743]];
  r = call(io, 'tok-admin', 'saveOpening', { rows: opening });
  ok(r.ok && r.data.saved === opening.length, 'saveOpening ' + (r.ok ? '' : r.error));
  var expected = 0;
  opening.forEach(function (o) { expected += sat(Number(String(o[2]).replace(/,|บาท/g, ''))); });
  var d = grandOf(io, '2026-11-15');
  var cellSum = 0;
  d.cells.forEach(function (row) { row.forEach(function (v) { cellSum += sat(v); }); });
  ok(cellSum === expected && cellSum === sat(d.grand), 'ผลรวมประเภท x ที่เก็บ = ยอดที่กรอก = KPI');

  console.log('4) ขบ. — สร้าง ตรวจ คำนวณยอด');
  // ยอดเดียวกับ ขบ.4 ในไฟล์จริง (ชื่อร้านเป็นข้อมูลจำลอง) ไฟล์ Excel เดิมรวมผิดเป็น 20,995
  var grossList = [9351, 5766.45, 2195, 4520.75, 12128, 14090, 6634, 560, 8025, 12970];
  var taxList = [87.39, 53.89, 20.51, 42.25, 113.35, 131.68, 0, 5.23, 75, 121.22];
  var lines = grossList.map(function (g, i) {
    return { type: i === 2 ? 'T02' : 'T08', payee: 'ร้านตัวอย่าง ' + (i + 1), kind: 'พัสดุ', method: 'เช็ค',
      gross: g, tax: taxList[i], taxType: taxList[i] ? 'ภ.ง.ด.53' : 'ไม่มีภาษี' };
  });
  r = call(io, 'tok-sup', 'saveKhb', { date: '22/10/69', lines: lines });
  ok(r.ok && r.data.no === 1, 'พัสดุสร้าง ขบ.1 ได้ ' + (r.ok ? '' : r.error));
  var doc = call(io, 'tok-boss', 'khbDoc', { no: 1 }).data;
  ok(sat(doc.total.gross) === sat(76240.2), 'ยอดรวม ขบ. = 76,240.20 (ไม่ใช่ 20,995 แบบไฟล์ Excel)');
  ok(doc.totalText === 'เจ็ดหมื่นหกพันสองร้อยสี่สิบบาทยี่สิบสตางค์', 'ตัวอักษรยอดรวม ขบ. ถูกต้อง');
  ok(sat(doc.total.net + doc.total.tax) === sat(doc.total.gross), 'ขอเบิก + ภาษี = รวม');
  ok(doc.noText === 'ขบ.1/2570' && doc.dateLong === '22 ตุลาคม 2569', 'เลขที่และวันที่ ขบ.');
  ok(/จำนวน 10 รายการ/.test(doc.paras[0]), 'ข้อความนับจำนวนรายการ');
  r = call(io, 'tok-fin', 'saveKhb', { date: '1/10/69', lines: [{ type: 'T06', payee: 'ครูตัวอย่าง ก', kind: 'ค่าจ้าง', method: 'KTB', gross: 11000, tax: 0 },
    { type: 'T06', payee: 'ครูตัวอย่าง ข', kind: 'ค่าจ้าง', method: 'KTB', gross: 10000, tax: 0 }] });
  ok(r.ok && r.data.no === 2, 'การเงินสร้าง ขบ.2 ได้ เลขรันต่อ');
  ok(/นอกปีงบ/.test(call(io, 'tok-fin', 'saveKhb', { date: '30/9/69', lines: lines }).error), 'วันที่นอกปีงบถูกปฏิเสธ');
  ok(/รายการที่ 1: ประเภทเงิน "T99"/.test(call(io, 'tok-fin', 'saveKhb', { date: '1/10/69', lines: [{ type: 'T99', payee: 'x', kind: 'เบิก', method: 'KTB', gross: 1 }] }).error), 'ประเภทเงินผิด บอกแถว');
  ok(/ภาษีต้องน้อยกว่า/.test(call(io, 'tok-fin', 'saveKhb', { date: '1/10/69', lines: [{ type: 'T06', payee: 'x', kind: 'เบิก', method: 'KTB', gross: 10, tax: 10, taxType: 'ภ.ง.ด.3' }] }).error), 'ภาษี >= ยอดรวม ถูกปฏิเสธ');
  ok(/ต้องเลือกประเภทภาษี/.test(call(io, 'tok-fin', 'saveKhb', { date: '1/10/69', lines: [{ type: 'T06', payee: 'x', kind: 'เบิก', method: 'KTB', gross: 10, tax: 1 }] }).error), 'มีภาษีแต่ไม่เลือกประเภทภาษี ถูกปฏิเสธ');
  ok(/อย่างน้อย 1 รายการ/.test(call(io, 'tok-fin', 'saveKhb', { date: '1/10/69', lines: [] }).error), 'ขบ. ว่างถูกปฏิเสธ');
  var docs = call(io, 'tok-fin', 'getDocs').data;
  ok(docs.khbs.length === 2 && docs.khbs[1].counts['รอจ่าย'] === 10, 'getDocs: ขบ.1 มี 10 รายการรอจ่าย');
  ok(docs.payees.indexOf('ร้านตัวอย่าง 1') >= 0, 'มีรายชื่อผู้รับให้เลือกซ้ำ');
  var before = grandOf(io, '2026-11-15').grand;
  ok(before === d.grand, 'สร้าง ขบ. ยังไม่ลดยอดคงเหลือ');

  console.log('5) ขจ. — ดึงรายการรอจ่าย ผูกโยง และกันผูกซ้ำ');
  var items = [1, 2, 3, 4, 5].map(function (s) { return { fy: FY, no: 1, seq: s }; }).concat([{ fy: FY, no: 2, seq: 1 }]);
  ok(/ไม่ก่อนวันที่ ขบ/.test(call(io, 'tok-fin', 'createKhj', { date: '21/10/69', items: items }).error), 'วันที่ ขจ. ก่อน ขบ. ถูกปฏิเสธ');
  r = call(io, 'tok-fin', 'createKhj', { date: '24/10/69', items: items });
  ok(r.ok && r.data.no === 1 && r.data.count === 6, 'สร้าง ขจ.1 จาก 2 ขบ. ' + (r.ok ? '' : r.error));
  ok(/อยู่ใน ขจ.1 แล้ว/.test(call(io, 'tok-fin', 'createKhj', { date: '24/10/69', items: [{ fy: FY, no: 1, seq: 1 }] }).error), 'รายการเดิมผูกซ้ำไม่ได้');
  ok(/ถูกเลือกซ้ำ/.test(call(io, 'tok-fin', 'createKhj', { date: '24/10/69', items: [{ fy: FY, no: 1, seq: 6 }, { fy: FY, no: 1, seq: 6 }] }).error), 'เลือกรายการเดียวกันสองครั้งไม่ได้');
  ok(/แก้ไขไม่ได้/.test(call(io, 'tok-fin', 'saveKhb', { no: 1, date: '22/10/69', lines: lines }).error), 'ขบ. ที่มีรายการใน ขจ. แก้ไม่ได้');
  ok(/ยกเลิกไม่ได้/.test(call(io, 'tok-fin', 'cancelKhb', { no: 1, reason: 'ทดสอบ' }).error), 'ขบ. ที่มีรายการใน ขจ. ยกเลิกไม่ได้');
  docs = call(io, 'tok-fin', 'getDocs').data;
  var k1 = docs.khbs.filter(function (h) { return h.no === 1; })[0];
  ok(k1.counts['อยู่ใน ขจ.'] === 5 && k1.counts['รอจ่าย'] === 5, 'สถานะรายการ: อยู่ใน ขจ. 5 / รอจ่าย 5');
  ok(k1.lines[0].khjNo === 1, 'รายการรู้ว่าอยู่ใน ขจ. ใบไหน');
  var j1 = docs.khjs[0];
  var net5 = 0; [0, 1, 2, 3, 4].forEach(function (i) { net5 += sat(grossList[i] - taxList[i]); });
  ok(sat(j1.total) === net5 + sat(11000), 'ยอด ขจ. = ยอดจ่ายจริงหลังหักภาษี');
  var jd = call(io, 'tok-boss', 'khjDoc', { no: 1 }).data;
  ok(jd.sections.length === 3, 'เอกสาร ขจ. แยกตามกลุ่มเงิน (อุดหนุน / รายได้ / บกศ.)');
  ok(/ขบ.2\/70 ลงวันที่ 1 ต.ค. 69 และ ขบ.1\/70 ลงวันที่ 22 ต.ค. 69/.test(jd.paras[0]), 'ข้อความอ้างถึง ขบ. ตามวันที่: ' + jd.paras[0].slice(0, 120));
  ok(sat(jd.grand) === sat(j1.total) && /^[ก-๙]+$/.test(jd.grandText), 'ยอดรวมและตัวอักษร ขจ.');
  ok(!/ง่ายเงิน/.test(jd.paras[0]) && /ขออนุมัติจ่ายเงิน/.test(jd.paras[0]), 'ข้อความ "ขออนุมัติจ่ายเงิน" สะกดถูก');

  console.log('6) การจ่าย — ยอดคงเหลือลดตามวันที่จ่ายจริง');
  var pay = j1.items.map(function (it) {
    return { khbFy: it.khbFy, khbNo: it.khbNo, seq: it.seq, method: it.method, ref: it.method === 'เช็ค' ? '1039328' + it.seq : '1000004379989', store: it.store, date: '28/10/69' };
  });
  var noRef = pay.map(function (x) { var y = JSON.parse(JSON.stringify(x)); y.ref = ''; return y; });
  ok(/ต้องกรอกเลขที่อ้างอิง/.test(call(io, 'tok-fin', 'savePayments', { no: 1, rows: noRef }).error), 'จ่ายด้วยเช็ค/KTB ต้องมีเลขที่อ้างอิง');
  r = call(io, 'tok-fin', 'savePayments', { no: 1, rows: pay });
  ok(r.ok && r.data.paid === 6, 'บันทึกการจ่าย 6 รายการ ' + (r.ok ? '' : r.error));
  var b27 = grandOf(io, '2026-10-27'), b28 = grandOf(io, '2026-10-28');
  ok(b27.grand === d.grand, 'ก่อนวันจ่าย ยอดไม่เปลี่ยน');
  ok(sat(d.grand) - sat(b28.grand) === sat(j1.total), 'วันจ่าย ยอดลดเท่ายอด ขจ. ทุกสตางค์');
  var cs = 0; b28.cells.forEach(function (row) { row.forEach(function (v) { cs += sat(v); }); });
  ok(cs === sat(b28.grand), 'ผลรวมตาราง = KPI หลังจ่าย (กฎ 7)');
  docs = call(io, 'tok-fin', 'getDocs').data;
  ok(docs.khbs.filter(function (h) { return h.no === 2; })[0].counts['จ่ายแล้ว'] === 1, 'สถานะเป็น จ่ายแล้ว');

  console.log('7) ปิดวัน / ยกเลิก ขจ.');
  io.sheets['ปิดวัน'].push(['2026-10-28', 'fin@example.com', '2026-10-28 17:00', '', '']);
  r = call(io, 'tok-fin', 'cancelKhj', { no: 1, reason: 'ทดสอบ' });
  ok(!r.ok && r.code === 'CLOSED', 'ยกเลิก ขจ. ที่จ่ายในวันที่ปิดแล้วไม่ได้');
  ok(call(io, 'tok-admin', 'rebuildLedger').ok, 'สร้าง Ledger ใหม่ได้เมื่อยอดวันที่ปิดไม่เปลี่ยน');
  var pay2 = [{ khbFy: FY, khbNo: 1, seq: 1, method: 'เช็ค', ref: '10393281', store: 'S06', date: '27/10/69' }];
  ok(call(io, 'tok-fin', 'savePayments', { no: 1, rows: pay2 }).code === 'CLOSED', 'แก้วันที่จ่ายออกจากวันที่ปิดไม่ได้');
  ok(/ปิดแล้ว/.test(call(io, 'tok-fin', 'saveKhb', { date: '28/10/69', lines: lines.slice(0, 1) }).error), 'สร้าง ขบ. ลงวันที่ปิดไม่ได้');
  io.sheets['ปิดวัน'][1][3] = 'ปลดล็อก'; io.sheets['ปิดวัน'][1][4] = 'แก้เลขเช็คผิด';
  r = call(io, 'tok-fin', 'cancelKhj', { no: 1, reason: 'เลขเช็คผิด ออกใหม่' });
  ok(r.ok, 'ปลดล็อกแล้วยกเลิก ขจ. ได้');
  ok(grandOf(io, '2026-10-28').grand === d.grand, 'ยกเลิก ขจ. แล้วยอดกลับคืน');
  docs = call(io, 'tok-fin', 'getDocs').data;
  ok(docs.khbs.filter(function (h) { return h.no === 1; })[0].counts['รอจ่าย'] === 10, 'รายการกลับไป รอจ่าย');
  r = call(io, 'tok-fin', 'createKhj', { date: '29/10/69', items: [{ fy: FY, no: 1, seq: 1 }] });
  ok(r.ok && r.data.no === 2, 'นำรายการไปสร้าง ขจ.2 ใหม่ได้ (เลข ขจ. ไม่ใช้ซ้ำ)');
  ok(/ไม่ก่อนวันที่ ขจ/.test(call(io, 'tok-fin', 'savePayments', { no: 2, rows: [{ khbFy: FY, khbNo: 1, seq: 1, method: 'เช็ค', ref: '1', store: 'S06', date: '28/10/69' }] }).error), 'วันที่จ่ายก่อนวันที่ ขจ. ถูกปฏิเสธ');
  r = call(io, 'tok-fin', 'cancelKhb', { no: 2, reason: 'ทดสอบยกเลิก' });
  ok(r.ok, 'ขบ. ที่ไม่มีรายการใน ขจ. ยกเลิกได้');
  ok(/ถูกยกเลิกแล้ว/.test(call(io, 'tok-fin', 'createKhj', { date: '29/10/69', items: [{ fy: FY, no: 2, seq: 1 }] }).error), 'รายการของ ขบ. ที่ยกเลิกแล้วนำไปจ่ายไม่ได้');
  ok(/ยกเลิกไปแล้ว/.test(call(io, 'tok-fin', 'cancelKhb', { no: 2, reason: 'x' }).error), 'ยกเลิกซ้ำไม่ได้');

  console.log('8) หัวคอลัมน์ผิดต้อง error ไม่ใช่ 0');
  io.sheets['การจ่าย'][0][9] = 'วันจ่าย';
  r = call(io, 'tok-admin', 'getDocs');
  ok(!r.ok && r.code === 'SCHEMA' && /คอลัมน์ที่ 10 ต้องเป็น "วันที่จ่าย"/.test(r.error), 'หัวคอลัมน์ การจ่าย ผิด -> บอกคอลัมน์');
  ok(call(io, 'tok-admin', 'rebuildLedger').code === 'SCHEMA', 'สร้าง Ledger ไม่ทำต่อเมื่อหัวคอลัมน์ผิด');
  io.sheets['การจ่าย'][0][9] = 'วันที่จ่าย';
  io.sheets['Ledger'][0][5] = 'จำนวน';
  ok(call(io, 'tok-admin', 'getBalances', { date: R.start }).code === 'SCHEMA', 'หัวคอลัมน์ Ledger ผิด -> error');
  io.sheets['Ledger'][0][5] = 'จำนวน +/-';
  var tmp = io.sheets['ขจ']; delete io.sheets['ขจ'];
  ok(/ไม่พบชีท "ขจ"/.test(call(io, 'tok-admin', 'getDocs').error), 'ไม่มีชีท -> บอกให้รัน setupSheets');
  io.sheets['ขจ'] = tmp;
  io.sheets['การจ่าย'].push([FY, 2, FY, 1, 99, 'เช็ค', '', 'S06', 1, '', 'ปกติ']);
  ok(/ไม่พบรายการ ขบ.1\/2570 ลำดับ 99/.test(call(io, 'tok-admin', 'getDocs').error), 'การจ่ายอ้างรายการที่ไม่มี -> error ชัดเจน');
  io.sheets['การจ่าย'].pop();

  console.log('9) ตั้งค่า');
  var st = call(io, 'tok-admin', 'getSettings').data;
  ok(st.docSettings['ผู้เสนอ'] && /\.{5}/.test(st.docSettings['ขบ_ลงนาม1_ชื่อ']), 'ตั้งค่าเอกสารมีค่าตั้งต้น (ไม่มีชื่อจริง)');
  r = call(io, 'tok-admin', 'saveDocSettings', { values: { 'ขบ_ลงนาม1_ชื่อ': '( นายตัวอย่าง ทดสอบ )' } });
  ok(r.ok && call(io, 'tok-boss', 'khbDoc', { no: 1 }).data.signers[0].name === '( นายตัวอย่าง ทดสอบ )', 'แก้ชื่อผู้ลงนามแล้วเอกสารเปลี่ยนตาม');
  var t2 = st.types.map(function (t) { return t.slice(); }).filter(function (t) { return t[0] !== 'T02'; });
  ok(/T02/.test(call(io, 'tok-admin', 'saveTypes', { rows: t2 }).error), 'ลบประเภทเงินที่ใช้ใน ขบ. ไม่ได้');
  var s2 = st.stores.filter(function (s) { return s[0] !== 'S06'; });
  ok(/S06/.test(call(io, 'tok-admin', 'saveStores', { rows: s2 }).error), 'ลบที่เก็บที่ใช้แล้วไม่ได้');

  console.log('\nผ่าน ' + passed + ' / ' + (passed + failed));
  if (failed) { console.log('มี ' + failed + ' ข้อไม่ผ่าน'); process.exit(1); }
  console.log('ทุกข้อผ่าน');
}

module.exports = { C: C, makeMemIO: makeMemIO, call: call };
