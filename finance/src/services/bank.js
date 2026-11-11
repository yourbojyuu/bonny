// ธนาคาร (ผังหน้า 8): ใบนำฝาก · นำเข้า statement · จับคู่ · หักกลบ OTID · งบกระทบยอด · รายการปรับปรุง · ทะเบียนเงินฝาก (คำนวณจาก Ledger)
import { fail, PermissionError, collector } from '../core/errors.js';
import { toSatang, formatSatang } from '../core/money.js';
import { daysBetween, isValidDate } from '../core/thaidate.js';
import { requirePermission } from '../core/roles.js';
import { hasRole } from './handoffs.js';
import { lockedThrough } from './daily.js';
import { validateWith, getOrFail, requireReason, norm } from './common.js';

const needFinance = (ctx) => { if (!hasRole(ctx.user, 'finance')) throw new PermissionError('เฉพาะการเงินทำรายการนี้'); };
const sum = (xs) => xs.reduce((s, x) => s + x, 0);
const monthEnd = (m) => `${m}-31`;
const addLedger = (ctx, e) => ctx.store.insert(ctx.user, 'ledger', { fund_code: '', subfund_code: '', debit: 0, credit: 0, memo: '', ...e });
const groupOfAccount = (ctx, id) => (ctx.store.get('bank_accounts', id) || {}).fund_group;

/* ---------------- ใบนำฝาก ---------------- */
export function cashByGroup(ctx, r) {
  const out = {};
  if (r.loan_id) {
    const loan = ctx.store.get('loans', r.loan_id);
    const fund = loan && ctx.store.find('funds', (f) => f.fund_code === loan.fund_code)[0];
    if (fund) out[fund.fund_group] = r.bks_cash + r.inc_cash + r.other;
    return out;
  }
  for (const s of ctx.store.list('receipt_splits').filter((x) => x.receipt_id === r.id)) {
    const g = (ctx.store.find('subfunds', (x) => x.code === s.subfund_code)[0] || {}).group;
    if (g && s.cash_amount) out[g] = (out[g] || 0) + s.cash_amount;
  }
  return out;
}
function transferByGroup(ctx, r) {
  const out = {};
  for (const s of ctx.store.list('receipt_splits').filter((x) => x.receipt_id === r.id)) {
    const g = (ctx.store.find('subfunds', (x) => x.code === s.subfund_code)[0] || {}).group;
    if (g && s.transfer_amount) out[g] = (out[g] || 0) + s.transfer_amount;
  }
  return out;
}

/** เงินสดตามใบเสร็จของกลุ่มเงินที่ยังไม่ฝาก */
export function undeposited(ctx, group) {
  requirePermission(ctx, 'masters.read');
  const done = new Set(ctx.store.list('deposit_slips').filter((s) => s.fund_group === group).flatMap((s) => s.receipt_ids));
  const rows = ctx.store.list('receipts').filter((r) => r.status !== 'ยกเลิก' && !done.has(r.id)).map((r) => ({ id: r.id, cash: cashByGroup(ctx, r)[group] || 0 })).filter((x) => x.cash > 0);
  return { group, receipts: rows, total: sum(rows.map((x) => x.cash)) };
}

export function createDeposit(ctx, input) {
  if (!hasRole(ctx.user, 'finance') && !hasRole(ctx.user, 'income')) throw new PermissionError('เฉพาะการเงินหรืองานรายรับนำฝาก');
  return ctx.store.withLock(() => {
    const rec = validateWith(ctx, 'deposit_slips', { slip_no: norm(input.slip_no), account_id: input.account_id, date: input.date, amount: input.amount, receipt_ids: input.receipt_ids || [] }, (out, c) => {
      const acct = ctx.store.get('bank_accounts', out.account_id);
      if (!acct || acct.type !== 'ออมทรัพย์') c.add('account_id', 'ใบนำฝากต้องฝากเข้าบัญชีออมทรัพย์ของกลุ่มเงิน');
      if (out.slip_no && ctx.store.find('deposit_slips', (s) => s.slip_no === out.slip_no).length) c.add('slip_no', 'เลขที่ใบนำฝากนี้มีแล้ว');
      if (Number.isInteger(out.amount) && out.amount <= 0) c.add('amount', 'ยอดฝากต้องมากกว่า 0');
      { const lt = lockedThrough(ctx); if (out.date && lt && out.date <= lt) c.add('date', `วันที่ ${out.date} ถูกล็อกแล้ว (ปิดวันถึง ${lt})`); }
      const group = acct ? acct.fund_group : '';
      const pending = new Map(undeposited(ctx, group).receipts.map((x) => [x.id, x.cash]));
      let expected = 0;
      for (const id of out.receipt_ids) { if (!pending.has(id)) c.add('receipt_ids', `ใบเสร็จ ${id} ไม่มีเงินสดของกลุ่ม ${group} ที่ยังไม่ฝาก`); else expected += pending.get(id); }
      out.fund_group = group; out.expected = expected; out.difference = (out.amount || 0) - expected;
      out.flags = out.difference !== 0 ? [`เงินสดที่ฝากไม่ตรงกับใบเสร็จ ส่วนต่าง ${formatSatang(out.difference)} บาท`] : [];
    });
    const slip = ctx.store.insert(ctx.user, 'deposit_slips', rec);
    addLedger(ctx, { date: rec.date, location: 'cash', credit: rec.amount, source_type: 'deposit_slip', source_id: slip.id, memo: `ใบนำฝาก ${rec.slip_no}` });
    addLedger(ctx, { date: rec.date, location: rec.account_id, debit: rec.amount, source_type: 'deposit_slip', source_id: slip.id, memo: `ใบนำฝาก ${rec.slip_no}` });
    return slip;
  });
}

