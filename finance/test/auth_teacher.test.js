import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { setup, EMAILS, seedBankAndFund, fieldsOf } from './helpers.js';
import { createAuth, createMemorySessions, hashPassword, makePasswordVerifier } from '../src/services/auth.js';
import { handleRequest } from '../src/api.js';
import { PermissionError } from '../src/core/errors.js';

// รหัสสมมติสำหรับ test เท่านั้น (รหัสจริงอยู่ใน Script Properties ไม่อยู่ในโค้ด)
const PW = 'test-only-pass';
const sha256 = (s) => createHash('sha256').update(s, 'utf8').digest('hex');

function authEnv() {
  const env = setup();
  const sessions = createMemorySessions(env.clock);
  let n = 0;
  const auth = createAuth({
    app: env.app, sessions, clock: env.clock,
    verifyPassword: makePasswordVerifier({ salt: 'salt-x', hash: hashPassword(sha256, 'salt-x', PW), sha256 }),
    newToken: () => `tok-${++n}`,
  });
  const req = (r) => handleRequest({ app: env.app, auth }, r);
  return { ...env, auth, sessions, req };
}

// ---------- รหัสผ่าน ----------

test('รหัสผ่านเก็บเป็น hash + salt ตรวจได้ถูกต้อง', () => {
  const h = hashPassword(sha256, 's1', PW);
  assert.match(h, /^[0-9a-f]{64}$/);
  assert.notEqual(h, hashPassword(sha256, 's2', PW));
  const verify = makePasswordVerifier({ salt: 's1', hash: h, sha256 });
  assert.equal(verify(PW), true);
  assert.equal(verify(PW + ' '), false);
  assert.equal(verify(''), false);
  assert.equal(makePasswordVerifier({ salt: '', hash: '', sha256 })(''), false); // ยังไม่ตั้งรหัส = เข้าไม่ได้
});

// ---------- ล็อกอิน ----------

test('ล็อกอินด้วยอีเมลโรงเรียน + รหัสที่ถูก → ได้ token และใช้เรียก api ได้', () => {
  const { req } = authEnv();
  const r = req({ action: 'login', payload: { email: EMAILS.finance, password: PW } });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.data.token, 'tok-1');
  const me = req({ token: r.data.token, action: 'me' });
  assert.equal(me.data.user.email, EMAILS.finance);
});

test('พิมพ์แค่ชื่อหน้า @ ระบบเติม @kwc.ac.th ให้ · ไม่สนตัวพิมพ์', () => {
  const { req } = authEnv();
  const r = req({ action: 'login', payload: { email: 'FINANCE.test', password: PW } });
  assert.equal(r.ok, true);
  assert.equal(req({ token: r.data.token, action: 'me' }).data.user.email, EMAILS.finance);
});

test('รหัสผิด / อีเมลนอกโดเมน / บัญชีถูกปิด → เข้าไม่ได้', () => {
  const { req, as, app } = authEnv();
  assert.deepEqual(req({ action: 'login', payload: { email: EMAILS.finance, password: 'ผิด' } }).errors.map((e) => e.field), ['password']);
  assert.deepEqual(req({ action: 'login', payload: { email: 'x@gmail.com', password: PW } }).errors.map((e) => e.field), ['email']);
  const t = app.store.find('users', (u) => u.email === EMAILS.plan)[0];
  as('admin').users.update(t.id, { active: false }, 'พ้นหน้าที่');
  const r = req({ action: 'login', payload: { email: EMAILS.plan, password: PW } });
  assert.equal(r.ok, false);
  assert.match(r.error, /ปิดใช้งาน/);
});

test('ไม่มี token / token มั่ว / ออกจากระบบแล้ว → ต้องล็อกอินใหม่', () => {
  const { req } = authEnv();
  assert.equal(req({ action: 'me' }).code, 'AUTH');
  assert.equal(req({ token: 'มั่ว', action: 'me' }).code, 'AUTH');
  const tok = req({ action: 'login', payload: { email: EMAILS.finance, password: PW } }).data.token;
  assert.equal(req({ token: tok, action: 'logout' }).ok, true);
  assert.equal(req({ token: tok, action: 'me' }).code, 'AUTH');
});

test('session หมดอายุ 6 ชั่วโมง', () => {
  const { req, clock } = authEnv();
  const tok = req({ action: 'login', payload: { email: EMAILS.finance, password: PW } }).data.token;
  clock.set('2026-11-10T08:59:00Z');
  assert.equal(req({ token: tok, action: 'me' }).ok, true);
  clock.set('2026-11-10T09:00:01Z');
  assert.equal(req({ token: tok, action: 'me' }).code, 'AUTH');
});

