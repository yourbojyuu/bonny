import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup, EMAILS, seedBankAndFund } from './helpers.js';
import { handle } from '../src/api.js';
import { createSheetsRepo } from '../src/data/sheetsRepo.js';
import { TABLES, headersOf } from '../src/core/schema.js';
import { createFakeSpreadsheet } from './fakeSpreadsheet.js';

// ---------- api: สิ่งที่หน้าเว็บเรียก ----------

test('api: อีเมลนอกโดเมนโรงเรียนถูกปฏิเสธ', () => {
  const { app } = setup();
  const r = handle(app, 'stranger@gmail.com', 'me', {});
  assert.equal(r.ok, false);
  assert.match(r.error, /kwc\.ac\.th/);
});

test('api: me คืนบทบาทและตารางที่อ่าน/แก้ได้', () => {
  const { app } = setup();
  const r = handle(app, EMAILS.finance, 'me', {});
  assert.equal(r.ok, true);
  assert.deepEqual(r.data.user.roles, ['finance']);
  assert.ok(r.data.tables.find((t) => t.key === 'payees').canWrite);
  assert.ok(!r.data.tables.find((t) => t.key === 'funds').canWrite);
  assert.ok(!r.data.tables.find((t) => t.key === 'users')); // การเงินไม่เห็นตารางผู้ใช้
});

test('api: ยอดเงินจากหน้าเว็บเป็นบาท แปลงเป็นสตางค์ก่อนบันทึก และคืนเป็นสตางค์', () => {
  const env = setup();
  seedBankAndFund(env);
  const r = handle(env.app, EMAILS.plan, 'create', { table: 'plan_projects', record: { name: 'โครงการสมมติ', fund_code: 'บกศ. ง/1', budget: '12,500.50' } });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.data.budget, 1250050);
  const bad = handle(env.app, EMAILS.plan, 'create', { table: 'plan_projects', record: { name: 'x', fund_code: 'บกศ. ง/1', budget: '1.234' } });
  assert.deepEqual(bad.errors.map((e) => e.field), ['budget']);
});

test('api: error ชี้ช่องที่ผิดกลับไปให้หน้าเว็บ', () => {
  const { app } = setup();
  const r = handle(app, EMAILS.finance, 'create', { table: 'payees', record: { name: 'ร้านสมมติ', tax_form: 'ภ.ง.ด.3' } });
  assert.equal(r.ok, false);
  assert.deepEqual(r.errors.map((e) => e.field), ['pay_method']);
});

test('api: ไม่มี action ลบ', () => {
  const { app } = setup();
  const r = handle(app, EMAILS.admin, 'delete', { table: 'users', id: 'x' });
  assert.equal(r.ok, false);
});

// ---------- sheetsRepo กับ Google Sheets จำลอง ----------

function sheetsEnv() {
  const ss = createFakeSpreadsheet();
  const lock = { waitLock() {}, releaseLock() {} };
  const repo = createSheetsRepo({ spreadsheet: ss, lock, tables: TABLES, newUuid: (() => { let i = 0; return () => `uuid-${++i}`; })() });
  repo.ensureSheets();
  return { ss, repo };
}

test('sheetsRepo: สร้างชีตพร้อมหัวคอลัมน์ทุกตาราง (1 ตาราง = 1 ชีต)', () => {
  const { ss } = sheetsEnv();
  for (const [name, t] of Object.entries(TABLES).filter(([, d]) => !d.virtual)) {
    assert.ok(headersOf(t).includes('id'));
    const sh = ss.getSheetByName(name);
    assert.ok(sh, name);
    assert.deepEqual(sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0], headersOf(t));
  }
});

test('sheetsRepo: เก็บทุกค่าเป็นข้อความ อ่านกลับได้ชนิดเดิม (เลข 0 นำหน้า · list · bool · เงิน)', () => {
  const { repo, ss } = sheetsEnv();
  repo.insert('cheque_books', { id: 'b1', bank_account_id: 'a1', first_no: '00000001', last_no: '00000050', note: '' });
  repo.insert('users', { id: 'u1', name: 'ก', email: 'a@kwc.ac.th', roles: ['finance', 'reviewer1'], appointment_ref: 'x', active: true });
  repo.insert('plan_projects', { id: 'p1', fiscal_year: 2570, name: 'x', fund_code: 'f', budget: 1250050 });
  assert.equal(repo.get('cheque_books', 'b1').first_no, '00000001');
  assert.deepEqual(repo.get('users', 'u1').roles, ['finance', 'reviewer1']);
  assert.equal(repo.get('users', 'u1').active, true);
  assert.equal(repo.get('plan_projects', 'p1').budget, 1250050);
  assert.equal(repo.get('plan_projects', 'p1').fiscal_year, 2570);
  assert.equal(typeof ss.getSheetByName('plan_projects').getRange(2, 1, 1, 5).getValues()[0][4], 'string');
});

