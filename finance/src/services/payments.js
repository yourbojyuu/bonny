// หน้ารายการ (payment_lines) = ฐานข้อมูลหลักของการจ่าย · 1 แถว = 1 ใบแจ้งหนี้/ใบส่งของ
// ผู้ใช้กรอก: วันที่ เลขที่เอกสารร้าน รายการ มูลค่าสินค้า · เลือก: รหัสอนุมัติ ผู้รับเงิน ชนิด · ระบบเติม: ประเภทเงิน วิธีจ่าย ประเภทภาษี ภาษี ยอดเบิก ธง
import { fail, PermissionError } from '../core/errors.js';
import { calcTax } from '../core/tax.js';
import { requirePermission } from '../core/roles.js';
import { validateWith, requireReason, getOrFail, norm } from './common.js';
import { hasRole } from './handoffs.js';
import { findByCode } from './approvals.js';
import { isInspected } from './procurement.js';
import { isAccountRecentlyChanged } from './payees.js';

const NO_CODE = ['ภาษีนำส่ง', 'คืนเงิน'];
const TAXABLE = ['เบิก', 'พัสดุ', 'ค่าจ้าง', 'สำรองจ่าย'];
const USER_FIELDS = ['approval_code', 'date', 'kind', 'payee_id', 'vendor_doc_no', 'description', 'expense_category', 'base_amount', 'fund_code', 'loan_id'];
const needFinance = (ctx) => { if (!hasRole(ctx.user, 'finance')) throw new PermissionError('เฉพาะการเงินบันทึกหน้ารายการ'); };

function derive(ctx, input, selfId) {
  const pick = {};
  for (const k of USER_FIELDS) if (input[k] !== undefined) pick[k] = input[k];
  return validateWith(ctx, 'payment_lines', pick, (out, c) => {
    out.vendor_doc_no = norm(out.vendor_doc_no);
    const payee = out.payee_id ? ctx.store.get('payees', out.payee_id) : null;
    if (out.payee_id && (!payee || !payee.active)) c.add('payee_id', 'ผู้รับเงินต้องอยู่ในทะเบียนผู้รับเงิน');
    if (!out.vendor_doc_no) c.add('vendor_doc_no', 'ต้องกรอกเลขที่เอกสารร้าน (หรือเลขอ้างอิง)');
    else if (payee && ctx.store.find('payment_lines', (l) => l.id !== selfId && !l.reverses && l.payee_id === out.payee_id && norm(l.vendor_doc_no).toLowerCase() === out.vendor_doc_no.toLowerCase()).length) {
      c.add('vendor_doc_no', 'ผู้รับเงินรายนี้มีเลขที่เอกสารนี้แล้ว (กรอกซ้ำ)');
    }
    if (Number.isInteger(out.base_amount) && out.base_amount <= 0) c.add('base_amount', 'ยอดต้องมากกว่า 0');

    // รหัสอนุมัติ
    let req = null;
    if (!NO_CODE.includes(out.kind)) {
      if (!out.approval_code) c.add('approval_code', 'ต้องเลือกรหัสอนุมัติ');
      else {
        req = findByCode(ctx, out.approval_code);
        if (!req) c.add('approval_code', 'ไม่พบรหัสอนุมัติ');
        else if (req.status === 'ปิดรหัส') { c.add('approval_code', 'รหัสอนุมัติปิดแล้ว ใช้ไม่ได้'); req = null; }
      }
    } else out.approval_code = '';
    if (req) {
      out.fund_code = req.fund_code;
      if (out.kind === 'พัสดุ' && !(req.route === 'วัสดุ' && isInspected(ctx, req.approval_code))) c.add('kind', 'ต้องตรวจรับพัสดุแล้วจึงทำชุดเบิก');
      if (out.kind === 'สำรองจ่าย' && req.route !== 'สำรองจ่าย') c.add('kind', 'รหัสนี้การเงินยังไม่ได้จำแนกเป็นสำรองจ่าย');
      if (out.kind === 'เงินยืม' || out.kind === 'ส่งใช้เงินยืม') {
        const loan = out.loan_id ? ctx.store.get('loans', out.loan_id) : null;
        if (!loan || loan.approval_code !== req.approval_code) c.add('loan_id', 'ต้องมีสัญญาเงินยืมของรหัสอนุมัตินี้');
      }
      // ยอดรวมของรหัส ≤ ยอดอนุมัติ (หลักฐานส่งใช้เงินยืมไม่นับเป็นเงินออกใหม่)
      if (out.kind !== 'ส่งใช้เงินยืม' && Number.isInteger(out.base_amount) && !c.has('base_amount')) {
        const used = ctx.store.list('payment_lines').filter((l) => l.id !== selfId && l.approval_code === req.approval_code && l.kind !== 'ส่งใช้เงินยืม').reduce((s, l) => s + l.request_amount, 0);
        if (used + out.base_amount > req.amount) c.add('base_amount', 'ยอดรวมของรหัสนี้เกินยอดที่ ผอ. อนุมัติ');
      }
    } else if (out.fund_code && !ctx.store.find('funds', (f) => f.fund_code === out.fund_code).length) c.add('fund_code', 'ไม่พบรหัสเงินนี้');

    if (!payee) return;
    out.tax_form = payee.tax_form; out.pay_method = payee.pay_method;
    const tax = TAXABLE.includes(out.kind) && Number.isInteger(out.base_amount) ? calcTax(ctx.settings, payee.tax_form, out.base_amount) : 0;
    out.tax_amount = tax; out.pay_amount = (out.base_amount || 0) - tax; out.request_amount = out.pay_amount + tax;

    const flags = [];
    if (isAccountRecentlyChanged(payee, ctx.today(), ctx.settings.payee_account_flag_days)) flags.push('บัญชีผู้รับเพิ่งเปลี่ยน');
    const allowed = out.fund_code ? ctx.store.find('fund_allowed_expense', (r) => r.active && r.fund_code === out.fund_code) : [];
    if (out.expense_category && allowed.length && !allowed.some((r) => r.expense_category === out.expense_category)) {
      if (ctx.settings.fund_allowed_expense_mode === 'block') c.add('expense_category', 'ค่าใช้จ่ายนี้ไม่อยู่ในรายการที่ประเภทเงินอนุญาต');
      else flags.push('ค่าใช้จ่ายไม่อยู่ในรายการอนุญาต');
    }
    out.flags = flags;
  });
}

