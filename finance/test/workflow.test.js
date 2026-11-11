import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup, EMAILS, fieldsOf } from './helpers.js';
import { PermissionError } from '../src/core/errors.js';

// เอกสารสมมติที่ใช้เส้นทางตรวจแบบเดียวกับ ขบ./ขจ. (ของจริงสร้างในขั้น 3)
const extraTables = {
  test_docs: { label: 'เอกสารทดสอบ', idPrefix: 'TD', columns: [
    { key: 'id', type: 'id' }, { key: 'title', type: 'string', required: true }, { key: 'maker', type: 'string', required: true },
  ] },
};
const extraFlows = {
  test_doc: { table: 'test_docs', makerField: 'maker', makerRole: 'finance', signedReceiverRole: 'khj_maker', label: 'เอกสารทดสอบ' },
};

function env() {
  const e = setup({ extraTables, extraFlows });
  const admin = e.as('admin');
  for (const [k, roles] of [['reviewer2', ['reviewer2']], ['reviewer3', ['reviewer3']], ['khj', ['khj_maker']], ['khj2', ['khj_maker']]]) {
    admin.users.create({ name: `ผู้ใช้ ${k}`, email: `${k}.test@kwc.ac.th`, roles, appointment_ref: `คำสั่งสมมติ ${k}` });
  }
  const as = (k) => e.app.asUser(`${k}.test@kwc.ac.th`);
  // ผู้ทำ = finance ; สร้างเอกสารผ่าน store ตรง ๆ (ในระบบจริงสร้างผ่านบริการของ ขบ./ขจ.)
  const doc = e.app.store.insert({ email: EMAILS.finance }, 'test_docs', { title: 'ใบทดสอบ', maker: EMAILS.finance });
  return { ...e, as, doc, wf: (who) => (who === 'finance' ? e.as('finance') : who === 'head' ? e.as('head') : who === 'reviewer1' ? e.as('reviewer1') : as(who)).workflow };
}
const sign = { scan_ref: 'scan-001.jpg' };

function walkToSign(e) {
  e.wf('finance').submit('test_doc', e.doc.id);
  for (const w of ['reviewer1', 'reviewer2', 'reviewer3']) {
    e.wf(w).receive('test_doc', e.doc.id);
    e.wf(w).pass('test_doc', e.doc.id);
  }
}

test('ผู้ทำส่งตรวจ → สถานะ "ส่งแล้ว · รอรับ" และนับวันค้าง (คำนวณเอง)', () => {
  const e = env();
  e.wf('finance').submit('test_doc', e.doc.id);
  assert.equal(e.wf('finance').status('test_doc', e.doc.id).text, 'ส่งแล้ว · รอรับ ผู้ตรวจชั้น 1 (0 วัน)');
  e.clock.set('2026-11-13T03:00:00Z');
  assert.equal(e.wf('finance').status('test_doc', e.doc.id).text, 'ส่งแล้ว · รอรับ ผู้ตรวจชั้น 1 (3 วัน)');
});

test('เฉพาะผู้ทำเป็นผู้ส่งตรวจ · ส่งซ้ำไม่ได้', () => {
  const e = env();
  assert.throws(() => e.wf('finance2' in {} ? 'x' : 'head').submit('test_doc', e.doc.id), PermissionError);
  e.wf('finance').submit('test_doc', e.doc.id);
  assert.throws(() => e.wf('finance').submit('test_doc', e.doc.id), /ส่งตรวจแล้ว/);
});

test('ผู้ทำ ขบ. พยายามรับ/เซ็นชั้น 1 ของเอกสารตัวเอง → ถูกปฏิเสธ (SoD)', () => {
  const e = env();
  // head เป็นทั้งการเงินและผู้ตรวจชั้น 1 · ถ้าเป็นผู้ทำเอง ต้องตรวจเอกสารตัวเองไม่ได้
  const mine = e.app.store.insert({ email: EMAILS.head }, 'test_docs', { title: 'ใบของ head', maker: EMAILS.head });
  e.wf('head').submit('test_doc', mine.id);
  assert.throws(() => e.wf('head').receive('test_doc', mine.id), PermissionError);
  assert.equal(e.wf('head').inbox().length, 0); // ไม่ขึ้นในถาดงานของตัวเอง
  e.wf('reviewer1').receive('test_doc', mine.id); // คนอื่นรับได้
});

test('ข้ามชั้นไม่ได้ · ต้องรับก่อนจึงตรวจได้ · คนละบทบาทรับไม่ได้', () => {
  const e = env();
  e.wf('finance').submit('test_doc', e.doc.id);
  assert.throws(() => e.wf('reviewer1').pass('test_doc', e.doc.id), /ยังไม่ได้กดรับ/);
  assert.throws(() => e.wf('reviewer2').receive('test_doc', e.doc.id), PermissionError); // ชั้น 2 รับก่อนชั้น 1 ไม่ได้
  e.wf('reviewer1').receive('test_doc', e.doc.id);
  assert.throws(() => e.wf('reviewer1').receive('test_doc', e.doc.id), /มีผู้รับแล้ว|ไม่อยู่ในขั้นรับ/);
  assert.throws(() => e.wf('head').pass('test_doc', e.doc.id), PermissionError); // ไม่ใช่คนที่รับไว้
});

