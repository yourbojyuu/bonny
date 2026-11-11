// วันที่เก็บเป็นข้อความ YYYY-MM-DD · ปีแสดงเป็น พ.ศ. · คำนวณเองทั้งหมด ไม่พึ่ง locale

const MONTHS = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];
const MONTHS_SHORT = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
const BKK_OFFSET_MS = 7 * 3600 * 1000;

export const toBE = (ceYear) => ceYear + 543;

/** ตรวจและแยก YYYY-MM-DD (โยน error ถ้าไม่ใช่วันที่จริง เช่น 30 ก.พ.) */
export function parseDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
  if (!m) throw new Error(`วันที่ไม่ถูกต้อง: ${iso}`);
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) throw new Error(`วันที่ไม่ถูกต้อง: ${iso}`);
  return { y, m: mo, d };
}

export function isValidDate(iso) {
  try { parseDate(iso); return true; } catch { return false; }
}

/** ปีงบประมาณ (พ.ศ.) ของวันที่ · startMonth = เดือนแรกของปีงบ (ค่าเริ่ม ต.ค.) */
export function fiscalYearOf(iso, startMonth = 10) {
  const { y, m } = parseDate(iso);
  return toBE(startMonth > 1 && m >= startMonth ? y + 1 : y);
}

export function formatThaiDate(iso) {
  const { y, m, d } = parseDate(iso);
  return `${d} ${MONTHS[m - 1]} ${toBE(y)}`;
}

export function formatThaiDateShort(iso) {
  const { y, m, d } = parseDate(iso);
  return `${d} ${MONTHS_SHORT[m - 1]} ${toBE(y)}`;
}

/** วันที่ปัจจุบันตามเวลาไทย (UTC+7 ไม่มี DST) */
export function todayInBangkok(date) {
  return new Date(date.getTime() + BKK_OFFSET_MS).toISOString().slice(0, 10);
}

export function daysBetween(fromIso, toIso) {
  const a = parseDate(fromIso), b = parseDate(toIso);
  return Math.round((Date.UTC(b.y, b.m - 1, b.d) - Date.UTC(a.y, a.m - 1, a.d)) / 86400000);
}

export function addDays(iso, n) {
  const { y, m, d } = parseDate(iso);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}
