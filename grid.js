/* ระบบการเงินโรงเรียน — grid.js
   ตารางกรอกหน้าตาแบบ Excel: แถวละรายการ · ลูกศร/Enter/Tab เลื่อนช่อง · วางหลายแถวจาก Excel · Ctrl+D คัดลอกจากแถวบน
   แถวเดิม (row._old) กับแถวใหม่อยู่ในตารางเดียวกัน: ช่องที่แก้ได้ของแถวเดิมกำหนดด้วย cfg.cellRo(row,col)
   ใช้ร่วมกันทั้ง ขบ.→ขจ.→จ่ายเงิน (รายจ่าย) และใบเสร็จ (รายรับ) */

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
   * cfg = { cols:[{k,label,w,type:'text'|'date'|'money'|'chk',list:fn,ro,calc:fn(row),ph}],
   *         rows:[{...}] (แถวเดิมมี _old:true), blank:fn(prev), onRow:fn(row,k,api), onPaste:fn(text,api,r,c)->bool,
   *         cellRo:fn(row,col)->bool, hide:fn(row)->bool, onChk:fn(row,on,api), rowCls:fn(row)->string, totals:fn(rows)->html, isEmpty:fn(row)->bool }
   */
  function create(host, cfg) {
    var rows = (cfg.rows || []).slice(), bad = {}, api = {}, drawing = false;
    var cols = cfg.cols;
    function blankRow(prev) { return cfg.blank ? cfg.blank(prev || null) : {}; }
    function empty(r) { return r._old ? false : cfg.isEmpty ? cfg.isEmpty(r) : cols.every(function (c) { return c.ro || c.calc || !r[c.k]; }); }
    function lastNew() { for (var i = rows.length - 1; i >= 0; i--) if (!rows[i]._old) return rows[i]; return null; }
    function ensureTail() { var l = rows[rows.length - 1]; if (!l || l._old || !empty(l)) rows.push(blankRow(lastNew())); }
    function ro(r, c) { if (c.calc || c.ro) return true; if (r._old) return cfg.cellRo ? cfg.cellRo(r, c) : true; return cfg.cellRo && c.nonew ? true : false; }
    ensureTail();

    function cellHtml(r, ri, c, ci) {
      var v = r[c.k], disp = '';
      if (c.type === 'chk') {
        var can = cfg.chkOk && cfg.chkOk(r);
        return '<td class="xc chk">' + (can ? '<input type="checkbox" data-r="' + ri + '" data-c="' + ci + '" data-chk="1"' + (r._on ? ' checked' : '') + ' aria-label="เลือกแถว ' + (ri + 1) + '">' : '') + '</td>';
      }
      if (c.calc) { var cv = c.calc(r); disp = c.type === 'money' ? fmtN(cv) : (cv === null || cv === undefined ? '' : cv); }
      else if (c.type === 'date') disp = v ? thaiDate(v) : '';
      else if (c.type === 'money') disp = v === '' || v === undefined || v === null ? '' : (isNaN(num(v)) ? String(v) : fmtN(num(v)));
      else disp = v === undefined || v === null ? '' : v;
      var r0 = ro(r, c);
      return '<td class="xc' + (r0 ? ' ro' : '') + (c.type === 'money' ? ' mn' : '') + (c.tag ? ' tag' : '') + (bad[ri + ':' + c.k] ? ' bad' : '') + '"><input data-r="' + ri + '" data-c="' + ci + '" data-k="' + c.k + '" value="' + esc(disp) + '"' +
        (r0 ? ' readonly tabindex="-1"' : '') + (c.list && !r0 ? ' list="gl-' + c.k + '"' : '') + (c.ph && !r0 ? ' placeholder="' + esc(c.ph) + '"' : '') + ' autocomplete="off"></td>';
    }
    function rowHtml(r, ri, no) {
      var cls = (r._old ? 'old ' : '') + (cfg.rowCls ? cfg.rowCls(r) : '');
      return '<tr data-r="' + ri + '" class="' + cls + '"><th class="rn" title="ลบแถว (Ctrl+Backspace)"><span>' + no + '</span>' + (r._old ? '' : '<button type="button" class="rx" data-del="' + ri + '" tabindex="-1" aria-label="ลบแถว ' + no + '">×</button>') + '</th>' +
        cols.map(function (c, ci) { return cellHtml(r, ri, c, ci); }).join('') + '</tr>';
    }
    function draw() {
      var h = '<div class="xl"><table class="xlt"><colgroup><col style="width:46px">' + cols.map(function (c) { return '<col style="width:' + c.w + 'px">'; }).join('') + '</colgroup>' +
        '<thead><tr class="ltr"><th class="rn"></th>' + cols.map(function (c, i) { return '<th>' + letter(i) + '</th>'; }).join('') + '</tr><tr class="lbl"><th class="rn">#</th>' + cols.map(function (c) { return '<th>' + (c.type === 'chk' ? '<input type="checkbox" id="xAll" aria-label="เลือกทั้งหมดที่เลือกได้">' : esc(c.label)) + '</th>'; }).join('') + '</tr></thead><tbody>';
      var no = 0, sep = false;
      rows.forEach(function (r, ri) {
        if (r._old && cfg.hide && cfg.hide(r)) return;
        if (!r._old && !sep) { if (no) h += '<tr class="sepr"><td colspan="' + (cols.length + 1) + '">▼ แถวใหม่ — พิมพ์หรือวางจาก Excel ต่อจากตรงนี้</td></tr>'; sep = true; no = 0; }
        h += rowHtml(r, ri, ++no);
      });
      h += '</tbody>' + (cfg.totals ? '<tfoot><tr><th class="rn">Σ</th>' + cfg.totals(rows) + '</tr></tfoot>' : '') + '</table></div>';
      cols.forEach(function (c) { if (c.list) h += '<datalist id="gl-' + c.k + '">' + c.list().map(function (x) { return '<option value="' + esc(x) + '">'; }).join('') + '</datalist>'; });
      drawing = true; host.innerHTML = h; drawing = false;
    }
    function inp(ri, ci) { return host.querySelector('input[data-r="' + ri + '"][data-c="' + ci + '"]'); }
    function refreshRow(ri) {
      var tr = host.querySelector('tr[data-r="' + ri + '"]'); if (!tr) return;
      Array.prototype.forEach.call(tr.querySelectorAll('input:not([data-chk])'), function (i) {
        var ci = Number(i.getAttribute('data-c')), c = cols[ci];
        if (document.activeElement === i && !c.calc) return;
        var tmp = document.createElement('div'); tmp.innerHTML = '<table><tr>' + cellHtml(rows[ri], ri, c, ci) + '</tr></table>';
        var ni = tmp.querySelector('input'); i.value = ni.value; i.parentNode.className = ni.parentNode.className;
      });
      if (cfg.totals) { var tf = host.querySelector('tfoot tr'); if (tf) tf.innerHTML = '<th class="rn">Σ</th>' + cfg.totals(rows); }
    }
    function addTail() {
      var l = rows[rows.length - 1]; if (l && !l._old && empty(l)) return;
      rows.push(blankRow(lastNew()));
      var tb = host.querySelector('tbody'), t = document.createElement('tbody'); t.innerHTML = rowHtml(rows[rows.length - 1], rows.length - 1, host.querySelectorAll('tbody tr:not(.old):not(.sepr)').length + 1); tb.appendChild(t.firstChild);
    }
    function setCell(ri, k, raw, silent) {
      var c = cols.filter(function (x) { return x.k === k; })[0]; if (!c || c.calc || c.type === 'chk') return;
      var r = rows[ri]; if (!r || ro(r, c)) return;
      if (c.type === 'date') { var iso = parseDate(raw); r[k] = iso || String(raw || '').trim(); if (!iso && raw) r._badDate = true; else delete r._badDate; }
      else if (c.type === 'money') { var n = num(raw); r[k] = isNaN(n) ? String(raw) : (n === 0 ? '' : n); }
      else r[k] = String(raw === undefined || raw === null ? '' : raw).trim();
      if (r._old) r._dirty = true;
      delete bad[ri + ':' + k];
      if (!silent && cfg.onRow) cfg.onRow(r, k, api);
    }
    function focusable(ri, ci) { var i = inp(ri, ci); return i && !i.readOnly && !i.getAttribute('data-chk'); }
    function focusCell(ri, ci, dir) {
      // ข้ามแถวที่ซ่อน/ช่องที่แก้ไม่ได้ (แถวเดิม) ไปยังช่องถัดไปที่แก้ได้ในคอลัมน์เดียวกัน
      var step = dir || 1;
      if (ri < 0) return;
      if (ri >= rows.length) { addTail(); ri = rows.length - 1; }
      var guard = 0;
      while (guard++ < 5000 && ri >= 0 && ri < rows.length && !focusable(ri, ci) && rows[ri]._old) ri += step;
      if (ri < 0) return; if (ri >= rows.length) { addTail(); ri = rows.length - 1; }
      var i = inp(ri, Math.max(0, Math.min(cols.length - 1, ci)));
      if (i) { i.focus(); i.scrollIntoView({ block: 'nearest', inline: 'nearest' }); }
    }
    function nextEditable(ri, ci, dir) { var n = ci + dir; while (n >= 0 && n < cols.length && !focusable(ri, n)) n += dir; return n; }

    host.addEventListener('focusin', function (e) {
      var i = e.target; if (!i.getAttribute || i.getAttribute('data-r') === null || i.getAttribute('data-chk')) return;
      var ri = Number(i.getAttribute('data-r')), c = cols[Number(i.getAttribute('data-c'))];
      Array.prototype.forEach.call(host.querySelectorAll('tr.cur'), function (t) { t.classList.remove('cur'); }); i.closest('tr').classList.add('cur');
      if (i.readOnly) return;
      if (c.type === 'money' && !c.calc) { var n = num(i.value); i.value = n ? String(n) : ''; }
      if (c.type === 'date' && rows[ri][c.k]) i.value = rows[ri][c.k].split('-').reverse().join('/').replace(/\/(\d{4})$/, function (m, y) { return '/' + (Number(y) + 543); });
      setTimeout(function () { if (document.activeElement === i && i.select) i.select(); }, 0);
    });
    host.addEventListener('focusout', function (e) {
      if (drawing) return;
      var i = e.target; if (!i.getAttribute || i.getAttribute('data-r') === null || i.getAttribute('data-chk')) return;
      var ri = Number(i.getAttribute('data-r')), c = cols[Number(i.getAttribute('data-c'))]; if (!rows[ri] || i.readOnly) return;
      if (String(i.value) !== '' || rows[ri][c.k]) setCell(ri, c.k, i.value);
      refreshRow(ri); if (!rows[ri]._old) addTail();
      if (rows[ri]._badDate && c.type === 'date') i.parentNode.classList.add('bad');
    });
    host.addEventListener('input', function (e) { var i = e.target; if (i.parentNode && i.getAttribute && i.getAttribute('data-r') !== null) i.parentNode.classList.remove('bad'); });
    host.addEventListener('change', function (e) {
      var i = e.target;
      if (i.id === 'xAll') { rows.forEach(function (r, ri) { if (r._old && !(cfg.hide && cfg.hide(r)) && cfg.chkOk && cfg.chkOk(r)) { r._on = i.checked; var cb = host.querySelector('input[data-chk][data-r="' + ri + '"]'); if (cb) cb.checked = i.checked; } }); if (cfg.onChk) cfg.onChk(null, i.checked, api); return; }
      if (i.getAttribute && i.getAttribute('data-chk')) { var r = rows[Number(i.getAttribute('data-r'))]; r._on = i.checked; i.closest('tr').classList.toggle('sel', i.checked); if (cfg.onChk) cfg.onChk(r, i.checked, api); }
    });
    host.addEventListener('keydown', function (e) {
      var i = e.target; if (!i.getAttribute || i.getAttribute('data-r') === null || i.getAttribute('data-chk')) return;
      var ri = Number(i.getAttribute('data-r')), ci = Number(i.getAttribute('data-c')), c = cols[ci];
      if (e.key === 'Enter') { e.preventDefault(); if (!i.readOnly) i.blur(); focusCell(ri + 1, ci, 1); }
      else if (e.key === 'ArrowDown') { e.preventDefault(); focusCell(ri + 1, ci, 1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); focusCell(ri - 1, ci, -1); }
      else if (e.key === 'ArrowRight' && (i.readOnly || (i.selectionStart === i.value.length && i.selectionEnd === i.value.length))) { var n = nextEditable(ri, ci, 1); if (n < cols.length) { e.preventDefault(); focusCell(ri, n); } }
      else if (e.key === 'ArrowLeft' && (i.readOnly || (i.selectionStart === 0 && i.selectionEnd === 0))) { var p = nextEditable(ri, ci, -1); if (p >= 0) { e.preventDefault(); focusCell(ri, p); } }
      else if ((e.ctrlKey || e.metaKey) && (e.key === 'd' || e.key === 'D') && ri > 0 && !i.readOnly) {
        e.preventDefault(); var src = null; for (var u = ri - 1; u >= 0; u--) { if (!(cfg.hide && rows[u]._old && cfg.hide(rows[u])) && (!ro(rows[u], c) || !rows[u]._old)) { src = rows[u]; break; } }
        if (src) { setCell(ri, c.k, c.type === 'date' ? src[c.k] : src[c.k]); refreshRow(ri); i.value = c.type === 'date' ? (rows[ri][c.k] ? thaiDate(rows[ri][c.k]) : '') : (rows[ri][c.k] === undefined ? '' : rows[ri][c.k]); }
      }
      else if ((e.ctrlKey || e.metaKey) && e.key === 'Backspace' && !rows[ri]._old) { e.preventDefault(); removeRow(ri); focusCell(Math.min(ri, rows.length - 1), ci); }
      else if (e.key === 'Escape' && !i.readOnly) { i.value = ''; setCell(ri, c.k, ''); refreshRow(ri); }
    });
    host.addEventListener('click', function (e) { var d = e.target.closest('[data-del]'); if (d) removeRow(Number(d.getAttribute('data-del'))); });
    host.addEventListener('paste', function (e) {
      var i = e.target; if (!i.getAttribute || i.getAttribute('data-r') === null || i.getAttribute('data-chk')) return;
      var text = (e.clipboardData || window.clipboardData).getData('text');
      if (!text || (text.indexOf('\t') < 0 && text.indexOf('\n') < 0)) return;
      e.preventDefault();
      var ri = Number(i.getAttribute('data-r')), ci = Number(i.getAttribute('data-c'));
      if (!rows[ri]._old && cfg.onPaste && cfg.onPaste(text, api, ri, ci)) return;
      var grid = Paste.parseTSV(text);
      grid.forEach(function (line, a) {
        var r = ri + a; while (r >= rows.length) rows.push(blankRow(lastNew()));
        var cc = ci; line.forEach(function (cell) { while (cc < cols.length && (ro(rows[r], cols[cc]) || cols[cc].type === 'chk')) cc++; if (cc >= cols.length) return; setCell(r, cols[cc].k, cell); cc++; });
      });
      ensureTail(); draw();
    });
    function removeRow(ri) { if (rows[ri]._old) return; rows.splice(ri, 1); bad = {}; ensureTail(); draw(); }

    api = {
      rows: function () { return rows; },
      filled: function () { return rows.filter(function (r) { return !r._old && !empty(r); }); },
      selected: function () { return rows.filter(function (r) { return r._old && r._on; }); },
      dirty: function () { return rows.filter(function (r) { return r._old && r._dirty; }); },
      set: function (ri, k, v) { setCell(ri, k, v, true); refreshRow(ri); },
      mark: function (ri, k) { bad[ri + ':' + k] = true; refreshRow(ri); var c = cols.map(function (x) { return x.k; }).indexOf(k); var i = inp(ri, c); if (i) i.parentNode.classList.add('bad'); },
      markRow: function (ri) { cols.forEach(function (c) { if (!ro(rows[ri], c)) bad[ri + ':' + c.k] = true; }); refreshRow(ri); },
      replace: function (list) { rows = list.slice(); bad = {}; ensureTail(); draw(); },
      append: function (list) { var l = rows[rows.length - 1]; if (l && !l._old && empty(l)) rows.pop(); rows = rows.concat(list); ensureTail(); draw(); },
      focus: function (ri, ci) { focusCell(ri === undefined ? rows.length - 1 : ri, ci || 0); },
      redraw: draw
    };
    draw();
    return api;
  }
  return { create: create, parseDate: parseDate, num: num, fmtN: fmtN };
})();