/* ---------------- นำเข้า statement ---------------- */
function csvSplit(line, d) {
  const out = []; let cur = '', q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) { if (ch === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += ch; }
    else if (ch === '"') q = true; else if (ch === d) { out.push(cur); cur = ''; } else cur += ch;
  }
  out.push(cur);
  return out.map((x) => x.trim());
}
function parseDate(s) {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(s) || null;
  let iso = null;
  if (m) { let y = Number(m[3]); if (y > 2400) y -= 543; iso = `${y}-${String(m[2]).padStart(2, '0')}-${String(m[1]).padStart(2, '0')}`; }
  else if (/^\d{4}-\d{2}-\d{2}/.test(s)) iso = s.slice(0, 10);
  return iso && isValidDate(iso) ? iso : null;
}
function parseMoney(s) {
  let t = String(s ?? '').replace(/[,\s]/g, '').toUpperCase();
  if (!t) return null;
  let neg = false;
  if (/^\(.*\)$/.test(t)) { neg = true; t = t.slice(1, -1); }
  if (t.endsWith('-')) { neg = true; t = t.slice(0, -1); }
  if (t.endsWith('DR')) { neg = true; t = t.slice(0, -2); } else if (t.endsWith('CR')) t = t.slice(0, -2);
  if (t.startsWith('-')) { neg = !neg; t = t.slice(1); }
  try { const v = toSatang(t); return neg ? -v : v; } catch { return null; }
}
const hnorm = (h) => String(h).toLowerCase().replace(/[^a-z]/g, '');

function parseStatement(text) {
  const raw = String(text || '').split(/\r?\n/).filter((l) => l.trim());
  if (!raw.length) fail('text', 'ไม่มีข้อมูล');
  const delim = raw[0].includes('\t') ? '\t' : ',';
  const head = csvSplit(raw[0], delim).map(hnorm);
  const col = (...names) => head.findIndex((h) => names.includes(h));
  const ix = { date: col('date'), teller: col('tellerid'), code: col('transactioncode', 'txncode', 'code'), desc: col('description', 'details'), cheque: col('chequeno', 'chequenumber'), amount: col('amount'), debit: col('debit', 'withdrawal'), credit: col('credit', 'deposit'), balance: col('balance'), branch: col('initbr', 'branch') };
  if (ix.date < 0 || (ix.amount < 0 && (ix.debit < 0 || ix.credit < 0))) fail('text', 'ไม่พบหัวคอลัมน์ Date และ Amount (หรือ Debit/Credit) ในบรรทัดแรก');
  const errs = [], rows = [];
  raw.slice(1).forEach((line, i) => {
    const f = csvSplit(line, delim);
    const d = parseDate(f[ix.date] || '');
    let amt = ix.amount >= 0 ? parseMoney(f[ix.amount]) : (parseMoney(f[ix.credit]) || 0) - (parseMoney(f[ix.debit]) || 0);
    if (!d) errs.push(`บรรทัด ${i + 2}: วันที่ไม่ถูกต้อง "${f[ix.date] || ''}"`);
    else if (amt === null) errs.push(`บรรทัด ${i + 2}: จำนวนเงินไม่ถูกต้อง`);
    else rows.push({ line_date: d, teller_id: f[ix.teller] || '', txn_code: String(f[ix.code] || '').trim().toUpperCase(), description: f[ix.desc] || '', cheque_no: String(f[ix.cheque] || '').trim(), amount: amt, balance: ix.balance >= 0 ? parseMoney(f[ix.balance]) : null, branch: f[ix.branch] || '' });
  });
  if (errs.length) fail('text', errs.slice(0, 5).join(' · '));
  if (!rows.length) fail('text', 'ไม่มีรายการใต้หัวคอลัมน์');
  return rows;
}

