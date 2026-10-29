/* ทดสอบหน้าเว็บในเบราว์เซอร์จริง เน้น "กรณีผิดพลาด" (รหัสผิด ข้อมูลเสีย ช่องค้นหาไม่พบ วางข้อมูลผิด ฯลฯ)
 * รัน: node test_ui.js   (ต้องมี playwright + chromium · ถ้าไม่มี จะข้ามโดยไม่ถือว่าผิด)
 * ใช้โค้ดหลังบ้านจริง (.gs) บนชีทจำลองในหน้า ข้อมูลทั้งหมดเป็นข้อมูลสมมติ */
var fs = require('fs'), path = require('path');
var pw; try { pw = require('playwright'); } catch (e) { console.log('ข้ามเทสต์หน้าเว็บ: ไม่พบ playwright'); process.exit(0); }
var rd = function (f) { return fs.readFileSync(path.join(__dirname, f), 'utf8'); };

var SHA = 'function SHA256(s){function R(n,x){return(x>>>n)|(x<<(32-n));}var K=[],H=[],p=2,c=0;function isP(n){for(var f=2;f*f<=n;f++)if(n%f===0)return false;return true;}' +
  'while(c<64){if(isP(p)){if(c<8)H[c]=(Math.pow(p,1/2)*4294967296)|0;K[c]=(Math.pow(p,1/3)*4294967296)|0;c++;}p++;}' +
  'var b=unescape(encodeURIComponent(s)),w=[],l=b.length*8,i,j;for(i=0;i<b.length;i++)w[i>>2]|=b.charCodeAt(i)<<(24-(i%4)*8);w[l>>5]|=0x80<<(24-l%32);w[((l+64>>9)<<4)+15]=l;' +
  'for(i=0;i<w.length;i+=16){var a=H.slice(0),W=[];for(j=0;j<64;j++){if(j<16)W[j]=w[i+j]|0;else{var s0=R(7,W[j-15])^R(18,W[j-15])^(W[j-15]>>>3),s1=R(17,W[j-2])^R(19,W[j-2])^(W[j-2]>>>10);W[j]=(W[j-16]+s0+W[j-7]+s1)|0;}' +
  'var t1=(a[7]+(R(6,a[4])^R(11,a[4])^R(25,a[4]))+((a[4]&a[5])^(~a[4]&a[6]))+K[j]+W[j])|0,t2=((R(2,a[0])^R(13,a[0])^R(22,a[0]))+((a[0]&a[1])^(a[0]&a[2])^(a[1]&a[2])))|0;a=[(t1+t2)|0].concat(a.slice(0,7));a[4]=(a[4]+t1)|0;}for(j=0;j<8;j++)H[j]=(H[j]+a[j])|0;}' +
  'return H.map(function(x){return(\'00000000\'+(x>>>0).toString(16)).slice(-8);}).join(\'\');}\n';

