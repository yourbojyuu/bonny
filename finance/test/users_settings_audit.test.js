import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup, EMAILS, fieldsOf } from './helpers.js';
import { createMemoryRepo } from '../src/data/memoryRepo.js';
import { createApp } from '../src/app.js';
import { PermissionError } from '../src/core/errors.js';

const newUser = (o = {}) => ({ name: 'ครู สมมติ', email: 'new.test@kwc.ac.th', roles: ['requester'], appointment_ref: 'คำสั่งสมมติ 9/2570', ...o });

// ---------- ผู้ใช้และบทบาท ----------

test('ตั้งผู้ดูแลคนแรกได้ครั้งเดียว ตอนยังไม่มีผู้ใช้', () => {
  const { app } = setup();
  assert.throws(() => app.bootstrap({ name: 'x', email: 'x.test@kwc.ac.th', appointment_ref: 'x' }), /มีผู้ใช้แล้ว/);
});

test('ผู้ดูแลเพิ่มผู้ใช้ได้ และบันทึก audit_log', () => {
  const { as, app } = setup();
  const u = as('admin').users.create(newUser());
  assert.equal(u.email, 'new.test@kwc.ac.th');
  assert.equal(u.created_by, EMAILS.admin);
  const log = app.store.list('audit_log').filter((r) => r.table === 'users' && r.record_id === u.id);
  assert.equal(log.length, 1);
  assert.equal(log[0].action, 'insert');
  assert.equal(log[0].user, EMAILS.admin);
});

test('อีเมลต้องอยู่ในโดเมนโรงเรียน · ห้ามซ้ำ (ไม่สนตัวพิมพ์) · ต้องมีเลขคำสั่ง', () => {
  const { as } = setup();
  const admin = as('admin');
  assert.deepEqual(fieldsOf(() => admin.users.create(newUser({ email: 'x@gmail.com' }))), ['email']);
  assert.deepEqual(fieldsOf(() => admin.users.create(newUser({ email: EMAILS.finance.toUpperCase() }))), ['email']);
  assert.deepEqual(fieldsOf(() => admin.users.create(newUser({ appointment_ref: '' }))), ['appointment_ref']);
  assert.deepEqual(fieldsOf(() => admin.users.create(newUser({ roles: ['ไม่มีบทบาทนี้'] }))), ['roles']);
  assert.deepEqual(fieldsOf(() => admin.users.create(newUser({ roles: [] }))), ['roles']);
});

test('บทบาทที่ขัดกันถือพร้อมกันไม่ได้ (ผู้ดูแลระบบ/ผู้ตรวจสอบ/กรรมการ/ผอ. กับคนทำรายการเงิน)', () => {
  const { as } = setup();
  const admin = as('admin');
  for (const roles of [['admin', 'finance'], ['auditor', 'finance'], ['cash_committee', 'finance'], ['director', 'finance'], ['auditor', 'requester']]) {
    assert.deepEqual(fieldsOf(() => admin.users.create(newUser({ roles }))), ['roles'], roles.join('+'));
  }
  // หัวหน้าการเงินเป็นการเงินด้วยได้ (กันที่ระดับเอกสารในขั้น 2)
  assert.ok(admin.users.create(newUser({ roles: ['finance', 'reviewer1'] })));
});

test('ผู้ดูแลให้บทบาทการเงินกับตัวเองไม่ได้', () => {
  const { as } = setup();
  const admin = as('admin');
  const me = admin.ctx.user;
  assert.deepEqual(fieldsOf(() => admin.users.update(me.id, { roles: ['admin', 'finance'] }, 'ทดสอบ')), ['roles']);
});

test('คนที่ไม่ใช่ผู้ดูแลจัดการผู้ใช้ไม่ได้', () => {
  const { as } = setup();
  assert.throws(() => as('finance').users.create(newUser()), PermissionError);
});

test('ปิดบัญชีผู้ใช้แล้วเข้าระบบไม่ได้ · ไม่มีคำสั่งลบ', () => {
  const { as, app } = setup();
  const admin = as('admin');
  const t = app.store.find('users', (u) => u.email === EMAILS.teacher)[0];
  admin.users.update(t.id, { active: false }, 'ย้ายโรงเรียน');
  assert.throws(() => app.asUser(EMAILS.teacher), PermissionError);
  assert.throws(() => app.asUser('nobody.test@kwc.ac.th'), PermissionError);
  assert.equal(admin.users.delete, undefined);
  assert.equal(app.store.delete, undefined);
});

