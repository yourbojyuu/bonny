// ผู้รับเงิน · เลขบัญชีแก้ได้ผ่านคำขอที่มีผู้อนุมัติ (ผู้อนุมัติ ≠ ผู้ยื่น) เท่านั้น
import { fail, PermissionError } from '../core/errors.js';
import { requirePermission } from '../core/roles.js';
import { daysBetween } from '../core/thaidate.js';
import { digitsOnly } from '../core/validate.js';
import { validateWith, requireReason, getOrFail, rejectFields, norm } from './common.js';

const ACCOUNT_FIELDS = ['bank', 'account_no', 'account_changed_at', 'account_change_approved_by'];

function check(ctx, rec, selfId) {
  return validateWith(ctx, 'payees', rec, (out, c) => {
    out.name = norm(out.name);
    if (out.name && ctx.store.find('payees', (p) => p.active && norm(p.name) === out.name && p.id !== selfId).length) c.add('name', 'มีผู้รับเงินชื่อนี้แล้ว');
    if (!out.cheque_print_name) out.cheque_print_name = out.name;
  });
}

export function createPayee(ctx, input) {
  requirePermission(ctx, 'payees.manage');
  rejectFields(input, ['id', ...ACCOUNT_FIELDS], 'เลขบัญชีต้องแก้ผ่านคำขอเปลี่ยนบัญชีที่มีผู้อนุมัติ');
  return ctx.store.insert(ctx.user, 'payees', check(ctx, input, null));
}

export function updatePayee(ctx, id, patch, reason) {
  requirePermission(ctx, 'payees.manage');
  rejectFields(patch, ['id', ...ACCOUNT_FIELDS], 'เลขบัญชีต้องแก้ผ่านคำขอเปลี่ยนบัญชีที่มีผู้อนุมัติ');
  const why = requireReason(reason);
  const { created_by, created_at, updated_at, ...plain } = getOrFail(ctx, 'payees', id, 'ผู้รับเงิน');
  return ctx.store.update(ctx.user, 'payees', id, check(ctx, { ...plain, ...patch }, id), { reason: why });
}

const STATUS = { '': 'รออนุมัติ', approve: 'อนุมัติแล้ว', reject: 'ไม่อนุมัติ' };
const withStatus = (r) => ({ ...r, status: STATUS[r.decision] });

export function requestAccountChange(ctx, payeeId, { bank, account_no, reason } = {}) {
  requirePermission(ctx, 'payees.account.request');
  const p = getOrFail(ctx, 'payees', payeeId, 'ผู้รับเงิน');
  if (ctx.store.find('payee_account_changes', (r) => r.payee_id === payeeId && !r.decision).length) {
    fail('payee_id', 'ผู้รับเงินนี้มีคำขอที่รออนุมัติอยู่แล้ว');
  }
  const no = digitsOnly(account_no);
  const rec = validateWith(ctx, 'payee_account_changes', {
    payee_id: payeeId, old_bank: p.bank, old_account_no: p.account_no,
    new_bank: bank, new_account_no: no, reason, requested_by: ctx.user.email,
  }, (out, c) => {
    if (no && !/^\d+$/.test(no)) c.add('account_no', 'เลขที่บัญชีต้องเป็นตัวเลข');
    // แสดง error ด้วยชื่อช่องที่ผู้ใช้กรอก
    for (const [from, to] of [['new_bank', 'bank'], ['new_account_no', 'account_no']]) {
      const e = c.errors.find((x) => x.field === from);
      if (e) e.field = to;
    }
  });
  return withStatus(ctx.store.insert(ctx.user, 'payee_account_changes', rec, { reason: rec.reason }));
}

function decide(ctx, reqId, decision, reason) {
  requirePermission(ctx, 'payees.account.approve');
  return ctx.store.withLock(() => {
    const r = getOrFail(ctx, 'payee_account_changes', reqId, 'คำขอ');
    if (r.decision) fail('id', `คำขอนี้ตัดสินแล้ว (${STATUS[r.decision]})`);
    if (r.requested_by.toLowerCase() === ctx.user.email.toLowerCase()) {
      throw new PermissionError('ผู้อนุมัติต้องไม่ใช่ผู้ยื่นคำขอ');
    }
    const patch = { decision, decided_by: ctx.user.email, decided_at: ctx.store.now(), decision_reason: reason || '' };
    const saved = ctx.store.update(ctx.user, 'payee_account_changes', reqId, patch, { reason: reason || 'อนุมัติคำขอเปลี่ยนบัญชี' });
    if (decision === 'approve') {
      ctx.store.update(ctx.user, 'payees', r.payee_id, {
        bank: r.new_bank, account_no: r.new_account_no,
        account_changed_at: ctx.today(), account_change_approved_by: ctx.user.email,
      }, { reason: `อนุมัติคำขอเปลี่ยนบัญชี ${reqId}` });
    }
    return withStatus(saved);
  });
}

export const approveAccountChange = (ctx, reqId) => decide(ctx, reqId, 'approve', '');
export function rejectAccountChange(ctx, reqId, reason) {
  const why = requireReason(reason);
  return decide(ctx, reqId, 'reject', why);
}

export function listAccountChanges(ctx) {
  requirePermission(ctx, 'masters.read');
  return ctx.store.list('payee_account_changes').map(withStatus);
}

export function listPayees(ctx) {
  requirePermission(ctx, 'masters.read');
  return ctx.store.list('payees');
}

export function getPayee(ctx, id) {
  requirePermission(ctx, 'masters.read');
  return getOrFail(ctx, 'payees', id, 'ผู้รับเงิน');
}

/** บัญชีที่ถูกแก้ภายใน N วัน → ขึ้นธงทุกครั้งที่จ่าย (ใช้ในขั้น 4) */
export function isAccountRecentlyChanged(payee, today, days) {
  if (!payee.account_changed_at) return false;
  const d = daysBetween(payee.account_changed_at, today);
  return d >= 0 && d <= days;
}