test('sheetsRepo: update แก้แถวที่ถูกต้อง · id ไม่พบ = error', () => {
  const { repo } = sheetsEnv();
  repo.insert('subfunds', { id: 's1', code: 'ก/20', name: 'บัตรสมมติ', group: 'บกศ.', has_collectible: false, active: true });
  repo.insert('subfunds', { id: 's2', code: 'ข/3', name: 'พิเศษสมมติ', group: 'บกศ.', has_collectible: true, active: true });
  repo.update('subfunds', 's2', { name: 'แก้แล้ว' });
  assert.equal(repo.get('subfunds', 's1').name, 'บัตรสมมติ');
  assert.equal(repo.get('subfunds', 's2').name, 'แก้แล้ว');
  assert.throws(() => repo.update('subfunds', 'zz', { name: 'x' }), /ไม่พบ/);
});

test('sheetsRepo: หัวคอลัมน์ในชีตถูกแก้จากภายนอก → หยุดทำงานทันที', () => {
  const { repo, ss } = sheetsEnv();
  ss.getSheetByName('subfunds').getRange(1, 2).setValue('แก้หัว');
  assert.throws(() => repo.list('subfunds'), /หัวคอลัมน์/);
});

test('sheetsRepo: withLock ใช้ LockService และปล่อย lock เสมอ', () => {
  const calls = [];
  const lock = { waitLock: (ms) => calls.push(['wait', ms]), releaseLock: () => calls.push(['release']) };
  const repo = createSheetsRepo({ spreadsheet: createFakeSpreadsheet(), lock, tables: TABLES, newUuid: () => 'x' });
  assert.throws(() => repo.withLock(() => { throw new Error('boom'); }), /boom/);
  assert.deepEqual(calls, [['wait', 30000], ['release']]);
});

test('api call: ยอดเงินจากหน้าเว็บเป็นบาทแปลงเป็นสตางค์ครั้งเดียว (ยอดยกมา 5,000 บาท = 500,000 สตางค์)', () => {
  const env = setup();
  const { sav } = seedBankAndFund(env);
  const r = handle(env.app, EMAILS.finance, 'call', { svc: 'ledger', method: 'opening', args: [{ account_id: sav.id, amount: '5,000', date: '2026-11-01' }] });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.data.debit, 500000);
  const bad = handle(env.app, EMAILS.finance, 'call', { svc: 'ledger', method: 'ไม่มี', args: [] });
  assert.equal(bad.ok, false);
});

// ---------- ความเร็ว: อ่านชีตครั้งเดียวต่อคำขอ แต่ต้องไม่เสียความถูกต้อง ----------

function countingEnv() {
  const { ss, repo } = sheetsEnv();
  let reads = 0;
  const orig = ss.getSheetByName.bind(ss);
  ss.getSheetByName = (n) => {
    const sh = orig(n);
    if (!sh) return sh;
    return { ...sh, getRange: (...a) => { const r = sh.getRange(...a); return { ...r, getValues: () => { reads++; return r.getValues(); } }; } };
  };
  return { ss, repo, reads: () => reads };
}

test('sheetsRepo memo: list ซ้ำหลายครั้งอ่านชีตครั้งเดียว (หัวคอลัมน์ + ข้อมูล = 2 ครั้ง)', () => {
  const { repo, reads } = countingEnv();
  repo.insert('subfunds', { id: 's1', code: 'ก/20', name: 'บัตรสมมติ', group: 'บกศ.', has_collectible: false, active: true });
  const before = reads();
  for (let i = 0; i < 5; i++) { repo.list('subfunds'); repo.get('subfunds', 's1'); }
  assert.ok(reads() - before <= 2, `อ่าน ${reads() - before} ครั้ง`);
});

test('sheetsRepo memo: แก้ค่าที่ได้จาก list ไม่ทำให้ข้อมูลใน memo เพี้ยน · insert/update เห็นผลทันที', () => {
  const { repo } = countingEnv();
  repo.insert('users', { id: 'u1', name: 'ก', email: 'a@kwc.ac.th', roles: ['finance'], appointment_ref: 'x', active: true });
  repo.list('users')[0].roles.push('admin');
  repo.get('users', 'u1').name = 'เปลี่ยนนอกระบบ';
  assert.deepEqual(repo.get('users', 'u1').roles, ['finance']);
  assert.equal(repo.get('users', 'u1').name, 'ก');
  repo.update('users', 'u1', { name: 'ข' });
  assert.equal(repo.get('users', 'u1').name, 'ข');
  repo.insert('users', { id: 'u2', name: 'ค', email: 'b@kwc.ac.th', roles: ['plan'], appointment_ref: 'x', active: true });
  assert.equal(repo.list('users').length, 2);
});

test('sheetsRepo memo: ได้ lock แล้วอ่านใหม่ เห็นสิ่งที่คนอื่นเขียนระหว่างรอ', () => {
  const { ss, repo } = sheetsEnv();
  repo.insert('subfunds', { id: 's1', code: 'ก/20', name: 'บัตรสมมติ', group: 'บกศ.', has_collectible: false, active: true });
  assert.equal(repo.list('subfunds').length, 1); // memo อุ่นไว้
  const other = createSheetsRepo({ spreadsheet: ss, lock: { waitLock() {}, releaseLock() {} }, tables: TABLES, newUuid: () => 'z' });
  other.insert('subfunds', { id: 's2', code: 'ข/3', name: 'พิเศษสมมติ', group: 'บกศ.', has_collectible: true, active: true });
  repo.withLock(() => assert.equal(repo.list('subfunds').length, 2));
});