test('ผ่านครบ 3 ชั้นตามลำดับ → รอ ผอ. เซ็น · บันทึก review_steps ทุกชั้น', () => {
  const e = env();
  walkToSign(e);
  const st = e.wf('finance').status('test_doc', e.doc.id);
  assert.equal(st.stage, 'sign');
  assert.equal(st.text, 'ส่งแล้ว · รอ ผอ. เซ็น (0 วัน)');
  const steps = e.app.store.list('review_steps').filter((r) => r.doc_id === e.doc.id);
  assert.deepEqual(steps.map((r) => [r.step, r.action, r.round]), [['1', 'pass', 1], ['2', 'pass', 1], ['3', 'pass', 1]]);
});

test('ชั้น 3 ส่งคืน → เอกสารกลับผู้ทำ และหลังแก้เริ่มชั้น 1 (ค่าเริ่มต้น)', () => {
  const e = env();
  e.wf('finance').submit('test_doc', e.doc.id);
  for (const w of ['reviewer1', 'reviewer2']) { e.wf(w).receive('test_doc', e.doc.id); e.wf(w).pass('test_doc', e.doc.id); }
  e.wf('reviewer3').receive('test_doc', e.doc.id);
  assert.deepEqual(fieldsOf(() => e.wf('reviewer3').returnDoc('test_doc', e.doc.id, '')), ['reason']);
  e.wf('reviewer3').returnDoc('test_doc', e.doc.id, 'ยอดภาษีไม่ตรง');
  assert.equal(e.wf('finance').status('test_doc', e.doc.id).text, 'ส่งคืนแก้ (ชั้น 3: ยอดภาษีไม่ตรง)');
  assert.equal(e.wf('finance').inbox()[0].kind, 'ส่งคืนแก้');
  e.wf('finance').submit('test_doc', e.doc.id);
  const st = e.wf('finance').status('test_doc', e.doc.id);
  assert.equal(st.stage, 'r1'); assert.equal(st.round, 2);
  assert.equal(e.wf('reviewer1').inbox()[0].kind, 'รอรับ');
});

test('ตั้งค่า "เริ่มที่ชั้นที่ส่งคืน" ได้ (รอยืนยัน 12.5)', () => {
  const e = env();
  e.as('admin').settings.update('review_restart', 'returned', 'ทดสอบ');
  e.wf('finance').submit('test_doc', e.doc.id);
  for (const w of ['reviewer1', 'reviewer2']) { e.wf(w).receive('test_doc', e.doc.id); e.wf(w).pass('test_doc', e.doc.id); }
  e.wf('reviewer3').receive('test_doc', e.doc.id); e.wf('reviewer3').returnDoc('test_doc', e.doc.id, 'x');
  e.wf('finance').submit('test_doc', e.doc.id);
  assert.equal(e.wf('finance').status('test_doc', e.doc.id).stage, 'r3');
});

test('ผู้รับ ขบ. ที่ ผอ. เซ็นแล้ว: ต้องแนบภาพ · ผู้รับ ≠ ผู้ทำ · เป็นบทบาทผู้ทำ ขจ.', () => {
  const e = env();
  walkToSign(e);
  assert.deepEqual(fieldsOf(() => e.wf('khj').receiveSigned('test_doc', e.doc.id, {})), ['scan_ref']);
  assert.throws(() => e.wf('finance').receiveSigned('test_doc', e.doc.id, sign), PermissionError); // ไม่ใช่ผู้ทำ ขจ.
  // ผู้ทำที่ถือบทบาทผู้ทำ ขจ. ด้วย ก็รับของตัวเองไม่ได้
  e.as('admin').users.create({ name: 'ผู้ทำสองบทบาท', email: 'both.test@kwc.ac.th', roles: ['finance', 'khj_maker'], appointment_ref: 'x' });
  const own = e.app.store.insert({ email: 'both.test@kwc.ac.th' }, 'test_docs', { title: 'ของ both', maker: 'both.test@kwc.ac.th' });
  const both = e.as('both').workflow;
  both.submit('test_doc', own.id);
  for (const w of ['reviewer1', 'reviewer2', 'reviewer3']) { e.wf(w).receive('test_doc', own.id); e.wf(w).pass('test_doc', own.id); }
  assert.throws(() => both.receiveSigned('test_doc', own.id, sign), PermissionError);
  const done = e.wf('khj').receiveSigned('test_doc', e.doc.id, sign);
  assert.equal(done.stage, 'done');
  assert.equal(e.wf('khj').status('test_doc', e.doc.id).text, 'ผอ. เซ็นแล้ว');
  assert.ok(e.app.store.list('review_steps').some((r) => r.step === 'director' && r.action === 'sign' && r.scan_ref === 'scan-001.jpg'));
});

