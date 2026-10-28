// รัน: node test.js   (ข้อมูลทั้งหมดในไฟล์นี้เป็นข้อมูลจำลอง)
// โหลดไฟล์ .gs ทุกไฟล์รวมกันใน context เดียว เหมือน Apps Script (ลำดับไฟล์สลับได้)
var fs = require('fs'), vm = require('vm'), path = require('path');
var FILES = ['Receipts.gs', 'Docs.gs', 'Code.gs', 'Ledger.gs', 'Util.gs', 'Schema.gs']; // ตั้งใจสลับลำดับ
var C = vm.createContext({ console: console, Date: Date, Math: Math, JSON: JSON });
FILES.forEach(function (f) { vm.runInContext(fs.readFileSync(path.join(__dirname, f), 'utf8'), C, { filename: f }); });

var P = vm.createContext({});
vm.runInContext(fs.readFileSync(path.join(__dirname, 'paste.js'), 'utf8'), P, { filename: 'paste.js' });
var Paste = P.Paste;

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
  sheets['ผู้ใช้'].push(['t1@example.com', 'ครูตัวอย่าง หนึ่ง', 'ครู', 'ใช่']);
  sheets['ผู้ใช้'].push(['t2@example.com', 'ครูตัวอย่าง สอง', 'ครู', 'ใช่']);
  C.SEED_STORES.forEach(function (s) { sheets['ที่เก็บเงิน'].push(s.slice()); });
  C.ALIAS_SEED.forEach(function (a) { sheets['ชื่อย่อ'].push(a.slice()); });
  C.SEED_TYPES.forEach(function (t) { sheets['ประเภทเงิน'].push([t[0], t[1], C.SEED_GROUPS[t[2]], t[3], 'ใช่']); });
  var tokens = {
    'tok-admin': 'admin@example.com', 'tok-fin': 'fin@example.com', 'tok-sup': 'sup@example.com',
    'tok-boss': 'boss@example.com', 'tok-off': 'off@example.com', 'tok-stranger': 'stranger@example.com',
    'tok-t1': 't1@example.com', 'tok-t2': 't2@example.com'
  };
  var verify = function (t) { if (!tokens[t]) throw C.fail('AUTH', 'token ไม่ถูกต้อง'); return tokens[t]; };
  if (process.env.SHEETIO) return sheetBackedIO(sheets, verify);
  return {
    sheets: sheets,
    verifyToken: verify,
    values: function (n) { return sheets[n] ? sheets[n].map(function (r) { return r.slice(); }) : null; },
    write: function (n, rows) { sheets[n] = [sheets[n][0]].concat(rows.map(function (r) { return r.slice(); })); }
  };
}

/* ---------- SHEETIO=1 node test.js : รันเทสต์ทั้งชุดผ่าน makeSheetIO จริง (Code.gs) บน Google Sheet จำลอง ----------
 * จำลองพฤติกรรมของชีทจริงที่สำคัญ: getLastRow ไม่นับแถวว่างท้าย · เซลล์ที่ไม่ได้ตั้งเป็นข้อความ แปลงตัวเลขเป็น number */