export function createLine(ctx, input) {
  needFinance(ctx);
  return ctx.store.withLock(() => {
    const rec = derive(ctx, input, null);
    return ctx.store.insert(ctx.user, 'payment_lines', { ...rec, status: 'บันทึกแล้ว', locked: false });
  });
}

function assertEditable(ctx, line) {
  if (line.locked) fail('id', 'แถวถูกล็อกแล้ว แก้ทับไม่ได้ ต้องทำรายการกลับพร้อมเหตุผล');
  if (line.status === 'ทำรายการกลับ') fail('id', 'แถวนี้ทำรายการกลับแล้ว');
  if (line.khb_id) {
    const st = ctx.store.get('doc_flow', `khb:${line.khb_id}`);
    if (st && st.stage !== 'returned') fail('id', 'แถวอยู่ใน ขบ. ที่กำลังตรวจหรือเซ็นแล้ว แก้ไม่ได้');
  }
}

export function updateLine(ctx, id, patch, reason) {
  needFinance(ctx);
  return ctx.store.withLock(() => {
    const why = requireReason(reason);
    const cur = getOrFail(ctx, 'payment_lines', id, 'แถวในหน้ารายการ');
    assertEditable(ctx, cur);
    const rec = derive(ctx, { ...Object.fromEntries(USER_FIELDS.map((k) => [k, cur[k]])), ...patch }, id);
    return ctx.store.update(ctx.user, 'payment_lines', id, { ...rec, status: cur.status, locked: cur.locked }, { reason: why });
  });
}

/** ทำรายการกลับ: แถวใหม่ยอดติดลบอ้างแถวเดิม · แถวเดิมไม่ถูกลบ */
export function reverseLine(ctx, id, reason) {
  needFinance(ctx);
  return ctx.store.withLock(() => {
    const why = requireReason(reason);
    const cur = getOrFail(ctx, 'payment_lines', id, 'แถวในหน้ารายการ');
    if (cur.reverses) fail('id', 'นี่คือรายการกลับ ทำกลับซ้ำไม่ได้');
    if (cur.status === 'ทำรายการกลับ') fail('id', 'แถวนี้ทำรายการกลับแล้ว');
    if (!cur.locked) fail('id', 'แถวยังไม่ล็อก แก้ไขได้โดยตรง');
    const { id: _i, created_by, created_at, updated_at, ...rest } = cur;
    const rev = ctx.store.insert(ctx.user, 'payment_lines', {
      ...rest, vendor_doc_no: `${cur.vendor_doc_no}-กลับ`, description: `ทำรายการกลับ: ${why}`,
      base_amount: -cur.base_amount, tax_amount: -cur.tax_amount, pay_amount: -cur.pay_amount, request_amount: -cur.request_amount,
      reverses: id, status: 'ทำรายการกลับ', locked: true, flags: [],
    }, { reason: why });
    ctx.store.update(ctx.user, 'payment_lines', id, { status: 'ทำรายการกลับ' }, { reason: why });
    return rev;
  });
}

export function listLines(ctx) {
  requirePermission(ctx, 'masters.read');
  return ctx.store.list('payment_lines');
}
