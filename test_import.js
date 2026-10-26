/* ทดสอบตัวนำเข้าข้อมูลเดิม (import.js) กับหลังบ้านจริงในหน่วยความจำ — ข้อมูลสมมติทั้งหมด · รัน: node test_import.js */
var fs = require('fs'), vm = require('vm');
var T = require('./test.js'), Importer = require('./import.js');
var ctx = {}; vm.createContext(ctx); vm.runInContext(fs.readFileSync(__dirname + '/paste.js', 'utf8') + ';this.Paste=Paste', ctx);
var Paste = ctx.Paste, passed = 0, failed = 0;
function ok(c, m) { if (c) { passed++; console.log('  ผ่าน ', m); } else { failed++; console.log('  ไม่ผ่าน', m); } }

var H = ['วันที่เบิก', 'เดือน', 'ขบ.', 'วันที่ ขบ.', 'ขจ.', 'ชนิด', 'เงินยืม', 'รายชื่อผู้รับ', 'มูลค่าสินค้า', 'จำนวนเงินที่จ่าย', 'ภาษี', 'จำนวนที่ขอเบิก', 'ประเภทเงิน', 'รายการเงิน', 'ประเภทภาษี', 'หมายเหตุ', 'Note'];
function L(date, khb, khbDate, khj, kind, payee, net, tax, type, taxType, method) { return [date, 'ตุลาคม', khb, khbDate, khj, kind, null, payee, null, net, tax, net + tax, type, '', taxType, method, '']; }
var register = [H,
  L('2026-10-02', '216/69', '2026-09-17', 1, 'เบิก', 'นางทดสอบ หนึ่ง', 1600, 0, 'อน.กพร.', 'ไม่มีภาษี', 'KTB'),
  L('2026-10-02', '216/69', '2026-09-17', 1, 'เบิก', 'นางทดสอบ หนึ่ง', 1600, 0, 'อน.กพร.', 'ไม่มีภาษี', 'KTB'),
  L('2026-10-02', '221/69', '2026-09-22', 1, 'พัสดุ', 'บริษัท ตัวอย่าง จำกัด', 3613.41, 34.09, 'อน.รห.', 'ภ.ง.ด.53', 'เช็ค'),
  L('2026-10-02', '221/69', '2026-09-22', 1, 'ถอน', 'นายถอน สอง', 2500, 0, 'E-Donation', 'ไม่มีภาษี', 'KTB'),
  L('2026-10-28', '2', '2026-10-20', 2, 'พัสดุ', 'ร้านตัวอย่าง ที่สาม', 5458.5, 51.5, 'อน.รห.', 'ภ.ง.ด.53', 'เช็ค'),
  L('2026-10-26', '1', '2026-10-22', 'A01', 'เงินยืม', 'นางสาวยืม สี่', 353824, 0, 'บกศ. ข/3', 'ไม่มีภาษี', 'KTB')];
function khjSheet(rows) { return { name: '1-10', rows: rows }; }
var khj1 = [[], ['บันทึกข้อความ'], [], ['ส่วนราชการ โรงเรียนทดสอบ'], ['ที่ ขจ.1/2570', null, null, 'วันที่ 2 ตุลาคม 2569', null, 1, '2026-10-02'],
  ['1. เงินอุดหนุน'], ['ที่', 'เลขที่เช็ค', 'ชื่อผู้รับ', 'จำนวนเงิน', 'หมายเหตุ'],
  [1, 10393584, 'บริษัท ตัวอย่าง จำกัด', 3613.41, null], [2, 1000013363441, 'นางทดสอบ หนึ่ง', 3200, 'จ่ายผ่าน KTB'], [3, 'ถอนเงินสด', 'ส.อ.ถอน สอง', 2500, 'E-donation'],
  ['เป็นจำนวนเงินทั้งสิ้น', null, null, 9313.41], ['รวมเป็นเงินทั้งสิ้น', null, '9,313.41 บาท', null, null, null, 9313.41]];
var reg = [['ชื่อ', null, 'ประเภท', null, 'จ่าย', 'ภาษี'], ['บริษัท ตัวอย่าง จำกัด', null, 'ร้านค้า', null, null, 'ภ.ง.ด.53'], ['นางทดสอบ หนึ่ง', null, 'ครู', null, 'KTB', 'ไม่มีภาษี'], ['ค.2 ค่าจ้างครู', null, 'ครู'], ['กรมสรรพากร', null, 'ภาษี']];
var sheets = [{ name: 'รายการ', rows: register }, { name: 'รายชื่อ', rows: reg }, khjSheet(khj1), { name: 'สรุปเช็ค', rows: [['x']] }];