function fakeSpreadsheet(sheets) {
  var textCols = {};
  function sheet(name) {
    var a = sheets[name]; textCols[name] = textCols[name] || {};
    function lastRow() { for (var i = a.length - 1; i >= 0; i--) if (a[i].some(function (v) { return v !== '' && v !== null && v !== undefined; })) return i + 1; return 0; }
    function range(r, c, nr, nc) {
      return {
        getValues: function () { var o = []; for (var i = 0; i < nr; i++) { var row = []; for (var j = 0; j < nc; j++) { var v = (a[r - 1 + i] || [])[c - 1 + j]; row.push(v === undefined || v === null ? '' : v); } o.push(row); } return o; },
        setValues: function (v) {
          for (var i = 0; i < nr; i++) { var row = a[r - 1 + i] = a[r - 1 + i] || []; for (var j = 0; j < nc; j++) {
            var x = v[i][j], col = c + j;
            if (typeof x === 'string' && !textCols[name][col] && /^-?\d+(\.\d+)?$/.test(x)) x = Number(x);
            row[c - 1 + j] = x; fakeSpreadsheet.cells = (fakeSpreadsheet.cells || 0) + 1;
          } }
          return this;
        },
        clearContent: function () { for (var i = 0; i < nr; i++) { var row = a[r - 1 + i]; if (row) for (var j = 0; j < nc; j++) if (c - 1 + j < row.length) row[c - 1 + j] = ''; } return this; },
        setNumberFormat: function (f) { if (f === '@') for (var j = 0; j < nc; j++) textCols[name][c + j] = true; return this; }
      };
    }
    return {
      getLastRow: function () { a = sheets[name]; return lastRow(); },
      getLastColumn: function () { return a.reduce(function (m, r) { return Math.max(m, r.length); }, 0); },
      getMaxColumns: function () { return Math.max(26, a.reduce(function (m, r) { return Math.max(m, r.length); }, 0)); },
      getRange: function (r, c, nr, nc) { a = sheets[name]; return range(r, c, nr || 1, nc || 1); }
    };
  }
  Object.keys(C.TEXT_COLS).forEach(function (n) { textCols[n] = {}; C.TEXT_COLS[n].forEach(function (c) { textCols[n][c] = true; }); });
  return { getActiveSpreadsheet: function () { return { getSheetByName: function (n) { return sheets[n] ? sheet(n) : null; } }; } };
}
function sheetBackedIO(sheets, verify) {
  var fake = fakeSpreadsheet(sheets), inner = null;
  var io = {
    sheets: sheets,
    verifyToken: verify,
    reset: function () { C.SpreadsheetApp = fake; inner = C.makeSheetIO(); }, // 1 คำขอ = io ใหม่ (memo ใหม่) เหมือนของจริง
    values: function (n) { if (!inner) io.reset(); return inner.values(n); },
    write: function (n, rows) { if (!inner) io.reset(); return inner.write(n, rows); }
  };
  return io;
}
function call(io, token, action, payload) {
  if (io.reset) io.reset();
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
  var opening = [['T20', 'S06', '1,433,468'], ['T18', 'S04', 1946874.55], ['T03', 'S02', 95618], ['T02', 'S01', '1,000.07 บาท'],
    ['รายได้ศูนย์กีฬา', 'บัญชีเงินรายได้', 369067], ['T21', 'S06', 868743]];
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
    return { type: i === 2 ? 'T01' : 'T20', payee: 'ร้านตัวอย่าง ' + (i + 1), kind: 'พัสดุ', method: 'เช็ค',
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
  r = call(io, 'tok-fin', 'saveKhb', { date: '1/10/69', lines: [{ type: 'T18', payee: 'ครูตัวอย่าง ก', kind: 'ค่าจ้าง', method: 'KTB', gross: 11000, tax: 0 },
    { type: 'T18', payee: 'ครูตัวอย่าง ข', kind: 'ค่าจ้าง', method: 'KTB', gross: 10000, tax: 0 }] });
  ok(r.ok && r.data.no === 2, 'การเงินสร้าง ขบ.2 ได้ เลขรันต่อ');
  ok(/นอกปีงบ/.test(call(io, 'tok-fin', 'saveKhb', { date: '30/9/69', lines: lines }).error), 'วันที่นอกปีงบถูกปฏิเสธ');
  ok(/รายการที่ 1: ประเภทเงิน "T99"/.test(call(io, 'tok-fin', 'saveKhb', { date: '1/10/69', lines: [{ type: 'T99', payee: 'x', kind: 'เบิก', method: 'KTB', gross: 1 }] }).error), 'ประเภทเงินผิด บอกแถว');
  ok(/ภาษีต้องน้อยกว่า/.test(call(io, 'tok-fin', 'saveKhb', { date: '1/10/69', lines: [{ type: 'T18', payee: 'x', kind: 'เบิก', method: 'KTB', gross: 10, tax: 10, taxType: 'ภ.ง.ด.3' }] }).error), 'ภาษี >= ยอดรวม ถูกปฏิเสธ');
  ok(/ต้องเลือกประเภทภาษี/.test(call(io, 'tok-fin', 'saveKhb', { date: '1/10/69', lines: [{ type: 'T18', payee: 'x', kind: 'เบิก', method: 'KTB', gross: 10, tax: 1 }] }).error), 'มีภาษีแต่ไม่เลือกประเภทภาษี ถูกปฏิเสธ');
  ok(/อย่างน้อย 1 รายการ/.test(call(io, 'tok-fin', 'saveKhb', { date: '1/10/69', lines: [] }).error), 'ขบ. ว่างถูกปฏิเสธ');
  var docs = call(io, 'tok-fin', 'getDocs').data;
  ok(docs.khbs.length === 2 && docs.khbs[1].counts['รอจ่าย'] === 10, 'getDocs: ขบ.1 มี 10 รายการรอจ่าย');
  ok(docs.payees.indexOf('ร้านตัวอย่าง 1') >= 0, 'มีรายชื่อผู้รับให้เลือกซ้ำ');
  var before = grandOf(io, '2026-11-15').grand;
  ok(before === d.grand, 'สร้าง ขบ. ยังไม่ลดยอดคงเหลือ');

  console.log('5) ขจ. — ดึงรายการรอจ่าย ผูกโยง และกันผูกซ้ำ');
  var items = [1, 2, 3, 4, 5].map(function (s) { return { fy: FY, no: 1, seq: s }; }).concat([{ fy: FY, no: 2, seq: 1 }]);
  ok(/ยังไม่ผ่านการอนุมัติ/.test(call(io, 'tok-fin', 'createKhj', { date: '24/10/69', items: items }).error), 'ขบ. ที่ยังไม่อนุมัติ ทำ ขจ. ไม่ได้');
  ok(call(io, 'tok-boss', 'approveKhb', { nos: [1, 2], decision: 'อนุมัติ' }).ok, 'ผู้บริหารอนุมัติ ขบ.1-2');
  ok(/ยังไม่กดรับเรื่อง/.test(call(io, 'tok-fin', 'createKhj', { date: '24/10/69', items: items }).error), 'อนุมัติแล้วแต่ยังไม่รับเรื่อง ทำ ขจ. ไม่ได้');
  ok(call(io, 'tok-fin', 'receiveKhb', { nos: [1, 2] }).ok, 'การเงินรับเรื่อง ขบ.1-2');
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
  var t2 = st.types.map(function (t) { return t.slice(); }).filter(function (t) { return t[0] !== 'T01'; });
  ok(/T0[0-9]|T1[0-9]|T2[0-9]/.test(call(io, 'tok-admin', 'saveTypes', { rows: t2 }).error), 'ลบประเภทเงินที่ใช้ใน ขบ. ไม่ได้');
  var s2 = st.stores.filter(function (s) { return s[0] !== 'S06'; });
  ok(/S06/.test(call(io, 'tok-admin', 'saveStores', { rows: s2 }).error), 'ลบที่เก็บที่ใช้แล้วไม่ได้');

  console.log('10) วันที่ไทยจาก Excel / ภาษีตามประเภทผู้รับ (ตรงกับ paste.js)');
  ok(C.parseDate('1 ต.ค. 69') === '2026-10-01' && C.parseDate('1 ตุลาคม 2569') === '2026-10-01' && C.parseDate('1-Oct-26') === '2026-10-01', 'วันที่แบบข้อความ ไทย/อังกฤษ');
  ok(C.parseDate('8 ต.ค. 25') === '2025-10-08' && C.parseDate('1/10/69') === '2026-10-01', 'ปี 2 หลัก: 25 = ค.ศ. · 69 = พ.ศ.');
  ok(C.calcTax('ภ.ง.ด.53', 9351, true) === 87.39 && C.calcTax('ภ.ง.ด.53', 500, false) === 5, 'ภ.ง.ด.53 หัก 1% ทุกยอด');
  ok(C.calcTax('ภ.ง.ด.3', 9999.99, false) === 0 && C.calcTax('ภ.ง.ด.3', 10000, false) === 100 && C.calcTax('ภ.ง.ด.3', 12000, false) === 120, 'ภ.ง.ด.3 หัก 1% เมื่อตั้งแต่ 10,000');
  ok(C.calcTax('ไม่มีภาษี', 50000, false) === 0 && C.calcTax('ภ.ง.ด.53', 0, false) === 0, 'ไม่มีภาษี = 0');
  var parity = true;
  ['ภ.ง.ด.53', 'ภ.ง.ด.3', 'ไม่มีภาษี'].forEach(function (tt) {
    [0.5, 99, 9999.99, 10000, 10700, 10700.01, 123456.78, 9351, 5766.45].forEach(function (g) {
      [true, false].forEach(function (v) { if (C.calcTax(tt, g, v) !== Paste.calcTax(tt, g, v)) parity = false; });
    });
  });
  ok(parity, 'calcTax ใน Util.gs = paste.js ทุกกรณีที่ทดสอบ');
  ok(C.resolveTypeAlias(C.SEED_TYPES.map(function (x) { return [x[0], x[1], '', '', 'ใช่']; }), C.ALIAS_SEED, 'อน.รห.') === 'T20', 'ชื่อย่อ อน.รห. -> เงินอุดหนุนรายหัว');

  console.log('11) ทะเบียนผู้รับเงิน + คิดภาษีอัตโนมัติ');
  var regRows = [['บจก.ตัวอย่างวัสดุ', 'ภ.ง.ด.53', 'ใช่', 'เช็ค', 'อน.รห.'], ['นายตัวอย่าง รับจ้าง', 'ภ.ง.ด.3', 'ไม่', 'KTB', ''], ['ร้านไม่มีภาษี', 'ไม่มีภาษี', 'ไม่', 'เช็ค', '']];
  r = call(io, 'tok-sup', 'savePayees', { rows: regRows });
  ok(r.ok && r.data.saved >= 3, 'พัสดุบันทึกทะเบียนผู้รับได้ ' + (r.ok ? '' : r.error));
  ok(/ภาษี "ภงด53"/.test(call(io, 'tok-sup', 'savePayees', { rows: [['x', 'ภงด53', '', '', '']] }).error), 'ประเภทภาษีผิดถูกปฏิเสธ');
  var L1 = function (name, gross, extra) { var o = { type: 'T20', payee: name, kind: 'พัสดุ', method: 'เช็ค', gross: gross, tax: '', taxType: 'ไม่มีภาษี', taxAuto: true }; for (var k in extra || {}) o[k] = extra[k]; return o; };
  r = call(io, 'tok-sup', 'saveKhb', { date: '12/11/69', lines: [L1('บจก.ตัวอย่างวัสดุ', 9351), L1('นายตัวอย่าง รับจ้าง', 9999.99), L1('นายตัวอย่าง รับจ้าง', 12000), L1('ร้านไม่มีภาษี', 20000), L1('ร้านใหม่ ไม่เคยมี', 500, { taxAuto: false, tax: '5', taxType: 'ภ.ง.ด.3' })] });
  ok(r.ok, 'บันทึก ขบ. ที่คิดภาษีอัตโนมัติ ' + (r.ok ? '' : r.error));
  var kd = call(io, 'tok-boss', 'getDocs').data.khbs[0];
  ok(kd.lines[0].tax === 87.39 && kd.lines[0].taxType === 'ภ.ง.ด.53', 'ภ.ง.ด.53 + VAT: 9,351 → ภาษี 87.39');
  ok(kd.lines[1].tax === 0 && kd.lines[2].tax === 120 && kd.lines[2].taxType === 'ภ.ง.ด.3', 'ภ.ง.ด.3: 9,999.99 ไม่หัก · 12,000 หัก 120');
  ok(kd.lines[3].tax === 0 && kd.lines[3].taxType === 'ไม่มีภาษี', 'ไม่มีภาษี = 0');
  var learned = call(io, 'tok-admin', 'getSettings').data.payees.filter(function (x) { return x[0] === 'ร้านใหม่ ไม่เคยมี'; })[0];
  ok(learned && learned[1] === 'ภ.ง.ด.3' && learned[3] === 'เช็ค', 'ผู้รับใหม่ถูกจำไว้ในทะเบียนอัตโนมัติ');

  console.log('12) วางจาก Excel — ขบ. (ตามแบบไฟล์เดิม)');
  var ctxP = { types: call(io, 'tok-admin', 'getSettings').data.types, aliases: call(io, 'tok-admin', 'getSettings').data.aliases, payees: {} };
  call(io, 'tok-admin', 'getSettings').data.payees.forEach(function (p) { ctxP.payees[Paste.nk(p[0])] = { taxType: p[1], vat: p[2] === 'ใช่', method: p[3], type: p[4] }; });
  var tsv = '1\tอน.รห\tบจก.ตัวอย่างวัสดุ\t\t\t9263.61\t87.39\t9351\n2\tรายได้ศูนย์กีฬา\tบจก.ผู้รับใหม่\t\t\t2174.49\t20.51\t2195\n3\tบกศ. จ/2\tนางสาวทดสอบ ตัวอย่าง\t\t\t11000\t0\t11000\n\t\t\t\t\t13138.1\t107.9\t13246\n(หนึ่งหมื่นสามพันบาท)\t\t\t\t\t\t\t';
  var pr = Paste.khbRows(Paste.parseTSV(tsv), ctxP);
  ok(pr.lines.length === 3 && pr.skipped === 2, 'วางแบบ ขบ. เดิม: 3 รายการ ข้ามแถวรวม/ตัวอักษร ' + pr.lines.length + '/' + pr.skipped);
  ok(pr.lines[0].type === 'T20' && pr.lines[0].gross === '9351' && pr.lines[0].tax === '87.39' && pr.lines[0].taxAuto, 'อน.รห → T08 · ยอดรวม 9,351 · ภาษีคิดตามทะเบียน (ผู้รับจด VAT)');
  ok(pr.lines[1].type === 'T01' && pr.lines[1].tax === '20.51' && /ผู้รับใหม่/.test(pr.lines[1].warn), 'ผู้รับใหม่ใช้ภาษีที่วางมา + เตือนให้ตรวจ');
  ok(pr.lines[2].type === 'T18' && pr.lines[2].gross === '11000', 'บกศ. จ/2 → T06');
  var head = 'ประเภทเงิน\tผู้รับ\tชนิด\tวิธีจ่าย\tยอดรวม\nอน.กพร.\tนายตัวอย่าง รับจ้าง\tเบิก\tKTB\t12,000.00\nรหัสไม่มี\tร้านอะไรสักอย่าง\t\t\t300';
  pr = Paste.khbRows(Paste.parseTSV(head), ctxP);
  ok(pr.header && pr.lines[0].type === 'T21' && pr.lines[0].tax === '120' && pr.lines[0].taxType === 'ภ.ง.ด.3' && pr.lines[0].method === 'KTB', 'วางแบบมีหัวตาราง: ภ.ง.ด.3 ยอด 12,000 → ภาษี 120');
  ok(pr.lines[1].bad.indexOf('type') >= 0, 'ประเภทเงินที่ไม่รู้จัก ถูกทำเครื่องหมายให้เลือก');
  ok(Paste.parseTSV('"ก\nข"\tค\nง\tจ').length === 2, 'อ่านช่องที่มีขึ้นบรรทัดใหม่ในเครื่องหมายคำพูด');
  var pay = Paste.payeeRows(Paste.parseTSV('บจก.ก\tภ.ง.ด.53\tเช็ค\tอน.รห.\nนายข\tภ.ง.ด.3\tKTB\nร้านค\tไม่มีภาษี'), ctxP);
  ok(pay.length === 3 && pay[0][1] === 'ภ.ง.ด.53' && pay[0][3] === 'เช็ค' && pay[0][4] === 'T20' && pay[1][1] === 'ภ.ง.ด.3' && pay[2][1] === 'ไม่มีภาษี', 'วางทะเบียนผู้รับเงิน (ภาษี/วิธีจ่าย/ประเภทเงิน อยู่ช่องไหนก็ได้)');

  console.log('13) ใบเสร็จ (รายรับ) — วางจาก Excel กันซ้ำ และ Ledger');
  var g0 = grandOf(io, '2027-09-30').grand;
  var rc = [{ date: '1/11/69', book: '18655', no: '833', type: 'อน.รห.', method: 'สด', amount: '600.00', payer: 'นักเรียนก' },
    { date: '1 พ.ย. 69', book: '18655', no: '833', type: 'ก/20', method: 'โอน', amount: '1,200', payer: 'นักเรียนก' },
    { date: '2/11/69', book: '18655', no: '834', type: 'รายได้ศูนย์กีฬา', method: 'โอน', amount: 225, payer: '' },
    { date: '2/11/69', book: '18655', no: '835', type: 'ประเภทที่ไม่มี', method: 'สด', amount: 10 },
    { date: '2/11/69', book: '', no: '836', type: 'ก/20', method: 'สด', amount: 10 },
    { date: '30/9/69', book: '1', no: '1', type: 'ก/20', method: 'สด', amount: 10 },
    { date: '2/11/69', book: '18655', no: '837', type: 'ก/20', method: 'ผ่อน', amount: 10 },
    { date: '2/11/69', book: '18655', no: '838', type: 'ก/20', method: 'สด', amount: 0 },
    { date: '2/11/69', book: '18655', no: '834', line: 1, type: 'ก/20', method: 'สด', amount: 5 }];
  r = call(io, 'tok-fin', 'importReceipts', { items: rc });
  ok(r.ok && !r.data.committed && r.data.count.new === 3 && r.data.count.error === 6, 'ดูตัวอย่าง: ใหม่ 3 · ผิด 6 ' + (r.ok ? JSON.stringify(r.data.count) : r.error));
  var msgs = r.data.rows.map(function (x) { return x.msg; }).join(' | ');
  ok(/T?ประเภทที่ไม่มี/.test(msgs) && /เล่มที่/.test(msgs) && /นอกปีงบ/.test(msgs) && /สด หรือ โอน/.test(msgs) && /มากกว่า 0/.test(msgs) && /ซ้ำกับแถวที่ 3/.test(msgs), 'แต่ละแถวที่ผิดบอกเหตุผล');
  ok(grandOf(io, '2027-09-30').grand === g0, 'ดูตัวอย่างยังไม่บันทึก ยอดไม่เปลี่ยน');
  var good3 = rc.slice(0, 3);
  r = call(io, 'tok-fin', 'importReceipts', { items: good3, commit: true });
  ok(r.ok && r.data.added === 3, 'บันทึก 3 แถวที่ผ่าน ' + (r.ok ? '' : r.error));
  var gr = grandOf(io, '2027-09-30');
  ok(sat(gr.grand) - sat(g0) === sat(600 + 1200 + 225) && gr.receivedIn === 2025, 'ยอดคงเหลือเพิ่ม 2,025 ตรงยอดรับ');
  var s1 = grandOf(io, '2026-11-01'); var t08 = s1.types.map(function (x) { return x.id; }).indexOf('T20');
  ok(s1.cells[t08][s1.stores.map(function (s) { return s.id; }).indexOf('S01')] - grandOf(io, '2026-10-31').cells[t08][s1.stores.map(function (s) { return s.id; }).indexOf('S01')] === 600, 'รับเงินสด เข้าที่เก็บเงินสด');
  var t05 = s1.types.map(function (x) { return x.id; }).indexOf('T10');
  ok(s1.cells[t05][s1.stores.map(function (s) { return s.id; }).indexOf('S04')] - grandOf(io, '2026-10-31').cells[t05][s1.stores.map(function (s) { return s.id; }).indexOf('S04')] === 1200, 'รับเงินโอน เข้าที่เก็บหลักของประเภทเงิน (S04)');
  r = call(io, 'tok-fin', 'importReceipts', { items: good3, commit: true });
  ok(!r.ok && /ไม่มีแถวที่บันทึกได้/.test(r.error), 'วางซ้ำครั้งที่ 2: ไม่เพิ่ม');
  r = call(io, 'tok-fin', 'importReceipts', { items: good3 });
  ok(r.data.count.same === 3 && r.data.count.new === 0, 'วางซ้ำ: ซ้ำ 3 แถว ข้ามทั้งหมด');
  var chg = [{ date: '1/11/69', book: '18655', no: '833', line: 1, type: 'อน.รห.', method: 'สด', amount: '650', payer: 'นักเรียนก' }];
  r = call(io, 'tok-fin', 'importReceipts', { items: chg });
  ok(r.data.count.changed === 1 && /600\.00 → 650\.00/.test(r.data.rows[0].msg), 'ยอดเปลี่ยน: แสดงว่าเปลี่ยนอะไร');
  ok(!call(io, 'tok-fin', 'importReceipts', { items: chg, commit: true }).ok && sat(grandOf(io, '2027-09-30').grand) === sat(gr.grand), 'ไม่เลือกอัปเดต → ไม่แก้ของเดิม');
  r = call(io, 'tok-fin', 'importReceipts', { items: chg, commit: true, updateChanged: true });
  ok(r.ok && r.data.updated === 1 && sat(grandOf(io, '2027-09-30').grand) === sat(gr.grand) + 5000, 'เลือกอัปเดต → ยอดเปลี่ยนเป็น 650');
  var wide = 'วันที่\tเดือน\tเล่มที่\tเลขที่\tรวม\tก/20 บัตรประจำตัว\tรายได้ SMS\tเงินอุดหนุนรายหัว\n1 พ.ย. 69\tพฤศจิกายน\t18700\t1\t825\t300\t225\t\n3 พ.ย. 69\tพฤศจิกายน\t18700\t2\t100\t\t\t100\n1 ต.ค. 69\tตุลาคม\tยอดยกมา\t\t9999\t1\t2\t3';
  var wr = Paste.receiptRows(Paste.parseTSV(wide), { types: ctxP.types, aliases: ctxP.aliases, defaultMethod: 'โอน' });
  ok(wr.wide && wr.items.length === 3 && wr.skipped === 1, 'ไฟล์ใบเสร็จแบบกว้างตามไฟล์เดิม แตกเป็นรายบรรทัด 3 รายการ');
  r = call(io, 'tok-fin', 'importReceipts', { items: wr.items, commit: true });
  ok(r.ok && r.data.added === 3 && grandOf(io, '2027-09-30').receivedIn === 2700, 'บันทึกแบบกว้างได้ ยอดรับรวม 2,700 (' + (r.ok ? '' : r.error) + ')');
  var rs = call(io, 'tok-boss', 'getReceipts').data;
  ok(rs.rows.length === 6 && rs.rows[0].length === 10, 'getReceipts ส่งรายการให้ผู้บริหารดู');
  ok(call(io, 'tok-boss', 'importReceipts', { items: good3 }).code === 'FORBIDDEN' && call(io, 'tok-sup', 'importReceipts', { items: good3 }).code === 'FORBIDDEN', 'เฉพาะการเงินนำเข้าใบเสร็จ');
  var beforeC = sat(grandOf(io, '2027-09-30').grand);
  r = call(io, 'tok-fin', 'cancelReceipt', { book: '18655', no: '834', reason: 'ออกผิด' });
  ok(r.ok && sat(grandOf(io, '2027-09-30').grand) === beforeC - 22500, 'ยกเลิกใบเสร็จ ยอดคืน');
  ok(/ถูกยกเลิกไปแล้ว/.test(call(io, 'tok-fin', 'importReceipts', { items: [{ date: '2/11/69', book: '18655', no: '834', line: 1, type: 'รายได้ศูนย์กีฬา', method: 'โอน', amount: 225 }] }).data.rows[0].msg), 'วางใบเสร็จที่ยกเลิกแล้ว ไม่ซ้อนกลับ');
  io.sheets['ปิดวัน'].push(['2026-11-03', 'fin@example.com', 'x', '', '']);
  ok(call(io, 'tok-fin', 'importReceipts', { items: [{ date: '3/11/69', book: '18700', no: '9', type: 'ก/20', method: 'สด', amount: 50 }], commit: true }).code === 'CLOSED', 'วันที่ปิดแล้วนำเข้าใบเสร็จไม่ได้');
  var tt2 = call(io, 'tok-admin', 'getSettings').data.types.filter(function (x) { return x[0] !== 'T10'; });
  ok(/T10/.test(call(io, 'tok-admin', 'saveTypes', { rows: tt2 }).error), 'ลบประเภทเงินที่ใช้ในใบเสร็จไม่ได้');
  ok(call(io, 'tok-admin', 'saveAliases', { rows: [['อน.รห.', 'T20'], ['ทดสอบ', 'T99']] }).error.indexOf('T99') > 0, 'ชื่อย่อชี้ประเภทเงินที่ไม่มี ถูกปฏิเสธ');

  console.log('14) ขั้นอนุมัติ: ครู → ผู้บริหาร → การเงินรับเรื่อง → ขจ.');
  var io3 = makeMemIO(), TL = [{ type: 'T20', payee: 'ร้านตัวอย่างเครื่องเขียน', kind: 'พัสดุ', method: 'เช็ค', gross: 1500, tax: '' }];
  r = call(io3, 'tok-t1', 'saveKhb', { date: '2/11/69', note: 'ซื้อวัสดุวิชาคณิต', lines: TL });
  ok(r.ok && r.data.no === 1 && r.data.flow === 'รออนุมัติ', 'ครูส่ง ขบ. ได้ สถานะ รออนุมัติ');
  call(io3, 'tok-t2', 'saveKhb', { date: '2/11/69', lines: TL });
  var t1d = call(io3, 'tok-t1', 'getDocs').data;
  ok(t1d.khbs.length === 1 && t1d.khbs[0].owner === 't1@example.com', 'ครูเห็นเฉพาะ ขบ. ของตัวเอง');
  ok(t1d.names['t1@example.com'] === 'ครูตัวอย่าง หนึ่ง', 'ส่งชื่อผู้ขอไปแสดง');
  ok(call(io3, 'tok-t1', 'khbDoc', { no: 2 }).code === 'FORBIDDEN', 'ครูเปิด ขบ. ของคนอื่นไม่ได้');
  ok(call(io3, 'tok-t1', 'getReceipts').code === 'FORBIDDEN' && call(io3, 'tok-t1', 'getBalances', { date: R.start }).code === 'FORBIDDEN', 'ครูดูรายรับ/ยอดเงินโรงเรียนไม่ได้');
  ok(call(io3, 'tok-t1', 'approveKhb', { nos: [1], decision: 'อนุมัติ' }).code === 'FORBIDDEN' && call(io3, 'tok-fin', 'approveKhb', { nos: [1], decision: 'อนุมัติ' }).code === 'FORBIDDEN', 'ครูและการเงินอนุมัติแทนผู้บริหารไม่ได้');
  ok(call(io3, 'tok-t2', 'cancelKhb', { no: 1, reason: 'x' }).code === 'FORBIDDEN', 'ครูยกเลิก ขบ. ของคนอื่นไม่ได้');
  ok(/ระบุเหตุผล/.test(call(io3, 'tok-boss', 'approveKhb', { nos: [1], decision: 'ส่งกลับ' }).error), 'ส่งกลับต้องมีเหตุผล');
  ok(/รับเรื่องไม่ได้/.test(call(io3, 'tok-fin', 'receiveKhb', { nos: [1] }).error), 'ยังไม่อนุมัติ การเงินรับเรื่องไม่ได้');
  ok(call(io3, 'tok-boss', 'approveKhb', { nos: [1], decision: 'ส่งกลับ', note: 'แนบใบเสนอราคา 3 ร้าน' }).ok, 'ผู้บริหารส่งกลับพร้อมเหตุผล');
  var k3 = call(io3, 'tok-t1', 'getDocs').data.khbs[0];
  ok(k3.flow === 'ส่งกลับแก้ไข' && k3.steps[1].note === 'แนบใบเสนอราคา 3 ร้าน' && k3.steps[1].by === 'boss@example.com', 'ครูเห็นว่าถูกส่งกลับและเหตุผล');
  r = call(io3, 'tok-t1', 'saveKhb', { no: 1, date: '3/11/69', note: 'แนบใบเสนอราคาแล้ว', lines: TL });
  ok(r.ok && call(io3, 'tok-boss', 'getDocs').data.khbs.filter(function (h) { return h.no === 1; })[0].flow === 'รออนุมัติ', 'ครูแก้แล้วส่งใหม่ กลับไปรออนุมัติ');
  ok(/ถูกเลือกซ้ำ/.test(call(io3, 'tok-boss', 'approveKhb', { nos: [1, 1], decision: 'อนุมัติ' }).error), 'เลือก ขบ. ซ้ำในการอนุมัติไม่ได้');
  ok(call(io3, 'tok-boss', 'approveKhb', { nos: [1, 2], decision: 'อนุมัติ' }).ok, 'ผู้บริหารอนุมัติหลายใบพร้อมกัน');
  ok(/อนุมัติไม่ได้/.test(call(io3, 'tok-boss', 'approveKhb', { nos: [1], decision: 'อนุมัติ' }).error), 'อนุมัติซ้ำไม่ได้');
  ok(/ขั้น "อนุมัติแล้ว" แก้ไขไม่ได้/.test(call(io3, 'tok-t1', 'saveKhb', { no: 1, date: '3/11/69', lines: TL }).error), 'ครูแก้ ขบ. ที่อนุมัติแล้วไม่ได้');
  ok(call(io3, 'tok-fin', 'receiveKhb', { nos: [1] }).ok, 'การเงินกดรับเรื่อง');
  r = call(io3, 'tok-fin', 'createKhj', { date: '4/11/69', items: [{ fy: FY, no: 1, seq: 1 }] });
  ok(r.ok && r.data.no === 1, 'รับเรื่องแล้วทำ ขจ. ต่อได้ ' + (r.ok ? '' : r.error));
  var t1j = call(io3, 'tok-t1', 'getDocs').data;
  ok(t1j.khjs.length === 1 && t1j.khbs[0].lines[0].khjNo === 1, 'ครูเห็นว่ารายการของตัวเองอยู่ใน ขจ.1 แล้ว');
  ok(call(io3, 'tok-t2', 'getDocs').data.khjs.length === 0, 'ครูอีกคนไม่เห็น ขจ. ที่ไม่มีรายการของตัวเอง');
  ok(call(io3, 'tok-t1', 'saveKhb', { date: '5/11/69', lines: TL, paper: true }).code === 'FORBIDDEN', 'ครูข้ามขั้นอนุมัติไม่ได้');
  r = call(io3, 'tok-fin', 'saveKhb', { date: '5/11/69', lines: TL, paper: true });
  ok(r.ok && r.data.flow === 'รับเรื่องแล้ว', 'การเงินบันทึกย้อนหลัง "อนุมัติบนกระดาษแล้ว" พร้อมทำ ขจ.');
  r = call(io3, 'tok-fin', 'saveKhb', { no: r.data.no, date: '5/11/69', lines: TL });
  ok(r.ok && r.data.flow === 'รออนุมัติ', 'แก้ ขบ. ที่อนุมัติแล้ว ต้องกลับไปขออนุมัติใหม่');
  io3.sheets['ขบ'].push([FY, 9, '2026-11-06', 'ข้อมูลเก่า', 'fin@example.com', '', 'ปกติ']);
  io3.sheets['ขบ_รายการ'].push([FY, 9, 1, 'T20', 'ร้านเก่า', 'พัสดุ', 'เช็ค', 100, 0, 'ไม่มีภาษี']);
  ok(call(io3, 'tok-fin', 'getDocs').data.khbs.filter(function (h) { return h.no === 9; })[0].flow === 'รับเรื่องแล้ว', 'ขบ. เก่าที่ไม่มีขั้นตอน ถือว่ารับเรื่องแล้ว');
  io3.sheets['ขบ_ขั้นตอน'].push([FY, 9, 'อนุมัติแล้ว', 'x', '', '']);
  ok(/ขั้น "อนุมัติแล้ว" ต้องเป็น/.test(call(io3, 'tok-fin', 'getDocs').error), 'ขั้นตอนพิมพ์ผิดในชีท -> error ชัดเจน');

  console.log('11) บัญชีแยกประเภท (getLedger)');
  var lg = call(io, 'tok-boss', 'getLedger');
  ok(lg.ok && lg.data.rows.length > 0 && lg.data.rows[0].length === 6, 'getLedger ส่งแถวบัญชีให้ผู้บริหารดูได้');
  var sumL = 0; lg.data.rows.forEach(function (r) { sumL += Math.round(r[5] * 100); });
  ok(sumL === Math.round(grandOf(io, '2027-09-30').grand * 100), 'ผลรวม Ledger = ยอดคงเหลือรวมสิ้นปีงบ');
  ok(lg.data.rows.every(function (r, i, a) { return !i || a[i - 1][0] <= r[0]; }), 'เรียงตามวันที่');

  console.log('12) แพ็กเกจรับเงิน');
  var pkOk = [{ total: '525', items: [{ type: 'T03', amount: '225' }, { type: 'T17', amount: '300' }] }, { total: '525', items: [{ type: 'T03', amount: '225' }, { type: 'T17', amount: '300' }] }, { total: 600, name: 'คนละรายการ', items: [{ type: 'T17', amount: 300 }, { type: 'T15', amount: 300 }] }];
  r = call(io, 'tok-fin', 'savePackages', { rows: pkOk });
  ok(r.ok && r.data.saved === 2, 'บันทึกแพ็กเกจได้ (ซ้ำทุกอย่างรวมเป็นอันเดียว) ' + (r.ok ? '' : r.error));
  r = call(io, 'tok-fin', 'getSettings');
  ok(r.ok && r.data.packages.length === 2 && r.data.packages[0][0] === 525 && r.data.packages[0][2].length === 2 && r.data.packages[1][1] === 'คนละรายการ', 'getSettings ส่งแพ็กเกจกลับ เรียงตามยอด');
  ok(/ไม่เท่ายอดรวม/.test(call(io, 'tok-fin', 'savePackages', { rows: [{ total: 500, items: [{ type: 'T03', amount: 225 }] }] }).error), 'ผลรวมรายการไม่เท่ายอดรวม -> ปฏิเสธ');
  ok(/ไม่ตรงกับชีทตั้งค่า/.test(call(io, 'tok-fin', 'savePackages', { rows: [{ total: 10, items: [{ type: 'ZZZ', amount: 10 }] }] }).error), 'ประเภทเงินที่ไม่รู้จัก -> ปฏิเสธ');
  ok(!call(io, 'tok-boss', 'savePackages', { rows: pkOk }).ok, 'ผู้บริหารแก้แพ็กเกจไม่ได้');
  var io4 = makeMemIO(); delete io4.sheets['แพ็กเกจรับเงิน'];
  ok(call(io4, 'tok-fin', 'getSettings').ok && call(io4, 'tok-fin', 'getSettings').data.packages.length === 0, 'ยังไม่มีชีทแพ็กเกจ (ติดตั้งเก่า) -> คืนรายการว่าง ไม่ error');

  console.log('13) ใบเสร็จยกเลิกทั้งใบ (ไม่เคยมียอด)');
  r = call(io, 'tok-fin', 'voidReceipts', { items: [{ date: '2026-10-17', book: 'V1', no: '835', reason: 'เขียนผิด' }] });
  ok(r.ok && r.data.added === 1, 'บันทึกใบยกเลิกได้ ' + (r.ok ? '' : r.error));
  ok(/มีในระบบแล้ว/.test(call(io, 'tok-fin', 'voidReceipts', { items: [{ date: '2026-10-17', book: 'V1', no: '835' }] }).error), 'เลขที่ซ้ำ -> ปฏิเสธ');
  var rc = call(io, 'tok-fin', 'getReceipts').data.rows.filter(function (x) { return x[0] === 'V1' && x[1] === '835'; })[0];
  ok(rc && rc[8] === 1 && rc[7] === 0, 'getReceipts เห็นใบยกเลิกยอด 0');
  var gb0 = grandOf(io, '2027-09-30').grand; call(io, 'tok-admin', 'rebuildLedger');
  ok(Math.abs(grandOf(io, '2027-09-30').grand - gb0) < 0.005, 'ใบยกเลิกไม่กระทบยอดคงเหลือ');
  ok(!call(io, 'tok-boss', 'voidReceipts', { items: [{ date: '2026-10-17', book: 'V2', no: '1' }] }).ok, 'ผู้บริหารบันทึกใบยกเลิกไม่ได้');

  console.log('14) boot (โหลดครั้งเดียวตอนเข้าระบบ)');
  r = call(io, 'tok-fin', 'boot', { date: '2026-10-26' });
  ok(r.ok && r.data.me.role === 'การเงิน' && r.data.schema && r.data.settings.types.length && r.data.docs.khbs && r.data.receipts.rows && r.data.balances && r.data.balances.grand !== undefined, 'boot ส่ง me/schema/settings/docs/receipts/balances ในคำขอเดียว ' + (r.ok ? '' : r.error));
  ok(Math.abs(r.data.balances.grand - grandOf(io, '2026-10-26').grand) < 0.005, 'ยอดคงเหลือใน boot = getBalances');
  r = call(io, 'tok-fin', 'boot', { date: '2030-01-01' });
  ok(r.ok && r.data.balances === null, 'วันที่นอกปีงบ -> balances เป็น null (ไม่ล้มทั้ง boot)');
  r = call(io, 'tok-t1', 'boot', {});
  ok(r.ok && !r.data.receipts && !r.data.balances && r.data.me.role === 'ครู', 'ครูได้ boot แบบไม่มีใบเสร็จ/ยอดคงเหลือ');
  ok(!call(io, 'tok-nobody', 'boot', {}).ok, 'ไม่มีสิทธิ์ -> boot ถูกปฏิเสธ');

  var dO = [['a', 1], ['b', 2]], d1 = C.diffRows(dO, [['a', 1], ['b', 2], ['c', 3]], 2);
  ok(d1.start === 2 && d1.rows.length === 1 && d1.clear === 0, 'diffRows: ต่อท้าย -> เขียนแถวใหม่แถวเดียว');
  var d2 = C.diffRows(dO, [['a', '1'], ['B', 2]], 2);
  ok(d2.start === 1 && d2.rows.length === 1, 'diffRows: 1 กับ "1" ถือว่าเท่ากัน · แก้แถวท้าย -> เขียนแถวเดียว');
  var d3 = C.diffRows(dO, [['a', 1]], 2);
  ok(d3.start === 1 && d3.rows.length === 0 && d3.clear === 1, 'diffRows: แถวหายไป -> ล้างแถวท้าย');
  var d4 = C.diffRows(dO, dO.map(function (r) { return r.concat(['x']); }), 2);
  ok(d4.rows.length === 0 && d4.clear === 0, 'diffRows: ไม่เปลี่ยน -> ไม่เขียนเลย (ไม่สนคอลัมน์เกินหัว)');
  ok(Paste.num('1,234.50 บาท') === 1234.5 && Paste.num('') === 0 && Paste.num('-') === 0 && isNaN(Paste.num('12O')) && Paste.num(7) === 7, 'Paste.num: ตัดคอมมา/บาท · ว่าง=0 · อ่านไม่ออก=NaN');
  var acts = C.actions(), bad = Object.keys(acts).filter(function (a) { var x = acts[a]; return typeof x[0] !== 'function' || !Array.isArray(x[1]) || typeof x[2] !== 'boolean'; });
  ok(!bad.length, 'ทะเบียน action: ทุกแถวมีฟังก์ชัน/บทบาท/ชนิดอ่านเขียนครบ ' + bad.join(','));
  ok(C.isWriteAction('saveKhb') && !C.isWriteAction('getDocs') && !C.isWriteAction('ping'), 'isWriteAction อ่านจากทะเบียนเดียวกัน');

  if (process.env.SHEETIO) console.log('เซลล์ที่เขียนลงชีทจำลองทั้งชุดเทสต์: ' + fakeSpreadsheet.cells);
  console.log('\nผ่าน ' + passed + ' / ' + (passed + failed));
  if (failed) { console.log('มี ' + failed + ' ข้อไม่ผ่าน'); process.exit(1); }
  console.log('ทุกข้อผ่าน');
}

module.exports = { C: C, makeMemIO: makeMemIO, call: call };
