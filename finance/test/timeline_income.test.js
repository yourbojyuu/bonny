import { test } from 'node:test';
import assert from 'node:assert/strict';
import { env3, approved, payee, line, E } from './step3_helpers.js';
import { PermissionError } from '../src/core/errors.js';
import { roleConflicts } from '../src/core/roles.js';

const stage = (tl, key) => tl.stages.find((s) => s.key === key);

test('งานรายรับ: ออกใบเสร็จและนำฝากได้ แต่ทำรายการจ่ายไม่ได้ · ถือร่วมกับกรรมการเก็บรักษาเงินไม่ได้', () => {
  const e = env3();
  const admin = e.as('admin');
  admin.users.create({ name: 'ผู้ใช้ รายรับ', email: E('inc'), roles: ['income'], appointment_ref: 'คำสั่งสมมติ inc' });
  admin.subfunds.create({ code: 'ก/20', name: 'ชนิดสมมติ', group: 'บกศ.' });
  const inc = e.app.asUser(E('inc'));
  inc.packages.create({ total: 50000, label: 'แพ็กเกจสมมติ', lines: ['ก/20=50000'], channels: [] });
  const r = inc.receipts.issue({ book_no: '1', receipt_no: '1', date: '2026-11-10', payer: 'ผู้ชำระสมมติ', bks_cash: 50000 });
  assert.equal(r.total, 50000);
  const { code } = approved(e);
  assert.throws(() => inc.payments.createLine({ approval_code: code, date: '2026-11-10', kind: 'เบิก', payee_id: 'x', vendor_doc_no: 'A', description: 'x', base_amount: 100 }), PermissionError);
  // ใบเสร็จเงินสดที่ยังไม่นำฝาก ขึ้นในไทม์ไลน์ขั้นรายรับ และเป็น "ขั้นของฉัน" ของงานรายรับ
  const tl = inc.reports.timeline();
  assert.deepEqual([stage(tl, 'receipt').count, tl.mine.includes('receipt'), tl.mine.includes('lines')], [1, true, false]);
  assert.deepEqual(roleConflicts(['income', 'cash_committee']).length, 1);
});

test('ไทม์ไลน์: บอกว่าเอกสารอยู่ขั้นไหน · เห็นได้เฉพาะบทบาทใน timeline_roles · ขั้นของฉันตามบทบาท', () => {
  const e = env3();
  assert.throws(() => e.u('teacher').reports.timeline(), PermissionError);
  let tl = e.u('finance').reports.timeline();
  assert.equal(tl.stages.length, 10);
  assert.ok(tl.stages.every((s) => s.count === 0));
  assert.ok(tl.mine.includes('lines') && tl.mine.includes('pay') && !tl.mine.includes('khj'));

  e.u('teacher').approvals.submit({ project_id: approved(e).proj.id, items: 'ซื้อของสมมติ', amount: 1000 });
  const { code } = approved(e, {});
  tl = e.u('reviewer1').reports.timeline();
  assert.equal(stage(tl, 'request').count, 1); // ใบที่เพิ่งยื่น รอแผนรับ
  assert.equal(stage(tl, 'request').items[0].sub, 'ส่งแล้ว รอแผนรับ');
  assert.equal(stage(tl, 'finance_in').count, 2); // อนุมัติแล้ว 2 ใบ ยังไม่มีใครรับ

  const p = payee(e);
  const l1 = line(e, code, p), l2 = line(e, code, p);
  assert.equal(stage(e.u('finance').reports.timeline(), 'lines').count, 2);
  const k = e.u('finance').khb.create({ line_ids: [l1.id, l2.id] });
  tl = e.u('finance').reports.timeline();
  assert.equal(stage(tl, 'lines').count, 0);
  assert.deepEqual(stage(tl, 'khb').items.map((x) => [x.title, x.sub]), [[k.khb_no, 'ยังไม่ส่งตรวจ']]);
  e.u('finance').workflow.submit('khb', k.id);
  assert.match(stage(e.u('finance').reports.timeline(), 'khb').items[0].sub, /ชั้น 1/);

  // ปรับรายชื่อบทบาทได้ที่ค่าตั้ง
  e.as('admin').settings.update('timeline_roles', ['reviewer1'], 'ทดสอบ');
  assert.throws(() => e.u('finance').reports.timeline(), PermissionError);
  assert.equal(e.u('reviewer1').reports.timeline().mine.includes('khb'), true);
});
