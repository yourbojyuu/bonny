// รายงานผู้บริหาร (ธงแดง · งานค้างรับ · เช็คค้าง · ค้างชำระ · เงินยืมเลยกำหนด · แผนใช้เกิน 90%) · สรุปผลการใช้เงินตามแผน · สิ้นปีงบ
import { requirePermission } from '../core/roles.js';
import { daysBetween } from '../core/thaidate.js';
import { formatSatang } from '../core/money.js';
import { pendingHandoffs, waitDays, overdueHandoffs } from './handoffs.js';
import { listLoans } from './loans.js';
import { projectUsage } from './plan.js';
import { report } from './daily.js';
import { reconcile } from './bank.js';

const sum = (xs) => xs.reduce((s, x) => s + x, 0);
const STEP_NAME = { plan: 'งานแผนรับใบขออนุมัติ', finance: 'การเงินรับเรื่อง', procure: 'พัสดุรับเรื่อง', bundle: 'การเงินรับชุดเบิก', r1: 'ผู้ตรวจชั้น 1', r2: 'ผู้ตรวจชั้น 2', r3: 'ผู้ตรวจชั้น 3', sign: 'รับคืนหลัง ผอ. เซ็น', daily_count: 'กรรมการรับรายงานประจำวัน', daily_sign: 'รับคืนหลัง ผอ. ตรวจการจ่าย' };

export function executive(ctx) {
  requirePermission(ctx, 'masters.read');
  const today = ctx.today();
  const flags = [];
  const add = (level, code, text, ref = '') => flags.push({ level, code, text, ref });

  for (const d of ctx.store.list('daily_close').filter((x) => x.counted_by && x.diff !== 0)) add('red', 'daily_diff', `นับเงินสดวันที่ ${d.date} ไม่ตรง ส่วนต่าง ${formatSatang(d.diff)} บาท: ${d.diff_note || 'ยังไม่มีคำอธิบาย'}`, d.id);
  for (const d of ctx.store.list('daily_close').filter((x) => x.director_sent_at && !x.received_back_at && x.date < today)) add('warn', 'daily_director_pending', `ผอ. ยังไม่ลงนามรายงานประจำวันที่ ${d.date} (ส่งแล้ว ${daysBetween(String(d.director_sent_at).slice(0, 10), today)} วัน)`, d.id);

  for (const h of overdueHandoffs(ctx)) add('warn', 'handoff_overdue', `งานค้างรับเกินกำหนด: ${STEP_NAME[h.step_key] || h.step_key} ${h.doc_id} ค้าง ${h.days} วัน (กำหนด ${h.limit} วัน)`, h.id);

  const [warnDays, redDays] = ctx.settings.cheque_stale_days;
  for (const c of ctx.store.list('cheques').filter((x) => ['ออกแล้ว', 'ลงนามแล้ว', 'ผู้รับรับแล้ว'].includes(x.status))) {
    const age = daysBetween(c.date, today);
    if (age >= redDays) add('red', 'cheque_stale_180', `เช็คเลขที่ ${c.cheque_no} ค้างขึ้นเงิน ${age} วัน (เกิน ${redDays} วัน)`, c.id);
    else if (age >= warnDays) add('warn', 'cheque_stale_150', `เช็คเลขที่ ${c.cheque_no} ค้างขึ้นเงิน ${age} วัน (เกิน ${warnDays} วัน)`, c.id);
  }
  for (const l of listLoans(ctx).filter((x) => x.status === 'เกินกำหนด')) add('red', 'loan_overdue', `เงินยืม ${l.loan_no} ของ ${l.borrower} เกินกำหนด ${l.overdue_days} วัน`, l.id);
  for (const p of ctx.store.list('plan_projects').filter((x) => x.active)) {
    const u = projectUsage(ctx, p);
    const pct = Math.round(((u.committed + u.spent) * 1000) / p.budget) / 10;
    if (pct >= 90) add('warn', 'plan_over_90', `โครงการ "${p.name}" ใช้เงินแล้ว ${pct}% ของวงเงิน`, p.id);
  }
  for (const a of ctx.store.list('bank_accounts').filter((x) => x.active)) {
    const lines = ctx.store.list('bank_statement_lines').filter((l) => l.account_id === a.id);
    if (!lines.length) continue;
    const month = lines.map((l) => l.line_date).sort().pop().slice(0, 7);
    const r = reconcile(ctx, a.id, month);
    if (!r.ok) add('red', 'bank_unreconciled', `บัญชี ${a.account_no} เดือน ${month}: ${r.flags[0]}`, a.id);
  }
  for (const s of ctx.store.list('deposit_slips').filter((x) => x.difference !== 0)) add('red', 'deposit_diff', `ใบนำฝาก ${s.slip_no}: ${s.flags[0]}`, s.id);

  const active = new Set(ctx.store.list('receipts').filter((r) => r.status !== 'ยกเลิก').map((r) => r.id));
  const paidBy = new Map();
  for (const s of ctx.store.list('receipt_splits').filter((x) => active.has(x.receipt_id))) paidBy.set(s.subfund_code, (paidBy.get(s.subfund_code) || 0) + s.amount);
  const dueBy = new Map();
  for (const c of ctx.store.list('collectibles')) dueBy.set(c.subfund_code, (dueBy.get(c.subfund_code) || 0) + c.amount_due);
  const arrears = [...dueBy.entries()].map(([code, due]) => ({ subfund_code: code, due, paid: paidBy.get(code) || 0, outstanding: due - (paidBy.get(code) || 0) })).filter((x) => x.outstanding > 0).sort((a, b) => (a.subfund_code < b.subfund_code ? -1 : 1));

  return { date: today, flags, pending: pendingHandoffs(ctx).map((h) => ({ id: h.id, step_key: h.step_key, doc_type: h.doc_type, doc_id: h.doc_id, days: waitDays(ctx, h) })), arrears };
}

