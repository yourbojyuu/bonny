// โอนผ่าน KTB Corporate Online (ผังหน้า 6): ระบบสร้างไฟล์จาก ขจ. → การเงิน (ผู้ตั้ง) อัปโหลด → ผู้บริหารอนุมัติใน KTB (≠ ผู้ตั้ง) → การเงินกรอกเลขธุรกรรม = จ่ายแล้ว
// รูปแบบไฟล์เป็นรูปแบบชั่วคราว (CSV) รอตัวอย่างไฟล์ KTB Corporate จริง (HANDOFF 12.16)
import { fail, PermissionError, collector } from '../core/errors.js';
import { formatSatang } from '../core/money.js';
import { hasRole } from './handoffs.js';
import { getOrFail } from './common.js';
import { recordPaid } from './ledger.js';

const needFinance = (ctx) => { if (!hasRole(ctx.user, 'finance')) throw new PermissionError('เฉพาะการเงินจัดการชุดโอน KTB'); };
const viewOf = (b) => ({ ...b, status: b.txn_ref ? 'จ่ายแล้ว' : b.approved_at ? 'อนุมัติแล้ว รอเลขธุรกรรม' : b.uploaded_at ? 'อัปโหลดแล้ว รอผู้บริหารอนุมัติ' : 'สร้างไฟล์แล้ว' });
const linesOf = (ctx, khjId) => ctx.store.list('payment_lines').filter((l) => l.khj_id === khjId && l.pay_method === 'KTB' && l.status !== 'ทำรายการกลับ');

export function createBatch(ctx, khjId) {
  needFinance(ctx);
  return ctx.store.withLock(() => {
    const khj = khjId ? ctx.store.get('khj', khjId) : null;
    if (!khj) fail('khj_id', 'ไม่พบ ขจ.');
    const st = ctx.store.get('doc_flow', `khj:${khjId}`);
    if (!st || st.stage !== 'done') fail('khj_id', 'ต้องเป็น ขจ. ที่ ผอ. เซ็นแล้ว');
    if (khj.pay_method !== 'KTB') fail('khj_id', 'ขจ. นี้ไม่ได้จ่ายผ่าน KTB');
    if (ctx.store.list('ktb_batches').some((b) => b.khj_id === khjId)) fail('khj_id', 'มีชุดโอนของ ขจ. นี้แล้ว');
    const lines = linesOf(ctx, khjId);
    const c = collector();
    for (const pid of new Set(lines.map((l) => l.payee_id))) {
      const p = ctx.store.get('payees', pid);
      if (!p || !p.account_no || !p.bank) c.add('payee_id', `ผู้รับ ${p ? p.name : pid} ยังไม่มีเลขบัญชีในทะเบียนผู้รับเงิน`);
    }
    c.throwIfAny();
    const total = lines.reduce((s, l) => s + l.pay_amount, 0), tax_total = lines.reduce((s, l) => s + l.tax_amount, 0);
    const khjTotal = lines.reduce((s, l) => s + l.request_amount, 0);
    if (total + tax_total !== khjTotal) fail('total', 'ยอดชุดโอนรวมภาษีที่หักไว้ไม่เท่ายอด ขจ.');
    const saved = ctx.store.insert(ctx.user, 'ktb_batches', { khj_id: khjId, file_name: `KTB-${khj.khj_no.replace('/', '-')}.csv`, total, tax_total, maker: ctx.user.email });
    return viewOf(saved);
  });
}

/** เนื้อไฟล์โอน (รวมหลายแถวของผู้รับเดียวเป็นรายการเดียว) */
export function fileContent(ctx, id) {
  needFinance(ctx);
  const b = getOrFail(ctx, 'ktb_batches', id, 'ชุดโอน');
  const by = new Map();
  for (const l of linesOf(ctx, b.khj_id)) by.set(l.payee_id, (by.get(l.payee_id) || 0) + l.pay_amount);
  const rows = [...by.entries()].map(([pid, amt]) => { const p = ctx.store.get('payees', pid); return [p.account_no, p.bank, p.name, formatSatang(amt).replace(/,/g, ''), b.file_name].map((x) => `"${String(x).replace(/"/g, '""')}"`).join(','); });
  return ['account_no,bank,payee_name,amount_baht,reference', ...rows].join('\n');
}

