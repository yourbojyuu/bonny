// เอกสารพิมพ์ A4 (HTML) ฟอนต์ TH Sarabun New / Sarabun · วันที่ไทย พ.ศ. คำนวณในโค้ด · ข้อความทุกช่องผ่าน esc()
// รูปแบบเป็นรูปแบบมาตรฐานชั่วคราวตามหัวข้อ 7 ของ HANDOFF ยังไม่ได้เทียบกับแบบฟอร์มเดิมของโรงเรียน (ไม่มีไฟล์ตัวอย่างใน repo)
import { formatSatang } from './money.js';
import { bahtText } from './bahttext.js';
import { formatThaiDate, formatThaiDateShort } from './thaidate.js';

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const m = (n) => formatSatang(n);
const d = (iso) => (iso ? formatThaiDate(iso) : '');

const CSS = `<style>
.doc{font-family:'TH Sarabun New','Sarabun',sans-serif;font-size:15pt;line-height:1.35;color:#000;max-width:178mm;margin:0 auto;background:#fff}
.doc h1{font-size:22pt;text-align:center;margin:0 0 6pt}.doc h2{font-size:16pt;margin:12pt 0 4pt}
.doc table{border-collapse:collapse;width:100%;margin:6pt 0}.doc th,.doc td{border:1px solid #000;padding:2pt 5pt;vertical-align:top;font-size:13pt}
.doc th{text-align:center;font-weight:700}.doc td.n{text-align:right}.doc td.c{text-align:center}
.doc .memo p{margin:2pt 0}.doc .indent{text-indent:24pt}.doc .sigrow{display:flex;flex-wrap:wrap;gap:0 4%;margin-top:6pt}
.doc .sig{width:30%;text-align:center;margin-top:24pt;font-size:13pt}.doc .sig .line{border-bottom:1px dotted #000;height:26pt}
.doc .pb{page-break-before:always}.doc .small{font-size:12pt}.doc .cheque{border:2px solid #000;padding:10pt 14pt;margin:8pt 0}
.doc .row{display:flex;justify-content:space-between;gap:12pt}.doc .big{font-size:20pt;font-weight:700}
@page{size:A4;margin:18mm 16mm}
</style>`;
const wrap = (body) => `${CSS}<div class="doc">${body}</div>`;

const table = (heads, rows, { total } = {}) => `<table><thead><tr>${heads.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c) => (typeof c === 'object' && c !== null ? `<td class="${c.k || ''}">${c.v}</td>` : `<td>${esc(c)}</td>`)).join('')}</tr>`).join('')}${total || ''}</tbody></table>`;
const N = (n) => ({ k: 'n', v: esc(m(n)) });

function memoHead(x) {
  return `<h1>บันทึกข้อความ</h1><div class="memo"><p><b>ส่วนราชการ</b> ${esc(x.school)}</p><p><b>ที่</b> ${esc(x.number)}<span style="margin-left:40pt"><b>วันที่</b> ${esc(d(x.date))}</span></p><p><b>เรื่อง</b> ${esc(x.subject)}</p><p><b>เรียน</b> ผู้อำนวยการ${esc(x.school)}</p></div><hr>`;
}
function sigs(list) {
  return `<div class="sigrow">${list.map((s) => `<div class="sig"><div class="line"></div>(${esc(s.name || '..............................')})<br>${esc(s.role)}</div>`).join('')}</div>`;
}

export function docApproval(x) {
  return wrap(`${memoHead({ school: x.school, number: x.approval_code || '(ยังไม่มีรหัสอนุมัติ)', date: x.date, subject: 'ขออนุมัติใช้เงิน' })}
<p class="indent">ด้วย ${esc(x.requester)} ขออนุมัติใช้เงินตามโครงการ/กิจกรรม <b>${esc(x.project)}</b> (${esc(x.fund_code)}) เพื่อ ${esc(x.items)} เป็นเงิน <b>${esc(m(x.amount))}</b> บาท (${esc(bahtText(x.amount))})</p>
<p class="indent">จึงเรียนมาเพื่อโปรดพิจารณาอนุมัติ</p>${sigs([{ role: 'ผู้ขอ', name: x.requester }, { role: 'งานแผน', name: x.plan_reviewer }, { role: `ผู้อำนวยการ${x.school}`, name: x.director_name }])}`);
}

export function docKhb(x) {
  const rows = x.lines.map((l, i) => [{ k: 'c', v: String(i + 1) }, l.vendor_doc_no, l.payee, l.description, l.approval_code, N(l.base_amount), N(l.tax_amount), N(l.request_amount)]);
  const total = `<tr><td colspan="5"><b>รวม</b> (${esc(bahtText(x.total))})</td><td class="n"></td><td class="n"></td><td class="n"><b>${esc(m(x.total))}</b></td></tr>`;
  return wrap(`${memoHead({ school: x.school, number: x.khb_no, date: x.date, subject: 'ขออนุมัติเบิกเงิน' })}
