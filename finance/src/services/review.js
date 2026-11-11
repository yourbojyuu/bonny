// ตรวจ 3 ชั้น + ผอ. (ใช้ร่วมทุกเอกสาร: ขบ. ขจ.) · ผู้ทำ → ชั้น 1 → ชั้น 2 → ชั้น 3 → ผอ. (เซ็นบนกระดาษ ระบบรับรู้ผ่านการกดรับคืน + ภาพ)
// เส้นทางของเอกสารชนิดหนึ่งนิยามเป็น "flow" ใน core/flows.js · สถานะทั้งหมดระบบกำหนด ผู้ใช้พิมพ์เองไม่ได้
import { fail, PermissionError } from '../core/errors.js';
import { requireReason, getOrFail } from './common.js';
import { sendHandoff, receiveHandoff, hasRole, waitDays, pendingHandoffs, overdueHandoffs } from './handoffs.js';

const STAGES = ['r1', 'r2', 'r3'];
const ROLE_OF = { r1: 'reviewer1', r2: 'reviewer2', r3: 'reviewer3' };
const NO_OF = { r1: 1, r2: 2, r3: 3 };
export const flowId = (type, docId) => `${type}:${docId}`;

function load(ctx, type, docId) {
  const flow = ctx.flows[type];
  if (!flow) fail('doc_type', `ไม่รู้จักเอกสารชนิด ${type}`);
  const doc = ctx.store.get(flow.table, docId);
  if (!doc) fail('doc_id', 'ไม่พบเอกสาร');
  const st = ctx.store.get('doc_flow', flowId(type, docId));
  return { flow, doc, st, maker: doc[flow.makerField || 'created_by'] };
}

const sameUser = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();

function openHandoff(ctx, type, docId, stepKey) {
  return pendingHandoffs(ctx).filter((h) => h.doc_type === type && h.doc_id === docId && h.step_key === stepKey).pop();
}

function saveState(ctx, st, patch) {
  const { created_by, created_at, updated_at, ...plain } = st;
  return ctx.store.update(ctx.user, 'doc_flow', st.id, { ...plain, ...patch });
}

function step(ctx, type, docId, round, stepName, action, extra = {}) {
  return ctx.store.insert(ctx.user, 'review_steps', { doc_type: type, doc_id: docId, round, step: stepName, user: ctx.user.email, action, at: ctx.store.now(), ...extra });
}

/** ผู้ทำส่งตรวจ (ครั้งแรก หรือหลังถูกส่งคืน) */
export function submitForReview(ctx, type, docId) {
  return ctx.store.withLock(() => {
    const { flow, doc, st, maker } = load(ctx, type, docId);
    if (!sameUser(ctx.user.email, maker)) throw new PermissionError('เฉพาะผู้ทำเอกสารเป็นผู้ส่งตรวจ');
    if (st && st.stage !== 'returned') fail('doc_id', 'เอกสารนี้ส่งตรวจแล้ว');
    if (flow.beforeSubmit) flow.beforeSubmit(ctx, doc);
    let stage = 'r1';
    if (st && ctx.settings.review_restart === 'returned' && STAGES.includes(st.return_stage)) stage = st.return_stage;
    const base = { doc_type: type, doc_id: docId, maker, round: (st ? st.round : 0) + 1, stage, phase: 'wait', reviewer: '', return_stage: '', return_reason: '', finished_at: '' };
    const saved = st ? saveState(ctx, st, base) : ctx.store.insert(ctx.user, 'doc_flow', { id: flowId(type, docId), ...base });
    sendHandoff(ctx, { doc_type: type, doc_id: docId, step_key: stage, from_role: flow.makerRole || '', to_role: ROLE_OF[stage] });
    return saved;
  });
}

/** ผู้ตรวจกดรับ */
export function receiveStage(ctx, type, docId) {
  return ctx.store.withLock(() => {
    const { st, maker } = load(ctx, type, docId);
    if (!st || !STAGES.includes(st.stage) || st.phase !== 'wait') fail('doc_id', 'เอกสารนี้ไม่อยู่ในขั้นรับตรวจ');
    if (sameUser(ctx.user.email, maker)) throw new PermissionError('ผู้ตรวจต้องไม่ใช่ผู้ทำเอกสารนั้น');
    const h = openHandoff(ctx, type, docId, st.stage);
    if (!h) fail('doc_id', 'ไม่พบงานส่งที่รอรับ');
    receiveHandoff(ctx, h.id, { forbidEmails: [maker], reason: `กดรับตรวจชั้น ${NO_OF[st.stage]}` });
    return saveState(ctx, st, { phase: 'review', reviewer: ctx.user.email });
  });
}