export function markUploaded(ctx, id) {
  needFinance(ctx);
  return ctx.store.withLock(() => {
    const b = getOrFail(ctx, 'ktb_batches', id, 'ชุดโอน');
    if (b.maker.toLowerCase() !== ctx.user.email.toLowerCase()) throw new PermissionError('เฉพาะผู้ตั้งรายการเป็นผู้อัปโหลด');
    if (b.uploaded_at) fail('id', 'อัปโหลดแล้ว');
    return viewOf(ctx.store.update(ctx.user, 'ktb_batches', id, { uploaded_at: ctx.store.now() }, { reason: 'อัปโหลดไฟล์ขึ้น KTB' }));
  });
}

/** บันทึกว่าผู้บริหารอนุมัติใน KTB แล้ว (ผู้อนุมัติอยู่ในรายชื่อผู้มีสิทธิ์ และ ≠ ผู้ตั้ง) */
export function recordApproval(ctx, id, approverId) {
  needFinance(ctx);
  return ctx.store.withLock(() => {
    const b = getOrFail(ctx, 'ktb_batches', id, 'ชุดโอน');
    if (!b.uploaded_at) fail('id', 'ต้องอัปโหลดไฟล์ขึ้น KTB ก่อน');
    if (b.approved_at) fail('id', 'อนุมัติแล้ว');
    const allowed = ctx.settings.ktb_approver_user_ids || [];
    const u = approverId ? ctx.store.get('users', approverId) : null;
    if (!allowed.length) fail('approver_id', 'ยังไม่ได้ตั้งรายชื่อผู้มีสิทธิ์อนุมัติ KTB ในค่าตั้ง');
    if (!u || !u.active || !allowed.includes(u.id)) fail('approver_id', 'ผู้อนุมัติต้องอยู่ในรายชื่อผู้มีสิทธิ์อนุมัติ KTB');
    if (u.email.toLowerCase() === b.maker.toLowerCase()) fail('approver_id', 'ผู้อนุมัติต้องไม่ใช่ผู้ตั้งรายการ');
    return viewOf(ctx.store.update(ctx.user, 'ktb_batches', id, { approver_id: u.id, approved_at: ctx.store.now() }, { reason: `ผู้บริหารอนุมัติใน KTB: ${u.name}` }));
  });
}

/** กรอกเลขธุรกรรม: ก่อนกรอกยังไม่นับว่าจ่าย */
export function recordTxn(ctx, id, txnRef) {
  needFinance(ctx);
  return ctx.store.withLock(() => {
    const b = getOrFail(ctx, 'ktb_batches', id, 'ชุดโอน');
    if (!b.approved_at) fail('id', 'ต้องมีผู้บริหารอนุมัติใน KTB ก่อน');
    if (b.txn_ref) fail('id', 'จ่ายแล้ว');
    const ref = String(txnRef || '').trim();
    if (!ref) fail('txn_ref', 'ต้องกรอกเลขธุรกรรม KTB');
    const saved = ctx.store.update(ctx.user, 'ktb_batches', id, { txn_ref: ref, paid_at: ctx.store.now() }, { reason: 'กรอกเลขธุรกรรม KTB' });
    recordPaid(ctx, linesOf(ctx, b.khj_id), { ktb_ref: ref });
    return viewOf(saved);
  });
}

export const listBatches = (ctx) => ctx.store.list('ktb_batches').map(viewOf);

/** รายชื่อผู้มีสิทธิ์อนุมัติใน KTB (ให้การเงินเลือกตอนบันทึก) */
export function approvers(ctx) {
  needFinance(ctx);
  return (ctx.settings.ktb_approver_user_ids || []).map((id) => ctx.store.get('users', id)).filter((u) => u && u.active).map((u) => ({ id: u.id, name: u.name }));
}