<p class="indent">ขอเบิกเงินตามรายการดังต่อไปนี้ รวม ${x.lines.length} รายการ เป็นเงิน <b>${esc(m(x.total))}</b> บาท</p>
${table(['ที่', 'เลขที่เอกสารร้าน', 'ผู้รับเงิน', 'รายการ', 'รหัสอนุมัติ', 'มูลค่า', 'ภาษี', 'ยอดเบิก'], rows, { total })}
<p class="indent">จึงเรียนมาเพื่อโปรดพิจารณาอนุมัติ</p>${sigs([{ role: 'ผู้ทำ', name: x.signers.maker }, { role: 'ผู้ตรวจชั้น 1 หัวหน้าการเงิน', name: x.signers.r1 }, { role: 'ผู้ตรวจชั้น 2 หัวหน้ากลุ่มบริหารงานแผนและงบประมาณ', name: x.signers.r2 }, { role: 'ผู้ตรวจชั้น 3 รองผู้อำนวยการ', name: x.signers.r3 }, { role: `ผู้อำนวยการ${x.school}`, name: x.director_name }])}`);
}

export function docKhj(x) {
  const rows = x.items.map((it, i) => [{ k: 'c', v: String(i + 1) }, it.payee, it.ref || '', { k: 'n', v: esc(m(it.amount)) }, it.amount_text || bahtText(it.amount), { k: 'n', v: esc(m(it.tax)) }]);
  const total = `<tr><td colspan="3"><b>รวมจ่ายผู้รับ</b></td><td class="n"><b>${esc(m(x.pay_total))}</b></td><td></td><td class="n"><b>${esc(m(x.tax_total))}</b></td></tr>`;
  return wrap(`${memoHead({ school: x.school, number: x.khj_no, date: x.date, subject: 'ขออนุมัติจ่ายเงิน' })}
<p class="indent">ตามที่ได้รับอนุมัติเบิกเงิน ${esc(x.khb_no)} ขออนุมัติจ่ายเงิน <b>เงิน${esc(x.fund_group)}</b> วิธีจ่าย <b>${esc(x.pay_method)}</b> รวมเป็นเงิน <b>${esc(m(x.total))}</b> บาท (${esc(bahtText(x.total))}) แบ่งเป็นจ่ายให้ผู้รับ ${esc(m(x.pay_total))} บาท และภาษีหัก ณ ที่จ่าย ${esc(m(x.tax_total))} บาท</p>
<h2>เงิน${esc(x.fund_group)}</h2>${table(['ที่', 'ผู้รับเงิน', x.pay_method === 'เช็ค' ? 'เลขที่เช็ค' : 'วิธีโอน', 'จำนวนเงิน', 'ตัวอักษร', 'ภาษีที่หัก'], rows, { total })}
<p class="indent">จึงเรียนมาเพื่อโปรดพิจารณาอนุมัติ</p>${sigs([{ role: 'ผู้ทำ ขจ.', name: x.signers.maker }, { role: 'ผู้ตรวจชั้น 1 หัวหน้าการเงิน', name: x.signers.r1 }, { role: 'ผู้ตรวจชั้น 2 หัวหน้ากลุ่มบริหารงานแผนและงบประมาณ', name: x.signers.r2 }, { role: 'ผู้ตรวจชั้น 3 รองผู้อำนวยการ', name: x.signers.r3 }, { role: `ผู้อำนวยการ${x.school}`, name: x.director_name }])}`);
}

/** หน้าเช็ค (ตำแหน่งตัวอักษรเป็นแบบทั่วไป ต้องปรับตามแบบเช็คจริงของธนาคาร) + ใบแนบรายการ */
export function docCheque(x) {
  return wrap(`<div class="cheque"><div class="row"><span>เลขที่เช็ค ${esc(x.cheque_no)}</span><span>วันที่ ${esc(d(x.date))}</span></div>
