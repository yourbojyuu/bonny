// รายรับ (ผังหน้า 7): ใบเสร็จ 4 ช่อง (+อื่น ๆ) → รวมยอด → หาแพ็กเกจ → แยกชนิดเงินย่อย (ไม่ตรงใช้ "กำหนดเอง" + เหตุผล) → Σ ที่แยก = ยอดใบเสร็จ → ลง Ledger → ตัดยอดค้างรายคน
import { fail, PermissionError, collector } from '../core/errors.js';
import { requirePermission } from '../core/roles.js';
import { formatSatang } from '../core/money.js';
import { hasRole } from './handoffs.js';
import { assertOpenDay } from './daily.js';
import { validateWith, requireReason, getOrFail, norm } from './common.js';

const CH = ['bks_cash', 'inc_cash', 'bks_transfer', 'inc_transfer', 'other'];
const needFinance = (ctx) => { if (!hasRole(ctx.user, 'finance')) throw new PermissionError('เฉพาะการเงินทำรายการรายรับ'); };
const parsePairs = (list) => Object.fromEntries((list || []).map((x) => { const i = String(x).lastIndexOf('='); return [String(x).slice(0, i), Number(String(x).slice(i + 1))]; }));
const sum = (xs) => xs.reduce((s, x) => s + x, 0);

/* ---------------- แพ็กเกจ ---------------- */
function checkPackage(ctx, out, c) {
  const lines = parsePairs(out.lines);
  const entries = Object.entries(lines);
  if (!entries.length || entries.some(([code, n]) => !Number.isInteger(n) || n <= 0)) c.add('lines', 'รูปแบบต้องเป็น รหัสชนิด=สตางค์ เช่น ก/20=100000');
  else {
    const missing = entries.map(([code]) => code).filter((code) => !ctx.store.find('subfunds', (x) => x.code === code).length);
    if (missing.length) c.add('lines', `ไม่พบชนิดเงินย่อย: ${missing.join(', ')}`);
    else if (sum(entries.map(([, n]) => n)) !== out.total) c.add('lines', 'ผลรวมที่แยกต้องเท่ายอดรวมของแพ็กเกจ');
  }
  const ch = parsePairs(out.channels);
  if (Object.keys(ch).some((k) => !CH.includes(k) || !Number.isInteger(ch[k]) || ch[k] < 0)) c.add('channels', `ช่องเงินต้องเป็น ${CH.join(' / ')} = สตางค์`);
}
export function createPackage(ctx, input) {
  requirePermission(ctx, 'packages.manage');
  return ctx.store.insert(ctx.user, 'packages', validateWith(ctx, 'packages', input, (out, c) => checkPackage(ctx, out, c)));
}
export const listPackages = (ctx) => { requirePermission(ctx, 'masters.read'); return ctx.store.list('packages'); };

/* ---------------- ยอดที่ต้องเก็บ ---------------- */
const activeSplits = (ctx) => {
  const ok = new Map(ctx.store.list('receipts').filter((r) => r.status !== 'ยกเลิก').map((r) => [r.id, r]));
  return ctx.store.list('receipt_splits').filter((s) => ok.has(s.receipt_id)).map((s) => ({ ...s, receipt: ok.get(s.receipt_id) }));
};
const paidOf = (splits, student, code) => sum(splits.filter((s) => s.receipt.student_id === student && s.subfund_code === code).map((s) => s.amount));
const dueOf = (ctx, student, code) => sum(ctx.store.list('collectibles').filter((x) => x.student_id === student && x.subfund_code === code).map((x) => x.amount_due));

