// เงินยืม: สัญญา → ทะเบียนเงินยืม (สถานะคำนวณจากวันที่) · ผู้ยืมที่มีเงินยืมเกินกำหนดค้าง ยืมใหม่ไม่ได้ (กฎข้อ 7)
import { collector } from '../core/errors.js';
import { reserveDocNumber } from '../core/numbering.js';
import { addDays, daysBetween } from '../core/thaidate.js';
import { hasRole } from './handoffs.js';
import { PermissionError } from '../core/errors.js';
import { findByCode } from './approvals.js';
import { validateWith } from './common.js';

const SPEC = { prefixSetting: 'doc_prefix_loan', table: 'loans', field: 'loan_no' };
const same = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();

export function settledDocs(ctx, loanId) {
  return ctx.store.list('payment_lines').filter((l) => l.kind === 'ส่งใช้เงินยืม' && l.loan_id === loanId).reduce((s, l) => s + l.request_amount, 0);
}
export function settledCash(ctx, loanId) {
  if (!ctx.store.tables.receipts) return 0; // ฝั่งรับ (ขั้น 5) คืนเงินสดอ้างสัญญา
  return ctx.store.list('receipts').filter((r) => r.loan_id === loanId && r.status !== 'ยกเลิก').reduce((s, r) => s + (r.total || 0), 0);
}

/** สถานะคำนวณเอง: ส่งใช้แล้ว / เกินกำหนด / ยืมอยู่ */
export function loanView(ctx, l) {
  const docs = settledDocs(ctx, l.id), cash = settledCash(ctx, l.id);
  const today = ctx.today();
  let status = 'ยืมอยู่', overdue_days = 0;
  if (docs + cash >= l.amount) status = 'ส่งใช้แล้ว';
  else if (today > l.due_date) { status = 'เกินกำหนด'; overdue_days = daysBetween(l.due_date, today); }
  return { ...l, settled_docs: docs, settled_cash: cash, status, overdue_days };
}

export const listLoans = (ctx) => ctx.store.list('loans').map((l) => loanView(ctx, l));
export const hasOverdue = (ctx, email) => listLoans(ctx).some((l) => same(l.borrower, email) && l.status === 'เกินกำหนด');

export function createLoan(ctx, input) {
  if (!hasRole(ctx.user, 'finance')) throw new PermissionError('เฉพาะการเงินทำสัญญาเงินยืม');
  return ctx.store.withLock(() => {
    const rec = validateWith(ctx, 'loans', { approval_code: input.approval_code, borrower: String(input.borrower || '').trim().toLowerCase(), amount: input.amount }, (out, c) => {
      const req = findByCode(ctx, out.approval_code);
      if (!req || req.route !== 'เงินยืม') c.add('approval_code', 'ต้องเป็นรหัสอนุมัติที่การเงินจำแนกเป็นเงินยืมแล้ว');
      else if (Number.isInteger(out.amount)) {
        const used = ctx.store.list('loans').filter((l) => l.approval_code === out.approval_code).reduce((s, l) => s + l.amount, 0);
        if (out.amount <= 0 || used + out.amount > req.amount) c.add('amount', 'ยอดยืมเกินยอดที่ ผอ. อนุมัติ');
        out.fund_code = req.fund_code;
      }
      if (out.borrower && !out.borrower.endsWith(`@${ctx.settings.allowed_email_domain}`)) c.add('borrower', `ผู้ยืมต้องเป็นอีเมล @${ctx.settings.allowed_email_domain}`);
      else if (out.borrower && hasOverdue(ctx, out.borrower)) c.add('borrower', 'ผู้ยืมมีเงินยืมเกินกำหนดค้างอยู่ ยืมใหม่ไม่ได้');
    });
    const date = ctx.today();
    const { docNo } = reserveDocNumber(ctx, SPEC, date);
    const saved = ctx.store.insert(ctx.user, 'loans', { ...rec, loan_no: docNo, date, due_date: addDays(date, ctx.settings.loan_due_days) });
    return loanView(ctx, saved);
  });
}
