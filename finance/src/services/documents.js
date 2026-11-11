// ขบ. (ขออนุมัติเบิกเงิน) และ ขจ. (ขออนุมัติจ่ายเงิน) · เส้นทางตรวจใช้ engine เดียวกัน (review.js)
import { fail, PermissionError, collector } from '../core/errors.js';
import { reserveDocNumber } from '../core/numbering.js';
import { hasRole } from './handoffs.js';
import { statusOf } from './review.js';
import { getOrFail } from './common.js';

const same = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();
const linesOf = (ctx, field, id) => ctx.store.list('payment_lines').filter((l) => l[field] === id);
const sum = (ls) => ls.reduce((s, l) => s + l.request_amount, 0);
const KHB = { prefixSetting: 'doc_prefix_khb', table: 'khb', field: 'khb_no' };
const KHJ = { prefixSetting: 'doc_prefix_khj', table: 'khj', field: 'khj_no' };

export const khbView = (ctx, k) => ({ ...k, total: sum(linesOf(ctx, 'khb_id', k.id)), line_count: linesOf(ctx, 'khb_id', k.id).length, status: statusOf(ctx, 'khb', k.id).text, flow: statusOf(ctx, 'khb', k.id) });
export const khjView = (ctx, k) => ({ ...k, total: sum(linesOf(ctx, 'khj_id', k.id)), line_count: linesOf(ctx, 'khj_id', k.id).length, status: statusOf(ctx, 'khj', k.id).text, flow: statusOf(ctx, 'khj', k.id) });

/** เส้นทางตรวจของ ขบ./ขจ. (ลงทะเบียนใน createApp) */
export const DOC_FLOWS = {
  khb: {
    table: 'khb', makerField: 'maker', makerRole: 'finance', signedReceiverRole: 'khj_maker', label: 'ขบ.',
    // ผอ. เซ็น ขบ. → แถวเป็น "ขบ.เซ็นแล้ว" (ผู้ทำ ขจ. รับต่อ)
    onSigned(ctx, doc) { for (const l of linesOf(ctx, 'khb_id', doc.id)) ctx.store.update(ctx.user, 'payment_lines', l.id, { status: 'ขบ.เซ็นแล้ว' }, { reason: `ผอ. เซ็น ${doc.khb_no}` }); },
  },
  khj: {
    table: 'khj', makerField: 'maker', makerRole: 'khj_maker', signedReceiverRole: 'finance', label: 'ขจ.',
    // กฎข้อ 10: Σ ขจ. ทุกกลุ่ม = ยอด ขบ. มิฉะนั้นส่งตรวจไม่ได้
    beforeSubmit(ctx, doc) {
      const khb = linesOf(ctx, 'khb_id', doc.khb_id);
      const khjs = ctx.store.list('khj').filter((j) => j.khb_id === doc.khb_id);
      const total = khjs.reduce((s, j) => s + sum(linesOf(ctx, 'khj_id', j.id)), 0);
      if (total !== sum(khb)) fail('total', 'ยอด ขจ. ทุกกลุ่มรวมกันไม่เท่ายอด ขบ. ส่งตรวจไม่ได้');
    },
    // ผอ. เซ็น ขจ. → ล็อกแถว
    onSigned(ctx, doc) { for (const l of linesOf(ctx, 'khj_id', doc.id)) ctx.store.update(ctx.user, 'payment_lines', l.id, { status: 'ขจ.เซ็นแล้ว', locked: true }, { reason: `ผอ. เซ็น ${doc.khj_no} ล็อกแถว` }); },
  },
};

