// ขออนุมัติใช้เงิน (ผังหน้า 2–3): ครูยื่น → งานแผนรับ/ตรวจ → เสนอ ผอ. → ผอ. เซ็น (กระดาษ) → งานแผนกดรับคืน + ภาพ → ระบบออกรหัสอนุมัติ → การเงินรับ → จำแนก 3 ทาง
import { fail, PermissionError, collector } from '../core/errors.js';
import { reserveDocNumber } from '../core/numbering.js';
import { requirePermission, STAFF_ROLES } from '../core/roles.js';
import { fiscalYearOf } from '../core/thaidate.js';
import { validateWith, requireReason, getOrFail } from './common.js';
import { sendHandoff, receiveHandoff, hasRole, pendingHandoffs } from './handoffs.js';
import { projectUsage } from './plan.js';

const DOC = 'approval';
const ST = { sent: 'ส่งแล้ว รอแผนรับ', review: 'แผนกำลังตรวจ', returned: 'ส่งคืนแก้', sign: 'รอ ผอ. เซ็น', rejected: 'ผอ. ไม่อนุมัติ', approved: 'อนุมัติแล้ว รอการเงินรับ', received: 'การเงินรับแล้ว', closed: 'ปิดรหัส' };
export const ROUTES = ['เงินยืม', 'วัสดุ', 'สำรองจ่าย'];
const SPEC = { prefixSetting: 'doc_prefix_approval', table: 'approval_requests', field: 'approval_code' };
const same = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();
const openHandoff = (ctx, id, step) => pendingHandoffs(ctx).filter((h) => h.doc_type === DOC && h.doc_id === id && h.step_key === step).pop();

/** ตรวจกฎข้อ 1: อยู่ในแผน · ประเภทเงินตรงแผน · ยอด ≤ คงเหลือ (selfCommitted = ยอดของใบนี้ที่ผูกพันอยู่แล้ว) */
function checkRules(ctx, out, c) {
  const proj = out.project_id ? ctx.store.get('plan_projects', out.project_id) : null;
  if (!proj || !proj.active) { if (!c.has('project_id')) c.add('project_id', 'ไม่พบโครงการนี้ในแผน'); return null; }
  if (out.fund_code && out.fund_code !== proj.fund_code) c.add('fund_code', `ประเภทเงินไม่ตรงกับแผน (แผนใช้ ${proj.fund_code})`);
  out.fund_code = proj.fund_code;
  if (Number.isInteger(out.amount)) {
    if (out.amount <= 0) c.add('amount', 'ยอดต้องมากกว่า 0');
    else if (out.amount > projectUsage(ctx, proj).remaining) c.add('amount', 'ยอดที่ขอเกินคงเหลือของโครงการ ต้องขอปรับแผนก่อน');
  }
  return proj;
}

export function submit(ctx, input) {
  return ctx.store.withLock(() => {
    const rec = validateWith(ctx, 'approval_requests', { project_id: input.project_id, fund_code: input.fund_code, items: input.items, amount: input.amount }, (out, c) => checkRules(ctx, out, c));
    const saved = ctx.store.insert(ctx.user, 'approval_requests', { ...rec, fiscal_year: fiscalYearOf(ctx.today(), ctx.settings.fiscal_year_start_month), requester: ctx.user.email, status: ST.sent, route: '' });
    sendHandoff(ctx, { doc_type: DOC, doc_id: saved.id, step_key: 'plan', from_role: 'requester', to_role: 'plan' });
    return saved;
  });
}

