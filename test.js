// รัน: node test.js   (ข้อมูลทั้งหมดในไฟล์นี้เป็นข้อมูลจำลอง)
var C = require('./Code.gs');

var passed = 0, failed = 0;
function ok(cond, name) {
  if (cond) { passed++; console.log('  ผ่าน  ' + name); }
  else { failed++; console.log('  ไม่ผ่าน  ' + name); }
}
function sat(x) { return Math.round(x * 100); }

/* ---------- ชีทจำลองในหน่วยความจำ ---------- */
function makeMemIO() {
  var sheets = {};
  Object.keys(C.SCHEMA).forEach(function (n) { sheets[n] = [C.SCHEMA[n].slice()]; });
  sheets['ผู้ใช้'].push(['admin@example.com', 'แอดมิน', 'admin', 'ใช่']);
  sheets['ผู้ใช้'].push(['fin@example.com', 'การเงิน', 'การเงิน', 'ใช่']);
  sheets['ผู้ใช้'].push(['boss@example.com', 'ผอ.', 'ผู้บริหาร', 'ใช่']);
  sheets['ผู้ใช้'].push(['off@example.com', 'ปิดแล้ว', 'การเงิน', 'ไม่']);
  C.SEED_STORES.forEach(function (s) { sheets['ที่เก็บเงิน'].push(s.slice()); });
  C.SEED_TYPES.forEach(function (t) { sheets['ประเภทเงิน'].push([t[0], t[1], C.SEED_GROUPS[t[2]], t[3], 'ใช่']); });
  var tokens = {
    'tok-admin': 'admin@example.com', 'tok-fin': 'fin@example.com', 'tok-boss': 'boss@example.com',
    'tok-off': 'off@example.com', 'tok-stranger': 'stranger@example.com'
  };
  return {
    sheets: sheets,
    verifyToken: function (t) {
      if (!tokens[t]) throw C.fail('AUTH', 'token ไม่ถูกต้อง');
      return tokens[t];
    },
    values: function (n) {
      if (!sheets[n]) return null;
      return sheets[n].map(function (r) { return r.slice(); });
    },
    write: function (n, rows) {
      sheets[n] = [sheets[n][0]].concat(rows.map(function (r) { return r.slice(); }));
    }
  };
}

function call(io, token, action, payload) {
  return C.dispatch({ action: action, idToken: token, payload: payload || {} }, io);
}