/** ประกอบหน้าทดสอบ: หน้าเว็บจริง + หลังบ้านจริงบนชีทจำลอง · opts.setup=false คือระบบใหม่ที่ยังไม่มีรหัส admin */
function buildPage(opts) {
  var html = rd('index.html'), markup = html.split('<body data-tab="overview">')[1].split('<script')[0];
  var gs = ['Schema.gs', 'Util.gs', 'Ledger.gs', 'Docs.gs', 'Cheques.gs', 'Receipts.gs', 'Code.gs'].map(rd).join('\n');
  var app = rd('app.js');
  var hook = 'function apiSend(req) {';
  if (app.indexOf(hook) < 0) throw new Error('ไม่พบ apiSend ใน app.js');
  app = app.replace(/function apiSend\(req\) \{[\s\S]*?\n\}\n/, 'function apiSend(req) { return new Promise(function (resolve) { setTimeout(function () { resolve(JSON.parse(JSON.stringify(Backend.dispatch(req, MEM)))); }, 5); }); }\n');
  var backend = 'var Backend=(function(){\n' + gs + '\nreturn {dispatch:dispatch,fail:fail,SCHEMA:SCHEMA,SEED_STORES:SEED_STORES,SEED_TYPES:SEED_TYPES,SEED_GROUPS:SEED_GROUPS,DOC_SETTING_SEED:DOC_SETTING_SEED,ALIAS_SEED:ALIAS_SEED};\n})();\n' +
    'var MEM=(function(){var B=Backend,sheets={};Object.keys(B.SCHEMA).forEach(function(n){sheets[n]=[B.SCHEMA[n].slice()];});\n' +
    'sheets["ผู้ใช้"].push(["admin01","ผู้ดูแล","admin","ใช่"],["fin01","การเงินทดสอบ","การเงิน","ใช่"],["boss01","ผอ.ทดสอบ","ผู้บริหาร","ใช่"]);\n' +
    'B.SEED_STORES.forEach(function(s){sheets["ที่เก็บเงิน"].push(s.slice());});B.SEED_TYPES.forEach(function(t){sheets["ประเภทเงิน"].push([t[0],t[1],B.SEED_GROUPS[t[2]],t[3],"ใช่"]);});\n' +
    'B.DOC_SETTING_SEED.forEach(function(r){sheets["ตั้งค่าเอกสาร"].push(r.slice());});B.ALIAS_SEED.forEach(function(r){sheets["ชื่อย่อ"].push(r.slice());});\n' +
    'var toks={"t-admin":"admin01","t-fin":"fin01","t-boss":"boss01"};\n' +
    'var io={verifyToken:function(t){if(!toks[t])throw B.fail("AUTH","token");return toks[t];},now:function(){return Date.now();},random:function(){return Math.random().toString(16).slice(2)+Math.random().toString(16).slice(2);},sha256:SHA256,hmac:function(t){return SHA256("secret-ui|"+t);},\n' +
    'values:function(n){return sheets[n]?sheets[n].map(function(r){return r.slice();}):null;},write:function(n,rows){sheets[n]=[sheets[n][0]].concat(rows.map(function(r){return r.slice();}));}};\n' +
    'function call(a,p,t){var r=B.dispatch({action:a,token:t,payload:p},io);if(!r.ok)throw new Error(a+": "+r.error);return r.data;}\n' +
    (opts.setup === false ? '' :
      'call("setupAdmin",{user:"admin01",pass:"Secret123"});\n' +
      'call("saveUser",{user:"fin01",name:"การเงินทดสอบ",role:"การเงิน",tempPass:"Temp12345"},"t-admin");call("saveUser",{user:"boss01",name:"ผอ.ทดสอบ",role:"ผู้บริหาร",tempPass:"Temp12345"},"t-admin");\n' +
      'call("changePassword",{old:"Temp12345",pass:"Secret123"},"t-fin");call("changePassword",{old:"Temp12345",pass:"Secret123"},"t-boss");\n' +
      'var L=function(type,payee,g){return {type:type,payee:payee,kind:"พัสดุ",method:"เช็ค",gross:g,tax:0,taxType:"ไม่มีภาษี"};};\n' +
      'call("saveKhb",{date:"2026-10-01",paper:true,lines:[L("T20","ร้านทดสอบ ก",1000),L("T20","ร้านทดสอบ ข",500),L("T10","ร้านทดสอบ ค",2000)]},"t-fin");\n' +
      'call("createKhj",{date:"2026-10-02",items:[1,2,3].map(function(i){return {fy:2570,no:1,seq:i};})},"t-fin");\n' +
      'call("savePayments",{no:1,rows:[{khbFy:2570,khbNo:1,seq:1,method:"เช็ค",ref:"7001",store:"S06",date:"2026-10-05"},{khbFy:2570,khbNo:1,seq:2,method:"เช็ค",ref:"7001",store:"S06",date:"2026-10-05"},{khbFy:2570,khbNo:1,seq:3,method:"เช็ค",ref:"7002",store:"S04",date:"2026-10-06"}]},"t-fin");\n') +
    'delete io.verifyToken;return io;})();\n';
  var scripts = ['combo.js', 'paste.js', 'grid.js', 'docs.js', 'cheques.js', 'flow.js', 'receipts.js', 'bento.js', 'report.js', 'export.js', 'import.js'].map(rd).join('\n');
  return '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>' + rd('app.css') + '</style>' + markup +
    '<script>var API_URL="demo";\n' + SHA + backend + app + '\n' + scripts + '</script>';
}

var passed = 0, failed = 0;
function ok(c, m) { if (c) { passed++; console.log('  ผ่าน ', m); } else { failed++; console.log('  ไม่ผ่าน', m); } }