export function resubmit(ctx, id, patch = {}) {
  return ctx.store.withLock(() => {
    const cur = getOrFail(ctx, 'approval_requests', id, 'ใบขออนุมัติ');
    if (!same(cur.requester, ctx.user.email)) throw new PermissionError('เฉพาะผู้ขอเป็นผู้แก้และส่งใหม่');
    if (cur.status !== ST.returned) fail('id', 'ใบนี้ไม่ได้ถูกส่งคืนให้แก้');
    const merged = { project_id: cur.project_id, fund_code: cur.fund_code, items: patch.items ?? cur.items, amount: patch.amount ?? cur.amount };
    const rec = validateWith(ctx, 'approval_requests', merged, (out, c) => checkRules(ctx, out, c));
    const saved = ctx.store.update(ctx.user, 'approval_requests', id, { ...rec, status: ST.sent, return_reason: '', plan_reviewer: '' }, { reason: 'ผู้ขอแก้และส่งใหม่' });
    sendHandoff(ctx, { doc_type: DOC, doc_id: id, step_key: 'plan', from_role: 'requester', to_role: 'plan' });
    return saved;
  });
}

/** งานแผนกดรับ */
export function receive(ctx, id) {
  return ctx.store.withLock(() => {
    const cur = getOrFail(ctx, 'approval_requests', id, 'ใบขออนุมัติ');
    if (cur.status !== ST.sent) fail('id', 'ใบนี้ไม่ได้รอรับ');
    const h = openHandoff(ctx, id, 'plan');
    receiveHandoff(ctx, h.id, { forbidEmails: [cur.requester], reason: 'งานแผนกดรับใบขออนุมัติ' });
    return ctx.store.update(ctx.user, 'approval_requests', id, { status: ST.review, plan_reviewer: ctx.user.email }, { reason: 'งานแผนกดรับ' });
  });
}

function mineInReview(ctx, id) {
  const cur = getOrFail(ctx, 'approval_requests', id, 'ใบขออนุมัติ');
  if (cur.status === ST.sent) fail('id', 'ยังไม่ได้กดรับ จึงตรวจไม่ได้');
  if (cur.status !== ST.review) fail('id', 'ใบนี้ไม่อยู่ในขั้นตรวจของงานแผน');
  if (!same(cur.plan_reviewer, ctx.user.email)) throw new PermissionError('เฉพาะงานแผนที่กดรับใบนี้เป็นผู้ตรวจ');
  return cur;
}

export function returnToRequester(ctx, id, reason) {
  return ctx.store.withLock(() => {
    const why = requireReason(reason);
    mineInReview(ctx, id);
    return ctx.store.update(ctx.user, 'approval_requests', id, { status: ST.returned, return_reason: why }, { reason: why });
  });
}

/** เสนอ ผอ. (ตรวจกฎข้อ 1 ซ้ำ เผื่อยอดคงเหลือเปลี่ยนระหว่างรอ) */
export function propose(ctx, id) {
  return ctx.store.withLock(() => {
    const cur = mineInReview(ctx, id);
    const c = collector();
    checkRules(ctx, { project_id: cur.project_id, fund_code: cur.fund_code, amount: cur.amount }, c);
    c.throwIfAny();
    sendHandoff(ctx, { doc_type: DOC, doc_id: id, step_key: 'sign', from_role: 'plan', to_role: 'plan', note: 'รอ ผอ. เซ็น แล้วกดรับคืนพร้อมแนบภาพ' });
    return ctx.store.update(ctx.user, 'approval_requests', id, { status: ST.sign }, { reason: 'เสนอ ผอ.' });
  });
}

