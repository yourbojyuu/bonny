// ภาษีหัก ณ ที่จ่าย: เทียบเกณฑ์เป็นจำนวนเต็ม (ไม่ปัดเกณฑ์ 500/1.07 เป็น 467)
//   หักเมื่อ base × (100 + VAT) ≥ เกณฑ์ยอดรวม VAT × 100   · ภาษี = round(base × อัตรา%)  (ครึ่งสตางค์ปัดขึ้น)
// base และผลลัพธ์เป็นสตางค์
export function calcTax(settings, taxForm, base) {
  const gross = taxForm === 'ภ.ง.ด.3' ? settings.pnd3_gross_threshold : taxForm === 'ภ.ง.ด.53' ? settings.pnd53_gross_threshold : null;
  if (gross == null || base <= 0) return 0;
  if (base * (100 + settings.vat_rate_pct) < gross * 100) return 0;
  return Math.floor((base * settings.wht_rate_pct + 50) / 100);
}