(async function () {
  var browser = await pw.chromium.launch(), errs = [];
  async function open(opts, w) {
    var ctx = await browser.newContext({ viewport: { width: w || 1280, height: 900 } }), pg = await ctx.newPage();
    pg.on('pageerror', function (e) { errs.push(e.message); }); await pg.route(/fonts\./, function (r) { r.abort(); });
    await pg.setContent(buildPage(opts || {}), { waitUntil: 'load' }); await pg.waitForTimeout(500); return pg;
  }
  var msg = async function (pg) { return (await pg.locator('#loginMsg').textContent()).trim(); };
  async function login(pg, u, p) { await pg.fill('#aUser', u); await pg.fill('#aPass', p); await pg.click('#af button[type=submit]'); await pg.waitForTimeout(700); }

  console.log('1) เข้าระบบ — กรณีผิดพลาด');
  var pg = await open();
  ok(await pg.locator('#aUser').count() === 1, 'ระบบที่ตั้งรหัสแล้วขึ้นหน้าเข้าระบบ (ไม่ใช่หน้าติดตั้งครั้งแรก)');
  ok(await pg.evaluate(function () { return !document.getElementById('af').checkValidity(); }), 'ปล่อยช่องว่างแล้วกดเข้า: ฟอร์มไม่ยอมส่ง (required)');
  await login(pg, 'fin01', 'wrongpass1');
  ok(/ไม่ถูกต้อง/.test(await msg(pg)) && await pg.locator('#app').isHidden(), 'รหัสผิด: ขึ้นข้อความ และไม่ได้เข้าแอป');
  await login(pg, 'nobody', 'Secret123');
  ok(/ไม่ถูกต้อง/.test(await msg(pg)) && !/ไม่มี|ไม่พบ/.test(await msg(pg)), 'ชื่อผู้ใช้ที่ไม่มี: ข้อความเดียวกับรหัสผิด (ไม่บอกว่ามีชื่อนี้หรือไม่)');
  for (var i = 0; i < 4; i++) await login(pg, 'fin01', 'bad' + i + 'xxxx');
  ok(/ล็อก/.test(await msg(pg)), 'ใส่รหัสผิดครบ 5 ครั้ง: ขึ้นว่าบัญชีถูกล็อก');
  await login(pg, 'fin01', 'Secret123');
  ok(/ล็อก/.test(await msg(pg)) && await pg.locator('#app').isHidden(), 'ถูกล็อกแล้วใส่รหัสถูก ก็ยังเข้าไม่ได้');
  await pg.evaluate(function () { try { sessionStorage.setItem('tok', 'ปลอม|1|99999999999999|xxx'); } catch (e) {} });
  await pg.evaluate(function () { startApp('ปลอม|1|99999999999999|xxx'); }); await pg.waitForTimeout(700);
  ok(await pg.locator('#aUser').count() === 1 && /เข้าสู่ระบบ/.test(await msg(pg)), 'โทเคนปลอม: กลับหน้าเข้าระบบพร้อมข้อความ (ไม่ค้างหน้าว่าง)');
  await pg.context().close();

  pg = await open({ setup: false });
  ok(await pg.locator('#aPass2').count() === 1, 'ระบบใหม่: ขึ้นหน้าติดตั้งครั้งแรก');
  await pg.fill('#aUser', 'admin01'); await pg.fill('#aPass', 'Secret123'); await pg.fill('#aPass2', 'Secret124'); await pg.click('#af button[type=submit]'); await pg.waitForTimeout(300);
  ok(/ไม่ตรงกัน/.test(await msg(pg)) && await pg.locator('#app').isHidden(), 'ติดตั้งครั้งแรก: ยืนยันรหัสไม่ตรง -> ไม่ตั้งรหัส');
  await pg.fill('#aPass2', 'Secret123'); await pg.fill('#aPass', 'short'); await pg.fill('#aPass2', 'short'); await pg.click('#af button[type=submit]'); await pg.waitForTimeout(500);
  ok(/อย่างน้อย 8/.test(await msg(pg)), 'ติดตั้งครั้งแรก: รหัสสั้นเกินไป ถูกปฏิเสธ');
  await pg.fill('#aUser', 'someone'); await pg.fill('#aPass', 'Secret123'); await pg.fill('#aPass2', 'Secret123'); await pg.click('#af button[type=submit]'); await pg.waitForTimeout(500);
  ok(/ไม่พบชื่อผู้ใช้|รายชื่อผู้ใช้/.test(await msg(pg)) && await pg.locator('#app').isHidden(), 'ติดตั้งครั้งแรก: ชื่อที่ไม่อยู่ในชีท ผู้ใช้ ถูกปฏิเสธ');
  await pg.context().close();

  console.log('2) ช่องเลือกแบบค้นหา (combo) — กรณีผิดพลาด');
  pg = await open(); await login(pg, 'fin01', 'Secret123'); await pg.evaluate(function () { go('expense'); }); await pg.waitForTimeout(1200);
  await pg.click('#qPayee'); await pg.keyboard.type('zzzไม่มีชื่อนี้'); await pg.waitForTimeout(200);
  ok(await pg.locator('.cb-it').count() === 0 && /ชื่อใหม่|ไม่มีในรายการ/.test(await pg.locator('.cb-empty').textContent()), 'ผู้รับ: พิมพ์ชื่อที่ไม่มี -> บอกว่าใช้เป็นชื่อใหม่ได้ ไม่ค้าง');
  await pg.keyboard.press('Enter'); await pg.waitForTimeout(150);
  ok(await pg.inputValue('#qPayee') === 'zzzไม่มีชื่อนี้' && await pg.evaluate(function () { return document.activeElement.id; }) === 'qType', 'ผู้รับ: Enter ใช้ชื่อที่พิมพ์ (ไม่ถูกแทนด้วยรายการอื่น) แล้วไปช่องประเภทเงินต่อ');
  await pg.click('#qType'); await pg.keyboard.type('ไม่มีประเภทนี้'); await pg.waitForTimeout(200);
  ok(await pg.locator('.cb-it').count() === 0 && /ไม่พบ/.test(await pg.locator('.cb-empty').textContent()), 'ประเภทเงิน: พิมพ์ที่ไม่มี -> "ไม่พบ"');
  await pg.keyboard.press('Escape'); await pg.waitForTimeout(150);
  ok(await pg.locator('.cb-pop:visible').count() === 0, 'กด Esc: เมนูปิด');
  await pg.fill('#qGross', '1000'); await pg.click('#qAdd'); await pg.waitForTimeout(500);
  var t = (await pg.locator('#toast').textContent()).trim();
  ok(/ประเภทเงิน|ไม่ตรง|ไม่พบ|เลือก/.test(t) || await pg.locator('#qFolds > *').count() === 0, 'เพิ่มรายการโดยประเภทเงินที่ไม่มีอยู่จริง: ถูกปฏิเสธ (ไม่ได้เพิ่ม) · ข้อความ: ' + t.slice(0, 50));
  await pg.evaluate(function () { go('settings'); }); await pg.waitForTimeout(1200);
  await pg.evaluate(function () { document.querySelectorAll('.card.col').forEach(function (c) { c.classList.remove('col'); }); }); await pg.waitForTimeout(300);
  var b = pg.locator('#typeRows .cb-btn').first(); await b.scrollIntoViewIfNeeded(); await b.click(); await pg.waitForTimeout(250);
  var before = await pg.evaluate(function () { return document.querySelector('#typeRows select.cb-hid').value; });
  await pg.keyboard.type('ไม่มีทางเจอ'); await pg.keyboard.press('Enter'); await pg.waitForTimeout(200);
  ok(await pg.evaluate(function () { return document.querySelector('#typeRows select.cb-hid').value; }) === before && await pg.locator('.cb-pop:visible').count() === 1, 'เมนูเลือก: ค้นหาไม่พบแล้วกด Enter -> ค่าเดิมไม่เปลี่ยน เมนูยังเปิดให้พิมพ์ใหม่');
  await pg.keyboard.press('Escape'); await pg.waitForTimeout(150);
  ok(await pg.locator('.cb-pop:visible').count() === 0 && await pg.evaluate(function () { return document.activeElement.className; }) === 'cb-btn', 'กด Esc: ปิดเมนูและโฟกัสกลับที่ปุ่ม ค่าเดิมคงอยู่');
  await pg.context().close();

  console.log('3) ทะเบียนเช็ค — กรณีผิดพลาด');
  pg = await open(); await login(pg, 'fin01', 'Secret123'); await pg.evaluate(function () { go('expense'); }); await pg.waitForTimeout(1200);
  await pg.click('#seg1 [data-g="cheque"]'); await pg.waitForTimeout(900);
  ok(await pg.locator('tr.cq-r').count() === 2, 'เช็คค้าง 2 ใบ (7001 รวม 2 รายการ + 7002)');
  await pg.click('#cqUpd'); await pg.waitForTimeout(300);
  await pg.click('#cqCheck'); await pg.waitForTimeout(300);
  ok(/ไม่พบแถว/.test(await pg.locator('#cqHint').textContent()) && await pg.locator('#cqSave').isDisabled(), 'วางว่าง: บอกว่าไม่พบแถว และปุ่มบันทึกยังกดไม่ได้');
  await pg.fill('#cqPaste', 'ข้อความทั่วไป ไม่มีตัวเลข\nอีกบรรทัด'); await pg.click('#cqCheck'); await pg.waitForTimeout(300);
  ok(/ไม่พบแถว/.test(await pg.locator('#cqHint').textContent()), 'วางข้อความที่ไม่มีเลขเช็ค: ไม่พบแถว');
  await pg.fill('#cqPaste', '9999999\t5/10/69\n7001\t3/10/69\n7002\t5/10/69\t999\n'); await pg.click('#cqCheck'); await pg.waitForTimeout(700);
  var sum = (await pg.locator('.pvsum').textContent()).replace(/\s+/g, ' ');
  ok(/ผิด 3/.test(sum) && await pg.locator('#cqSave').isDisabled(), 'ทุกแถวผิด (ไม่พบเลข / ก่อนวันออกเช็ค / ยอดไม่ตรง): ปุ่มบันทึกกดไม่ได้ · ' + sum);
  var errs3 = await pg.locator('.pvtable tbody tr td:last-child').allTextContents();
  ok(/ไม่พบเช็ค/.test(errs3[0]) && /ก่อนวันที่ออกเช็ค/.test(errs3[1]) && /ยอดไม่ตรง/.test(errs3[2]), 'แต่ละแถวบอกเหตุผลของตัวเอง');
  await pg.fill('#cqPaste', '9999999\t5/10/69\n7002\t9/10/69\n'); await pg.click('#cqCheck'); await pg.waitForTimeout(600);
  await pg.click('#cqSave'); await pg.waitForTimeout(900);
  ok(/ข้ามแถวที่ผิด 1/.test(await pg.locator('#toast').textContent()) && await pg.locator('tr.cq-r').count() === 1, 'ผิดบางแถว: บันทึกเฉพาะแถวที่ถูก (7002) และบอกว่าข้ามกี่แถว · ค้างเหลือ 1 ใบ');
  await pg.context().close();
  pg = await open(); await login(pg, 'boss01', 'Secret123'); await pg.evaluate(function () { go('expense'); }); await pg.waitForTimeout(1200);
  await pg.click('#seg1 [data-g="cheque"]'); await pg.waitForTimeout(900);
  ok(await pg.locator('tr.cq-r').count() === 2 && await pg.locator('#cqUpd').count() === 0 && await pg.locator('[data-pick]').count() === 0, 'ผู้บริหาร: เห็นทะเบียนแต่ไม่มีปุ่มอัปเดต/ช่องติ๊กเลือก (ดูได้อย่างเดียว)');
  var denied = await pg.evaluate(function () { return api('saveChequeClear', { items: [{ ref: '7001', date: '2026-10-09' }], commit: true }).then(function () { return 'ok'; }, function (e) { return e.code + ':' + e.message; }); });
  ok(/^FORBIDDEN/.test(denied), 'ผู้บริหารส่งคำสั่งอัปเดตตรง ๆ: หลังบ้านปฏิเสธ (FORBIDDEN) ไม่ใช่แค่ซ่อนปุ่ม');
  await pg.context().close();

  console.log('4) มือถือ — ไม่ล้นจอ');
  pg = await open({}, 390); await login(pg, 'fin01', 'Secret123');
  for (var tab of ['overview', 'income', 'expense', 'settings']) { await pg.evaluate(function (t) { go(t); }, tab); await pg.waitForTimeout(900); ok(await pg.evaluate(function () { return document.documentElement.scrollWidth - innerWidth; }) <= 0, 'หน้า ' + tab + ' บนจอ 390px ไม่ล้นด้านข้าง'); }
  await pg.context().close();

  ok(errs.length === 0, 'ไม่มี JavaScript error ตลอดการทดสอบ ' + errs.slice(0, 3).join(' | '));
  await browser.close();
  console.log('\nผ่าน ' + passed + ' / ' + (passed + failed));
  if (failed) { console.log('มี ' + failed + ' ข้อไม่ผ่าน'); process.exit(1); }
  console.log('ทุกข้อผ่าน');
})().catch(function (e) { console.error(e); process.exit(1); });