function requireMyReview(ctx, st, maker) {
  if (!st || !STAGES.includes(st.stage)) fail('doc_id', 'เอกสารนี้ไม่อยู่ในขั้นตรวจ');
  if (st.phase !== 'review') fail('doc_id', 'ยังไม่ได้กดรับ จึงตรวจไม่ได้');
  if (!sameUser(ctx.user.email, st.reviewer) || sameUser(ctx.user.email, maker)) throw new PermissionError('เฉพาะผู้ที่กดรับตรวจเอกสารนี้เป็นผู้เซ็นผ่านหรือส่งคืนได้');
}

/** เซ็นผ่าน → ชั้นถัดไป (หรือรอ ผอ. เซ็นเมื่อผ่านชั้น 3) */
export function passStage(ctx, type, docId) {
  return ctx.store.withLock(() => {
    const { flow, st, maker } = load(ctx, type, docId);
    requireMyReview(ctx, st, maker);
    step(ctx, type, docId, st.round, String(NO_OF[st.stage]), 'pass');
    const i = STAGES.indexOf(st.stage);
    if (i < STAGES.length - 1) {
      const next = STAGES[i + 1];
      sendHandoff(ctx, { doc_type: type, doc_id: docId, step_key: next, from_role: ROLE_OF[st.stage], to_role: ROLE_OF[next] });
      return saveState(ctx, st, { stage: next, phase: 'wait', reviewer: '' });
    }
    sendHandoff(ctx, { doc_type: type, doc_id: docId, step_key: 'sign', from_role: ROLE_OF[st.stage], to_role: flow.signedReceiverRole, note: 'รอ ผอ. เซ็น แล้วกดรับคืนพร้อมแนบภาพ' });
    return saveState(ctx, st, { stage: 'sign', phase: 'wait', reviewer: '' });
  });
}

/** ส่งคืนผู้ทำ (ต้องมีเหตุผล) */
export function returnStage(ctx, type, docId, reason) {
  return ctx.store.withLock(() => {
    const { st, maker } = load(ctx, type, docId);
    const why = requireReason(reason);
    requireMyReview(ctx, st, maker);
    step(ctx, type, docId, st.round, String(NO_OF[st.stage]), 'return', { reason: why });
    return saveState(ctx, st, { stage: 'returned', phase: '', reviewer: '', return_stage: st.stage, return_reason: `ชั้น ${NO_OF[st.stage]}: ${why}` });
  });
}

function signPrereq(ctx, type, docId, scanRef) {
  const loaded = load(ctx, type, docId);
  const { flow, st, doc, maker } = loaded;
  if (!st || st.stage !== 'sign' || st.phase !== 'wait') fail('doc_id', 'เอกสารนี้ไม่ได้รอ ผอ. เซ็น');
  if (!hasRole(ctx.user, flow.signedReceiverRole)) throw new PermissionError('ไม่มีสิทธิ์กดรับคืนเอกสารที่ ผอ. เซ็น');
  if (sameUser(ctx.user.email, maker)) throw new PermissionError('ผู้รับต้องไม่ใช่ผู้ทำเอกสารนี้');
  const others = flow.distinctFrom ? flow.distinctFrom(ctx, doc) : [];
  if (others.some((e) => sameUser(e, ctx.user.email))) throw new PermissionError('ผู้รับต้องไม่ใช่ผู้ทำเอกสารต้นทาง');
  if (ctx.settings.require_scan && !String(scanRef || '').trim()) fail('scan_ref', 'ต้องแนบภาพหน้าที่ ผอ. ลงนาม');
  const h = openHandoff(ctx, type, docId, 'sign');
  if (!h) fail('doc_id', 'ไม่พบงานส่งที่รอรับ');
  return { ...loaded, h, forbid: [maker, ...others] };
}

/** ผอ. เซ็นแล้ว: ผู้รับกดรับคืน + แนบภาพ */
export function receiveSigned(ctx, type, docId, { scan_ref = '' } = {}) {
  return ctx.store.withLock(() => {
    const { flow, st, doc, h, forbid } = signPrereq(ctx, type, docId, scan_ref);
    receiveHandoff(ctx, h.id, { scan_ref, forbidEmails: forbid, reason: 'กดรับคืนเอกสารที่ ผอ. เซ็น' });
    step(ctx, type, docId, st.round, 'director', 'sign', { scan_ref });
    const saved = saveState(ctx, st, { stage: 'done', phase: '', finished_at: ctx.store.now() });
    if (flow.onSigned) flow.onSigned(ctx, doc, saved);
    return saved;
  });
}