<p>จ่าย <b>${esc(x.print_name)}</b></p><p class="big">${esc(m(x.amount))} บาท</p><p>(${esc(x.amount_text)})</p></div>
<div class="pb"></div><h1>ใบแนบรายการจ่ายเช็คเลขที่ ${esc(x.cheque_no)}</h1><p>ผู้รับเงิน ${esc(x.print_name)} · ${esc(x.khj_no)} · วันที่ ${esc(d(x.date))}</p>
${table(['ที่', 'เลขที่เอกสารร้าน', 'รายการ', 'ยอด/ภาษี'], x.lines.map((l, i) => [{ k: 'c', v: String(i + 1) }, l.vendor_doc_no, l.description, { k: 'n', v: esc(x.attachment[i]) }]), { total: `<tr><td colspan="3"><b>รวมจ่ายเช็ค</b> (${esc(x.amount_text)})</td><td class="n"><b>${esc(m(x.amount))}</b></td></tr>` })}`);
}

export function docChequeRegister(x) {
  const rows = x.rows.map((r) => [d(r.date), r.cheque_no, r.payee, N(r.amount), r.khj_no, r.status + (r.note ? ` (${r.note})` : '')]);
  return wrap(`<h1>ทะเบียนคุมเช็ค</h1><p>${esc(x.school)} · บัญชี ${esc(x.account)} · ${esc(x.fund_group)}</p>${table(['วันที่จ่าย', 'เลขที่เช็ค', 'ร้านค้า / ผู้รับเงิน', 'จำนวนเงิน (บาท)', 'อ้าง ขจ.', 'สถานะ / หมายเหตุ'], rows)}<p class="small">เลขเช็คที่ขาดในช่วงที่ใช้: ${x.gaps.length ? esc(x.gaps.join(', ')) : 'ไม่มี'} · เช็คเสียลงทะเบียนครบ (ไม่นับยอด)</p>`);
}

/** ทะเบียนเงินฝากธนาคาร ตามแบบหน้า 12 ของผัง (เพิ่มคอลัมน์ ประเภทเอกสาร) */
export function docDepositRegister(x) {
  const mo = x.month;
  const body = x.rows.map((r, i) => `<tr><td class="c">${i === 0 ? esc(formatThaiDateShort(`${mo}-01`).split(' ').slice(1).join(' ')) : ''}</td><td class="c">${esc(Number(r.date.slice(8)))}</td><td class="c">${esc(r.doc_type)}</td><td class="c">${esc(r.doc_no)}</td><td>${esc(r.description)}</td><td class="n">${r.in ? esc(m(r.in)) : ''}</td><td class="n">${r.out ? esc(m(r.out)) : ''}</td><td class="n">${esc(m(r.balance))}</td><td>${i === x.rows.length - 1 && x.signed_by ? esc(x.signed_by) : ''}</td><td></td></tr>`).join('');
  return wrap(`<h1>ทะเบียนเงินฝากธนาคาร</h1><p>ประเภท ${x.account_type === 'กระแสรายวัน' ? '☐ ออมทรัพย์ ☑ กระแสรายวัน' : '☑ ออมทรัพย์ ☐ กระแสรายวัน'} · ธนาคาร ${esc(x.bank)} สาขา ${esc(x.branch)} · เลขที่บัญชี ${esc(x.account_no)}</p><p>ประเภทเงิน ${esc(x.fund_group)} · ปีงบประมาณ ${esc(x.fiscal_year)}</p>
<table style="table-layout:fixed"><colgroup><col style="width:9%"><col style="width:6%"><col style="width:10%"><col style="width:13%"><col style="width:20%"><col style="width:11%"><col style="width:11%"><col style="width:12%"><col style="width:8%"><col style="width:8%"></colgroup><thead><tr><th rowspan="2">เดือน</th><th rowspan="2">วันที่</th><th colspan="2">ที่เอกสาร</th><th rowspan="2">รายการ</th><th colspan="3">จำนวนเงิน (บาท)</th><th rowspan="2">ลายมือชื่อ<br>หัวหน้า<br>หน่วยงานย่อย</th><th rowspan="2">หมายเหตุ</th></tr><tr><th>ประเภท</th><th>เลขที่</th><th>รับ</th><th>จ่าย</th><th>คงเหลือ</th></tr></thead><tbody>
<tr><td class="c"></td><td class="c">—</td><td></td><td></td><td>ยอดยกมา</td><td></td><td></td><td class="n">${esc(m(x.opening))}</td><td></td><td></td></tr>${body}
<tr><td class="c"></td><td class="c">—</td><td></td><td></td><td>ยอดยกไป</td><td></td><td></td><td class="n">${esc(m(x.closing))}</td><td></td><td></td></tr></tbody></table>`);
}

export function docDaily(x) {
  const g = x.report.groups.map((r) => [r.group, N(r.carried), N(r.in), N(r.out), N(r.balance)]);
  const tot = x.report.total;
  return wrap(`<h1>รายงานเงินคงเหลือประจำวัน</h1><p>${esc(x.school)} · วันที่ ${esc(d(x.report.date))}</p>${table(['ประเภทเงิน', 'ยกมา', 'รับ', 'จ่าย', 'คงเหลือ'], g, { total: `<tr><td><b>รวม</b></td><td class="n"><b>${esc(m(tot.carried))}</b></td><td class="n"><b>${esc(m(tot.in))}</b></td><td class="n"><b>${esc(m(tot.out))}</b></td><td class="n"><b>${esc(m(tot.balance))}</b></td></tr>` })}
