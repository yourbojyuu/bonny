// เช็ค + ทะเบียนคุมเช็ค (ผังหน้า 6): ระบบเสนอเลขจากสมุดของกลุ่มเงิน → พิมพ์ → ยืนยันเลขที่พิมพ์จริง → (พลาด = เช็คเสีย + รูป) → ส่งลงนาม → ผู้รับลงชื่อรับเช็ค = จ่ายแล้ว
import { fail, PermissionError, collector } from '../core/errors.js';
import { bahtText } from '../core/bahttext.js';
import { formatSatang } from '../core/money.js';
import { hasRole } from './handoffs.js';
import { getOrFail, requireReason } from './common.js';
import { recordPaid } from './ledger.js';

const needFinance = (ctx) => { if (!hasRole(ctx.user, 'finance')) throw new PermissionError('เฉพาะการเงินจัดการเช็ค'); };
const padNo = (n, width) => String(n).padStart(width, '0');

function signedKhj(ctx, id) {
  const khj = id ? ctx.store.get('khj', id) : null;
  if (!khj) fail('khj_id', 'ไม่พบ ขจ.');
  const st = ctx.store.get('doc_flow', `khj:${id}`);
  if (!st || st.stage !== 'done') fail('khj_id', 'เช็คสร้างได้จาก ขจ. ที่ ผอ. เซ็นแล้วเท่านั้น');
  return khj;
}

const chequeLines = (ctx, khjId) => ctx.store.list('payment_lines').filter((l) => l.khj_id === khjId && l.pay_method === 'เช็ค' && l.status !== 'ทำรายการกลับ');
const accountOfLine = (ctx, l) => (ctx.store.find('funds', (f) => f.fund_code === l.fund_code)[0] || {}).bank_account_id;

/** เลขถัดไปที่ยังไม่ใช้ในสมุดของบัญชี (สมุดเล่มแรกที่ยังเหลือ) */
export function nextChequeNo(ctx, accountId) {
  const books = ctx.store.list('cheque_books').filter((b) => b.bank_account_id === accountId).sort((a, b) => Number(a.first_no) - Number(b.first_no));
  const used = new Set(ctx.store.list('cheques').filter((c) => books.some((b) => b.id === c.book_id)).map((c) => c.cheque_no));
  for (const b of books) {
    const w = b.first_no.length;
    for (let n = Number(b.first_no); n <= Number(b.last_no); n++) if (!used.has(padNo(n, w))) return { no: padNo(n, w), book: b };
  }
  return null;
}

function resolveAccount(ctx, khj, lines) {
  const accts = new Set(lines.map((l) => accountOfLine(ctx, l)));
  if (accts.size !== 1) fail('payee_id', 'แถวของผู้รับรายนี้ใช้บัญชีธนาคารต่างกัน แยกจ่ายไม่ได้');
  const acct = ctx.store.get('bank_accounts', [...accts][0]);
  if (!acct || acct.type !== 'กระแสรายวัน') fail('cheque_no', 'ประเภทเงินนี้ไม่มีบัญชีกระแสรายวันสำหรับสั่งจ่ายเช็ค');
  if (acct.fund_group !== khj.fund_group) fail('cheque_no', 'สมุดเช็คต้องตรงกับกลุ่มเงินของ ขจ.');
  return acct;
}

function groupsOf(ctx, khj) {
  const pending = chequeLines(ctx, khj.id).filter((l) => !l.cheque_no);
  const by = new Map();
  for (const l of pending) { if (!by.has(l.payee_id)) by.set(l.payee_id, []); by.get(l.payee_id).push(l); }
  return [...by.entries()].map(([payee_id, lines]) => ({ payee_id, lines }));
}

export const attachmentOf = (lines) => lines.map((l) => (l.tax_amount > 0 ? `${formatSatang(l.base_amount)}/${formatSatang(l.tax_amount)}` : formatSatang(l.base_amount)));

export function chequeView(ctx, c) {
  const lines = (c.line_ids || []).map((id) => ctx.store.get('payment_lines', id)).filter(Boolean);
  const khj = ctx.store.get('khj', c.khj_id);
  return { ...c, attachment: attachmentOf(lines), khj_no: khj ? khj.khj_no : '' };
}