/** ผอ. ส่งคืน: คนที่กดรับคืนเป็นผู้บันทึก พร้อมเหตุผล (+ ภาพถ้าตั้งให้ต้องแนบ) */
export function directorReturn(ctx, type, docId, { scan_ref = '', reason = '' } = {}) {
  return ctx.store.withLock(() => {
    const why = requireReason(reason);
    const { st, h, forbid } = signPrereq(ctx, type, docId, scan_ref);
    receiveHandoff(ctx, h.id, { scan_ref, forbidEmails: forbid, reason: 'บันทึก ผอ. ส่งคืน' });
    step(ctx, type, docId, st.round, 'director', 'return', { reason: why, scan_ref });
    return saveState(ctx, st, { stage: 'returned', phase: '', reviewer: '', return_stage: 'sign', return_reason: `ผอ.: ${why}` });
  });
}

const STAGE_TEXT = { r1: 'ผู้ตรวจชั้น 1', r2: 'ผู้ตรวจชั้น 2', r3: 'ผู้ตรวจชั้น 3' };

/** สถานะคำนวณจาก doc_flow + handoff (ไม่มีช่องสถานะที่พิมพ์เอง) */
export function statusOf(ctx, type, docId) {
  const st = ctx.store.get('doc_flow', flowId(type, docId));
  if (!st) return { stage: 'draft', round: 0, text: 'ร่าง' };
  const base = { stage: st.stage, phase: st.phase, round: st.round, reviewer: st.reviewer };
  if (st.stage === 'returned') return { ...base, text: `ส่งคืนแก้ (${st.return_reason})` };
  if (st.stage === 'done') return { ...base, text: 'ผอ. เซ็นแล้ว' };
  const h = openHandoff(ctx, type, docId, st.stage);
  const days = h ? waitDays(ctx, h) : 0;
  if (st.stage === 'sign') return { ...base, days, text: `ส่งแล้ว · รอ ผอ. เซ็น (${days} วัน)` };
  if (st.phase === 'wait') return { ...base, days, text: `ส่งแล้ว · รอรับ ${STAGE_TEXT[st.stage]} (${days} วัน)` };
  return { ...base, text: `กำลังตรวจ ชั้น ${NO_OF[st.stage]} โดย ${st.reviewer}` };
}

/** ถาดงานของฉัน: รอรับ (ไม่รวมเอกสารที่ฉันทำเอง) · กำลังตรวจ · ส่งคืนให้แก้ */
export function inbox(ctx) {
  const out = [];
  for (const h of pendingHandoffs(ctx)) {
    if (!hasRole(ctx.user, h.to_role)) continue;
    const st = ctx.store.get('doc_flow', flowId(h.doc_type, h.doc_id));
    if (st && sameUser(st.maker, ctx.user.email)) continue;
    if (h.doc_type === 'approval') { const ar = ctx.store.get('approval_requests', h.doc_id); if (ar && sameUser(ar.requester, ctx.user.email)) continue; }
    out.push({ kind: h.step_key === 'sign' ? 'รอรับคืนหลัง ผอ. เซ็น' : h.step_key.startsWith('r') ? 'รอรับ' : 'รอรับ', handoff_id: h.id, doc_type: h.doc_type, doc_id: h.doc_id, step_key: h.step_key, days: waitDays(ctx, h) });
  }
  for (const st of ctx.store.list('doc_flow')) {
    if (st.phase === 'review' && sameUser(st.reviewer, ctx.user.email)) out.push({ kind: 'กำลังตรวจ', doc_type: st.doc_type, doc_id: st.doc_id, step_key: st.stage });
    if (st.stage === 'returned' && sameUser(st.maker, ctx.user.email)) out.push({ kind: 'ส่งคืนแก้', doc_type: st.doc_type, doc_id: st.doc_id, reason: st.return_reason });
  }
  for (const r of ctx.store.list('approval_requests')) {
    if (r.status === 'ส่งคืนแก้' && sameUser(r.requester, ctx.user.email)) out.push({ kind: 'ส่งคืนแก้', doc_type: 'approval', doc_id: r.id, reason: r.return_reason });
  }
  return out;
}

export function overdue(ctx) {
  return overdueHandoffs(ctx);
}
