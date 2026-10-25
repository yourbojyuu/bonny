/* ระบบการเงินโรงเรียน — grid.js
   ตารางกรอกหน้าตาแบบ Excel: แถวละรายการ · ลูกศร/Enter/Tab เลื่อนช่อง · วางหลายแถวจาก Excel · Ctrl+D คัดลอกจากแถวบน
   ใช้ร่วมกันทั้ง ขบ. (รายจ่าย) และใบเสร็จ (รายรับ) */

var Grid = (function () {
  var MON = { 'ม.ค.': 1, 'ก.พ.': 2, 'มี.ค.': 3, 'เม.ย.': 4, 'พ.ค.': 5, 'มิ.ย.': 6, 'ก.ค.': 7, 'ส.ค.': 8, 'ก.ย.': 9, 'ต.ค.': 10, 'พ.ย.': 11, 'ธ.ค.': 12,
    'มกราคม': 1, 'กุมภาพันธ์': 2, 'มีนาคม': 3, 'เมษายน': 4, 'พฤษภาคม': 5, 'มิถุนายน': 6, 'กรกฎาคม': 7, 'สิงหาคม': 8, 'กันยายน': 9, 'ตุลาคม': 10, 'พฤศจิกายน': 11, 'ธันวาคม': 12 };
  function p2(n) { return ('0' + n).slice(-2); }
  function yr(y) { y = Number(y); if (y < 100) return y >= 50 ? y + 1957 : y + 2000; return y > 2400 ? y - 543 : y; }
  /** ข้อความวันที่ (8 ต.ค. 69 · 8/10/69 · 2026-10-08) -> ISO หรือ '' */
  function parseDate(s) {
    s = String(s || '').trim(); if (!s) return '';
    var m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
    if (m) return yr(m[1]) + '-' + p2(m[2]) + '-' + p2(m[3]);
    m = /^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/.exec(s);
    if (m) return yr(m[3]) + '-' + p2(m[2]) + '-' + p2(m[1]);
    m = /^(\d{1,2})\s*[\-\/ ]?\s*([^\d\s\/\-]+\.?)\s*[\-\/ ]?\s*(\d{2,4})$/.exec(s);
    if (m && MON[m[2]]) return yr(m[3]) + '-' + p2(MON[m[2]]) + '-' + p2(m[1]);
    return '';
  }
  function num(s) { var t = String(s === null || s === undefined ? '' : s).replace(/[,\s]|บาท/g, ''); if (t === '' || t === '-') return 0; var n = Number(t); return isFinite(n) ? n : NaN; }
  function fmtN(n) { return n ? n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : ''; }
  function letter(i) { return String.fromCharCode(65 + i); }

  /**
   * cfg = { cols:[{k,label,w,type:'text'|'date'|'money'|'list',list:fn,ro,calc:fn(row),align,ph,fmt:fn(row)}],
   *         pre:[{k:v}] (อ่านอย่างเดียว), rows:[{}], blank:fn(prevRow)->row, onRow:fn(row,k,api), onPaste:fn(text,api)->bool,
   *         totals:fn(rows)->html, isEmpty:fn(row)->bool }
   */
  function create(host, cfg) {
    var rows = (cfg.rows || []).slice(), bad = {}, api = {}, drawing = false;
    var cols = cfg.cols, nEd = cols.filter(function (c) { return !c.ro && !c.calc; }).length;
    function blankRow(prev) { return cfg.blank ? cfg.blank(prev || null) : {}; }
    function empty(r) { return cfg.isEmpty ? cfg.isEmpty(r) : cols.every(function (c) { return c.ro || c.calc || !r[c.k]; }); }
    function ensureTail() { if (!rows.length || !empty(rows[rows.length - 1])) rows.push(blankRow(rows[rows.length - 1])); }
    ensureTail();

    function cellHtml(r, ri, c, ci) {
      var v = r[c.k], disp = '';
      if (c.calc) { var cv = c.calc(r); disp = c.type === 'money' ? fmtN(cv) : (cv === null || cv === undefined ? '' : cv); }
      else if (c.type === 'date') disp = v ? thaiDate(v) : '';
      else if (c.type === 'money') disp = v === '' || v === undefined || v === null ? '' : (isNaN(num(v)) ? String(v) : fmtN(num(v)));
      else disp = v === undefined || v === null ? '' : v;
      var ro = c.ro || c.calc;
      return '<td class="xc' + (ro ? ' ro' : '') + (c.type === 'money' ? ' mn' : '') + (bad[ri + ':' + c.k] ? ' bad' : '') + '"><input data-r="' + ri + '" data-c="' + ci + '" data-k="' + c.k + '" value="' + esc(disp) + '"' +
        (ro ? ' readonly tabindex="-1"' : '') + (c.list ? ' list="gl-' + c.k + '"' : '') + (c.ph ? ' placeholder="' + esc(c.ph) + '"' : '') + ' autocomplete="off"></td>';
    }
    function rowHtml(r, ri) {
      return '<tr data-r="' + ri + '"><th class="rn" title="ลบแถว (Ctrl+Backspace)"><span>' + (ri + 1) + '</span><button type="button" class="rx" data-del="' + ri + '" tabindex="-1" aria-label="ลบแถว ' + (ri + 1) + '">×</button></th>' + cols.map(function (c, ci) { return cellHtml(r, ri, c, ci); }).join('') + '</tr>';
    }
    function draw() {
      var pre = cfg.pre || [], h = '<div class="xl"><table class="xlt"><colgroup><col style="width:46px">' + cols.map(function (c) { return '<col style="width:' + c.w + 'px">'; }).join('') + '</colgroup>' +
        '<thead><tr class="ltr"><th class="rn"></th>' + cols.map(function (c, i) { return '<th>' + letter(i) + '</th>'; }).join('') + '</tr><tr class="lbl"><th class="rn">#</th>' + cols.map(function (c) { return '<th>' + esc(c.label) + '</th>'; }).join('') + '</tr></thead><tbody>';
      pre.forEach(function (p, i) {
        h += '<tr class="pre"><th class="rn">' + (i + 1) + '</th>' + cols.map(function (c) {
          var v = p[c.k], d = v === undefined || v === null ? '' : v;
          if (c.type === 'date') d = d ? thaiDate(d) : ''; else if (c.type === 'money') d = typeof d === 'number' ? fmtN(d) : d;
          return '<td class="xc ro' + (c.type === 'money' ? ' mn' : '') + '"><span>' + esc(d) + '</span></td>';
        }).join('') + '</tr>';
      });
      if (pre.length) h += '<tr class="sepr"><td colspan="' + (cols.length + 1) + '">▼ แถวใหม่ — พิมพ์หรือวางจาก Excel ต่อจากตรงนี้</td></tr>';
      rows.forEach(function (r, ri) { h += rowHtml(r, ri); });
      h += '</tbody>' + (cfg.totals ? '<tfoot><tr><th class="rn">Σ</th>' + cfg.totals(rows) + '</tr></tfoot>' : '') + '</table></div>';
      cols.forEach(function (c) { if (c.list) h += '<datalist id="gl-' + c.k + '">' + c.list().map(function (x) { return '<option value="' + esc(x) + '">'; }).join('') + '</datalist>'; });
      drawing = true; host.innerHTML = h; drawing = false;
    }
    function inp(ri, ci) { return host.querySelector('input[data-r="' + ri + '"][data-c="' + ci + '"]'); }
    function refreshRow(ri) {
      var tr = host.querySelector('tr[data-r="' + ri + '"]'); if (!tr) return;
      Array.prototype.forEach.call(tr.querySelectorAll('input'), function (i) {
        var ci = Number(i.getAttribute('data-c')), c = cols[ci];
        if (document.activeElement === i && !c.calc) return;
        var tmp = document.createElement('div'); tmp.innerHTML = '<table><tr>' + cellHtml(rows[ri], ri, c, ci) + '</tr></table>';
        var ni = tmp.querySelector('input'); i.value = ni.value; i.parentNode.className = ni.parentNode.className;
      });
      if (cfg.totals) { var tf = host.querySelector('tfoot tr'); if (tf) tf.innerHTML = '<th class="rn">Σ</th>' + cfg.totals(rows); }
    }
    function addTail() {
      if (empty(rows[rows.length - 1])) return;
      rows.push(blankRow(rows[rows.length - 1]));
      var tb = host.querySelector('tbody'), t = document.createElement('tbody'); t.innerHTML = rowHtml(rows[rows.length - 1], rows.length - 1); tb.appendChild(t.firstChild);
    }
    /** ตั้งค่าช่อง (ผ่านการ parse ตามชนิด) แล้วเรียก onRow */
    function setCell(ri, k, raw, silent) {
      var c = cols.filter(function (x) { return x.k === k; })[0]; if (!c || c.ro || c.calc) return;
      var r = rows[ri]; if (!r) return;
      if (c.type === 'date') { var iso = parseDate(raw); r[k] = iso || String(raw || '').trim(); if (!iso && raw) r['_badDate'] = true; else delete r['_badDate']; }
      else if (c.type === 'money') { var n = num(raw); r[k] = isNaN(n) ? String(raw) : (n === 0 ? '' : n); }
      else r[k] = String(raw === undefined || raw === null ? '' : raw).trim();
      delete bad[ri + ':' + k];
      if (!silent && cfg.onRow) cfg.onRow(r, k, api);
    }
    function focusCell(ri, ci) {
      if (ri < 0) ri = 0; if (ri >= rows.length) { addTail(); ri = rows.length - 1; }
      var i = inp(ri, Math.max(0, Math.min(cols.length - 1, ci)));
      if (i) { i.focus(); i.select && i.select(); i.scrollIntoView({ block: 'nearest', inline: 'nearest' }); }
    }
    function nextEditable(ci, dir) { var n = ci + dir; while (n >= 0 && n < cols.length && (cols[n].ro || cols[n].calc)) n += dir; return n; }

    host.addEventListener('focusin', function (e) {
      var i = e.target; if (!i.getAttribute || i.getAttribute('data-r') === null) return;
      var ri = Number(i.getAttribute('data-r')), c = cols[Number(i.getAttribute('data-c'))];
      Array.prototype.forEach.call(host.querySelectorAll('tr.cur'), function (t) { t.classList.remove('cur'); }); i.closest('tr').classList.add('cur');
      if (c.type === 'money' && !c.calc) { var n = num(i.value); i.value = n ? String(n) : ''; }
      if (c.type === 'date' && rows[ri][c.k]) i.value = rows[ri][c.k].split('-').reverse().join('/').replace(/\/(\d{4})$/, function (m, y) { return '/' + (Number(y) + 543); });
      setTimeout(function () { if (document.activeElement === i && i.select) i.select(); }, 0);
    });
    host.addEventListener('focusout', function (e) {
      if (drawing) return;
      var i = e.target; if (!i.getAttribute || i.getAttribute('data-r') === null) return;
      var ri = Number(i.getAttribute('data-r')), c = cols[Number(i.getAttribute('data-c'))]; if (c.ro || c.calc || !rows[ri]) return;
      if (String(i.value) !== '' || rows[ri][c.k]) setCell(ri, c.k, i.value);
      refreshRow(ri); addTail();
      var ci2 = i.parentNode; if (rows[ri]._badDate && c.type === 'date') ci2.classList.add('bad');
    });
    host.addEventListener('input', function (e) {
      var i = e.target; if (!i.getAttribute || i.getAttribute('data-r') === null) return;
      i.parentNode.classList.remove('bad');
    });
    host.addEventListener('keydown', function (e) {
      var i = e.target; if (!i.getAttribute || i.getAttribute('data-r') === null) return;
      var ri = Number(i.getAttribute('data-r')), ci = Number(i.getAttribute('data-c')), c = cols[ci];
      if (e.key === 'Enter') { e.preventDefault(); i.blur(); focusCell(ri + 1, ci); }
      else if (e.key === 'ArrowDown') { if (c.list && i.value === '' && false) return; e.preventDefault(); focusCell(ri + 1, ci); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); focusCell(ri - 1, ci); }
      else if (e.key === 'ArrowRight' && i.selectionStart === i.value.length && i.selectionEnd === i.value.length) { var n = nextEditable(ci, 1); if (n < cols.length) { e.preventDefault(); focusCell(ri, n); } }
      else if (e.key === 'ArrowLeft' && i.selectionStart === 0 && i.selectionEnd === 0) { var p = nextEditable(ci, -1); if (p >= 0) { e.preventDefault(); focusCell(ri, p); } }
      else if ((e.ctrlKey || e.metaKey) && (e.key === 'd' || e.key === 'D') && ri > 0 && !c.ro && !c.calc) { e.preventDefault(); i.value = rows[ri - 1][c.k] === undefined ? '' : (c.type === 'date' ? thaiDate(rows[ri - 1][c.k]) : rows[ri - 1][c.k]); setCell(ri, c.k, rows[ri - 1][c.k]); refreshRow(ri); i.value = c.type === 'date' ? thaiDate(rows[ri][c.k]) : rows[ri][c.k]; }
      else if ((e.ctrlKey || e.metaKey) && e.key === 'Backspace') { e.preventDefault(); removeRow(ri); focusCell(Math.min(ri, rows.length - 1), ci); }
      else if (e.key === 'Escape') { i.value = ''; setCell(ri, c.k, ''); refreshRow(ri); }
    });
    host.addEventListener('click', function (e) { var d = e.target.closest('[data-del]'); if (d) { removeRow(Number(d.getAttribute('data-del'))); } });
    host.addEventListener('paste', function (e) {
      var i = e.target; if (!i.getAttribute || i.getAttribute('data-r') === null) return;
      var text = (e.clipboardData || window.clipboardData).getData('text');
      if (!text || (text.indexOf('\t') < 0 && text.indexOf('\n') < 0)) return;
      e.preventDefault();
      if (cfg.onPaste && cfg.onPaste(text, api, Number(i.getAttribute('data-r')), Number(i.getAttribute('data-c')))) return;
      var grid = Paste.parseTSV(text), ri = Number(i.getAttribute('data-r')), ci = Number(i.getAttribute('data-c'));
      grid.forEach(function (line, a) {
        var r = ri + a; while (r >= rows.length) rows.push(blankRow(rows[rows.length - 1]));
        var cc = ci; line.forEach(function (cell) { while (cc < cols.length && (cols[cc].ro || cols[cc].calc)) cc++; if (cc >= cols.length) return; setCell(r, cols[cc].k, cell); cc++; });
      });
      ensureTail(); draw();
    });
    function removeRow(ri) { rows.splice(ri, 1); bad = {}; ensureTail(); draw(); }

    api = {
      rows: function () { return rows; },
      filled: function () { return rows.filter(function (r) { return !empty(r); }); },
      set: function (ri, k, v) { setCell(ri, k, v, true); refreshRow(ri); },
      mark: function (ri, k) { bad[ri + ':' + k] = true; refreshRow(ri); var c = cols.map(function (x) { return x.k; }).indexOf(k); var i = inp(ri, c); if (i) i.parentNode.classList.add('bad'); },
      markRow: function (ri) { cols.forEach(function (c) { if (!c.ro && !c.calc) bad[ri + ':' + c.k] = true; }); refreshRow(ri); },
      replace: function (list) { rows = list.slice(); bad = {}; ensureTail(); draw(); },
      append: function (list) { if (rows.length && empty(rows[rows.length - 1])) rows.pop(); rows = rows.concat(list); ensureTail(); draw(); },
      focus: function (ri, ci) { focusCell(ri === undefined ? rows.length - 1 : ri, ci || 0); },
      redraw: draw, pre: function (p) { cfg.pre = p; draw(); }
    };
    draw();
    return api;
  }
  return { create: create, parseDate: parseDate, num: num, fmtN: fmtN };
})();