export function setCollectible(ctx, input) {
  needFinance(ctx);
  return ctx.store.withLock(() => ctx.store.insert(ctx.user, 'collectibles', validateWith(ctx, 'collectibles', { ...input, student_id: norm(input.student_id) }, (out, c) => {
    const sf = ctx.store.find('subfunds', (x) => x.code === out.subfund_code)[0];
    if (!sf || !sf.has_collectible) c.add('subfund_code', 'ชนิดนี้ไม่ได้ตั้งยอดที่ต้องเก็บ (ตั้งได้เฉพาะ บกศ. และรายได้ SMS)');
    if (Number.isInteger(out.amount_due) && out.amount_due <= 0) c.add('amount_due', 'ยอดต้องมากกว่า 0');
    if (ctx.store.find('collectibles', (x) => x.student_id === out.student_id && x.subfund_code === out.subfund_code && x.academic_year === out.academic_year && x.term === out.term).length) c.add('student_id', 'นักเรียนคนนี้มียอดของชนิด ปี และภาคเรียนนี้แล้ว');
  })));
}
export function listCollectibles(ctx) {
  requirePermission(ctx, 'masters.read');
  const splits = activeSplits(ctx);
  return ctx.store.list('collectibles').map((x) => { const due = dueOf(ctx, x.student_id, x.subfund_code), paid = paidOf(splits, x.student_id, x.subfund_code); return { ...x, paid, outstanding: due - paid }; });
}

/* ---------------- หาแพ็กเกจ ---------------- */
const chOf = (input) => Object.fromEntries(CH.map((k) => [k, input[k] || 0]));
const fits = (pk, ch) => { const spec = parsePairs(pk.channels); return !Object.keys(spec).length || CH.every((k) => (spec[k] || 0) === ch[k]); };

/** ผลการหาแพ็กเกจจากยอดรวม: auto · ambiguous (หลายแพ็กเกจ) · detail_mismatch (ยอดเท่าแต่รายละเอียดต่าง) · none */
export function preview(ctx, input) {
  needFinance(ctx);
  const ch = chOf(input), total = sum(Object.values(ch));
  const cands = ctx.store.list('packages').filter((p) => p.active && p.total === total);
  const ok = cands.filter((p) => fits(p, ch));
  if (ok.length === 1) return { status: 'auto', total, package: ok[0], candidates: cands, splits: Object.entries(parsePairs(ok[0].lines)).map(([subfund_code, amount]) => ({ subfund_code, amount })) };
  return { status: !cands.length ? 'none' : ok.length ? 'ambiguous' : 'detail_mismatch', total, package: null, candidates: cands, splits: [] };
}

/* ---------------- ใบเสร็จ ---------------- */
export function nextNo(ctx, book) {
  const nums = ctx.store.list('receipts').filter((r) => r.book_no === String(book)).map((r) => Number(r.receipt_no));
  return String(nums.length ? Math.max(...nums) + 1 : 1);
}

/** แบ่งเงินสด/โอนให้แต่ละชนิดเงินย่อย: ช่อง บกศ. → ชนิดกลุ่ม บกศ. · ช่อง รด. → กลุ่มรายได้ · ส่วนที่เหลือเอาจากช่องไหนก็ได้ (เงินสดก่อน) */
function allocate(ctx, splits, ch) {
  const pools = { 'บกศ.': { cash: ch.bks_cash, transfer: ch.bks_transfer }, 'รายได้': { cash: ch.inc_cash, transfer: ch.inc_transfer }, '*': { cash: ch.other, transfer: 0 } };
  const take = (p, kind, n) => { const t = Math.min(n, p[kind]); p[kind] -= t; return t; };
  return splits.map((sp) => {
    const sf = ctx.store.find('subfunds', (x) => x.code === sp.subfund_code)[0];
    let rem = sp.amount, cash = 0, transfer = 0;
    const own = pools[sf.group] || pools['*'];
    for (const kind of ['cash', 'transfer']) { const t = take(own, kind, rem); rem -= t; if (kind === 'cash') cash += t; else transfer += t; }
    for (const p of Object.values(pools)) for (const kind of ['cash', 'transfer']) { if (!rem) break; const t = take(p, kind, rem); rem -= t; if (kind === 'cash') cash += t; else transfer += t; }
    return { ...sp, group: sf.group, fund_code: sf.fund_code || '', cash_amount: cash, transfer_amount: transfer };
  });
}

const bankOf = (ctx, group) => (ctx.store.find('bank_accounts', (a) => a.type === 'ออมทรัพย์' && a.fund_group === group)[0] || {}).id || 'bank';

