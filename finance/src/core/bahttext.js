// คำอ่านยอดเงินเป็นภาษาไทย (เหมือน BAHTTEXT ของ Excel) · รับยอดเป็นสตางค์จำนวนเต็ม
const D = ['ศูนย์', 'หนึ่ง', 'สอง', 'สาม', 'สี่', 'ห้า', 'หก', 'เจ็ด', 'แปด', 'เก้า'];
const P = ['', 'สิบ', 'ร้อย', 'พัน', 'หมื่น', 'แสน'];

// อ่านเลข 1..999999 · hasHigher = มีหลักล้านขึ้นไปนำหน้า (หลักหน่วย 1 อ่าน "เอ็ด")
function below(n, hasHigher) {
  const s = String(n);
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const d = Number(s[i]);
    const pos = s.length - 1 - i;
    if (d === 0) continue;
    if (pos === 0) out += d === 1 && (s.length > 1 || hasHigher) ? 'เอ็ด' : D[d];
    else if (pos === 1) out += d === 1 ? 'สิบ' : d === 2 ? 'ยี่สิบ' : `${D[d]}สิบ`;
    else out += D[d] + P[pos];
  }
  return out;
}

function read(n) {
  if (n === 0) return 'ศูนย์';
  const hi = Math.floor(n / 1000000), lo = n % 1000000;
  return (hi ? `${read(hi)}ล้าน` : '') + (lo ? below(lo, hi > 0) : '');
}

export function bahtText(satang) {
  if (!Number.isInteger(satang)) throw new Error('ยอดเงินต้องเป็นสตางค์จำนวนเต็ม');
  const neg = satang < 0;
  const a = Math.abs(satang);
  const baht = Math.floor(a / 100), st = a % 100;
  return `${neg ? 'ลบ' : ''}${read(baht)}บาท${st ? `${read(st)}สตางค์` : 'ถ้วน'}`;
}