<p>เงินสดในระบบ ${esc(m(x.report.system_cash))} บาท · เงินสดที่นับได้ ${x.day && x.day.counted_by ? esc(m(x.day.counted_cash)) : '.................'} บาท${x.day && x.day.diff ? ` · ส่วนต่าง ${esc(m(x.day.diff))} บาท (${esc(x.day.diff_note)})` : ''}</p>${sigs([{ role: 'กรรมการเก็บรักษาเงิน', name: (x.day && x.day.signers && x.day.signers[0]) || '' }, { role: 'กรรมการเก็บรักษาเงิน', name: (x.day && x.day.signers && x.day.signers[1]) || '' }, { role: `ผู้อำนวยการ${x.school} ตรวจการจ่าย`, name: x.director_name }])}`);
}

export function docTax(x) {
  const rows = x.summary.forms.flatMap((f) => f.rows.map((r) => [f.form, r.name, N(r.base), N(r.tax)]).concat([[{ k: 'n', v: `<b>รวม ${esc(f.form)}</b>` }, '', { k: 'n', v: `<b>${esc(m(f.base))}</b>` }, { k: 'n', v: `<b>${esc(m(f.tax))}</b>` }]]));
  return wrap(`<h1>สรุปภาษีหัก ณ ที่จ่าย ประจำเดือน ${esc(x.summary.month)}</h1><p>${esc(x.school)}</p>${table(['แบบ', 'ผู้รับเงิน', 'มูลค่า', 'ภาษีที่หัก'], rows)}<p><b>รวมภาษีที่หักทั้งสิ้น ${esc(m(x.summary.total_tax))} บาท</b></p>`);
}

export function docReceiptsMonth(x) {
  const rows = x.summary.rows.map((r) => [`${r.subfund_code} ${r.name}`, r.due == null ? 'ไม่ตั้งยอด' : N(r.due), N(r.cash), N(r.transfer), N(r.total), r.outstanding == null ? '' : N(r.outstanding), r.pct == null ? '' : `${r.pct}%`]);
  return wrap(`<h1>สรุปรายรับรายเดือนแยกชนิดเงินย่อย ${esc(x.summary.month)}</h1><p>${esc(x.school)}</p>${table(['ชนิดเงินย่อย', 'ยอดที่ต้องเก็บ', 'รับเงินสด', 'รับโอน', 'รับรวม', 'ค้างชำระ', 'เก็บได้'], rows)}`);
}

export function docPlanSummary(x) {
  const p = x.plan;
  const rows = p.rows.map((r) => [r.name, r.fund_code, N(r.budget), N(r.committed), N(r.spent), N(r.remaining), `${r.pct}%`]);
  return wrap(`<h1>สรุปผลการใช้เงินตามแผน ปีงบประมาณ ${esc(p.fiscal_year)}</h1><p>${esc(x.school)} · เสนอคณะกรรมการสถานศึกษา</p>${table(['โครงการ/กิจกรรม', 'รหัสเงิน', 'วงเงิน', 'ผูกพัน', 'จ่ายจริง', 'คงเหลือ', 'ใช้ไป'], rows, { total: `<tr><td colspan="2"><b>รวม</b></td><td class="n"><b>${esc(m(p.total.budget))}</b></td><td class="n"><b>${esc(m(p.total.committed))}</b></td><td class="n"><b>${esc(m(p.total.spent))}</b></td><td class="n"><b>${esc(m(p.total.remaining))}</b></td><td></td></tr>` })}`);
}