export function planSummary(ctx, fiscalYear) {
  requirePermission(ctx, 'masters.read');
  const rows = ctx.store.list('plan_projects').filter((p) => p.fiscal_year === fiscalYear).map((p) => {
    const u = projectUsage(ctx, p);
    return { id: p.id, name: p.name, fund_code: p.fund_code, budget: p.budget, ...u, pct: Math.round(((u.committed + u.spent) * 1000) / p.budget) / 10 };
  });
  const total = { budget: sum(rows.map((r) => r.budget)), committed: sum(rows.map((r) => r.committed)), spent: sum(rows.map((r) => r.spent)), remaining: sum(rows.map((r) => r.remaining)) };
  return { fiscal_year: fiscalYear, rows, total };
}

function fyRange(fy, startMonth) {
  const endYear = fy - 543;
  const from = startMonth === 1 ? `${endYear}-01-01` : `${endYear - 1}-${String(startMonth).padStart(2, '0')}-01`;
  const last = new Date(Date.UTC(startMonth === 1 ? endYear + 1 : endYear, startMonth === 1 ? 0 : startMonth - 1, 0));
  return { from, to: last.toISOString().slice(0, 10) };
}

/** สิ้นปีงบ: ยอดยกไป (ต่อกลุ่มเงิน = ยอดยกมาปีถัดไป เพราะ Ledger ต่อเนื่อง) · เช็คค้างจ่ายยกข้ามปี · สรุปตามแผน */
export function yearEnd(ctx, fiscalYear) {
  requirePermission(ctx, 'masters.read');
  const { from, to } = fyRange(fiscalYear, ctx.settings.fiscal_year_start_month);
  const rep = report(ctx, to);
  const outstanding = ctx.store.list('cheques').filter((c) => ['ออกแล้ว', 'ลงนามแล้ว', 'ผู้รับรับแล้ว'].includes(c.status) && c.date <= to);
  return { fiscal_year: fiscalYear, from, to, closing: rep.groups.map((g) => ({ group: g.group, balance: g.balance })), outstanding_cheques: outstanding, plan: planSummary(ctx, fiscalYear) };
}