export function createKhb(ctx, { line_ids } = {}) {
  if (!hasRole(ctx.user, 'finance')) throw new PermissionError('เฉพาะการเงินทำ ขบ.');
  return ctx.store.withLock(() => {
    const c = collector();
    const ids = Array.isArray(line_ids) ? [...new Set(line_ids)] : [];
    if (!ids.length) c.add('line_ids', 'ต้องเลือกแถวอย่างน้อย 1 แถว');
    const lines = [];
    for (const id of ids) {
      const l = ctx.store.get('payment_lines', id);
      if (!l) c.add('line_ids', `ไม่พบแถว ${id}`);
      else if (l.status !== 'บันทึกแล้ว' || l.khb_id || l.kind === 'ส่งใช้เงินยืม' || l.reverses) c.add('line_ids', `แถว ${l.vendor_doc_no} เข้า ขบ. ไม่ได้ (อยู่ใน ขบ. แล้ว หรือเป็นหลักฐาน/รายการกลับ)`);
      else if (!l.fund_code) c.add('line_ids', `แถว ${l.vendor_doc_no} ไม่มีประเภทเงิน`);
      else lines.push(l);
    }
    c.throwIfAny();
    const { docNo } = reserveDocNumber(ctx, KHB, ctx.today());
    const k = ctx.store.insert(ctx.user, 'khb', { khb_no: docNo, date: ctx.today(), maker: ctx.user.email });
    for (const l of lines) ctx.store.update(ctx.user, 'payment_lines', l.id, { khb_id: k.id, status: 'อยู่ใน ขบ.' }, { reason: `เข้า ${docNo}` });
    return khbView(ctx, k);
  });
}

export const listKhb = (ctx) => ctx.store.list('khb').map((k) => khbView(ctx, k));

/** ผู้ทำ ขจ. จัด ขจ. จาก ขบ. ที่ ผอ. เซ็นแล้ว: แยก กลุ่มเงิน × วิธีจ่าย (ผู้รับเดียวหลายแถว → เช็คใบเดียว ในขั้น 4) */
export function generateKhj(ctx, khbId) {
  if (!hasRole(ctx.user, 'khj_maker')) throw new PermissionError('เฉพาะผู้ทำ ขจ. จัด ขจ.');
  return ctx.store.withLock(() => {
    const khb = getOrFail(ctx, 'khb', khbId, 'ขบ.');
    if (same(khb.maker, ctx.user.email)) throw new PermissionError('ผู้ทำ ขจ. ต้องไม่ใช่ผู้ทำ ขบ.');
    const st = ctx.store.get('doc_flow', `khb:${khbId}`);
    if (!st || st.stage !== 'done') fail('id', 'ขบ. นี้ยังไม่ได้ ผอ. เซ็น (และผู้ทำ ขจ. กดรับคืนพร้อมภาพ)');
    if (ctx.store.list('khj').some((j) => j.khb_id === khbId)) fail('id', 'ขบ. นี้จัด ขจ. แล้ว (ซ้ำไม่ได้)');
    const groups = new Map();
    for (const l of linesOf(ctx, 'khb_id', khbId)) {
      const fund = ctx.store.find('funds', (f) => f.fund_code === l.fund_code)[0];
      if (!fund) fail('id', `แถว ${l.vendor_doc_no} ไม่มีประเภทเงินที่ตั้งไว้`);
      const key = `${fund.fund_group}\u0001${l.pay_method}`;
      if (!groups.has(key)) groups.set(key, { fund_group: fund.fund_group, pay_method: l.pay_method, lines: [] });
      groups.get(key).lines.push(l);
    }
    const order = ctx.settings.fund_groups;
    const sorted = [...groups.values()].sort((a, b) => order.indexOf(a.fund_group) - order.indexOf(b.fund_group) || a.pay_method.localeCompare(b.pay_method, 'th'));
    const out = [];
    for (const g of sorted) {
      const { docNo } = reserveDocNumber(ctx, KHJ, ctx.today());
      const k = ctx.store.insert(ctx.user, 'khj', { khj_no: docNo, khb_id: khbId, fund_group: g.fund_group, pay_method: g.pay_method, date: ctx.today(), maker: ctx.user.email });
      for (const l of g.lines) ctx.store.update(ctx.user, 'payment_lines', l.id, { khj_id: k.id, status: 'อยู่ใน ขจ.' }, { reason: `เข้า ${docNo}` });
      out.push(khjView(ctx, k));
    }
    const total = out.reduce((s, k) => s + k.total, 0);
    if (total !== sum(linesOf(ctx, 'khb_id', khbId))) fail('total', 'ยอด ขจ. ทุกกลุ่มรวมกันไม่เท่ายอด ขบ.');
    return out;
  });
}

export const listKhj = (ctx) => ctx.store.list('khj').map((k) => khjView(ctx, k));
