import { test } from 'node:test';
import assert from 'node:assert/strict';
import { env3, approved, payee, line, reviewAll, SCAN, E } from './step3_helpers.js';
import { fieldsOf } from './helpers.js';
import { PermissionError } from '../src/core/errors.js';

// เตรียมแถว 3 กลุ่มเงิน (อุดหนุน บกศ. รายได้) × วิธีจ่าย
function seedLines(e) {
  const mk = (fund, amount) => approved(e, { proj: e.u('plan').plan_projects.create({ name: `โครงการ ${fund}`, fund_code: fund, budget: 20000000 }), amount }).code;
  const c1 = mk('บกศ. ง/1', 3000000), c2 = mk('อน.รห.', 3000000), c3 = mk('รด.สมมติ', 3000000);
  const chk = payee(e, { name: 'ร้านเช็ค', tax_form: 'ไม่มีภาษี', pay_method: 'เช็ค' });
  const ktb = payee(e, { name: 'ร้านโอน', tax_form: 'ภ.ง.ด.53', pay_method: 'KTB' });
  const lines = [
    line(e, c1, chk, { base_amount: 100000 }), line(e, c1, chk, { base_amount: 200000 }), line(e, c1, chk, { base_amount: 300000 }),
    line(e, c1, ktb, { base_amount: 400000 }), line(e, c2, chk, { base_amount: 500000 }), line(e, c3, ktb, { base_amount: 600000 }),
  ];
  return { lines, chk, ktb };
}

test('ขบ.: การเงินจัดแถวเข้า ขบ. ออกเลข ขบ.1/2570 · เลขต่อเนื่อง · ยอดคำนวณจากแถว', () => {
  const e = env3();
  const { lines } = seedLines(e);
  const k = e.u('finance').khb.create({ line_ids: lines.slice(0, 3).map((l) => l.id) });
  assert.equal(k.khb_no, 'ขบ.1/2570');
  assert.equal(k.total, 600000);
  assert.equal(k.maker, E('finance'));
  assert.equal(e.u('finance').khb.create({ line_ids: [lines[3].id] }).khb_no, 'ขบ.2/2570');
  assert.deepEqual(e.u('finance').payments.listLines().filter((l) => l.khb_id === k.id).map((l) => l.status), ['อยู่ใน ขบ.', 'อยู่ใน ขบ.', 'อยู่ใน ขบ.']);
});

test('ขบ.: แถวต้องอยู่ในสถานะบันทึกแล้ว ไม่ซ้ำ ขบ. อื่น · ต้องมีอย่างน้อย 1 แถว · เฉพาะการเงิน', () => {
  const e = env3();
  const { lines } = seedLines(e);
  assert.deepEqual(fieldsOf(() => e.u('finance').khb.create({ line_ids: [] })), ['line_ids']);
  e.u('finance').khb.create({ line_ids: [lines[0].id] });
  assert.deepEqual(fieldsOf(() => e.u('finance').khb.create({ line_ids: [lines[0].id] })), ['line_ids']);
  assert.deepEqual(fieldsOf(() => e.u('finance').khb.create({ line_ids: ['ไม่มี'] })), ['line_ids']);
  assert.throws(() => e.u('khj').khb.create({ line_ids: [lines[1].id] }), PermissionError);
});

test('ผู้ทำ ขบ. พยายามเซ็นชั้น 1 ของ ขบ. ตัวเอง → ถูกปฏิเสธ · ผ่านครบ 3 ชั้น + ผอ. → แถวเป็น "ขบ.เซ็นแล้ว"', () => {
  const e = env3();
  const { lines } = seedLines(e);
  const k = e.u('head').khb.create({ line_ids: lines.map((l) => l.id) }); // head = การเงิน + ผู้ตรวจชั้น 1
  e.u('head').workflow.submit('khb', k.id);
  assert.throws(() => e.u('head').workflow.receive('khb', k.id), PermissionError);
  e.u('reviewer1').workflow.receive('khb', k.id); e.u('reviewer1').workflow.pass('khb', k.id);
  e.u('reviewer2').workflow.receive('khb', k.id); e.u('reviewer2').workflow.pass('khb', k.id);
  e.u('reviewer3').workflow.receive('khb', k.id); e.u('reviewer3').workflow.pass('khb', k.id);
  assert.throws(() => e.u('head').workflow.receiveSigned('khb', k.id, SCAN), PermissionError); // ไม่ใช่ผู้ทำ ขจ.
  e.u('khj').workflow.receiveSigned('khb', k.id, SCAN);
  assert.equal(e.u('finance').payments.listLines().every((l) => l.status === 'ขบ.เซ็นแล้ว'), true);
  assert.equal(e.u('finance').khb.list()[0].status, 'ผอ. เซ็นแล้ว');
});

test('ส่งคืนจากชั้น 3 → แก้แถวได้ → ส่งใหม่เริ่มชั้น 1 · แถวใน ขบ. ที่กำลังตรวจแก้ไม่ได้', () => {
  const e = env3();
  const { lines } = seedLines(e);
  const k = e.u('finance').khb.create({ line_ids: [lines[0].id, lines[1].id] });
  e.u('finance').workflow.submit('khb', k.id);
  assert.throws(() => e.u('finance').payments.updateLine(lines[0].id, { description: 'แก้' }, 'x'), /กำลังตรวจ|แก้ไม่ได้/);
  for (const w of ['reviewer1', 'reviewer2']) { e.u(w).workflow.receive('khb', k.id); e.u(w).workflow.pass('khb', k.id); }
  e.u('reviewer3').workflow.receive('khb', k.id); e.u('reviewer3').workflow.returnDoc('khb', k.id, 'ยอดไม่ตรงใบส่งของ');
  assert.ok(e.u('finance').payments.updateLine(lines[0].id, { base_amount: 90000 }, 'แก้ตามผู้ตรวจ'));
  e.u('finance').workflow.submit('khb', k.id);
  assert.equal(e.u('finance').workflow.status('khb', k.id).stage, 'r1');
});