var io = T.makeMemIO(), st = T.call(io, 'tok-fin', 'getSettings').data, sch = T.call(io, 'tok-fin', 'getSchema').data;
var cx = { fy: st.fy, fyStart: st.fyStart, fyEnd: st.fyEnd, lineKinds: sch.lineKinds, taxTypes: sch.taxTypes,
  resolveType: function (t) { return Paste.matchType(t, { types: st.types, aliases: st.aliases || [] }, true) || ''; },
  storeOfType: function (id) { var t = st.types.filter(function (x) { return x[0] === id; })[0]; return t ? t[3] : ''; } };
console.log('นำเข้าข้อมูลเดิม');
var plan = Importer.analyze(sheets, cx);
ok(plan && plan.khbs.length === 4 && plan.khjs.length === 3 && plan.totals.lines === 6, 'อ่านได้ 4 ขบ. 3 ขจ. 6 รายการ');
ok(plan.khbs[0].key === '1' && plan.khbs[1].key === '2' && plan.khbs[2].key === '216/69' && plan.khbs[3].key === '221/69', 'ขบ. ปีงบนี้ (เลขล้วน) มาก่อน ตามด้วยของปีก่อนเรียงวันที่');
ok(plan.khbs[2].prior && plan.khbs[2].date === st.fyStart && /ปีงบก่อน/.test(plan.khbs[2].note), 'ขบ. ปีก่อนใช้วันเริ่มปีงบ เก็บวันที่เดิมในหมายเหตุ');
ok(plan.khjs.map(function (j) { return j.key; }).join(',') === '1,2,A01', 'ขจ. เลขล้วนก่อน แล้ว A01');
ok(plan.payees.length === 2, 'ทะเบียนผู้รับตัดแถวที่ไม่ใช่ผู้รับ (ชื่อกองทุน/กรมสรรพากร)');
ok(plan.payments.length === 4 && plan.unmatched.length === 0, 'จับคู่การจ่ายได้ 4 รายการ (รวมแถวที่ชื่อต่างกันแต่ยอดตรง) ' + plan.unmatched.join('; '));
ok(plan.problems.some(function (x) { return /ส\.อ\.ถอน/.test(x); }), 'แจ้งเตือนรายการที่จับคู่จากยอดเงิน');
var m = plan.payments.map(function (L) { return L.paid.method; }).sort().join(',');
ok(m === 'KTB,KTB,ถอน,เช็ค', 'วิธีจ่ายจากเลขอ้างอิง: เช็ค/KTB/ถอน ' + m);

function api(a, p) { var r = T.call(io, 'tok-fin', a, p); return r.ok ? Promise.resolve(r.data) : Promise.reject(new Error(r.error)); }
Importer.run(plan, api, { payees: true, docs: true, pay: true }).then(function (r) {
  ok(r.khbs.join(',') === '1,2,3,4' && r.khjs.join(',') === '1,2,3' && r.paid === 4 && !r.warns.length, 'นำเข้าสำเร็จ เลขตรงแผน');
  var d = T.call(io, 'tok-fin', 'getDocs').data, g = 0, n = 0;
  d.khbs.forEach(function (h) { h.lines.forEach(function (l) { g += Math.round(l.gross * 100); n++; }); });
  ok(n === 6 && g / 100 === plan.totals.gross, 'ยอดขอเบิกในระบบ = ยอดในไฟล์ (' + plan.totals.gross + ')');
  ok(d.khbs.every(function (h) { return h.flow === 'รับเรื่องแล้ว'; }), 'ทุก ขบ. อนุมัติแล้ว/รับเรื่องแล้ว');
  var j1 = d.khjs.filter(function (j) { return j.no === 1; })[0];
  ok(j1.items.length === 4 && j1.items.filter(function (i) { return i.date === '2026-10-02'; }).length === 4, 'ขจ.1 จ่ายครบ 4 รายการ วันที่ตามเอกสาร');
  var chk = j1.items.filter(function (i) { return i.ref === '10393584'; })[0];
  ok(chk && chk.method === 'เช็ค', 'เลขเช็คถูกบันทึกกับรายการที่ตรง');
  var j2 = d.khjs.filter(function (j) { return j.no === 2; })[0];
  ok(j2.items.every(function (i) { return !i.date; }), 'ขจ.2 (ไม่มีเอกสารจ่าย) ยังรอจ่ายเงิน');
  console.log('\nผ่าน ' + passed + ' / ' + (passed + failed)); if (failed) process.exit(1); console.log('ทุกข้อผ่าน');
}).catch(function (e) { console.log('ล้มเหลว', e.message); process.exit(1); });