if (require.main === module) {
  var FY = C.FISCAL_YEAR;
  var R = C.fiscalRange(FY);

  console.log('1) วันที่ / จำนวนเงิน / token');
  ok(C.fiscalRange(2570).start === '2026-10-01' && C.fiscalRange(2570).end === '2027-09-30', 'ช่วงปีงบ 2570');
  ok(C.parseDate('1/10/2569') === '2026-10-01', 'วันที่ 1/10/2569');
  ok(C.parseDate('1/10/69') === '2026-10-01', 'วันที่ 1/10/69');
  ok(C.parseDate('2026-10-01') === '2026-10-01', 'วันที่ ISO');
  ok(C.parseDate(new Date(2026, 9, 1)) === '2026-10-01', 'วันที่แบบ Date');
  var serial = (Date.UTC(2026, 9, 1) - Date.UTC(1899, 11, 30)) / 86400000;
  ok(C.parseDate(serial) === '2026-10-01', 'วันที่แบบเลข Excel');
  var threw = false; try { C.parseDate('31/2/2569'); } catch (e) { threw = true; }
  ok(threw, 'วันที่ที่ไม่มีจริงต้อง error');
  ok(C.inFiscalYear('2026-10-01', FY) && !C.inFiscalYear('2026-09-30', FY), 'วันที่ต้องอยู่ในปีงบ');
  ok(C.parseAmount('1,234.50 บาท') === 1234.5, 'จำนวนเงินตัด , และ บาท');
  threw = false; try { C.parseAmount('0'); } catch (e) { threw = true; }
  ok(threw, 'จำนวนเงิน 0 ต้อง error');
  threw = false; try { C.parseAmount('abc'); } catch (e) { threw = true; }
  ok(threw, 'จำนวนเงินอ่านไม่ได้ต้อง error');
  var good = { aud: 'cid', exp: 2000, iss: 'accounts.google.com', email: 'A@x.com', email_verified: 'true' };
  ok(C.validateClaims(good, 'cid', 1000) === 'a@x.com', 'claims ถูกต้อง');
  threw = false; try { C.validateClaims(good, 'other', 1000); } catch (e) { threw = e.code === 'AUTH'; }
  ok(threw, 'aud ไม่ตรงถูกปฏิเสธ');
  threw = false; try { C.validateClaims(good, 'cid', 3000); } catch (e) { threw = e.code === 'AUTH'; }
  ok(threw, 'token หมดอายุถูกปฏิเสธ');

  console.log('2) สิทธิ์ (เกณฑ์ข้อ 3)');
  var io = makeMemIO();
  ok(call(io, null, 'ping').ok === true, 'ping ไม่ต้องมี token');
  var r = call(io, '', 'getBalances', { date: R.start });
  ok(!r.ok && r.code === 'AUTH', 'ไม่มี token ถูกปฏิเสธ');
  r = call(io, 'tok-stranger', 'getBalances', { date: R.start });
  ok(!r.ok && r.code === 'AUTH', 'อีเมลไม่อยู่ในชีท ผู้ใช้ ถูกปฏิเสธ');
  r = call(io, 'tok-off', 'getBalances', { date: R.start });
  ok(!r.ok && r.code === 'AUTH', 'ผู้ใช้ที่ปิดใช้งานถูกปฏิเสธ');
  r = call(io, 'tok-bad', 'getSchema');
  ok(!r.ok && r.code === 'AUTH', 'token ปลอมถูกปฏิเสธ');
  r = call(io, 'tok-boss', 'saveOpening', { rows: [] });
  ok(!r.ok && r.code === 'FORBIDDEN', 'ผู้บริหารแก้ยอดยกมาไม่ได้');
  r = call(io, 'tok-fin', 'saveTypes', { rows: [] });
  ok(!r.ok && r.code === 'FORBIDDEN', 'การเงินแก้ตั้งค่าไม่ได้');
  r = call(io, 'tok-boss', 'getBalances', { date: R.start });
  ok(r.ok, 'ผู้บริหารดูภาพรวมได้');
  r = call(io, 'tok-admin', 'getSchema');
  ok(r.ok && r.data.schema['Ledger'][5] === 'จำนวน +/-', 'getSchema ส่ง SCHEMA');

  console.log('3) ยอดยกมา -> Ledger -> ภาพรวม (เกณฑ์ข้อ 1 และกฎ 7)');
  var opening = [
    ['T01', 'S02', '95,618'], ['T02', 'S02', 369067], ['T03', 'S02', 358910],
    ['T04', 'S03', 93267.2], ['T05', 'S04', 108130], ['T06', 'S04', 1946874.55],
    ['T08', 'S06', 1433468], ['T09', 'S06', 868743], ['T13', 'S07', 223.1],
    ['T15', 'S08', 7330], ['T20', 'S08', 86685],
    ['เงินรายได้ อื่นๆ', 'เงินสด', '1,000.07 บาท'],          // อ้างด้วยชื่อ
    ['T08', 'S01', 500000.01], ['T05', 'S05', 12.34]
  ];
  r = call(io, 'tok-admin', 'saveOpening', { rows: opening });
  ok(r.ok && r.data.saved === opening.length, 'saveOpening บันทึกได้ ' + (r.ok ? '' : r.error));
  ok(io.sheets['Ledger'].length - 1 === opening.length, 'Ledger มีรายการเท่ายอดยกมา');
  var expected = 0;
  opening.forEach(function (o) { expected += sat(Number(String(o[2]).replace(/,|บาท/g, ''))); });

  var d = call(io, 'tok-admin', 'getBalances', { date: '2026-11-15' }).data;
  var cellSum = 0, rowOk = true, colOk = true;
  d.cells.forEach(function (row, i) {
    var rs = 0; row.forEach(function (v) { rs += sat(v); }); cellSum += rs;
    if (rs !== sat(d.rowTotals[i])) rowOk = false;
  });
  d.stores.forEach(function (s, j) {
    var cs = 0; d.cells.forEach(function (row) { cs += sat(row[j]); });
    if (cs !== sat(d.colTotals[j])) colOk = false;
  });
  ok(cellSum === expected, 'ผลรวมประเภท x ที่เก็บ = ยอดที่กรอก (' + cellSum + ' สตางค์)');
  ok(cellSum === sat(d.grand), 'ผลรวมประเภท x ที่เก็บ = KPI ยอดรวมหน้าภาพรวม');
  ok(rowOk && colOk, 'ผลรวมแถวและคอลัมน์ตรงกับตาราง');
  var t01 = d.types.map(function (t) { return t.id; }).indexOf('T01');
  var s02 = d.stores.map(function (s) { return s.id; }).indexOf('S02');
  ok(d.cells[t01][s02] === 95618, 'ค่าในช่อง T01 x S02 ถูกต้อง');
  var t03 = d.types.map(function (t) { return t.id; }).indexOf('T03');
  var s01 = d.stores.map(function (s) { return s.id; }).indexOf('S01');
  ok(d.cells[t03][s01] === 1000.07, 'อ้างประเภทเงินและที่เก็บด้วยชื่อได้');
  d = call(io, 'tok-admin', 'getBalances', { date: R.start }).data;
  ok(sat(d.grand) === expected, 'วันที่ 1 ต.ค. เห็นยอดยกมาครบ');
  r = call(io, 'tok-admin', 'getBalances', { date: '2026-09-30' });
  ok(!r.ok, 'วันที่นอกปีงบถูกปฏิเสธ');

  console.log('4) โอนระหว่างที่เก็บไม่นับเป็นรับหรือจ่าย (กฎ 4) และตัดตามวัน');
  io.sheets['Ledger'].push(['2026-12-01', 'โอน-1', 'โอนระหว่างที่เก็บ', 'T01', 'S02', -1000]);
  io.sheets['Ledger'].push(['2026-12-01', 'โอน-1', 'โอนระหว่างที่เก็บ', 'T01', 'S01', 1000]);
  var before = call(io, 'tok-admin', 'getBalances', { date: '2026-11-30' }).data;
  var after = call(io, 'tok-admin', 'getBalances', { date: '2026-12-01' }).data;
  ok(before.grand === after.grand, 'ยอดรวมไม่เปลี่ยนเมื่อโอน');
  ok(after.cells[t01][s01] === 1000 && before.cells[t01][s01] === 0, 'ยอดย้ายที่เก็บตามวันที่');
  io.sheets['Ledger'].pop(); io.sheets['Ledger'].pop();

  console.log('5) หัวคอลัมน์ผิดต้อง error ไม่ใช่ 0 (เกณฑ์ข้อ 2 / กฎ 3)');
  io.sheets['Ledger'][0][5] = 'จำนวน';
  r = call(io, 'tok-admin', 'getBalances', { date: R.start });
  ok(!r.ok && r.code === 'SCHEMA', 'หัวคอลัมน์ Ledger ผิด -> error');
  ok(/จำนวน \+\/-/.test(r.error) && /คอลัมน์ที่ 6/.test(r.error), 'ข้อความบอกคอลัมน์ที่ผิด: ' + r.error);
  io.sheets['Ledger'][0][5] = 'จำนวน +/-';
  var saveHeader = io.sheets['ยอดยกมา'][0][3];
  io.sheets['ยอดยกมา'][0][3] = 'ยอดเงิน';
  r = call(io, 'tok-admin', 'getSettings');
  ok(!r.ok && r.code === 'SCHEMA', 'หัวคอลัมน์ ยอดยกมา ผิด -> error');
  io.sheets['ยอดยกมา'][0][3] = saveHeader;
  io.sheets['ประเภทเงิน'][0][1] = '  ชื่อ  ';
  ok(call(io, 'tok-admin', 'getSettings').ok, 'หัวคอลัมน์มีช่องว่างเกิน ตัดแล้วผ่าน');
  io.sheets['ประเภทเงิน'][0][1] = 'ชื่อ';
  var tmp = io.sheets['Ledger'];
  delete io.sheets['Ledger'];
  r = call(io, 'tok-admin', 'getBalances', { date: R.start });
  ok(!r.ok && /ไม่พบชีท/.test(r.error), 'ไม่มีชีท Ledger -> error');
  io.sheets['Ledger'] = tmp;
  io.sheets['Ledger'].push(['2026-12-05', 'x', 'x', 'T99', 'S02', 10]);
  r = call(io, 'tok-admin', 'getBalances', { date: '2026-12-31' });
  ok(!r.ok && /T99/.test(r.error), 'Ledger อ้างประเภทเงินที่ไม่มี -> error');
  io.sheets['Ledger'].pop();

  console.log('6) กติกาข้อมูลและวันที่ปิด (กฎ 5)');
  r = call(io, 'tok-admin', 'saveOpening', { rows: [['T01', 'S02', 0]] });
  ok(!r.ok, 'ยอดยกมา 0 ถูกปฏิเสธ');
  r = call(io, 'tok-admin', 'saveOpening', { rows: [['T99', 'S02', 5]] });
  ok(!r.ok && /T99/.test(r.error), 'ประเภทเงินไม่ตรงชีทตั้งค่าถูกปฏิเสธ');
  r = call(io, 'tok-admin', 'saveOpening', { rows: [['T01', 'S02', 5], ['T01', 'S02', 6]] });
  ok(!r.ok && /ซ้ำ/.test(r.error), 'ประเภทเงิน x ที่เก็บ ซ้ำถูกปฏิเสธ');
  ok(io.sheets['Ledger'].length - 1 === opening.length, 'ข้อมูลเดิมไม่ถูกแก้เมื่อบันทึกไม่ผ่าน');
  io.sheets['ปิดวัน'].push([R.start, 'fin@example.com', '2026-10-01 17:00', '', '']);
  r = call(io, 'tok-admin', 'saveOpening', { rows: opening });
  ok(!r.ok && r.code === 'CLOSED', 'วันที่ปิดแล้วห้ามบันทึกย้อน');
  r = call(io, 'tok-admin', 'rebuildLedger');
  ok(!r.ok && r.code === 'CLOSED', 'วันที่ปิดแล้วห้ามสร้าง Ledger ใหม่');
  io.sheets['ปิดวัน'][1][3] = 'ปลดล็อก'; io.sheets['ปิดวัน'][1][4] = 'แก้ยอดยกมา';
  r = call(io, 'tok-admin', 'saveOpening', { rows: opening });
  ok(r.ok, 'ปลดล็อกพร้อมเหตุผลแล้วบันทึกได้');
  r = call(io, 'tok-admin', 'rebuildLedger');
  ok(r.ok && r.data.rows === opening.length, 'rebuildLedger สร้างใหม่ทั้งชีทจากยอดยกมา');
  io.sheets['Ledger'].push(['2026-12-05', 'มือแก้', 'x', 'T01', 'S02', 999]);
  call(io, 'tok-admin', 'rebuildLedger');
  ok(io.sheets['Ledger'].length - 1 === opening.length, 'rebuildLedger ล้างรายการที่แก้มือ');

  console.log('7) ตั้งค่า ประเภทเงิน / ที่เก็บเงิน');
  var st = call(io, 'tok-admin', 'getSettings').data;
  var types2 = st.types.map(function (t) { return t.slice(); });
  types2.push(['T22', 'บกศ. ก/1 ใหม่', 'เงินบำรุงการศึกษา (บกศ.)', 'S04', 'ใช่']);
  r = call(io, 'tok-admin', 'saveTypes', { rows: types2 });
  ok(r.ok, 'เพิ่มประเภทเงินใหม่ได้');
  r = call(io, 'tok-admin', 'saveTypes', { rows: types2.filter(function (t) { return t[0] !== 'T01'; }) });
  ok(!r.ok && /T01/.test(r.error), 'ลบประเภทเงินที่ถูกใช้ใน Ledger ไม่ได้');
  var t2 = types2.map(function (t) { return t.slice(); }); t2[0][4] = 'ไม่';
  r = call(io, 'tok-admin', 'saveTypes', { rows: t2 });
  ok(r.ok, 'ปิดใช้งานประเภทเงินที่มียอดได้');
  d = call(io, 'tok-admin', 'getBalances', { date: R.start }).data;
  ok(d.types.some(function (t) { return t.id === 'T01'; }), 'ประเภทที่ปิดแต่มียอดยังแสดงในภาพรวม');
  ok(sat(d.grand) === expected, 'ยอดรวมเท่าเดิมหลังแก้ตั้งค่า');
  r = call(io, 'tok-admin', 'saveTypes', { rows: [['T30', 'ผิด', 'กลุ่ม', 'S99', 'ใช่']] });
  ok(!r.ok, 'ที่เก็บหลักที่ไม่มีถูกปฏิเสธ');
  r = call(io, 'tok-admin', 'saveStores', { rows: [['S01', 'เงินสด', 'เงินสด'], ['S02', 'x', 'ผิดชนิด']] });
  ok(!r.ok && /ชนิด/.test(r.error), 'ชนิดที่เก็บต้องตรงรายการ');
  r = call(io, 'tok-admin', 'saveStores', { rows: st.stores.filter(function (s) { return s[0] !== 'S02'; }) });
  ok(!r.ok && /S02/.test(r.error), 'ลบที่เก็บที่ถูกใช้ใน Ledger ไม่ได้');

  console.log('\nผ่าน ' + passed + ' / ' + (passed + failed));
  if (failed) { console.log('มี ' + failed + ' ข้อไม่ผ่าน'); process.exit(1); }
  console.log('ทุกข้อผ่าน');
}

module.exports = { makeMemIO: makeMemIO, call: call };