const catOf = (ctx, code) => { const m = ctx.settings.statement_codes; return Object.keys(m).find((k) => m[k].includes(code)) || 'other'; };
const setLine = (ctx, l, patch, reason) => ctx.store.update(ctx.user, 'bank_statement_lines', l.id, patch, { reason });

function runMatching(ctx, accountId) {
  const acct = ctx.store.get('bank_accounts', accountId);
  const ids = new Set([accountId]);
  if (acct && acct.linked_account_id) ids.add(acct.linked_account_id);
  for (const a of ctx.store.list('bank_accounts')) if (a.linked_account_id === accountId) ids.add(a.id);
  let matched = 0;
  const tol = ctx.settings.deposit_match_days;
  const near = (a, b) => Math.abs(daysBetween(a, b)) <= tol;
  for (const id of ids) {
    const group = groupOfAccount(ctx, id);
    const all = () => ctx.store.list('bank_statement_lines');
    const takenSrc = () => new Set(all().map((l) => l.matched_source).filter(Boolean));
    for (const l of all().filter((x) => x.account_id === id && ['ยังไม่จับคู่', 'ไม่พบเอกสาร'].includes(x.match_status))) {
      const cat = catOf(ctx, l.txn_code);
      const taken = takenSrc();
      let hit = null;
      if (cat === 'overdraft') continue; // จับคู่ในขั้นหักกลบด้านล่าง
      if (cat === 'deposit' && l.amount > 0) {
        const s = ctx.store.list('deposit_slips').find((x) => x.account_id === id && x.amount === l.amount && near(x.date, l.line_date) && !taken.has(`deposit_slip:${x.id}`));
        if (s) hit = { src: `deposit_slip:${s.id}` };
      } else if (cat === 'cheque' && l.amount < 0) {
        const digits = l.cheque_no.replace(/\D/g, '');
        const c = digits && ctx.store.list('cheques').find((x) => Number(x.cheque_no) === Number(digits) && x.amount === -l.amount && ['ลงนามแล้ว', 'ผู้รับรับแล้ว'].includes(x.status) && (ctx.store.get('cheque_books', x.book_id) || {}).bank_account_id === id);
        if (c) { ctx.store.update(ctx.user, 'cheques', c.id, { status: 'ขึ้นเงินแล้ว', cleared_at: l.line_date }, { reason: 'เช็คขึ้นเงินตาม statement' }); hit = { src: `cheque:${c.id}` }; }
      } else if (cat === 'ktb' && l.amount < 0) {
        for (const b of ctx.store.list('ktb_batches').filter((x) => x.txn_ref)) {
          const by = new Map();
          for (const pl of ctx.store.list('payment_lines').filter((x) => x.khj_id === b.khj_id && x.pay_method === 'KTB' && x.status !== 'ทำรายการกลับ')) {
            const f = ctx.store.find('funds', (x) => x.fund_code === pl.fund_code)[0];
            if (f && f.bank_account_id === id) by.set(pl.payee_id, (by.get(pl.payee_id) || 0) + pl.pay_amount);
          }
          const p = [...by.entries()].find(([pid, amt]) => amt === -l.amount && !taken.has(`ktb:${b.id}:${pid}`));
          if (p) { hit = { src: `ktb:${b.id}:${p[0]}` }; break; }
        }
      } else if (cat === 'interest' && l.amount > 0) {
        addLedger(ctx, { date: l.line_date, subfund_code: 'ดอกเบี้ย', location: id, debit: l.amount, source_type: 'interest', source_id: l.id, memo: 'ดอกเบี้ยเงินฝาก (statement)' });
        setLine(ctx, l, { match_status: 'ดอกเบี้ย', matched_source: `interest:${l.id}` }, 'จับคู่ดอกเบี้ย'); matched++; continue;
      } else if (l.amount > 0) {
        const r = ctx.store.list('receipts').filter((x) => x.status !== 'ยกเลิก').find((x) => {
          const t = transferByGroup(ctx, x)[group] || 0;
          if (!t || taken.has(`receipt:${x.id}`)) return false;
          return (x.kcorp_ref && l.description.toUpperCase().includes(x.kcorp_ref.toUpperCase())) || (t === l.amount && near(x.date, l.line_date));
        });
        if (r) hit = { src: `receipt:${r.id}` };
      }
      if (hit) { setLine(ctx, l, { match_status: 'จับคู่แล้ว', matched_source: hit.src }, 'จับคู่ statement'); matched++; }
      else if (l.match_status !== 'ไม่พบเอกสาร') setLine(ctx, l, { match_status: 'ไม่พบเอกสาร' }, 'ไม่พบเอกสารที่ตรงกัน');
    }
  }
  // หักกลบ OTID (Overdraft protection): บัญชีกระแสรายวัน +x คู่กับบัญชีออมทรัพย์ −x วันเดียวกัน
  const otid = ctx.store.list('bank_statement_lines').filter((x) => ids.has(x.account_id) && x.match_status === 'ยังไม่จับคู่' && catOf(ctx, x.txn_code) === 'overdraft');
  for (const cur of otid.filter((x) => x.amount > 0)) {
    const ca = ctx.store.get('bank_accounts', cur.account_id);
    const sv = ca && ca.linked_account_id && otid.find((x) => x.account_id === ca.linked_account_id && x.amount === -cur.amount && x.line_date === cur.line_date && x.match_status === 'ยังไม่จับคู่');
    if (!sv) continue;
    setLine(ctx, cur, { match_status: 'หักกลบ OTID', matched_source: `otid:${cur.id}` }, 'หักกลบ OTID');
    setLine(ctx, sv, { match_status: 'หักกลบ OTID', matched_source: `otid:${cur.id}` }, 'หักกลบ OTID');
    addLedger(ctx, { date: cur.line_date, location: sv.account_id, credit: cur.amount, source_type: 'otid_transfer', source_id: cur.id, memo: 'OTID โอนจากออมทรัพย์เข้ากระแสรายวัน' });
    addLedger(ctx, { date: cur.line_date, location: cur.account_id, debit: cur.amount, source_type: 'otid_transfer', source_id: cur.id, memo: 'OTID โอนจากออมทรัพย์เข้ากระแสรายวัน' });
    matched += 2;
  }
  return matched;
}

