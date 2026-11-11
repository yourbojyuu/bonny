// วัสดุ (ผังหน้า 3): พัสดุจัดซื้อตามรหัส (ยอด ≤ ที่อนุมัติ · เลข e-GP) → ตรวจรับ (กรรมการ ≠ ผู้ขอซื้อ) → ส่งชุดเบิกให้การเงินกดรับ
import { fail, PermissionError } from '../core/errors.js';
import { hasRole, sendHandoff, receiveHandoff, pendingHandoffs } from './handoffs.js';
import { findByCode } from './approvals.js';
import { validateWith, getOrFail } from './common.js';

const needProc = (ctx) => { if (!hasRole(ctx.user, 'procurement')) throw new PermissionError('เฉพาะพัสดุทำรายการนี้'); };
const same = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();
const view = (p) => ({ ...p, status: p.sent_at ? 'ส่งชุดเบิกแล้ว' : p.inspected_at ? 'ตรวจรับแล้ว' : 'จัดซื้อแล้ว' });

export function purchase(ctx, input) {
  needProc(ctx);
  return ctx.store.withLock(() => {
    const rec = validateWith(ctx, 'procurements', { approval_code: input.approval_code, vendor: input.vendor, amount: input.amount, egp_no: input.egp_no }, (out, c) => {
      const req = findByCode(ctx, out.approval_code);
      if (!req || req.status === 'ปิดรหัส') c.add('approval_code', 'ไม่พบรหัสอนุมัติ หรือรหัสปิดแล้ว');
      else if (req.route !== 'วัสดุ') c.add('approval_code', 'รหัสนี้การเงินยังไม่ได้จำแนกเป็นวัสดุ');
      else if (Number.isInteger(out.amount)) {
        const used = ctx.store.list('procurements').filter((p) => p.approval_code === out.approval_code).reduce((s, p) => s + p.amount, 0);
        if (out.amount <= 0 || used + out.amount > req.amount) c.add('amount', 'ยอดจัดซื้อเกินยอดที่ ผอ. อนุมัติ ครูต้องยื่นขออนุมัติเพิ่ม');
      }
    });
    const h = pendingHandoffs(ctx).filter((x) => x.doc_type === 'approval' && x.step_key === 'procure' && x.doc_id === findByCode(ctx, rec.approval_code).id)[0];
    if (h && hasRole(ctx.user, h.to_role) && h.sent_by.toLowerCase() !== ctx.user.email.toLowerCase()) receiveHandoff(ctx, h.id, { reason: 'พัสดุรับเรื่องและจัดซื้อ' }); // การลงมือจัดซื้อ = กดรับ
    return view(ctx.store.insert(ctx.user, 'procurements', { ...rec, purchased_by: ctx.user.email }));
  });
}

export function inspect(ctx, id) {
  needProc(ctx);
  return ctx.store.withLock(() => {
    const p = getOrFail(ctx, 'procurements', id, 'รายการจัดซื้อ');
    const req = findByCode(ctx, p.approval_code);
    if (same(req.requester, ctx.user.email)) throw new PermissionError('กรรมการตรวจรับต้องไม่ใช่ผู้ขอซื้อ');
    if (p.inspected_at) fail('id', 'ตรวจรับแล้ว');
    return view(ctx.store.update(ctx.user, 'procurements', id, { inspector: ctx.user.email, inspected_at: ctx.store.now() }, { reason: 'บันทึกผลตรวจรับ' }));
  });
}

export function sendBundle(ctx, id) {
  needProc(ctx);
  return ctx.store.withLock(() => {
    const p = getOrFail(ctx, 'procurements', id, 'รายการจัดซื้อ');
    if (!p.inspected_at) fail('id', 'ต้องตรวจรับก่อนจึงส่งชุดเบิกได้');
    if (p.sent_at) fail('id', 'ส่งชุดเบิกแล้ว');
    sendHandoff(ctx, { doc_type: 'procurement', doc_id: id, step_key: 'bundle', from_role: 'procurement', to_role: 'finance' });
    return view(ctx.store.update(ctx.user, 'procurements', id, { sent_at: ctx.store.now() }, { reason: 'ส่งชุดเบิกให้การเงิน' }));
  });
}

/** การเงินกดรับชุดเบิกจากพัสดุ */
export function receiveBundle(ctx, id) {
  return ctx.store.withLock(() => {
    const h = pendingHandoffs(ctx).filter((x) => x.doc_type === 'procurement' && x.doc_id === id)[0];
    if (!h) fail('id', 'ไม่พบชุดเบิกที่รอรับ');
    receiveHandoff(ctx, h.id, { reason: 'การเงินกดรับชุดเบิก' });
    return view(getOrFail(ctx, 'procurements', id));
  });
}

export const listProcurements = (ctx) => ctx.store.list('procurements').map(view);
export const isInspected = (ctx, code) => ctx.store.list('procurements').some((p) => p.approval_code === code && p.inspected_at);