/** เสนอเลขเช็คต่อผู้รับ (ยังไม่บันทึกอะไร) */
export function propose(ctx, khjId) {
  needFinance(ctx);
  const khj = signedKhj(ctx, khjId);
  const out = [];
  const hypo = new Map();
  for (const g of groupsOf(ctx, khj)) {
    const acct = resolveAccount(ctx, khj, g.lines);
    const base = nextChequeNo(ctx, acct.id);
    if (!base) fail('cheque_no', 'สมุดเช็คของบัญชีนี้หมดแล้ว เพิ่มสมุดเล่มใหม่ก่อน');
    const shift = hypo.get(acct.id) || 0;
    hypo.set(acct.id, shift + 1);
    out.push({
      payee_id: g.payee_id, payee_name: (ctx.store.get('payees', g.payee_id) || {}).name, line_count: g.lines.length, line_ids: g.lines.map((l) => l.id),
      amount: g.lines.reduce((s, l) => s + l.pay_amount, 0), next_no: padNo(Number(base.no) + shift, base.no.length), book_id: base.book.id, attachment: attachmentOf(g.lines),
    });
  }
  return out;
}

/** ยืนยันเลขที่พิมพ์จริง → ลงทะเบียนคุมเช็คทันที */
export function confirm(ctx, { khj_id, payee_id, cheque_no } = {}) {
  needFinance(ctx);
  return ctx.store.withLock(() => {
    const khj = signedKhj(ctx, khj_id);
    const g = groupsOf(ctx, khj).find((x) => x.payee_id === payee_id);
    if (!g) fail('payee_id', 'ผู้รับรายนี้ไม่มีแถวที่ต้องจ่ายเช็คใน ขจ. นี้ (หรือออกเช็คแล้ว)');
    const acct = resolveAccount(ctx, khj, g.lines);
    const next = nextChequeNo(ctx, acct.id);
    if (!next) fail('cheque_no', 'สมุดเช็คของบัญชีนี้หมดแล้ว');
    if (String(cheque_no || '').trim() !== next.no) fail('cheque_no', `เลขที่พิมพ์ไม่ตรงกับระบบ (ระบบเสนอ ${next.no}) ถ้าพิมพ์พลาดให้บันทึกเช็คเสียก่อน`);
    const payee = ctx.store.get('payees', payee_id);
    const amount = g.lines.reduce((s, l) => s + l.pay_amount, 0);
    const c = ctx.store.insert(ctx.user, 'cheques', {
      cheque_no: next.no, book_id: next.book.id, khj_id, payee_id, print_name: payee.cheque_print_name || payee.name, amount, amount_text: bahtText(amount),
      date: ctx.today(), status: 'ออกแล้ว', line_ids: g.lines.map((l) => l.id),
    });
    for (const l of g.lines) ctx.store.update(ctx.user, 'payment_lines', l.id, { cheque_no: next.no }, { reason: `ออกเช็ค ${next.no}` });
    return chequeView(ctx, c);
  });
}

/** เช็คเสีย: เลขนั้นถูกใช้ (ไม่นับยอด) พร้อมรูปและเหตุผล · เลขถัดไปจึงเลื่อน */
export function voidCheque(ctx, { khj_id, cheque_no, reason, void_photo } = {}) {
  needFinance(ctx);
  return ctx.store.withLock(() => {
    const khj = signedKhj(ctx, khj_id);
    const lines = chequeLines(ctx, khj_id);
    if (!lines.length) fail('khj_id', 'ขจ. นี้ไม่มีรายการจ่ายเช็ค');
    const acct = resolveAccount(ctx, khj, [lines[0]]);
    const next = nextChequeNo(ctx, acct.id);
    const c = collector();
    if (!String(reason || '').trim()) c.add('reason', 'ต้องระบุเหตุผล');
    if (!String(void_photo || '').trim()) c.add('void_photo', 'ต้องแนบรูปเช็คที่ประทับยกเลิก');
    if (!next || String(cheque_no || '').trim() !== next.no) c.add('cheque_no', `เช็คเสียต้องเป็นเลขถัดไปของสมุด${next ? ` (${next.no})` : ''}`);
    c.throwIfAny();
    const saved = ctx.store.insert(ctx.user, 'cheques', { cheque_no: next.no, book_id: next.book.id, khj_id, payee_id: '', print_name: '', amount: 0, amount_text: '', date: ctx.today(), status: 'เสีย', line_ids: [], void_photo, void_reason: String(reason).trim() }, { reason: String(reason).trim() });
    return chequeView(ctx, saved);
  });
}

