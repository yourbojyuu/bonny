// ยอดผูกพัน/จ่ายจริง/คงเหลือของโครงการ: คำนวณจากใบขออนุมัติและหน้ารายการ ไม่เก็บซ้ำ
export const COMMITTING = ['อนุมัติแล้ว รอการเงินรับ', 'การเงินรับแล้ว'];

export function projectUsage(ctx, project) {
  const reqs = ctx.store.list('approval_requests').filter((r) => r.project_id === project.id);
  const committed = reqs.filter((r) => COMMITTING.includes(r.status)).reduce((s, r) => s + r.amount, 0);
  const codes = new Set(reqs.map((r) => r.approval_code).filter(Boolean));
  const spent = ctx.store.list('payment_lines').filter((l) => l.status === 'จ่ายแล้ว' && codes.has(l.approval_code)).reduce((s, l) => s + l.request_amount, 0);
  return { committed, spent, remaining: project.budget - committed - spent };
}
