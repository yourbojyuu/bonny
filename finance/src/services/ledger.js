// Ledger (append-only): debit = เงินเข้า/เพิ่ม · credit = เงินออก/ลด · ที่เก็บเงิน = บัญชีธนาคารของประเภทเงิน
// ภาษีที่หักไว้ยังอยู่ในบัญชีจนกว่าจะจ่ายเป็นแถว "ภาษีนำส่ง"
import { requirePermission } from '../core/roles.js';
import { closeIfComplete } from './approvals.js';
import { hasRole } from './handoffs.js';
import { fail, PermissionError } from '../core/errors.js';
import { isValidDate } from '../core/thaidate.js';

/** บันทึกว่าจ่ายแล้ว: แถวเป็น "จ่ายแล้ว" + ledger (ผู้เรียกถือ lock) */
export function recordPaid(ctx, lines, patch = {}) {
  const date = ctx.today();
  const codes = new Set();
  for (const l of lines) {
    ctx.store.update(ctx.user, 'payment_lines', l.id, { ...patch, status: 'จ่ายแล้ว', paid_date: date }, { reason: 'จ่ายแล้ว' });
    const fund = ctx.store.find('funds', (f) => f.fund_code === l.fund_code)[0];
    ctx.store.insert(ctx.user, 'ledger', { date, fund_code: l.fund_code, location: fund ? fund.bank_account_id : '', debit: 0, credit: l.pay_amount, source_type: 'payment_line', source_id: l.id, memo: `${l.kind} ${l.vendor_doc_no}` });
    if (l.approval_code) codes.add(l.approval_code);
  }
  if (ctx.settings.close_code_mode === 'auto') for (const c of codes) closeIfComplete(ctx, c);
}

export function listLedger(ctx) {
  requirePermission(ctx, 'masters.read');
  return ctx.store.list('ledger');
}

export function balance(ctx) {
  requirePermission(ctx, 'masters.read');
  const m = new Map();
  for (const e of ctx.store.list('ledger')) {
    const key = e.fund_code || e.subfund_code;
    const r = m.get(key) || { fund_code: key, debit: 0, credit: 0 };
    r.debit += e.debit; r.credit += e.credit; m.set(key, r);
  }
  return [...m.values()].filter((r) => r.fund_code).map((r) => ({ ...r, balance: r.debit - r.credit }));
}

/** สรุปภาษีหัก ณ ที่จ่ายรายเดือน (ตามวันที่จ่าย) แยก ภ.ง.ด.3 / 53 ต่อผู้รับ */
export function taxSummary(ctx, ym) {
  requirePermission(ctx, 'masters.read');
  const lines = ctx.store.list('payment_lines').filter((l) => l.status === 'จ่ายแล้ว' && l.tax_amount > 0 && String(l.paid_date).startsWith(ym));
  const forms = [];
  for (const form of ['ภ.ง.ด.3', 'ภ.ง.ด.53']) {
    const byPayee = new Map();
    for (const l of lines.filter((x) => x.tax_form === form)) {
      const r = byPayee.get(l.payee_id) || { payee_id: l.payee_id, name: (ctx.store.get('payees', l.payee_id) || {}).name || '', base: 0, tax: 0 };
      r.base += l.base_amount; r.tax += l.tax_amount; byPayee.set(l.payee_id, r);
    }
    if (byPayee.size) { const rows = [...byPayee.values()]; forms.push({ form, base: rows.reduce((s, r) => s + r.base, 0), tax: rows.reduce((s, r) => s + r.tax, 0), rows }); }
  }
  return { month: ym, forms, total_tax: forms.reduce((s, f) => s + f.tax, 0) };
}

/** ยอดยกมา ณ วันเริ่มใช้ระบบ ต่อบัญชีธนาคาร (ใช้ตรวจกับ statement) · ย้ายข้อมูลขั้น 8 ใช้ต่อ */
export function opening(ctx, { account_id, amount, date } = {}) {
  if (!hasRole(ctx.user, 'finance')) throw new PermissionError('เฉพาะการเงินบันทึกยอดยกมา');
  if (!account_id || !ctx.store.get('bank_accounts', account_id)) fail('account_id', 'ไม่พบบัญชีธนาคาร');
  if (!Number.isInteger(amount)) fail('amount', 'ยอดต้องเป็นสตางค์จำนวนเต็ม');
  if (!isValidDate(date)) fail('date', 'วันที่ไม่ถูกต้อง');
  if (amount === 0) return null;
  return ctx.store.insert(ctx.user, 'ledger', { date, fund_code: '', subfund_code: '', location: account_id, debit: amount > 0 ? amount : 0, credit: amount < 0 ? -amount : 0, source_type: 'opening', source_id: account_id, memo: 'ยอดยกมา' }, { reason: 'ยอดยกมาตั้งต้น' });
}