export function importStatement(ctx, { account_id, text } = {}) {
  needFinance(ctx);
  return ctx.store.withLock(() => {
    if (!account_id || !ctx.store.get('bank_accounts', account_id)) fail('account_id', 'ไม่พบบัญชีธนาคาร');
    const rows = parseStatement(text);
    const key = (r) => [r.line_date, r.txn_code, r.amount, r.balance, r.cheque_no, r.description].join('|');
    const seen = new Set(ctx.store.list('bank_statement_lines').filter((l) => l.account_id === account_id).map(key));
    let imported = 0, skipped = 0;
    for (const r of rows) {
      if (seen.has(key(r))) { skipped++; continue; }
      seen.add(key(r));
      ctx.store.insert(ctx.user, 'bank_statement_lines', { ...r, account_id, match_status: 'ยังไม่จับคู่', matched_source: '' });
      imported++;
    }
    const matched = runMatching(ctx, account_id);
    return { imported, skipped, matched };
  });
}
export function statementLines(ctx, accountId) {
  requirePermission(ctx, 'masters.read');
  return ctx.store.list('bank_statement_lines').filter((l) => l.account_id === accountId);
}

/* ---------------- รายการปรับปรุง (ต้องมีผู้อนุมัติ) ---------------- */
export function createAdjustment(ctx, input) {
  needFinance(ctx);
  return ctx.store.insert(ctx.user, 'adjustments', validateWith(ctx, 'adjustments', { account_id: input.account_id, date: input.date, amount: input.amount, reason: input.reason, maker: ctx.user.email }, (out, c) => {
    if (!ctx.store.get('bank_accounts', out.account_id)) c.add('account_id', 'ไม่พบบัญชีธนาคาร');
    if (Number.isInteger(out.amount) && out.amount === 0) c.add('amount', 'ยอดปรับปรุงต้องไม่เป็น 0');
  }));
}
export function approveAdjustment(ctx, id) {
  return ctx.store.withLock(() => {
    if (!ctx.user.roles.some((r) => (ctx.settings.adjustment_approver_roles || []).includes(r))) throw new PermissionError('ไม่มีสิทธิ์อนุมัติรายการปรับปรุง');
    const a = getOrFail(ctx, 'adjustments', id, 'รายการปรับปรุง');
    if (a.approved_at) fail('id', 'อนุมัติแล้ว');
    if (a.maker.toLowerCase() === ctx.user.email.toLowerCase()) throw new PermissionError('ผู้อนุมัติต้องไม่ใช่ผู้ทำรายการปรับปรุง');
    const saved = ctx.store.update(ctx.user, 'adjustments', id, { approved_by: ctx.user.email, approved_at: ctx.store.now() }, { reason: 'อนุมัติรายการปรับปรุง' });
    addLedger(ctx, { date: a.date, location: a.account_id, debit: a.amount > 0 ? a.amount : 0, credit: a.amount < 0 ? -a.amount : 0, source_type: 'adjustment', source_id: id, memo: `ปรับปรุง: ${a.reason}` });
    const line = ctx.store.list('bank_statement_lines').find((l) => l.account_id === a.account_id && l.amount === a.amount && l.line_date === a.date && ['ยังไม่จับคู่', 'ไม่พบเอกสาร'].includes(l.match_status));
    if (line) setLine(ctx, line, { match_status: 'จับคู่แล้ว', matched_source: `adjustment:${id}` }, 'จับคู่กับรายการปรับปรุง');
    return saved;
  });
}
export const listAdjustments = (ctx) => { requirePermission(ctx, 'masters.read'); return ctx.store.list('adjustments'); };