export function issue(ctx, input) {
  needFinance(ctx);
  return ctx.store.withLock(() => {
    const ch = chOf(input);
    const base = validateWith(ctx, 'receipts', { book_no: norm(input.book_no), receipt_no: norm(input.receipt_no), date: input.date, payer: input.payer, student_id: norm(input.student_id), kcorp_ref: norm(input.kcorp_ref), loan_id: input.loan_id || '', ...ch }, (out, cc) => {
      for (const k of CH) if (out[k] < 0) cc.add(k, 'ยอดห้ามติดลบ');
      if (CH.every((k) => out[k] >= 0) && sum(CH.map((k) => out[k])) <= 0) cc.add('total', 'ยอดรวมต้องมากกว่า 0');
      if (out.book_no && out.receipt_no) {
        const exp = nextNo(ctx, out.book_no);
        const has = ctx.store.find('receipts', (r) => r.book_no === out.book_no).length;
        if (!/^\d+$/.test(out.receipt_no)) cc.add('receipt_no', 'เลขที่ต้องเป็นตัวเลข');
        else if (has && out.receipt_no !== exp) cc.add('receipt_no', `เลขที่ต้องต่อเนื่องในเล่ม (เลขถัดไปคือ ${exp})`);
      }
      if (out.bks_transfer + out.inc_transfer > 0 && !out.kcorp_ref) cc.add('kcorp_ref', 'เงินโอนต้องจดเลขที่อ้างอิง Kcorp หลังตรวจยอดเข้าบัญชี');
      if (out.loan_id && !ctx.store.get('loans', out.loan_id)) cc.add('loan_id', 'ไม่พบสัญญาเงินยืม');
    });
    assertOpenDay(ctx, base.date);
    const total = sum(CH.map((k) => base[k]));
    let replaces = '';
    if (input.replaces) {
      const old = ctx.store.get('receipts', input.replaces);
      if (!old || old.status !== 'ยกเลิก') fail('replaces', 'ใบเดิมต้องมีสถานะยกเลิกก่อนจึงออกใบแทนได้');
      replaces = old.id;
    }
    let splits = [], mode = '', pkgId = '', reason = '';
    if (!base.loan_id) {
      const sp = input.split || { mode: 'auto' };
      const col = collector();
      if (sp.mode === 'manual') {
        mode = 'manual'; reason = String(sp.reason || '').trim();
        if (!reason) col.add('manual_reason', 'กำหนดเองต้องระบุเหตุผล');
        if (sp.package_id) {
          const pk = ctx.store.get('packages', sp.package_id);
          if (!pk || !pk.active || pk.total !== total) col.add('package_id', 'แพ็กเกจที่เลือกต้องมียอดรวมเท่ายอดใบเสร็จ');
          else { pkgId = pk.id; splits = Object.entries(parsePairs(pk.lines)).map(([subfund_code, amount]) => ({ subfund_code, amount })); }
        } else {
          splits = (sp.splits || []).map((x) => ({ subfund_code: String(x.subfund_code || ''), amount: x.amount }));
          const bad = splits.filter((x) => !Number.isInteger(x.amount) || x.amount <= 0 || !ctx.store.find('subfunds', (s) => s.code === x.subfund_code).length);
          const diff = total - sum(splits.map((x) => x.amount || 0));
          if (!splits.length || bad.length) col.add('splits', 'ต้องกรอกชนิดเงินย่อยที่มีอยู่ และยอดเป็นสตางค์มากกว่า 0');
          else if (diff !== 0) col.add('splits', `ผลรวมที่แยกต้องเท่ายอดใบเสร็จ (ส่วนต่าง ${formatSatang(diff)} บาท)`);
        }
      } else {
        const pv = preview(ctx, { ...ch });
        if (pv.status !== 'auto') col.add('split', { none: 'ไม่พบแพ็กเกจที่ตรงกับยอดนี้', ambiguous: 'มีหลายแพ็กเกจที่ตรงกัน', detail_mismatch: 'ยอดเท่ากับแพ็กเกจ แต่รายละเอียดต่างกัน' }[pv.status] + ' กดกำหนดเอง');
        else { mode = 'auto'; pkgId = pv.package.id; splits = pv.splits; }
      }
      col.throwIfAny();
      // ชนิดที่ตั้งยอดที่ต้องเก็บ: ต้องมีนักเรียน · รับเกินยอดค้างไม่ได้
      const need = splits.filter((x) => ctx.store.find('subfunds', (s) => s.code === x.subfund_code)[0].has_collectible);
      if (need.length) {
        if (!base.student_id) fail('student_id', 'ชนิดเงินที่ตั้งยอดที่ต้องเก็บต้องระบุรหัสนักเรียน');
        const paid = activeSplits(ctx);
        for (const code of new Set(need.map((x) => x.subfund_code))) {
          const want = sum(need.filter((x) => x.subfund_code === code).map((x) => x.amount));
          const due = dueOf(ctx, base.student_id, code);
          if (!due) fail('splits', `นักเรียน ${base.student_id} ไม่มียอดที่ต้องเก็บของ ${code}`);
          if (want > due - paidOf(paid, base.student_id, code)) fail('splits', `ยอด ${code} เกินยอดค้างชำระของนักเรียน`);
        }
      }
    }
    const rec = ctx.store.insert(ctx.user, 'receipts', { ...base, total, status: replaces ? 'แทนใบเดิม' : 'ปกติ', replaces, package_id: pkgId, split_mode: mode, manual_reason: reason });
    const entry = (e) => ctx.store.insert(ctx.user, 'ledger', { date: base.date, debit: 0, credit: 0, ...e });
    if (base.loan_id) {
      const loan = ctx.store.get('loans', base.loan_id);
      const fund = ctx.store.find('funds', (f) => f.fund_code === loan.fund_code)[0];
      const cash = base.bks_cash + base.inc_cash + base.other, tr = base.bks_transfer + base.inc_transfer;
      if (cash) entry({ fund_code: loan.fund_code, subfund_code: '', location: 'cash', debit: cash, source_type: 'receipt_loan', source_id: rec.id, memo: `คืนเงินยืม ${loan.loan_no}` });
      if (tr) entry({ fund_code: loan.fund_code, subfund_code: '', location: fund ? fund.bank_account_id : 'bank', debit: tr, source_type: 'receipt_loan', source_id: rec.id, memo: `คืนเงินยืม ${loan.loan_no}` });
    } else {
      for (const a of allocate(ctx, splits, ch)) {
        const sp = ctx.store.insert(ctx.user, 'receipt_splits', { receipt_id: rec.id, subfund_code: a.subfund_code, amount: a.amount, cash_amount: a.cash_amount, transfer_amount: a.transfer_amount });
        const memo = `ใบเสร็จ ${base.book_no}/${base.receipt_no}`;
        if (a.cash_amount) entry({ fund_code: a.fund_code, subfund_code: a.subfund_code, location: 'cash', debit: a.cash_amount, source_type: 'receipt_split', source_id: sp.id, memo });
        if (a.transfer_amount) entry({ fund_code: a.fund_code, subfund_code: a.subfund_code, location: bankOf(ctx, a.group), debit: a.transfer_amount, source_type: 'receipt_split', source_id: sp.id, memo });
      }
    }
    return rec;
  });
}

