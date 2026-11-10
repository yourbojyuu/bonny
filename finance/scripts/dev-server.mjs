// เซิร์ฟเวอร์ทดลองบนเครื่อง (ไม่ใช่ของจริง): หน้าเว็บเดียวกับบน Apps Script + ข้อมูลสมมติในหน่วยความจำ
// ใช้: node scripts/dev-server.mjs แล้วเปิด http://localhost:8787/?as=finance  (as = admin|finance|head|reviewer1|plan|teacher|auditor)
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { createMemoryRepo } from '../src/data/memoryRepo.js';
import { createApp } from '../src/app.js';
import { handle } from '../src/api.js';

const D = 'kwc.ac.th';
const app = createApp({ repo: createMemoryRepo(), clock: { now: () => new Date() } });
app.bootstrap({ name: 'ผู้ดูแล สมมติ', email: `admin@${D}`, appointment_ref: 'คำสั่งสมมติ 1/2570' });
const admin = app.asUser(`admin@${D}`);
const people = { finance: ['finance'], head: ['finance', 'reviewer1'], reviewer1: ['reviewer1'], plan: ['plan'], teacher: ['requester'], auditor: ['auditor'] };
for (const [k, roles] of Object.entries(people)) admin.users.create({ name: `ผู้ใช้สมมติ ${k}`, email: `${k}@${D}`, roles, appointment_ref: `คำสั่งสมมติ ${k}` });
const sav = admin.bank_accounts.create({ account_no: '0000000001', bank: 'ธนาคารสมมติ', branch: 'สาขาสมมติ', type: 'ออมทรัพย์', fund_group: 'บกศ.' });
const cur = admin.bank_accounts.create({ account_no: '0000000002', bank: 'ธนาคารสมมติ', branch: 'สาขาสมมติ', type: 'กระแสรายวัน', fund_group: 'บกศ.', linked_account_id: sav.id });
admin.funds.create({ fund_code: 'บกศ. ง/1', name: 'ค่าจ้างครูสมมติ', fund_group: 'บกศ.', bank_account_id: cur.id });
const fin = app.asUser(`finance@${D}`);
fin.cheque_books.create({ bank_account_id: cur.id, first_no: '00000001', last_no: '00000050' });
const p = fin.payees.create({ name: 'ร้านสมมติ ก', tax_form: 'ภ.ง.ด.53', pay_method: 'KTB' });
fin.payees.requestAccountChange(p.id, { bank: 'ธนาคารสมมติ', account_no: '0000000099', reason: 'ร้านแจ้งเปลี่ยน (สมมติ)' });
app.asUser(`plan@${D}`).plan_projects.create({ name: 'โครงการสมมติ', fund_code: 'บกศ. ง/1', budget: 1250050 });

const html = readFileSync(new URL('../src/ui/index.html', import.meta.url), 'utf8');
const shim = `<script>
var AS = (new URLSearchParams(location.search).get('as') || 'admin') + '@${D}';
window.google = { script: { run: (function mk(ok, bad) { return {
  withSuccessHandler: function (f) { return mk(f, bad); }, withFailureHandler: function (f) { return mk(ok, f); },
  api: function (action, payload) { fetch('/api', { method: 'POST', body: JSON.stringify({ email: AS, action: action, payload: payload }) }).then(function (r) { return r.json(); }).then(ok, bad); } }; })() } };
</script>`;
createServer((req, res) => {
  if (req.method === 'POST' && req.url === '/api') {
    let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => {
      const { email, action, payload } = JSON.parse(b);
      res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(handle(app, email, action, payload)));
    });
    return;
  }
  res.setHeader('content-type', 'text/html; charset=utf-8');
  res.end(html.replace('<script>', shim + '<script>'));
}).listen(8787, () => console.log('dev: http://localhost:8787/?as=finance'));
