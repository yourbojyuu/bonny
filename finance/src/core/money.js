// เงินเก็บเป็น "สตางค์" จำนวนเต็มทั้งระบบ เพื่อไม่ให้ปัดเศษผิด (เช่น เกณฑ์ 467.29)

/** แปลงยอดบาท (ตัวเลข หรือข้อความแบบ "1,234.50") เป็นสตางค์ ทศนิยมเกิน 2 ตำแหน่ง = error */
export function toSatang(input) {
  if (typeof input === 'number') {
    if (!Number.isFinite(input)) throw new Error('ยอดเงินไม่ถูกต้อง');
    const x = input * 100;
    const r = Math.round(x);
    if (Math.abs(x - r) > 1e-6) throw new Error('ยอดเงินมีทศนิยมได้ไม่เกิน 2 ตำแหน่ง');
    return r;
  }
  if (typeof input !== 'string') throw new Error('ยอดเงินไม่ถูกต้อง');
  const s = input.replace(/,/g, '').trim();
  const m = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(s);
  if (!m) throw new Error(/^-?\d+\.\d{3,}$/.test(s) ? 'ยอดเงินมีทศนิยมได้ไม่เกิน 2 ตำแหน่ง' : 'ยอดเงินไม่ถูกต้อง');
  const v = Number(m[2]) * 100 + Number((m[3] || '').padEnd(2, '0'));
  return m[1] ? -v : v;
}

/** สตางค์ → "1,234.50" */
export function formatSatang(satang) {
  const neg = satang < 0;
  const a = Math.abs(satang);
  const baht = Math.floor(a / 100).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const st = String(a % 100).padStart(2, '0');
  return `${neg ? '-' : ''}${baht}.${st}`;
}