/** ยกเลิกใบผิด (ไม่ลบ): สถานะ ยกเลิก + เหตุผล · ตีกลับ Ledger · ยอดค้างรายคนคืน */
export function cancel(ctx, id, reason) {
  needFinance(ctx);
  return ctx.store.withLock(() => {
    const why = requireReason(reason);
    const r = getOrFail(ctx, 'receipts', id, 'ใบเสร็จ');
    if (r.status === 'ยกเลิก') fail('id', 'ใบเสร็จนี้ยกเลิกแล้ว');
    const saved = ctx.store.update(ctx.user, 'receipts', id, { status: 'ยกเลิก', cancel_reason: why }, { reason: why });
    const srcIds = new Set([id, ...ctx.store.list('receipt_splits').filter((s) => s.receipt_id === id).map((s) => s.id)]);
    for (const e of ctx.store.list('ledger').filter((x) => srcIds.has(x.source_id) && x.debit > 0)) {
      ctx.store.insert(ctx.user, 'ledger', { date: ctx.today(), fund_code: e.fund_code, subfund_code: e.subfund_code, location: e.location, debit: 0, credit: e.debit, source_type: `${e.source_type}_reversal`, source_id: e.source_id, memo: `ยกเลิก ${e.memo}` });
    }
    return saved;
  });
}