// ---------- ตั้งค่า ----------

test('ค่าเริ่มต้น settings ครบ และค่าที่ [รอยืนยัน] ถูกระบุไว้', () => {
  const { as } = setup();
  const s = as('finance').ctx.settings;
  assert.equal(s.fiscal_year_start_month, 10);
  assert.equal(s.doc_prefix_approval, 'อม.');
  assert.equal(s.doc_prefix_khb, 'ขบ.');
  assert.equal(s.doc_prefix_khj, 'ขจ.');
  assert.equal(s.pnd3_gross_threshold, 1000000); // 10,000 บาท เป็นสตางค์
  assert.equal(s.pnd53_gross_threshold, 50000); // 500 บาท
  assert.equal(s.vat_rate_pct, 7);
  assert.deepEqual(s.pay_methods, ['KTB', 'เช็ค', 'ออนไลน์']);
  assert.equal(s.fund_allowed_expense_mode, 'flag');
  const pending = as('admin').settings.pending().map((p) => p.key);
  for (const k of ['doc_prefix_approval', 'payee_account_approver_roles', 'cash_holding_limit', 'sla_days']) {
    assert.ok(pending.includes(k), k);
  }
});

test('แก้ settings ต้องเป็นผู้ดูแล · ต้องมีเหตุผล · ค่าต้องถูกชนิด · บันทึก before/after', () => {
  const { as, app } = setup();
  const admin = as('admin');
  assert.throws(() => as('finance').settings.update('pay_methods', ['KTB'], 'x'), PermissionError);
  assert.deepEqual(fieldsOf(() => admin.settings.update('pay_methods', ['KTB', 'เช็ค'], '')), ['reason']);
  assert.deepEqual(fieldsOf(() => admin.settings.update('fiscal_year_start_month', 13, 'x')), ['value']);
  assert.deepEqual(fieldsOf(() => admin.settings.update('pay_methods', [], 'x')), ['value']);
  assert.deepEqual(fieldsOf(() => admin.settings.update('ไม่มีคีย์นี้', 1, 'x')), ['key']);
  admin.settings.update('fund_allowed_expense_mode', 'block', 'ได้รายการจากโรงเรียนแล้ว');
  assert.equal(admin.ctx.settings.fund_allowed_expense_mode, 'block');
  const log = app.store.list('audit_log').filter((r) => r.table === 'settings' && r.record_id === 'fund_allowed_expense_mode');
  assert.equal(log.at(-1).reason, 'ได้รายการจากโรงเรียนแล้ว');
  assert.equal(JSON.parse(log.at(-1).after).value, '"block"');
});

// ---------- audit_log ----------

test('audit_log แก้ไม่ได้ และอ่านได้เฉพาะผู้ดูแล/ผู้ตรวจสอบ', () => {
  const { as, app } = setup();
  const row = app.store.list('audit_log')[0];
  assert.throws(() => app.store.update({ email: EMAILS.admin }, 'audit_log', row.id, { reason: 'แก้' }), /append-only/);
  assert.ok(as('auditor').audit.list().length > 0);
  assert.throws(() => as('finance').audit.list(), PermissionError);
});

test('ทุกการแก้ไขเก็บค่าก่อน/หลัง และ updated_at เปลี่ยน', () => {
  const { as, app, clock } = setup();
  const admin = as('admin');
  const u = admin.users.create(newUser());
  clock.set('2026-11-11T03:00:00Z');
  const u2 = admin.users.update(u.id, { name: 'ครู สมมติ ใหม่' }, 'แก้ชื่อ');
  assert.equal(u2.created_at, u.created_at);
  assert.notEqual(u2.updated_at, u.updated_at);
  const log = app.store.list('audit_log').filter((r) => r.record_id === u.id && r.action === 'update')[0];
  assert.equal(JSON.parse(log.before).name, 'ครู สมมติ');
  assert.equal(JSON.parse(log.after).name, 'ครู สมมติ ใหม่');
});

test('ระบบเปล่าที่ยังไม่ bootstrap ไม่มีใครเข้าได้', () => {
  const app = createApp({ repo: createMemoryRepo(), clock: { now: () => new Date() } });
  assert.throws(() => app.asUser('a.test@kwc.ac.th'), PermissionError);
});