/* ---------------- งบกระทบยอด ---------------- */
export function reconcile(ctx, accountId, month) {
  requirePermission(ctx, 'masters.read');
  const end = monthEnd(month);
  const lines = ctx.store.list('bank_statement_lines').filter((l) => l.account_id === accountId && l.line_date <= end);
  const sorted = lines.map((l, i) => ({ l, i })).sort((a, b) => (a.l.line_date < b.l.line_date ? -1 : a.l.line_date > b.l.line_date ? 1 : a.i - b.i)).map((x) => x.l);
  const stmt = sorted.length ? sorted[sorted.length - 1].balance : null;
  const ledgerBal = sum(ctx.store.list('ledger').filter((e) => e.location === accountId && e.date <= end).map((e) => e.debit - e.credit));
  const books = new Set(ctx.store.list('cheque_books').filter((b) => b.bank_account_id === accountId).map((b) => b.id));
  const outstanding = ctx.store.list('cheques').filter((c) => books.has(c.book_id) && c.received_at && String(c.received_at).slice(0, 10) <= end && (c.status === 'ผู้รับรับแล้ว' || (c.status === 'ขึ้นเงินแล้ว' && c.cleared_at > end)));
  const matchedSlips = new Set(lines.map((l) => l.matched_source).filter((s) => s && s.startsWith('deposit_slip:')));
  const transit = ctx.store.list('deposit_slips').filter((s) => s.account_id === accountId && s.date <= end && !matchedSlips.has(`deposit_slip:${s.id}`));
  const open = lines.filter((l) => ['ยังไม่จับคู่', 'ไม่พบเอกสาร'].includes(l.match_status));
  const credits = open.filter((l) => l.amount > 0), debits = open.filter((l) => l.amount < 0);
  const adjusted = ledgerBal + sum(outstanding.map((c) => c.amount)) - sum(transit.map((s) => s.amount));
  const diff = stmt === null ? null : stmt - adjusted;
  const flags = [];
  if (stmt === null) flags.push('ยังไม่ได้นำเข้า statement ของเดือนนี้');
  else if (diff !== 0) flags.push(`ยอดไม่ตรง ส่วนต่าง ${formatSatang(diff)} บาท แก้ได้ด้วยรายการปรับปรุงที่มีผู้อนุมัติเท่านั้น`);
  if (credits.length) flags.push(`เงินเข้าที่ยังไม่ออกใบเสร็จ ${credits.length} รายการ`);
  if (debits.length) flags.push(`รายการออกที่ไม่พบเอกสาร ${debits.length} รายการ`);
  return { account_id: accountId, month, statement_balance: stmt, ledger_balance: ledgerBal, outstanding_cheques: outstanding, deposits_in_transit: transit, unmatched_credits: credits, unmatched_debits: debits, adjusted_ledger: adjusted, diff, ok: diff === 0, flags };
}