export const listReceipts = (ctx) => { requirePermission(ctx, 'masters.read'); return ctx.store.list('receipts'); };
export const splitsOf = (ctx, id) => { requirePermission(ctx, 'masters.read'); return ctx.store.list('receipt_splits').filter((s) => s.receipt_id === id); };

/** สรุปรายรับรายเดือนแยกชนิดเงินย่อย: ยอดที่ต้องเก็บ · เงินสด · โอน · รับรวม · ค้างชำระ · % ที่เก็บได้ */
export function monthlySummary(ctx, ym) {
  requirePermission(ctx, 'masters.read');
  const all = activeSplits(ctx);
  const inMonth = all.filter((s) => String(s.receipt.date).startsWith(ym));
  const rows = [];
  for (const code of [...new Set(inMonth.map((s) => s.subfund_code))]) {
    const sf = ctx.store.find('subfunds', (x) => x.code === code)[0] || {};
    const mine = inMonth.filter((s) => s.subfund_code === code);
    const row = { subfund_code: code, name: sf.name || '', group: sf.group || '', cash: sum(mine.map((s) => s.cash_amount)), transfer: sum(mine.map((s) => s.transfer_amount)), total: sum(mine.map((s) => s.amount)), due: null, outstanding: null, pct: null };
    if (sf.has_collectible) {
      const due = sum(ctx.store.list('collectibles').filter((x) => x.subfund_code === code).map((x) => x.amount_due));
      const paid = sum(all.filter((s) => s.subfund_code === code && String(s.receipt.date) <= `${ym}-31`).map((s) => s.amount));
      Object.assign(row, { due, outstanding: due - paid, pct: due ? Math.round((paid * 1000) / due) / 10 : null });
    }
    rows.push(row);
  }
  return { month: ym, rows };
}

/** ชนิดเงินย่อยตั้งต้นจากหัวคอลัมน์ชีต "ใบเสร็จ69" (กลุ่มและการตั้งยอดเป็นค่าที่ตั้งไว้ก่อน รอยืนยัน 12.13) */
const DEFAULT_SUBFUNDS = [
  ['ก/20', 'บัตรประจำตัว', 'บกศ.'], ['ข/3', 'พิเศษวิทย์ฯ', 'บกศ.'], ['ค/1', 'ตามความถนัดนักเรียน', 'บกศ.'], ['ค/2', 'ค่าจ้างครูต่างชาติ', 'บกศ.'],
  ['ง/1', 'ค่าจ้างครูเชี่ยวชาญเฉพาะ', 'บกศ.'], ['ง/2', 'ค่าสาธารณูปโภค', 'บกศ.'], ['ง/4', 'เกินมาตรฐาน', 'บกศ.'], ['จ/1', 'ค่าประกันอุบัติเหตุ', 'บกศ.'], ['จ/2', 'ค่าจ้างบุคลากร', 'บกศ.'],
  ['SMS', 'รายได้ SMS', 'รายได้', true], ['ศูนย์กีฬา', 'ศูนย์กีฬา', 'รายได้'], ['รายได้อื่น ๆ', 'รายได้อื่น ๆ', 'รายได้'], ['E-donation', 'เงินบริจาค E-donation', 'อุดหนุน'],
];
export function seedDefaultSubfunds(ctx) {
  requirePermission(ctx, 'subfunds.manage');
  let created = 0;
  for (const [code, name, group, collect] of DEFAULT_SUBFUNDS) {
    if (ctx.store.find('subfunds', (x) => x.code === code).length) continue;
    ctx.store.insert(ctx.user, 'subfunds', { code, name, group, has_collectible: collect === true || group === 'บกศ.', fund_code: '', active: true }, { reason: 'ชนิดเงินย่อยตั้งต้น (รอยืนยัน 12.13)' });
    created++;
  }
  return { created };
}