/** ทะเบียนคุมเช็คต่อบัญชี: วันที่จ่าย · เลขเช็ค · ผู้รับ · ยอด · ขจ. · สถานะ + เลขที่ขาดในช่วงที่ใช้ */
export function register(ctx, accountId) {
  const books = ctx.store.list('cheque_books').filter((b) => b.bank_account_id === accountId);
  const cq = ctx.store.list('cheques').filter((c) => books.some((b) => b.id === c.book_id)).sort((a, b) => Number(a.cheque_no) - Number(b.cheque_no));
  const rows = cq.map((c) => ({ id: c.id, date: c.date, cheque_no: c.cheque_no, payee: c.status === 'เสีย' ? 'เสีย' : c.print_name, amount: c.amount, khj_no: (ctx.store.get('khj', c.khj_id) || {}).khj_no || '', status: c.status, note: c.void_reason || '' }));
  const gaps = [];
  for (const b of books) {
    const used = new Set(cq.filter((c) => c.book_id === b.id).map((c) => Number(c.cheque_no)));
    if (!used.size) continue;
    for (let n = Number(b.first_no); n <= Math.max(...used); n++) if (!used.has(n)) gaps.push(padNo(n, b.first_no.length));
  }
  return { rows, gaps };
}

/** ส่งลงนาม: ตรวจทะเบียนคุมเช็ค (กฎข้อ 12) ว่าครบและตรง ขจ. */
export function sendForSignature(ctx, id) {
  needFinance(ctx);
  return ctx.store.withLock(() => {
    const c = getOrFail(ctx, 'cheques', id, 'เช็ค');
    if (c.status !== 'ออกแล้ว') fail('id', 'เช็คใบนี้ไม่อยู่ในสถานะรอส่งลงนาม');
    const lines = c.line_ids.map((x) => ctx.store.get('payment_lines', x)).filter(Boolean);
    const col = collector();
    if (!c.date) col.add('date', 'ต้องมีวันที่จ่าย');
    if (!c.payee_id) col.add('payee_id', 'ต้องมีผู้รับเงิน');
    if (c.amount !== lines.reduce((s, l) => s + l.pay_amount, 0) || lines.some((l) => l.khj_id !== c.khj_id)) col.add('amount', 'ยอดเช็คไม่ตรงกับ ขจ. ส่งลงนามไม่ได้');
    col.throwIfAny();
    return chequeView(ctx, ctx.store.update(ctx.user, 'cheques', id, { status: 'ลงนามแล้ว', signed_at: ctx.store.now() }, { reason: 'ส่งลงนามเช็ค' }));
  });
}

/** ผู้รับเงินลงชื่อรับเช็ค = จ่ายแล้ว (ledger · ตัดยอดแผน) */
export function markReceived(ctx, id) {
  needFinance(ctx);
  return ctx.store.withLock(() => {
    const c = getOrFail(ctx, 'cheques', id, 'เช็ค');
    if (c.status === 'ออกแล้ว') fail('id', 'ต้องส่งลงนามก่อนจึงบันทึกผู้รับรับเช็คได้');
    if (c.status !== 'ลงนามแล้ว') fail('id', 'เช็คใบนี้ผู้รับรับแล้ว หรือไม่อยู่ในสถานะรอผู้รับ');
    const lines = c.line_ids.map((x) => ctx.store.get('payment_lines', x)).filter(Boolean);
    const saved = ctx.store.update(ctx.user, 'cheques', id, { status: 'ผู้รับรับแล้ว', received_at: ctx.store.now() }, { reason: 'ผู้รับลงชื่อรับเช็ค' });
    recordPaid(ctx, lines);
    return chequeView(ctx, saved);
  });
}

export const listCheques = (ctx) => ctx.store.list('cheques').map((c) => chequeView(ctx, c));
