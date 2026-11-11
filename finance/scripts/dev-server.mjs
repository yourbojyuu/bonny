// เซิร์ฟเวอร์ทดลองบนเครื่อง (ไม่ใช่ของจริง): หน้าเว็บเดียวกับบน Apps Script + ข้อมูลสมมติในหน่วยความจำ
// ใช้: node scripts/dev-server.mjs แล้วเปิด http://localhost:8787
// ล็อกอิน: admin | finance | head | reviewer1 | plan | auditor | ชื่อใดก็ได้ (= ครูทั่วไป) · รหัสทดลอง = DEV_PASSWORD (ค่าเริ่ม dev-pass)
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { createMemoryRepo } from '../src/data/memoryRepo.js';
import { createApp } from '../src/app.js';
import { handleRequest } from '../src/api.js';
import { createAuth, createMemorySessions, hashPassword, makePasswordVerifier } from '../src/services/auth.js';
import { createHash, randomUUID } from 'node:crypto';

const D = 'kwc.ac.th';
const app = createApp({ repo: createMemoryRepo(), clock: { now: () => new Date() } });
app.bootstrap({ name: 'ผู้ดูแล สมมติ', email: `admin@${D}`, appointment_ref: 'คำสั่งสมมติ 1/2570' });
const admin = app.asUser(`admin@${D}`);
const people = { finance: ['finance'], head: ['finance', 'reviewer1'], reviewer1: ['reviewer1'], reviewer2: ['reviewer2'], reviewer3: ['reviewer3'], khj: ['khj_maker'], proc: ['procurement'], unit: ['unit_head'], cmt: ['cash_committee'], plan: ['plan'], auditor: ['auditor'] };
for (const [k, roles] of Object.entries(people)) admin.users.create({ name: `ผู้ใช้สมมติ ${k}`, email: `${k}@${D}`, roles, appointment_ref: `คำสั่งสมมติ ${k}` });
const sav = admin.bank_accounts.create({ account_no: '0000000001', bank: 'ธนาคารสมมติ', branch: 'สาขาสมมติ', type: 'ออมทรัพย์', fund_group: 'บกศ.' });
const cur = admin.bank_accounts.create({ account_no: '0000000002', bank: 'ธนาคารสมมติ', branch: 'สาขาสมมติ', type: 'กระแสรายวัน', fund_group: 'บกศ.', linked_account_id: sav.id });
admin.funds.create({ fund_code: 'บกศ. ง/1', name: 'ค่าจ้างครูสมมติ', fund_group: 'บกศ.', bank_account_id: cur.id });
admin.users.create({ name: 'ผู้บริหาร สมมติ', email: `dir@${D}`, roles: ['director'], appointment_ref: 'คำสั่งสมมติ dir' });
admin.settings.update('ktb_approver_user_ids', [app.store.find('users', (u) => u.email === `dir@${D}`)[0].id], 'ตั้งต้นทดลอง');
admin.subfunds.seedDefaults();
for (const c of ['ก/20', 'ข/3']) admin.subfunds.update(admin.subfunds.list().find((x) => x.code === c).id, { has_collectible: false }, 'ทดลอง: ชนิดนี้ไม่ตั้งยอด');
const fin = app.asUser(`finance@${D}`);
fin.packages.create({ total: 232500, label: 'แพ็กเกจ A', lines: ['ก/20=100000', 'ข/3=100000', 'ศูนย์กีฬา=32500'] });
fin.packages.create({ total: 300000, label: 'SMS งวดหนึ่ง', lines: ['SMS=300000'] });
fin.collectibles.set({ student_id: 'S001', subfund_code: 'SMS', academic_year: 2569, term: '1', amount_due: 960000 });
fin.cheque_books.create({ bank_account_id: cur.id, first_no: '00000001', last_no: '00000050' });
const p = fin.payees.create({ name: 'ร้านสมมติ ก', tax_form: 'ภ.ง.ด.53', pay_method: 'KTB' });
fin.payees.requestAccountChange(p.id, { bank: 'ธนาคารสมมติ', account_no: '0000000099', reason: 'ร้านแจ้งเปลี่ยน (สมมติ)' });
fin.payees.create({ name: 'ร้านสมมติ ค (เช็ค)', tax_form: 'ภ.ง.ด.53', pay_method: 'เช็ค' });
const planner = app.asUser(`plan@${D}`);
planner.plan_projects.create({ name: 'โครงการพัฒนาห้องเรียนสมมติ', fund_code: 'บกศ. ง/1', budget: 1250050, owner_emails: [`teacher@${D}`] });
planner.plan_projects.create({ name: 'กิจกรรมแข่งขันวิชาการสมมติ', fund_code: 'บกศ. ง/1', budget: 4800000, owner_emails: [`teacher@${D}`, `plan@${D}`] });
planner.plan_projects.create({ name: 'โครงการซ่อมบำรุงอาคารสมมติ', fund_code: 'บกศ. ง/1', budget: 32000000 });

const sha256 = (x) => createHash('sha256').update(x, 'utf8').digest('hex');
const clock = { now: () => new Date() };
const auth = createAuth({
  app, clock, sessions: createMemorySessions(clock), newToken: () => randomUUID(),
  verifyPassword: makePasswordVerifier({ salt: 'dev', hash: hashPassword(sha256, 'dev', process.env.DEV_PASSWORD || 'dev-pass'), sha256 }),
});

const html = readFileSync(new URL('../src/ui/index.html', import.meta.url), 'utf8');
const shim = `<script>
window.google = { script: { run: (function mk(ok, bad) { return {
  withSuccessHandler: function (f) { return mk(f, bad); }, withFailureHandler: function (f) { return mk(ok, f); },
  api: function (req) { fetch('/api', { method: 'POST', body: JSON.stringify(req) }).then(function (r) { return r.json(); }).then(ok, bad); } }; })() } };
</script>`;
createServer((req, res) => {
  if (req.method === 'POST' && req.url === '/api') {
    let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify(handleRequest({ app, auth }, JSON.parse(b), '')));
    });
    return;
  }
  res.setHeader('content-type', 'text/html; charset=utf-8');
  res.end(html.replace('<script>', shim + '<script>'));
}).listen(8787, () => console.log('dev: http://localhost:8787'));
