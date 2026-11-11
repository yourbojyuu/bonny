import { test } from 'node:test';
import assert from 'node:assert/strict';
import { env3, project, approved, SCAN, E } from './step3_helpers.js';
import { fieldsOf } from './helpers.js';
import { PermissionError } from '../src/core/errors.js';

test('ใบขออนุมัติ: ต้องอ้างโครงการในแผน · ยอด ≤ คงเหลือ · ประเภทเงินตรงแผน (block)', () => {
  const e = env3();
  const p = project(e, { budget: 500000 });
  const t = e.u('teacher').approvals;
  assert.deepEqual(fieldsOf(() => t.submit({ project_id: 'ไม่มี', items: 'x', amount: 1000 })), ['project_id']);
  assert.deepEqual(fieldsOf(() => t.submit({ project_id: p.id, items: 'x', amount: 500001 })), ['amount']);
  assert.deepEqual(fieldsOf(() => t.submit({ project_id: p.id, items: 'x', amount: 1000, fund_code: 'อน.รห.' })), ['fund_code']);
  assert.deepEqual(fieldsOf(() => t.submit({ project_id: p.id, items: '', amount: 1000 })), ['items']);
  const r = t.submit({ project_id: p.id, items: 'ซื้อวัสดุ', amount: 500000 });
  assert.equal(r.status, 'ส่งแล้ว รอแผนรับ');
  assert.equal(r.fund_code, 'บกศ. ง/1');
  assert.equal(r.requester, E('teacher'));
});

test('งานแผนรับ → ตรวจ → เสนอ ผอ. → ผอ. เซ็น → รับคืนพร้อมภาพ → ออกรหัสอนุมัติ อม.1/2570', () => {
  const e = env3();
  const { req, code, proj } = approved(e, { amount: 1000000 });
  assert.equal(code, 'อม.1/2570');
  assert.equal(req.status, 'อนุมัติแล้ว รอการเงินรับ');
  assert.equal(req.scan_ref, 'scan-x.jpg');
  // ยอดในแผนกลายเป็น "ผูกพัน"
  const row = e.u('plan').plan_projects.list().find((x) => x.id === proj.id);
  assert.deepEqual([row.committed, row.spent, row.remaining], [1000000, 0, 9000000]);
  // รหัสต่อเนื่องไม่ซ้ำ
  assert.equal(approved(e, { proj, amount: 1000 }).code, 'อม.2/2570');
});

test('ผู้ขอรับ/อนุมัติงานของตัวเองไม่ได้ · เฉพาะงานแผนรับได้', () => {
  const e = env3();
  const p = project(e);
  const r = e.u('teacher').approvals.submit({ project_id: p.id, items: 'x', amount: 1000 });
  assert.throws(() => e.u('teacher').approvals.receive(r.id), PermissionError);
  assert.throws(() => e.u('finance').approvals.receive(r.id), PermissionError);
  // งานแผนที่เป็นผู้ขอเอง ก็รับของตัวเองไม่ได้
  const mine = e.u('plan').approvals.submit({ project_id: p.id, items: 'ของแผนเอง', amount: 1000 });
  assert.throws(() => e.u('plan').approvals.receive(mine.id), PermissionError);
});

test('ไม่ผ่านส่งคืนครู (ต้องมีเหตุผล) → ครูแก้แล้วส่งใหม่ · ต้องรับก่อนจึงเสนอได้', () => {
  const e = env3();
  const p = project(e);
  const r = e.u('teacher').approvals.submit({ project_id: p.id, items: 'x', amount: 1000 });
  assert.throws(() => e.u('plan').approvals.propose(r.id), /ยังไม่ได้กดรับ/);
  e.u('plan').approvals.receive(r.id);
  assert.deepEqual(fieldsOf(() => e.u('plan').approvals.returnToRequester(r.id, '')), ['reason']);
  assert.equal(e.u('plan').approvals.returnToRequester(r.id, 'ไม่อยู่ในแผน').status, 'ส่งคืนแก้');
  assert.equal(e.u('teacher').workflow.inbox()[0].kind, 'ส่งคืนแก้');
  const again = e.u('teacher').approvals.resubmit(r.id, { items: 'แก้รายการแล้ว', amount: 2000 });
  assert.equal(again.status, 'ส่งแล้ว รอแผนรับ');
  assert.equal(again.amount, 2000);
  assert.throws(() => e.u('teacher2').approvals.resubmit(r.id, { items: 'y' }), PermissionError);
});

test('ผอ. เซ็นแล้วต้องแนบภาพ (ค่าตั้ง) · รหัสออกได้เมื่อกดรับคืนเท่านั้น · ยอดตรวจซ้ำกับคงเหลือ', () => {
  const e = env3();
  const p = project(e, { budget: 1500000 });
  const a = e.u('teacher').approvals.submit({ project_id: p.id, items: 'ก', amount: 1000000 });
  const b = e.u('teacher2').approvals.submit({ project_id: p.id, items: 'ข', amount: 1000000 }); // รวมเกินแผน
  for (const r of [a, b]) e.u('plan').approvals.receive(r.id);
  e.u('plan').approvals.propose(a.id);
  assert.deepEqual(fieldsOf(() => e.u('plan').approvals.recordDecision(a.id, { approved: true })), ['scan_ref']);
  assert.equal(e.u('plan').approvals.get(a.id).approval_code, ''); // ยังไม่มีรหัส
  e.u('plan').approvals.recordDecision(a.id, { approved: true, ...SCAN });
  // ใบ b ถูกตรวจซ้ำตอนเสนอ: ยอดผูกพันของ a ทำให้คงเหลือไม่พอ
  assert.deepEqual(fieldsOf(() => e.u('plan').approvals.propose(b.id)), ['amount']);
});

test('ผอ. ไม่อนุมัติ → แจ้งครู จบ (ไม่ออกรหัส ไม่ผูกพันยอด)', () => {
  const e = env3();
  const p = project(e);
  const r = e.u('teacher').approvals.submit({ project_id: p.id, items: 'x', amount: 1000 });
  e.u('plan').approvals.receive(r.id); e.u('plan').approvals.propose(r.id);
  assert.deepEqual(fieldsOf(() => e.u('plan').approvals.recordDecision(r.id, { approved: false })), ['reason']);
  const done = e.u('plan').approvals.recordDecision(r.id, { approved: false, reason: 'ไม่อนุมัติ', ...SCAN });
  assert.equal(done.status, 'ผอ. ไม่อนุมัติ'); assert.equal(done.approval_code, '');
  assert.equal(e.u('plan').plan_projects.list()[0].committed, 0);
});

test('การเงินกดรับเรื่องแล้วจำแนก 3 ทาง · ผู้ขอเห็นสถานะของตัวเอง', () => {
  const e = env3();
  const { req } = approved(e);
  assert.equal(e.u('finance').workflow.inbox().filter((x) => x.doc_id === req.id).length, 1);
  assert.throws(() => e.u('finance').approvals.classify(req.id, 'วัสดุ'), /ยังไม่ได้กดรับ/);
  e.u('finance').approvals.financeReceive(req.id);
  assert.deepEqual(fieldsOf(() => e.u('finance').approvals.classify(req.id, 'อื่นๆ')), ['route']);
  assert.equal(e.u('finance').approvals.classify(req.id, 'วัสดุ').route, 'วัสดุ');
  assert.equal(e.u('teacher').approvals.list().length, 1);
  assert.equal(e.u('teacher2').approvals.list().length, 0); // ครูเห็นเฉพาะของตน
});