test('รหัสผิด 5 ครั้งใน 15 นาที → พักการเข้าระบบอีเมลนั้น 15 นาที แม้รหัสถูก', () => {
  const { req, clock } = authEnv();
  for (let i = 0; i < 5; i++) req({ action: 'login', payload: { email: EMAILS.head, password: 'ผิด' } });
  const r = req({ action: 'login', payload: { email: EMAILS.head, password: PW } });
  assert.equal(r.ok, false);
  assert.match(r.error, /พัก/);
  assert.equal(req({ action: 'login', payload: { email: EMAILS.finance, password: PW } }).ok, true); // คนอื่นไม่โดน
  clock.set('2026-11-10T03:16:00Z');
  assert.equal(req({ action: 'login', payload: { email: EMAILS.head, password: PW } }).ok, true);
});

test('ทุกการล็อกอินลง login_log พร้อมบัญชี Google จริง (ถ้ารู้) และไม่เก็บรหัส', () => {
  const { auth, app } = authEnv();
  auth.login({ email: EMAILS.finance, password: PW, googleEmail: 'someone.else@kwc.ac.th' });
  try { auth.login({ email: EMAILS.head, password: 'ผิด', googleEmail: '' }); } catch { /* คาดว่าผิด */ }
  const log = app.store.list('login_log');
  assert.deepEqual(log.map((l) => [l.email, l.google_email, l.result]), [
    [EMAILS.finance, 'someone.else@kwc.ac.th', 'สำเร็จ'],
    [EMAILS.head, '', 'รหัสผิด'],
  ]);
  assert.ok(!JSON.stringify(log).includes(PW));
  assert.ok(!JSON.stringify(app.store.list('audit_log')).includes(PW));
});

// ---------- ครูทั่วไป (ไม่มีชื่อในตารางผู้ใช้) ----------

test('ครูที่ไม่มีชื่อในตารางผู้ใช้ เข้าได้ในฐานะ "ครูผู้ขอ" · ไม่ถูกบันทึกเป็นผู้ใช้', () => {
  const { req, app } = authEnv();
  const before = app.store.list('users').length;
  const tok = req({ action: 'login', payload: { email: 'someteacher', password: PW } }).data.token;
  const me = req({ token: tok, action: 'me' }).data;
  assert.equal(me.user.email, 'someteacher@kwc.ac.th');
  assert.deepEqual(me.user.roles, ['requester']);
  assert.deepEqual(me.tables.map((t) => t.key), ['plan_projects']);
  assert.ok(!me.tables[0].canWrite);
  assert.deepEqual(me.settings, {}); // ครูไม่เห็นค่าตั้ง
  assert.equal(app.store.list('users').length, before);
  assert.equal(req({ token: tok, action: 'list', payload: { table: 'payees' } }).ok, false);
});

// ---------- แท็กผู้รับผิดชอบโครงการ ----------

test('โครงการมีแท็กผู้รับผิดชอบ (อีเมลโรงเรียน) · ครูเห็นว่าโครงการไหนเป็นของตน', () => {
  const env = authEnv();
  seedBankAndFund(env);
  const plan = env.as('plan');
  assert.deepEqual(fieldsOf(() => plan.plan_projects.create({ name: 'ก', fund_code: 'บกศ. ง/1', budget: 100, owner_emails: ['x@gmail.com'] })), ['owner_emails']);
  plan.plan_projects.create({ name: 'โครงการของครู', fund_code: 'บกศ. ง/1', budget: 100, owner_emails: [' SomeTeacher@kwc.ac.th ', 'someteacher@kwc.ac.th'] });
  plan.plan_projects.create({ name: 'โครงการอื่น', fund_code: 'บกศ. ง/1', budget: 200 });
  const rows = env.app.asUser('someteacher@kwc.ac.th').plan_projects.list();
  assert.deepEqual(rows.map((r) => [r.name, r.is_mine]), [['โครงการของครู', true], ['โครงการอื่น', false]]);
  assert.deepEqual(rows[0].owner_emails, ['someteacher@kwc.ac.th']);
  assert.throws(() => env.app.asUser('someteacher@kwc.ac.th').plan_projects.create({ name: 'x', fund_code: 'บกศ. ง/1', budget: 1 }), PermissionError);
});
