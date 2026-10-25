/* ระบบการเงินโรงเรียน — export.js
   สร้างไฟล์ Excel (.xlsx) ของ ขบ. / ขจ. ให้หน้าตาเหมือนไฟล์งานเดิม ใช้ฟอนต์ TH SarabunPSK
   ข้อมูลมาจาก action khbDoc / khjDoc (ยอดรวมและตัวอักษรคำนวณโดยระบบ) · ต้องโหลด vendor/exceljs.min.js ก่อน */

var XlsxExport = (function () {
  var FONT = 'TH SarabunPSK', LINE = { style: 'thin', color: { argb: 'FF5B6272' } }, FINE = { style: 'hair', color: { argb: 'FF9AA3B5' } };
  var HEAD_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE6ECF8' } };
  var TOT_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF4F6FB' } };
  var NUM = '#,##0.00;-#,##0.00;"-"';
  var BOX = { top: LINE, left: LINE, bottom: LINE, right: LINE };

  function font(sz, bold, argb) { return { name: FONT, size: sz || 16, bold: !!bold, color: argb ? { argb: argb } : undefined }; }
  function lines(text, widthUnits) { return Math.max(1, Math.ceil(String(text).length * 1.45 / widthUnits)); }

  function sheetBase(wb, title, widths) {
    var ws = wb.addWorksheet(title, {
      pageSetup: { paperSize: 9, orientation: 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0, horizontalCentered: true,
        margins: { left: 0.55, right: 0.55, top: 0.6, bottom: 0.6, header: 0.3, footer: 0.3 } },
      views: [{ showGridLines: false }]
    });
    ws.columns = widths.map(function (w) { return { width: w }; });
    return ws;
  }
  /** ใส่ข้อความช่วงที่ merge */
  function put(ws, r, c1, c2, value, o) {
    o = o || {};
    if (c2 > c1) ws.mergeCells(r, c1, r, c2);
    var cell = ws.getCell(r, c1);
    cell.value = value;
    cell.font = o.font || font(16);
    cell.alignment = { horizontal: o.h || 'left', vertical: o.v || 'middle', wrapText: !!o.wrap, indent: o.indent || 0 };
    if (o.fill) for (var c = c1; c <= c2; c++) ws.getCell(r, c).fill = o.fill;
    if (o.box) for (var k = c1; k <= c2; k++) ws.getCell(r, k).border = o.box;
    if (o.num) cell.numFmt = NUM;
    return cell;
  }
  function head(ws, d, last, widthSum) {
    var r = 1;
    ws.getRow(r).height = 8; r = 2;
    put(ws, r, 1, last, 'บันทึกข้อความ', { h: 'center', font: font(26, true) }); ws.getRow(r).height = 40;
    if (d.cancelled) put(ws, 3, 1, last, 'ยกเลิกเอกสารนี้แล้ว', { h: 'center', font: font(16, true, 'FFD01C3F') });
    ws.getRow(3).height = 14;
    var half = Math.floor(last / 2);
    put(ws, 4, 1, last, 'ส่วนราชการ  ' + d.org); ws.getRow(4).height = 24;
    put(ws, 5, 1, half, 'ที่  ' + d.noText); put(ws, 5, half + 1, last, 'วันที่  ' + d.dateLong, { h: 'left' }); ws.getRow(5).height = 24;
    put(ws, 6, 1, last, 'เรื่อง  ' + d.subject); ws.getRow(6).height = 24;
    put(ws, 7, 1, last, 'เรียน  ' + d.to); ws.getRow(7).height = 24;
    for (var c = 1; c <= last; c++) ws.getCell(7, c).border = { bottom: LINE };
    ws.getRow(8).height = 10;
    return 9;
  }
  function para(ws, r, last, text, widthSum, indent) {
    put(ws, r, 1, last, text, { wrap: true, v: 'top', indent: indent === undefined ? 4 : indent });
    ws.getRow(r).height = 22 * lines(text, widthSum * 0.82) + 2;
    return r + 1;
  }
  /** ลายเซ็น 2 คน ต่อแถว: ซ้ายคอลัมน์ 1..mid ขวาคอลัมน์ mid+1..last */
  function dots(n) { return new Array(Math.max(8, n) + 1).join('.'); }
  function signBlock(ws, r, last, mid, signers, widths) {
    for (var i = 0; i < signers.length; i += 2) {
      var pair = [signers[i], signers[i + 1]].filter(function (s) { return s && (s.name || s.pos); });
      if (!pair.length) continue;
      [[1, mid], [mid + 1, last]].forEach(function (rng, k) {
        var s = signers[i + k]; if (!s || !(s.name || s.pos)) return;
        var bw = 0; for (var q = rng[0]; q <= rng[1]; q++) bw += widths[q - 1];
        put(ws, r, rng[0], rng[1], 'ลงชื่อ ' + dots(Math.floor(bw * 0.6) - 8), { h: 'center' });
        put(ws, r + 1, rng[0], rng[1], s.name, { h: 'center' });
        put(ws, r + 2, rng[0], rng[1], s.pos, { h: 'center', wrap: true });
      });
      ws.getRow(r).height = 34; ws.getRow(r + 1).height = 22; ws.getRow(r + 2).height = 22 * (String((pair[0] || {}).pos || '').length > 34 || String((pair[1] || {}).pos || '').length > 34 ? 2 : 1);
      r += 4;
    }
    return r;
  }
  function directorBlock(ws, r, last, dir) {
    put(ws, r, 1, last, 'ความเห็นผู้อำนวยการ', { h: 'left', font: font(16, true) }); ws.getRow(r).height = 26; r++;
    for (var i = 0; i < 2; i++) { put(ws, r, 1, last, '.....................................................................................................................', { h: 'center' }); ws.getRow(r).height = 24; r++; }
    ws.getRow(r).height = 14; r++;
    put(ws, r, 1, last, 'ลงชื่อ ......................................................', { h: 'center' }); ws.getRow(r).height = 30; r++;
    put(ws, r, 1, last, dir.name, { h: 'center' }); ws.getRow(r).height = 22; r++;
    put(ws, r, 1, last, dir.pos, { h: 'center' }); ws.getRow(r).height = 22;
    return r + 1;
  }
  function sum(rowFrom, rowTo, col) { return 'SUM(' + col + rowFrom + ':' + col + rowTo + ')'; }

  /* ---------- ขบ. ---------- */
  function buildKhb(wb, d) {
    var W = [6, 17, 14, 12, 12, 16, 13, 17], last = 8, tw = 107;
    var ws = sheetBase(wb, d.noText.replace(/[\\\/*?:\[\]]/g, '-'), W);
    var r = head(ws, d, last, tw);
    r = para(ws, r, last, d.paras[0], tw); r = para(ws, r, last, d.paras[1], tw, 0);
    ws.getRow(r).height = 6; r++;
    var h = r;
    ['ที่', 'ประเภทเงิน', 'รายการ - ชื่อผู้เบิก/ผู้ยืม', null, null, 'ขอเบิกเงิน', 'ภาษี', 'รวมเป็นเงิน'].forEach(function (t, i) {
      var c = ws.getCell(h, i + 1); c.value = t; c.font = font(16, true); c.fill = HEAD_FILL; c.border = BOX; c.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    });
    ws.mergeCells(h, 3, h, 5); ws.getRow(h).height = 28; r = h + 1;
    var first = r;
    d.rows.forEach(function (x) {
      ws.mergeCells(r, 3, r, 5);
      ws.getCell(r, 1).value = x.i; ws.getCell(r, 2).value = x.type; ws.getCell(r, 3).value = x.payee;
      ws.getCell(r, 6).value = x.net; ws.getCell(r, 7).value = x.tax; ws.getCell(r, 8).value = { formula: 'F' + r + '+G' + r, result: x.gross };
      for (var c = 1; c <= last; c++) {
        var cell = ws.getCell(r, c);
        cell.font = font(16, c === 8); cell.border = { top: FINE, left: LINE, right: LINE, bottom: FINE };
        cell.alignment = { vertical: 'middle', wrapText: c === 2 || c === 3, horizontal: c === 1 || c === 2 ? 'center' : c >= 6 ? 'right' : 'left', indent: c === 3 ? 1 : 0 };
        if (c >= 6) cell.numFmt = NUM;
      }
      ws.getRow(r).height = Math.max(25, 22 * Math.max(lines(x.payee, 36), lines(x.type, 16)) + 3);
      r++;
    });
    var lastRow = r - 1;
    ws.mergeCells(r, 1, r, 5);
    ws.getCell(r, 1).value = 'รวม';
    ws.getCell(r, 6).value = { formula: sum(first, lastRow, 'F'), result: d.total.net };
    ws.getCell(r, 7).value = { formula: sum(first, lastRow, 'G'), result: d.total.tax };
    ws.getCell(r, 8).value = { formula: sum(first, lastRow, 'H'), result: d.total.gross };
    for (var c2 = 1; c2 <= last; c2++) {
      var t = ws.getCell(r, c2); t.font = font(16, true); t.fill = TOT_FILL; t.border = BOX;
      t.alignment = { horizontal: c2 >= 6 ? 'right' : 'center', vertical: 'middle' }; if (c2 >= 6) t.numFmt = NUM;
    }
    ws.getRow(r).height = 27; r++;
    put(ws, r, 1, last, '(' + d.totalText + ')', { h: 'right', font: font(16, true) }); ws.getRow(r).height = 26; r += 2;
    put(ws, r, 1, last, 'จึงเรียนมาเพื่อโปรดพิจารณาอนุมัติ', { indent: 4 }); ws.getRow(r).height = 26; r += 2;
    r = signBlock(ws, r, last, 4, d.signers, W);
    ws.getRow(r).height = 8; r++;
    r = directorBlock(ws, r, last, d.director);
    ws.pageSetup.fitToHeight = 1;
    ws.pageSetup.printArea = 'A1:H' + r;
    return ws;
  }

  /* ---------- ขจ. ---------- */
  function buildKhj(wb, d) {
    var W = [6, 19, 36, 20, 25], last = 5, tw = 106;
    var ws = sheetBase(wb, d.noText.replace(/[\\\/*?:\[\]]/g, '-'), W);
    var r = head(ws, d, last, tw);
    r = para(ws, r, last, d.paras[0], tw);
    var secTotals = [];
    d.sections.forEach(function (s, si) {
      ws.getRow(r).height = 10; r++;
      put(ws, r, 1, last, (si + 1) + '. ' + s.title + ' จำนวน ' + s.rows.length + ' รายการ', { font: font(16, true) }); ws.getRow(r).height = 26; r++;
      ['ที่', 'เลขที่เช็ค', 'ชื่อผู้รับ', 'จำนวนเงิน', 'หมายเหตุ'].forEach(function (t, i) {
        var c = ws.getCell(r, i + 1); c.value = t; c.font = font(16, true); c.fill = HEAD_FILL; c.border = BOX; c.alignment = { horizontal: 'center', vertical: 'middle' };
      });
      ws.getRow(r).height = 26; r++;
      var first = r;
      s.rows.forEach(function (x) {
        ws.getCell(r, 1).value = x.i; ws.getCell(r, 2).value = x.ref; ws.getCell(r, 3).value = x.payee; ws.getCell(r, 4).value = x.amount; ws.getCell(r, 5).value = x.note || x.khb;
        for (var c = 1; c <= last; c++) {
          var cell = ws.getCell(r, c);
          cell.font = font(c === 5 && !x.note ? 13 : 16, false, c === 5 && !x.note ? 'FF6B7385' : undefined);
          cell.border = { top: FINE, left: LINE, right: LINE, bottom: FINE };
          cell.alignment = { vertical: 'middle', wrapText: c === 3 || c === 5, horizontal: c === 3 ? 'left' : c === 4 ? 'right' : 'center', indent: c === 3 ? 1 : 0 };
          if (c === 4) cell.numFmt = NUM;
        }
        ws.getRow(r).height = Math.max(25, 22 * lines(x.payee, 33) + 3);
        r++;
      });
      var lastRow = r - 1;
      ws.mergeCells(r, 1, r, 3);
      ws.getCell(r, 1).value = 'เป็นจำนวนเงินทั้งสิ้น';
      ws.getCell(r, 4).value = { formula: sum(first, lastRow, 'D'), result: s.total };
      for (var c2 = 1; c2 <= last; c2++) {
        var t = ws.getCell(r, c2); t.font = font(16, true); t.fill = TOT_FILL; t.border = BOX;
        t.alignment = { horizontal: c2 === 4 ? 'right' : 'center', vertical: 'middle' }; if (c2 === 4) t.numFmt = NUM;
      }
      ws.getRow(r).height = 27; secTotals.push('D' + r); r++;
      put(ws, r, 1, last, '(' + s.totalText + ')', { h: 'right', font: font(16, true) }); ws.getRow(r).height = 26; r++;
    });
    ws.getRow(r).height = 10; r++;
    put(ws, r, 1, 3, 'รวมเป็นเงินทั้งสิ้น', { font: font(18, true), h: 'center' });
    ws.mergeCells(r, 4, r, 5); // ยอดรวมอยู่ D:E
    var g = ws.getCell(r, 4); g.value = { formula: 'SUM(' + secTotals.join(',') + ')', result: d.grand }; g.numFmt = NUM; g.font = font(18, true); g.alignment = { horizontal: 'right', vertical: 'middle' };
    ws.getRow(r).height = 30; r++;
    put(ws, r, 1, last, '(' + d.grandText + ')', { h: 'right', font: font(16, true) }); ws.getRow(r).height = 26; r += 2;
    put(ws, r, 1, last, 'จึงเรียนมาเพื่อโปรดพิจารณา', { indent: 4 }); ws.getRow(r).height = 26; r += 2;
    r = signBlock(ws, r, last, 3, d.signers, W);
    ws.getRow(r).height = 8; r++;
    r = directorBlock(ws, r, last, d.director);
    ws.pageSetup.printArea = 'A1:E' + r;
    return ws;
  }

  function fileName(d) { return d.noText.replace(/[\\\/:*?"<>|]/g, '-') + '.xlsx'; }
  function build(d) {
    var wb = new ExcelJS.Workbook();
    wb.creator = 'ระบบการเงินโรงเรียน'; wb.created = new Date();
    if (d.kind === 'ขบ') buildKhb(wb, d); else buildKhj(wb, d);
    return wb.xlsx.writeBuffer();
  }
  function download(d) {
    return build(d).then(function (buf) {
      var blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob); a.download = fileName(d);
      document.body.appendChild(a); a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
      return fileName(d);
    });
  }
  return { build: build, download: download, fileName: fileName };
})();
if (typeof module !== 'undefined') module.exports = XlsxExport;
