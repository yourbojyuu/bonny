// ออกเลขเอกสาร: prefix + เลข + "/" + ปีงบ พ.ศ. · เริ่ม 1 ใหม่ทุกปีงบ · ไม่ซ้ำ ไม่ขาด
// เลขถัดไปคำนวณจากเอกสารที่มีอยู่จริงในตาราง (ไม่มีตัวนับแยก จึงไม่มีทางที่ตัวนับกับเอกสารไม่ตรงกัน)
// ทั้งหมดทำภายใต้ lock: อ่านเลขล่าสุด → บันทึกเอกสาร ถ้าบันทึกไม่สำเร็จ เลขนั้นยังว่างให้ใบถัดไป
import { fiscalYearOf } from './thaidate.js';

export function formatDocNo(prefix, seq, fiscalYear) {
  return `${prefix}${seq}/${fiscalYear}`;
}

export function parseDocNo(docNo) {
  const m = /(\d+)\/(\d{4})$/.exec(String(docNo || ''));
  return m ? { seq: Number(m[1]), fiscal_year: Number(m[2]) } : null;
}

/** เลขถัดไปของปีงบ (ผู้เรียกต้องถือ lock อยู่แล้ว และบันทึกเอกสารที่ใช้เลขนี้ใน lock เดียวกัน) */
export function reserveDocNumber(ctx, spec, date) {
  const s = ctx.settings;
  const fy = fiscalYearOf(date, s.fiscal_year_start_month);
  let max = 0;
  for (const r of ctx.store.list(spec.table)) {
    const p = parseDocNo(r[spec.field]);
    if (p && p.fiscal_year === fy && p.seq > max) max = p.seq;
  }
  return { docNo: formatDocNo(s[spec.prefixSetting], max + 1, fy), seq: max + 1, fiscal_year: fy };
}

/**
 * @param spec { prefixSetting, table, field } เช่น { prefixSetting:'doc_prefix_khb', table:'khb', field:'khb_no' }
 * @param build (docNo, {seq, fiscal_year}) => record ที่จะบันทึก (ห้ามกำหนดเลขเอง)
 */
export function issueDocNumber(ctx, spec, date, build) {
  return ctx.store.withLock(() => {
    const { docNo, seq, fiscal_year: fy } = reserveDocNumber(ctx, spec, date);
    const rec = { ...build(docNo, { seq, fiscal_year: fy }) };
    if (rec[spec.field] === undefined) rec[spec.field] = docNo;
    if (rec[spec.field] !== docNo) throw new Error('เลขเอกสารระบบออกให้ ผู้ใช้กำหนดเองไม่ได้');
    return ctx.store.insert(ctx.user, spec.table, rec);
  });
}

/** ตรวจเลขขาด/ซ้ำ จากรายการเลขเอกสาร (ใช้ในรายงานตรวจสอบ) */
export function checkSequence(docNos) {
  const seen = new Map();
  const byYear = new Map();
  const duplicates = [];
  for (const no of docNos) {
    seen.set(no, (seen.get(no) || 0) + 1);
    if (seen.get(no) === 2) duplicates.push(no);
    const p = parseDocNo(no);
    if (!p) continue;
    if (!byYear.has(p.fiscal_year)) byYear.set(p.fiscal_year, new Set());
    byYear.get(p.fiscal_year).add(p.seq);
  }
  const gaps = [];
  for (const fy of [...byYear.keys()].sort()) {
    const set = byYear.get(fy);
    const max = Math.max(...set);
    const missing = [];
    for (let i = 1; i <= max; i++) if (!set.has(i)) missing.push(i);
    if (missing.length) gaps.push({ fiscal_year: fy, missing });
  }
  return { gaps, duplicates };
}