test('ขจ.: ผู้ทำ ขจ. จัดจาก ขบ. ที่ ผอ. เซ็น · ≠ ผู้ทำ ขบ. · แยก กลุ่มเงิน × วิธีจ่าย · เลข ขจ. เลขเดียวทั้งโรงเรียน', () => {
  const e = env3();
  const { lines } = seedLines(e);
  const k = e.u('finance').khb.create({ line_ids: lines.map((l) => l.id) });
  assert.throws(() => e.u('khj').khj.generate(k.id), /ยังไม่ได้เซ็น|ผอ. เซ็น/); // ขบ. ยังไม่เซ็น
  reviewAll(e, 'khb', k.id, 'khj');
  assert.throws(() => e.u('finance').khj.generate(k.id), PermissionError);
  const list = e.u('khj').khj.generate(k.id);
  assert.deepEqual(list.map((x) => x.khj_no), ['ขจ.1/2570', 'ขจ.2/2570', 'ขจ.3/2570', 'ขจ.4/2570']);
  const groups = list.map((x) => `${x.fund_group}/${x.pay_method}`).sort();
  assert.deepEqual(groups, ['บกศ./KTB', 'บกศ./เช็ค', 'รายได้/KTB', 'อุดหนุน/เช็ค']);
  assert.equal(list.reduce((s, x) => s + x.total, 0), k.total); // Σ ขจ. = ยอด ขบ.
  assert.throws(() => e.u('khj').khj.generate(k.id), /จัดแล้ว|ซ้ำ/);
});

test('ผู้ทำ ขจ. ต้องไม่ใช่ผู้ทำ ขบ. (แม้ถือบทบาทผู้ทำ ขจ. ด้วย)', () => {
  const e = env3();
  e.as('admin').users.create({ name: 'สองบทบาท', email: E('both'), roles: ['finance', 'khj_maker'], appointment_ref: 'x' });
  const { lines } = seedLines(e);
  const k = e.app.asUser(E('both')).khb.create({ line_ids: lines.map((l) => l.id) });
  e.app.asUser(E('both')).workflow.submit('khb', k.id);
  for (const w of ['reviewer1', 'reviewer2', 'reviewer3']) { e.u(w).workflow.receive('khb', k.id); e.u(w).workflow.pass('khb', k.id); }
  assert.throws(() => e.app.asUser(E('both')).workflow.receiveSigned('khb', k.id, SCAN), PermissionError);
  e.u('khj').workflow.receiveSigned('khb', k.id, SCAN);
  assert.throws(() => e.app.asUser(E('both')).khj.generate(k.id), PermissionError);
});

test('ขจ. สองกลุ่มรวมไม่เท่า ขบ. → ส่งตรวจไม่ได้', () => {
  const e = env3();
  const { lines } = seedLines(e);
  const k = e.u('finance').khb.create({ line_ids: lines.map((l) => l.id) });
  reviewAll(e, 'khb', k.id, 'khj');
  const list = e.u('khj').khj.generate(k.id);
  // จำลองข้อมูลเพี้ยน: แถวหลุดจาก ขจ. (แก้ตรงในตาราง ไม่ผ่านบริการ)
  e.app.store.update({ email: 'x' }, 'payment_lines', lines[0].id, { khj_id: '' });
  assert.deepEqual(fieldsOf(() => e.u('khj').workflow.submit('khj', list[0].id)), ['total']);
});

test('ผอ. เซ็น ขจ. → ล็อกแถว แก้ทับไม่ได้ · ผิดต้องทำรายการกลับ + เหตุผล (ไม่ลบ ยอดหักล้าง)', () => {
  const e = env3();
  const { lines } = seedLines(e);
  const k = e.u('finance').khb.create({ line_ids: lines.map((l) => l.id) });
  reviewAll(e, 'khb', k.id, 'khj');
  const list = e.u('khj').khj.generate(k.id);
  for (const j of list) reviewAll(e, 'khj', j.id, 'finance');
  const ls = e.u('finance').payments.listLines();
  assert.equal(ls.every((l) => l.locked && l.status === 'ขจ.เซ็นแล้ว'), true);
  assert.throws(() => e.u('finance').payments.updateLine(lines[0].id, { base_amount: 1 }, 'x'), /ล็อก/);
  assert.deepEqual(fieldsOf(() => e.u('finance').payments.reverseLine(lines[0].id, '')), ['reason']);
  const rev = e.u('finance').payments.reverseLine(lines[0].id, 'ใบส่งของซ้ำ');
  assert.deepEqual([rev.base_amount, rev.request_amount, rev.reverses], [-100000, -100000, lines[0].id]);
  const after = e.u('finance').payments.listLines();
  assert.equal(after.find((l) => l.id === lines[0].id).status, 'ทำรายการกลับ');
  assert.equal(after.length, lines.length + 1); // ไม่ลบแถว
  assert.throws(() => e.u('finance').payments.reverseLine(lines[0].id, 'ซ้ำอีก'), /กลับแล้ว/);
  assert.equal(e.u('finance').khj.list().every((j) => j.status === 'ผอ. เซ็นแล้ว'), true);
});
