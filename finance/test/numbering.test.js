import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup } from './helpers.js';
import { issueDocNumber, formatDocNo, checkSequence } from '../src/core/numbering.js';

// ตารางทดสอบแทน approval_requests/khb ที่จะสร้างในขั้น 3
const extraTables = {
  test_docs: {
    label: 'เอกสารทดสอบ', idPrefix: 'T',
    columns: [
      { key: 'id', type: 'id' },
      { key: 'doc_no', type: 'string', required: true },
      { key: 'date', type: 'date', required: true },
    ],
  },
};
const spec = { prefixSetting: 'doc_prefix_approval', table: 'test_docs', field: 'doc_no' };

function env() {
  const e = setup({ extraTables });
  const ctx = e.as('finance').ctx;
  const issue = (date, extra = {}) =>
    issueDocNumber(ctx, spec, date, (docNo) => ({ doc_no: docNo, date, ...extra }));
  return { ...e, ctx, issue };
}

test('รูปแบบเลข: prefix + เลข + / + ปีงบ พ.ศ. 4 หลัก ไม่มี 0 นำ', () => {
  assert.equal(formatDocNo('ขบ.', 1, 2570), 'ขบ.1/2570');
  assert.equal(formatDocNo('ขจ.', 125, 2570), 'ขจ.125/2570');
  assert.equal(formatDocNo('', 3, 2570), '3/2570'); // เงินยืม
});

test('รหัสอนุมัติใช้ prefix จาก settings (ค่าเริ่ม อม. [รอยืนยัน])', () => {
  const { issue } = env();
  assert.equal(issue('2026-11-10').doc_no, 'อม.1/2570');
});

test('ออกเลขต่อเนื่อง ไม่ซ้ำ ไม่ขาด', () => {
  const { issue, ctx } = env();
  const nos = Array.from({ length: 50 }, () => issue('2026-11-10').doc_no);
  assert.equal(nos[49], 'อม.50/2570');
  assert.deepEqual(checkSequence(nos), { gaps: [], duplicates: [] });
  assert.equal(ctx.store.list('test_docs').length, 50);
});

test('ขึ้นปีงบใหม่ (1 ต.ค.) เริ่มเลข 1 ใหม่', () => {
  const { issue } = env();
  issue('2027-09-30');
  assert.equal(issue('2027-09-30').doc_no, 'อม.2/2570');
  assert.equal(issue('2027-10-01').doc_no, 'อม.1/2571');
  assert.equal(issue('2027-09-29').doc_no, 'อม.3/2570');
});

test('เปลี่ยน prefix ใน settings แล้วเลขยังต่อจากเดิม', () => {
  const { issue, as } = env();
  issue('2026-11-10');
  as('admin').settings.update('doc_prefix_approval', 'AP', 'ทดสอบเปลี่ยนรูปแบบ');
  assert.equal(issue('2026-11-10').doc_no, 'AP2/2570');
});

test('บันทึกเอกสารล้มเหลว → ไม่เสียเลข (เลขไม่ขาด)', () => {
  const { issue, ctx } = env();
  issue('2026-11-10');
  assert.throws(() => issueDocNumber(ctx, spec, '2026-11-10', () => ({ date: 'ไม่ใช่วันที่' })));
  assert.equal(issue('2026-11-10').doc_no, 'อม.2/2570');
});

test('ผู้ใช้พิมพ์เลขเอกสารเองไม่ได้', () => {
  const { ctx } = env();
  assert.throws(
    () => issueDocNumber(ctx, spec, '2026-11-10', () => ({ doc_no: 'อม.99/2570', date: '2026-11-10' })),
    /ระบบออกให้/,
  );
});

test('ออกเลขภายใต้ lock: ระหว่างถือ lock ออกเลขซ้อนไม่ได้', () => {
  const { ctx, issue } = env();
  assert.throws(
    () => issueDocNumber(ctx, spec, '2026-11-10', (docNo) => {
      issue('2026-11-10'); // คนที่สองกดพร้อมกัน
      return { doc_no: docNo, date: '2026-11-10' };
    }),
    /lock/i,
  );
  assert.equal(issue('2026-11-10').doc_no, 'อม.1/2570');
});

test('ตรวจเลขขาด/ซ้ำจากรายการเลขที่มีอยู่', () => {
  const r = checkSequence(['ขบ.1/2570', 'ขบ.2/2570', 'ขบ.4/2570', 'ขบ.4/2570', 'ขบ.1/2571']);
  assert.deepEqual(r, { gaps: [{ fiscal_year: 2570, missing: [3] }], duplicates: ['ขบ.4/2570'] });
});
