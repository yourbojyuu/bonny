// รวมข้อมูลจากบริการต่าง ๆ ให้ core/print.js สร้าง HTML A4 · หน้าเว็บแสดงผลแล้วสั่งพิมพ์ (window.print)
import { fail } from '../core/errors.js';
import { requirePermission } from '../core/roles.js';
import * as P from '../core/print.js';
import { formatThaiDate } from '../core/thaidate.js';
import { getOrFail } from './common.js';
import * as approvals from './approvals.js';
import * as documents from './documents.js';
import * as cheques from './cheques.js';
import * as bank from './bank.js';
import * as daily from './daily.js';
import * as ledger from './ledger.js';
import * as receipts from './receipts.js';
import * as reports from './reports.js';

const nameOf = (ctx, email) => { if (!email) return ''; const u = ctx.store.find('users', (x) => x.email === email)[0]; return u ? u.name : String(email).split('@')[0]; };
const school = (ctx) => ctx.settings.school_name;
const director = (ctx) => ctx.settings.director_name;
const signersOf = (ctx, type, id, makerEmail) => {
  const steps = ctx.store.list('review_steps').filter((r) => r.doc_type === type && r.doc_id === id && r.action === 'pass');
  const last = steps.length ? Math.max(...steps.map((r) => r.round)) : 0;
  const by = (n) => nameOf(ctx, (steps.filter((r) => r.round === last && r.step === n).pop() || {}).user);
  return { maker: nameOf(ctx, makerEmail), r1: by('1'), r2: by('2'), r3: by('3') };
};

export function render(ctx, kind, arg) {
  const base = { school: school(ctx), director_name: director(ctx) };
  const out = (title, html) => ({ title, html });
  switch (kind) {
    case 'approval': {
      const r = approvals.get(ctx, arg);
      const pj = ctx.store.get('plan_projects', r.project_id) || {};
      return out(`ใบขออนุมัติใช้เงิน ${r.approval_code || ''}`, P.docApproval({ ...base, date: r.decided_at ? String(r.decided_at).slice(0, 10) : ctx.today(), approval_code: r.approval_code, requester: nameOf(ctx, r.requester), project: pj.name || '', fund_code: r.fund_code, items: r.items, amount: r.amount, plan_reviewer: nameOf(ctx, r.plan_reviewer) }));
    }
    case 'khb': {
      requirePermission(ctx, 'masters.read');
      const k = getOrFail(ctx, 'khb', arg, 'ขบ.');
      const lines = ctx.store.list('payment_lines').filter((l) => l.khb_id === k.id).map((l) => ({ ...l, payee: (ctx.store.get('payees', l.payee_id) || {}).name || '' }));
      return out(`ขบ. ${k.khb_no}`, P.docKhb({ ...base, khb_no: k.khb_no, date: k.date, lines, total: lines.reduce((s, l) => s + l.request_amount, 0), signers: signersOf(ctx, 'khb', k.id, k.maker) }));
    }
    case 'khj': {
      requirePermission(ctx, 'masters.read');
      const k = getOrFail(ctx, 'khj', arg, 'ขจ.');
      const khb = ctx.store.get('khb', k.khb_id) || {};
      const ls = ctx.store.list('payment_lines').filter((l) => l.khj_id === k.id);
      const by = new Map();
      for (const l of ls) { const x = by.get(l.payee_id) || { pay: 0, tax: 0 }; x.pay += l.pay_amount; x.tax += l.tax_amount; by.set(l.payee_id, x); }
      const cqs = ctx.store.list('cheques').filter((c) => c.khj_id === k.id && c.status !== 'เสีย');
      const items = [...by.entries()].map(([pid, x]) => { const c = cqs.find((q) => q.payee_id === pid); return { payee: (ctx.store.get('payees', pid) || {}).name || '', ref: c ? c.cheque_no : (k.pay_method === 'เช็ค' ? '(ยังไม่ออกเช็ค)' : 'โอน KTB'), amount: x.pay, tax: x.tax, amount_text: c ? c.amount_text : '' }; });
      return out(`ขจ. ${k.khj_no}`, P.docKhj({ ...base, khj_no: k.khj_no, khb_no: khb.khb_no || '', date: k.date, fund_group: k.fund_group, pay_method: k.pay_method, items, total: ls.reduce((s, l) => s + l.request_amount, 0), pay_total: ls.reduce((s, l) => s + l.pay_amount, 0), tax_total: ls.reduce((s, l) => s + l.tax_amount, 0), signers: signersOf(ctx, 'khj', k.id, k.maker) }));
    }
    case 'cheque': {
      const c = cheques.listCheques(ctx).find((x) => x.id === arg);
      if (!c) fail('id', 'ไม่พบเช็ค');
      const lines = c.line_ids.map((id) => ctx.store.get('payment_lines', id)).filter(Boolean);
      return out(`เช็ค ${c.cheque_no}`, P.docCheque({ ...base, cheque_no: c.cheque_no, date: c.date, print_name: c.print_name, amount: c.amount, amount_text: c.amount_text, khj_no: c.khj_no, attachment: c.attachment, lines }));
    }
    case 'cheque_register': {
      const a = getOrFail(ctx, 'bank_accounts', arg, 'บัญชี');
      const r = cheques.register(ctx, arg);
      return out('ทะเบียนคุมเช็ค', P.docChequeRegister({ ...base, account: a.account_no, fund_group: a.fund_group, rows: r.rows, gaps: r.gaps }));
    }
    case 'deposit_register': {
      const a = getOrFail(ctx, 'bank_accounts', arg.account_id, 'บัญชี');
      const r = bank.register(ctx, arg.account_id, arg.month);
      return out('ทะเบียนเงินฝากธนาคาร', P.docDepositRegister({ ...base, account_type: a.type, bank: a.bank, branch: a.branch, account_no: a.account_no, fund_group: a.fund_group, fiscal_year: Number(arg.month.slice(0, 4)) + (Number(arg.month.slice(5)) >= ctx.settings.fiscal_year_start_month ? 544 : 543), month: arg.month, opening: r.opening, closing: r.closing, rows: r.rows, signed_by: nameOf(ctx, r.signed_by) }));
    }
    case 'daily': {
      const rep = daily.report(ctx, arg);
      const day = daily.getDay(ctx, arg);
      return out(`รายงานเงินคงเหลือประจำวัน ${arg}`, P.docDaily({ ...base, report: rep, day: day && { ...day, signers: (day.signers || []).map((e) => nameOf(ctx, e)) } }));
    }
    case 'tax': return out(`สรุปภาษีหัก ณ ที่จ่าย ${arg}`, P.docTax({ ...base, summary: ledger.taxSummary(ctx, arg) }));
    case 'receipts_month': return out(`สรุปรายรับ ${arg}`, P.docReceiptsMonth({ ...base, summary: receipts.monthlySummary(ctx, arg) }));
    case 'plan_summary': return out(`สรุปผลการใช้เงินตามแผน ${arg}`, P.docPlanSummary({ ...base, plan: reports.planSummary(ctx, Number(arg)) }));
    default: return fail('kind', `ไม่รู้จักเอกสารชนิด ${kind}`);
  }
}