/* ---------------- ทะเบียนเงินฝากธนาคาร (จาก Ledger) ---------------- */
export function register(ctx, accountId, month) {
  requirePermission(ctx, 'masters.read');
  const start = `${month}-01`, end = monthEnd(month);
  const es = ctx.store.list('ledger').filter((e) => e.location === accountId);
  const isOpening = (e) => e.source_type === 'opening';
  const opening = sum(es.filter((e) => (isOpening(e) && e.date <= end) || (!isOpening(e) && e.date < start)).map((e) => e.debit - e.credit));
  const mine = es.map((e, i) => ({ e, i })).filter(({ e }) => !isOpening(e) && e.date >= start && e.date <= end).sort((a, b) => (a.e.date < b.e.date ? -1 : a.e.date > b.e.date ? 1 : a.i - b.i)).map((x) => x.e);
  const groups = new Map();
  for (const e of mine) {
    let key = `${e.source_type}:${e.source_id}`, type = e.source_type, no = '', desc = e.memo;
    if (e.source_type === 'deposit_slip') { type = 'ใบนำฝาก'; const s = ctx.store.get('deposit_slips', e.source_id); no = s ? s.slip_no : ''; }
    else if (e.source_type === 'receipt_split' || e.source_type === 'receipt_loan' || e.source_type === 'receipt_split_reversal') {
      type = 'Kcorp'; const sp = ctx.store.get('receipt_splits', e.source_id); const r = ctx.store.get('receipts', sp ? sp.receipt_id : e.source_id);
      no = r ? r.kcorp_ref : ''; key = `rc:${r ? r.id : e.source_id}:${e.source_type.endsWith('reversal') ? 'rev' : 'in'}`; desc = r ? `รับโอน (ใบเสร็จ ${r.book_no}/${r.receipt_no})` : e.memo;
    } else if (e.source_type === 'payment_line') {
      const l = ctx.store.get('payment_lines', e.source_id);
      if (l && l.cheque_no) { type = 'เช็ค'; no = l.cheque_no; key = `cq:${l.cheque_no}`; desc = 'จ่ายด้วยเช็ค'; }
      else if (l && l.ktb_ref) { type = 'KTB'; no = l.ktb_ref; key = `ktb:${l.ktb_ref}:${l.payee_id}`; desc = 'โอนผ่าน KTB'; }
    } else if (e.source_type === 'interest') { type = 'ดอกเบี้ย'; desc = 'รับดอกเบี้ยเงินฝาก'; }
    else if (e.source_type === 'otid_transfer') { type = 'OTID'; desc = e.memo; }
    else if (e.source_type === 'adjustment') { type = 'ปรับปรุง'; desc = e.memo; }
    const g = groups.get(key) || { month, date: e.date, doc_type: type, doc_no: no, description: desc, in: 0, out: 0 };
    g.in += e.debit; g.out += e.credit; groups.set(key, g);
  }
  let bal = opening;
  const rows = [...groups.values()].map((g) => { bal += g.in - g.out; return { ...g, balance: bal }; });
  const so = ctx.store.find('register_signoffs', (s) => s.account_id === accountId && s.month === month)[0];
  return { account_id: accountId, month, opening, rows, closing: bal, signed_by: so ? so.signed_by : '', signed_at: so ? so.signed_at : '' };
}

/** หัวหน้าหน่วยงานย่อยลงนามทะเบียนรายเดือน (เมื่อกระทบยอดตรงเท่านั้น) */
export function signMonth(ctx, { account_id, month } = {}) {
  if (!hasRole(ctx.user, 'unit_head')) throw new PermissionError('เฉพาะหัวหน้าหน่วยงานย่อยลงนามทะเบียนเงินฝาก');
  return ctx.store.withLock(() => {
    if (!/^\d{4}-\d{2}$/.test(String(month || ''))) fail('month', 'เดือนต้องเป็นรูปแบบ ปี ค.ศ.-เดือน เช่น 2026-11');
    if (!account_id || !ctx.store.get('bank_accounts', account_id)) fail('account_id', 'ไม่พบบัญชีธนาคาร');
    if (ctx.store.find('register_signoffs', (s) => s.account_id === account_id && s.month === month).length) fail('month', 'เดือนนี้ลงนามแล้ว');
    const r = reconcile(ctx, account_id, month);
    if (!r.ok) fail('month', 'งบกระทบยอดยังไม่ตรง ลงนามไม่ได้');
    return ctx.store.insert(ctx.user, 'register_signoffs', { account_id, month, signed_by: ctx.user.email, signed_at: ctx.store.now() });
  });
}