test('ตั้งค่า "ไม่ต้องแนบภาพ" ได้ (รอยืนยัน 12.8) · ผอ. ส่งคืนต้องมีเหตุผล', () => {
  const e = env();
  e.as('admin').settings.update('require_scan', false, 'ทดสอบ');
  walkToSign(e);
  assert.deepEqual(fieldsOf(() => e.wf('khj').directorReturn('test_doc', e.doc.id, { scan_ref: '', reason: '' })), ['reason']);
  e.wf('khj').directorReturn('test_doc', e.doc.id, { reason: 'ผอ. ให้แก้ยอด' });
  assert.equal(e.wf('finance').status('test_doc', e.doc.id).stage, 'returned');
  e.wf('finance').submit('test_doc', e.doc.id);
  assert.equal(e.wf('finance').status('test_doc', e.doc.id).stage, 'r1');
});

test('ผู้ทำ ขจ. ต้องไม่ใช่คนเดียวกับผู้ทำเอกสารต้นทาง (distinctFrom)', () => {
  const flows = { ...extraFlows, test_doc: { ...extraFlows.test_doc, distinctFrom: (ctx, doc) => [doc.source_maker].filter(Boolean) } };
  const e = setup({ extraTables: { test_docs: { ...extraTables.test_docs, columns: [...extraTables.test_docs.columns, { key: 'source_maker', type: 'string' }] } }, extraFlows: flows });
  e.as('admin').users.create({ name: 'a', email: 'khj.test@kwc.ac.th', roles: ['khj_maker'], appointment_ref: 'x' });
  for (const [k, r] of [['reviewer2', 'reviewer2'], ['reviewer3', 'reviewer3']]) e.as('admin').users.create({ name: k, email: `${k}.test@kwc.ac.th`, roles: [r], appointment_ref: 'x' });
  const d = e.app.store.insert({ email: EMAILS.finance }, 'test_docs', { title: 't', maker: EMAILS.finance, source_maker: 'khj.test@kwc.ac.th' });
  e.as('finance').workflow.submit('test_doc', d.id);
  for (const [w, who] of [['reviewer1', e.as('reviewer1')], ['reviewer2', e.app.asUser('reviewer2.test@kwc.ac.th')], ['reviewer3', e.app.asUser('reviewer3.test@kwc.ac.th')]]) { who.workflow.receive('test_doc', d.id); who.workflow.pass('test_doc', d.id); }
  assert.throws(() => e.app.asUser('khj.test@kwc.ac.th').workflow.receiveSigned('test_doc', d.id, sign), /ต้องไม่ใช่/);
});

test('ถาดงานแยกตามบทบาท · งานค้างเกิน sla_days ขึ้นธง', () => {
  const e = env();
  e.wf('finance').submit('test_doc', e.doc.id);
  assert.equal(e.wf('reviewer1').inbox().length, 1);
  assert.equal(e.wf('reviewer2').inbox().length, 0);
  assert.deepEqual(e.wf('reviewer1').overdue(), []); // ยังไม่ได้ตั้ง sla_days = ไม่ขึ้นธง
  e.as('admin').settings.update('sla_days', { r1: 2 }, 'ทดสอบ');
  e.clock.set('2026-11-12T03:00:00Z');
  assert.equal(e.wf('reviewer1').overdue().length, 0); // 2 วัน ยังไม่เกิน
  assert.equal(e.wf('reviewer1').inbox()[0].overdue, false);
  e.clock.set('2026-11-13T03:00:00Z');
  const flags = e.wf('reviewer1').overdue();
  assert.equal(flags.length, 1);
  assert.deepEqual([flags[0].step_key, flags[0].days, flags[0].limit], ['r1', 3, 2]);
  const row = e.wf('reviewer1').inbox()[0]; // ถาดงานบอกเองว่าเกินกำหนด (หน้าแรกใช้แสดงธง)
  assert.deepEqual([row.days, row.limit, row.overdue], [3, 2, true]);
  e.wf('reviewer1').receive('test_doc', e.doc.id);
  assert.equal(e.wf('reviewer1').overdue().length, 0); // รับแล้ว หยุดนับ
});

test('handoff แยกอ่านได้เฉพาะผู้ดูแล/ผู้ตรวจสอบ · review_steps แก้ไม่ได้', () => {
  const e = env();
  e.wf('finance').submit('test_doc', e.doc.id);
  assert.ok(e.as('auditor').audit.list().length > 0);
  const row = e.app.store.list('handoffs')[0];
  assert.equal(row.received_at, '');
  assert.throws(() => e.app.store.update({ email: 'x' }, 'review_steps', 'none', {}), /append-only|ไม่พบ/);
});