/** ผอ. เซ็นแล้ว งานแผนกดรับคืน: อนุมัติ → ออกรหัส · ไม่อนุมัติ → แจ้งครู จบ */
export function recordDecision(ctx, id, { approved, scan_ref = '', reason = '' } = {}) {
  return ctx.store.withLock(() => {
    const cur = getOrFail(ctx, 'approval_requests', id, 'ใบขออนุมัติ');
    if (cur.status !== ST.sign) fail('id', 'ใบนี้ไม่ได้รอ ผอ. เซ็น');
    if (!hasRole(ctx.user, 'plan')) throw new PermissionError('เฉพาะงานแผนกดรับคืนใบที่ ผอ. เซ็น');
    if (same(cur.requester, ctx.user.email)) throw new PermissionError('ผู้ขอรับคืนใบของตัวเองไม่ได้');
    if (!approved) {
      const why = requireReason(reason);
      receiveHandoff(ctx, openHandoff(ctx, id, 'sign').id, { scan_ref, forbidEmails: [cur.requester], allowSender: true, reason: 'ผอ. ไม่อนุมัติ' });
      return ctx.store.update(ctx.user, 'approval_requests', id, { status: ST.rejected, return_reason: why, scan_ref, decided_at: ctx.store.now() }, { reason: why });
    }
    if (ctx.settings.require_scan && !String(scan_ref).trim()) fail('scan_ref', 'ต้องแนบภาพหน้าที่ ผอ. ลงนาม');
    const c = collector();
    checkRules(ctx, { project_id: cur.project_id, fund_code: cur.fund_code, amount: cur.amount }, c);
    c.throwIfAny();
    receiveHandoff(ctx, openHandoff(ctx, id, 'sign').id, { scan_ref, forbidEmails: [cur.requester], allowSender: true, reason: 'กดรับคืนใบที่ ผอ. เซ็น' });
    const { docNo } = reserveDocNumber(ctx, SPEC, ctx.today());
    const saved = ctx.store.update(ctx.user, 'approval_requests', id, { status: ST.approved, approval_code: docNo, scan_ref, decided_at: ctx.store.now() }, { reason: `ออกรหัสอนุมัติ ${docNo}` });
    sendHandoff(ctx, { doc_type: DOC, doc_id: id, step_key: 'finance', from_role: 'plan', to_role: 'finance' });
    return saved;
  });
}

export function financeReceive(ctx, id) {
  return ctx.store.withLock(() => {
    const cur = getOrFail(ctx, 'approval_requests', id, 'ใบขออนุมัติ');
    if (cur.status !== ST.approved) fail('id', 'ใบนี้ไม่ได้รอการเงินรับ');
    receiveHandoff(ctx, openHandoff(ctx, id, 'finance').id, { forbidEmails: [cur.requester], reason: 'การเงินกดรับเรื่อง' });
    return ctx.store.update(ctx.user, 'approval_requests', id, { status: ST.received }, { reason: 'การเงินรับเรื่อง' });
  });
}

/** จำแนก 3 ทาง · วัสดุ → ส่งต่อพัสดุ (ส่ง → รับ) */
export function classify(ctx, id, route) {
  return ctx.store.withLock(() => {
    if (!hasRole(ctx.user, 'finance')) throw new PermissionError('เฉพาะการเงินจำแนกเรื่อง');
    const cur = getOrFail(ctx, 'approval_requests', id, 'ใบขออนุมัติ');
    if (cur.status !== ST.received) fail('id', 'ยังไม่ได้กดรับเรื่อง จึงจำแนกไม่ได้');
    if (!ROUTES.includes(route)) fail('route', `ต้องเลือก ${ROUTES.join(' / ')}`);
    const saved = ctx.store.update(ctx.user, 'approval_requests', id, { route }, { reason: `จำแนกเป็น ${route}` });
    if (route === 'วัสดุ') sendHandoff(ctx, { doc_type: DOC, doc_id: id, step_key: 'procure', from_role: 'finance', to_role: 'procurement' });
    return saved;
  });
}

/** ผู้ขอเห็นเฉพาะของตน · บุคลากรเห็นทั้งหมด */
export function list(ctx) {
  const all = ctx.store.list('approval_requests');
  return ctx.user.roles.some((r) => STAFF_ROLES.includes(r)) ? all : all.filter((r) => same(r.requester, ctx.user.email));
}
export function get(ctx, id) {
  const r = getOrFail(ctx, 'approval_requests', id, 'ใบขออนุมัติ');
  if (!ctx.user.roles.some((x) => STAFF_ROLES.includes(x)) && !same(r.requester, ctx.user.email)) throw new PermissionError('ดูได้เฉพาะใบของตนเอง');
  return r;
}

export function findByCode(ctx, code) {
  return ctx.store.find('approval_requests', (r) => r.approval_code && r.approval_code === code)[0] || null;
}
