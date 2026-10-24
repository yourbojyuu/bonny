/* ระบบการเงินโรงเรียน — docs.js
   ขบ. (ขอเบิก) → รอจ่าย → ขจ. (ขอจ่าย) → การจ่าย · สายโยง · พิมพ์เอกสาร A4 */

var Docs = (function () {
  var seg = 'khb', q = '', filt = 'all', sel = {}, linkHover = null, resizeT = 0;

  var TAX_QUICK = [['', 'คิด'], ['1v', '1% มี VAT'], ['1', '1% ไม่มี VAT'], ['3v', '3% มี VAT'], ['3', '3% ไม่มี VAT']];
  var METHOD_BY_KIND = { 'พัสดุ': 'เช็ค', 'เบิก': 'KTB', 'ค่าจ้าง': 'KTB', 'เงินยืม': 'KTB', 'ถอน': 'ถอน' };
  var STATE_CLS = { 'รอจ่าย': 'wait', 'อยู่ใน ขจ.': 'in', 'รอจ่ายเงิน': 'in', 'จ่ายแล้ว': 'paid', 'ยกเลิก': 'cancel' };

  function fy() { return S.docs.fy; }
  function khbs() { return S.docs.khbs; }
  function khjs() { return S.docs.khjs; }
  function findKhb(no) { return khbs().filter(function (h) { return h.no === no; })[0]; }
  function findKhj(no) { return khjs().filter(function (j) { return j.no === no; })[0]; }
  function L(sheet, i) { return S.schema.schema[sheet][i]; }
  function badge(state) { return '<span class="badge ' + (STATE_CLS[state] || '') + '">' + esc(state) + '</span>'; }
  function isCompany(name) { return /บริษัท|บจก|หจก|ห้างหุ้นส่วน|จำกัด|มหาชน|การไฟฟ้า|การประปา|รัฐวิสาหกิจ/.test(name || ''); }

  /** สรุปสถานะทั้งระบบ */
  function stats() {
    var s = { wait: { n: 0, a: 0 }, in: { n: 0, a: 0 }, paid: { n: 0, a: 0 } };
    khbs().forEach(function (h) {
      h.lines.forEach(function (l) {
        var k = l.state === 'รอจ่าย' ? 'wait' : l.state === 'อยู่ใน ขจ.' ? 'in' : l.state === 'จ่ายแล้ว' ? 'paid' : '';
        if (!k) return;
        s[k].n++; s[k].a += Math.round(l.net * 100);
      });
    });
    ['wait', 'in', 'paid'].forEach(function (k) { s[k].a /= 100; });
    return s;
  }

  /* ================= หน้าหลักรายจ่าย ================= */
  function render(v, opt) {
    if (opt && opt.seg) seg = opt.seg;
    var s = stats();
    v.innerHTML =
      '<section class="hero">' + heroDeco('expense') +
      '<div class="lbl">ขอเบิก → ขอจ่าย → จ่ายเงิน</div>' +
      '<div class="big money">' + money(s.wait.a + s.in.a) + '</div><div class="sub">ยอดที่ยังไม่ได้จ่าย (หลังหักภาษี ณ ที่จ่าย)</div>' +
      '<div class="flow">' +
      flowTile('pending', 'ขบ. รอทำ ขจ.', s.wait) + '<span class="arrow" aria-hidden="true">' + ICON.arrow + '</span>' +
      flowTile('khj', 'อยู่ใน ขจ. รอจ่ายเงิน', s.in) + '<span class="arrow" aria-hidden="true">' + ICON.arrow + '</span>' +
      flowTile('khj', 'จ่ายแล้ว', s.paid) +
      '</div></section>' +
      '<div class="seg glass" role="group" aria-label="มุมมอง">' +
      segBtn('khb', 'ขบ. ขอเบิก') + segBtn('pending', 'รอจ่าย' + (s.wait.n ? ' (' + s.wait.n + ')' : '')) +
      segBtn('khj', 'ขจ. ขอจ่าย') + segBtn('links', 'สายโยง') + '</div>' +
      '<div id="dv"></div>';
    Array.prototype.forEach.call(v.querySelectorAll('[data-seg]'), function (b) {
      b.onclick = function () { switchSeg(b.getAttribute('data-seg')); };
    });
    renderSeg();
  }
  function flowTile(target, label, x) {
    return '<button class="tile" type="button" data-seg="' + target + '"><div class="k">' + esc(label) + '</div>' +
      '<div class="v money">' + money(x.a) + '</div><div class="s">' + x.n + ' รายการ</div></button>';
  }
  function segBtn(id, label) {
    return '<button type="button" data-seg="' + id + '" aria-pressed="' + (seg === id) + '">' + esc(label) + '</button>';
  }
  function switchSeg(id) {
    if (id === seg) return;
    var run = function () {
      seg = id;
      Array.prototype.forEach.call(document.querySelectorAll('.seg [data-seg]'), function (b) {
        b.setAttribute('aria-pressed', String(b.getAttribute('data-seg') === seg));
      });
      renderSeg();
    };
    if (document.startViewTransition && !REDUCE) { try { document.startViewTransition(run); return; } catch (e) {} }
    run();
  }
  function renderSeg() {
    leave();
    var dv = $('dv'); if (!dv) return;
    dv.className = ''; void dv.offsetWidth; dv.className = 'view-in';
    if (seg === 'khb') renderKhbList(dv);
    else if (seg === 'pending') renderPending(dv);
    else if (seg === 'khj') renderKhjList(dv);
    else renderLinks(dv);
    observeReveal();
  }
  function rerender() {
    if (S.tab === 'expense') render($('view'), null);
    else renderTabs();
  }
  /** ออกจากหน้า: เก็บแถบล่าง */
  function leave() { var d = $('dock'); if (d) d.parentNode.removeChild(d); }

  /* ================= ขบ. ================= */
  function bar(counts, total) {
    var p = counts['จ่ายแล้ว'] || 0, k = counts['อยู่ใน ขจ.'] || 0, w = counts['รอจ่าย'] || 0;
    if (!total) return '';
    return '<div class="bar" aria-hidden="true"><i class="p" style="flex-grow:' + p + '"></i><i class="k" style="flex-grow:' + k + '"></i><i class="w" style="flex-grow:' + w + '"></i></div>' +
      '<div class="legend"><span><i style="background:var(--ok)"></i>จ่ายแล้ว ' + p + '</span><span><i style="background:var(--c2)"></i>ใน ขจ. ' + k + '</span><span><i style="background:#f5b13d"></i>รอจ่าย ' + w + '</span></div>';
  }
  function renderKhbList(dv) {
    var list = khbs().filter(function (h) {
      if (filt === 'open' && !(h.status !== 'ยกเลิก' && (h.counts['รอจ่าย'] || h.counts['อยู่ใน ขจ.']))) return false;
      if (filt === 'done' && !(h.status !== 'ยกเลิก' && !h.counts['รอจ่าย'] && !h.counts['อยู่ใน ขจ.'])) return false;
      if (filt === 'cancel' && h.status !== 'ยกเลิก') return false;
      if (!q) return true;
      var t = ('ขบ.' + h.no + ' ' + h.note + ' ' + h.lines.map(function (l) { return l.payee + ' ' + typeName(l.type); }).join(' ')).toLowerCase();
      return t.indexOf(q.toLowerCase()) >= 0;
    });
    var h = '<div class="toolbar"><input class="grow" type="search" id="q" placeholder="ค้นหา เลข ขบ. / ผู้รับ / ประเภทเงิน" value="' + esc(q) + '" aria-label="ค้นหา">' +
      '<select id="filt" style="width:auto" aria-label="กรอง">' +
      [['all', 'ทั้งหมด'], ['open', 'ยังจ่ายไม่ครบ'], ['done', 'จ่ายครบแล้ว'], ['cancel', 'ยกเลิก']].map(function (o) {
        return '<option value="' + o[0] + '"' + (filt === o[0] ? ' selected' : '') + '>' + o[1] + '</option>';
      }).join('') + '</select>' +
      (can.khb() ? '<button class="btn" type="button" id="newKhb">' + ICON.plus + ' สร้าง ขบ.</button>' : '') + '</div>';
    if (!list.length) {
      h += '<div class="empty"><b>' + (khbs().length ? 'ไม่พบ ขบ. ที่ตรงเงื่อนไข' : 'ยังไม่มี ขบ. ในปีงบนี้') + '</b>' +
        (can.khb() && !khbs().length ? 'กด "สร้าง ขบ." เพื่อเริ่มกรอกรายการขอเบิกใบแรก' : 'ลองเปลี่ยนคำค้นหรือตัวกรอง') + '</div>';
    } else {
      h += '<div class="grid stagger">' + list.map(function (x, i) {
        var n = x.lines.length;
        return '<button class="doc glass' + (x.status === 'ยกเลิก' ? ' cancel' : '') + '" type="button" data-khb="' + x.no + '" style="--i:' + Math.min(i, 12) + '">' +
          '<div style="display:flex;justify-content:space-between;gap:8px;align-items:center"><span class="no">ขบ.' + x.no + '/' + x.fy + '</span>' +
          (x.status === 'ยกเลิก' ? badge('ยกเลิก') : (x.counts['รอจ่าย'] ? badge('รอจ่าย') : x.counts['อยู่ใน ขจ.'] ? badge('อยู่ใน ขจ.') : badge('จ่ายแล้ว'))) + '</div>' +
          '<div class="meta">' + esc(thaiDate(x.date)) + ' · ' + n + ' รายการ' + (x.note ? ' · ' + esc(x.note) : '') + '</div>' +
          '<div class="amt">' + money(x.total.gross) + ' <small class="meta">บาท</small></div>' +
          (x.status === 'ยกเลิก' ? '' : bar(x.counts, n)) + '</button>';
      }).join('') + '</div>';
    }
    dv.innerHTML = h;
    $('q').oninput = function () { q = this.value; var pos = this.selectionStart; renderKhbList(dv); var qq = $('q'); qq.focus(); qq.setSelectionRange(pos, pos); };
    $('filt').onchange = function () { filt = this.value; renderKhbList(dv); };
    if ($('newKhb')) $('newKhb').onclick = function () { openKhb(null); };
    Array.prototype.forEach.call(dv.querySelectorAll('[data-khb]'), function (b) {
      b.onclick = function () { openKhb(Number(b.getAttribute('data-khb'))); };
    });
  }

  function typeOptions(sel) {
    var groups = {}, order = [];
    S.st.types.forEach(function (t) {
      if (t[4] !== 'ใช่' && t[0] !== sel) return;
      if (!groups[t[2]]) { groups[t[2]] = []; order.push(t[2]); }
      groups[t[2]].push(t);
    });
    return '<option value="">— เลือก —</option>' + order.map(function (g) {
      return '<optgroup label="' + esc(g) + '">' + groups[g].map(function (t) {
        return '<option value="' + esc(t[0]) + '"' + (t[0] === sel ? ' selected' : '') + '>' + esc(t[1]) + '</option>';
      }).join('') + '</optgroup>';
    }).join('');
  }
  function lineHtml(l, i, locked) {
    var dis = locked ? ' disabled' : '';
    return '<div class="line' + (locked ? ' locked' : '') + '" data-line>' +
      '<span class="i">' + (i + 1) + '</span>' +
      '<label class="f" data-c="type">' + esc(L('ขบ_รายการ', 3)) + '<select data-f="type"' + dis + '>' + typeOptions(l.type) + '</select></label>' +
      '<label class="f" data-c="payee">' + esc(L('ขบ_รายการ', 4)) + '<input data-f="payee" list="payees" value="' + esc(l.payee) + '" placeholder="ชื่อร้าน / ผู้เบิก / ผู้ยืม"' + dis + '></label>' +
      '<label class="f" data-c="kind">' + esc(L('ขบ_รายการ', 5)) + '<select data-f="kind"' + dis + '>' + plainOpts(S.schema.lineKinds, l.kind) + '</select></label>' +
      '<label class="f" data-c="method">' + esc(L('ขบ_รายการ', 6)) + '<select data-f="method"' + dis + '>' + plainOpts(S.schema.payMethods, l.method) + '</select></label>' +
      '<label class="f" data-c="gross">' + esc(L('ขบ_รายการ', 7)) + '<input class="money" data-f="gross" inputmode="decimal" value="' + (l.gross ? esc(l.gross) : '') + '" placeholder="0.00"' + dis + '></label>' +
      '<label class="f" data-c="tax">' + esc(L('ขบ_รายการ', 8)) + '<span class="taxrow"><input class="money" data-f="tax" inputmode="decimal" value="' + (l.tax ? esc(l.tax) : '') + '" placeholder="0.00"' + dis + '>' +
      (locked ? '' : '<select data-f="quick" aria-label="คิดภาษีอัตโนมัติ">' + TAX_QUICK.map(function (o) { return '<option value="' + o[0] + '">' + o[1] + '</option>'; }).join('') + '</select>') + '</span></label>' +
      '<label class="f" data-c="taxType">' + esc(L('ขบ_รายการ', 9)) + '<select data-f="taxType"' + dis + '>' + plainOpts(S.schema.taxTypes, l.taxType || 'ไม่มีภาษี') + '</select></label>' +
      '<div class="f" data-c="net"><span style="font-size:13px;font-weight:600;color:var(--ink2)">จ่ายจริง (หลังหักภาษี)</span><span class="net" data-net>' + money(r2(cleanNum(l.gross) - cleanNum(l.tax))) + '</span>' +
      (l.state ? badge(l.state) + (l.khjNo ? ' <span class="meta" style="font-size:12.5px">ขจ.' + l.khjNo + '</span>' : '') : '') + '</div>' +
      (locked ? '' : '<button class="del" type="button" data-del aria-label="ลบรายการ" data-c="del">×</button>') + '</div>';
  }
  function readLines(box) {
    return Array.prototype.map.call(box.querySelectorAll('[data-line]'), function (row) {
      var o = {};
      Array.prototype.forEach.call(row.querySelectorAll('[data-f]'), function (f) { o[f.getAttribute('data-f')] = f.value; });
      return { type: o.type, payee: o.payee, kind: o.kind, method: o.method, gross: o.gross, tax: o.tax, taxType: o.taxType };
    });
  }
  function recalc(box) {
    var lines = readLines(box), net = 0, tax = 0, gross = 0;
    Array.prototype.forEach.call(box.querySelectorAll('[data-line]'), function (row, i) {
      var g = cleanNum(lines[i].gross), t = cleanNum(lines[i].tax);
      gross += Math.round(g * 100); tax += Math.round(t * 100); net += Math.round((g - t) * 100);
      row.querySelector('[data-net]').textContent = money(r2(g - t));
      row.querySelector('.i').textContent = i + 1;
    });
    var tot = box.parentNode.querySelector('[data-tot]');
    if (tot) tot.innerHTML = '<span>ขอเบิกเงิน <b>' + money(net / 100) + '</b></span><span>ภาษี <b>' + money(tax / 100) + '</b></span>' +
      '<span class="g">รวมเป็นเงิน <b>' + money(gross / 100) + '</b></span>';
  }
  function blankLine(prev) {
    return { type: prev ? prev.type : '', payee: '', kind: prev ? prev.kind : 'พัสดุ', method: prev ? prev.method : 'เช็ค', gross: '', tax: '', taxType: 'ไม่มีภาษี' };
  }

  function openKhb(no) {
    var h = no ? findKhb(no) : null;
    var linked = h ? h.lines.filter(function (l) { return l.khjNo; }).length : 0;
    var locked = !!h && (h.status === 'ยกเลิก' || linked > 0) || !can.khb();
    var data = h || { date: defaultDate(), note: '', lines: [blankLine(null)] };
    var payees = (S.docs.payees || []).map(function (p) { return '<option value="' + esc(p) + '">'; }).join('');
    var info = '';
    if (h && h.status === 'ยกเลิก') info = '<div class="err-box" style="margin-bottom:12px">ขบ. นี้ถูกยกเลิกแล้ว · ' + esc(h.note) + '</div>';
    else if (linked) info = '<p class="hint">มีรายการอยู่ใน ขจ. แล้ว ' + linked + ' รายการ จึงแก้ไขไม่ได้ ถ้าต้องแก้ ให้ยกเลิก ขจ. นั้นก่อน (รายการจะกลับมาเป็น "รอจ่าย")</p>';
    var m = openModal({
      title: h ? 'ขบ.' + h.no + '/' + h.fy : 'สร้าง ขบ. ใหม่',
      headExtra: h ? (h.status === 'ยกเลิก' ? badge('ยกเลิก') : '') : '',
      body: info +
        '<div class="form-head"><label class="f">' + esc(L('ขบ', 2)) + '<input type="date" id="kDate" value="' + esc(data.date) + '" min="' + S.st.fyStart + '" max="' + S.st.fyEnd + '"' + (locked ? ' disabled' : '') + '></label>' +
        '<label class="f">' + esc(L('ขบ', 3)) + '<input id="kNote" value="' + esc(h ? h.note : '') + '" placeholder="เช่น ชุดพัสดุ ต.ค. / เงินเดือนลูกจ้าง"' + (locked ? ' disabled' : '') + '></label></div>' +
        '<datalist id="payees">' + payees + '</datalist>' +
        '<div id="kLines">' + data.lines.map(function (l, i) { return lineHtml(l, i, locked); }).join('') + '</div>' +
        (locked ? '' : '<button class="btn soft" type="button" id="kAdd">' + ICON.plus + ' เพิ่มรายการ</button>') +
        '<div class="totals" data-tot></div>',
      footer: (h && !locked ? '<button class="btn danger" type="button" id="kCancel">ยกเลิก ขบ.</button>' : '') +
        (h ? '<button class="btn ghost" type="button" id="kPrint">' + ICON.print + ' พิมพ์</button>' : '') +
        '<span class="sp"></span><button class="btn ghost" type="button" data-close>ปิด</button>' +
        (locked ? '' : '<button class="btn" type="button" id="kSave">บันทึก ขบ.</button>')
    });
    var el = m.el, box = el.querySelector('#kLines');
    thaiDateHint(el.querySelector('#kDate'));
    recalc(box);
    if (locked) {
      if (el.querySelector('#kPrint')) el.querySelector('#kPrint').onclick = function () { openPaper('khb', h.no); };
      return;
    }
    box.addEventListener('input', function () { recalc(box); });
    box.addEventListener('change', function (e) {
      var f = e.target, row = f.closest('[data-line]');
      if (f.getAttribute('data-f') === 'kind') row.querySelector('[data-f="method"]').value = METHOD_BY_KIND[f.value] || 'เช็ค';
      if (f.getAttribute('data-f') === 'quick' && f.value) {
        var g = cleanNum(row.querySelector('[data-f="gross"]').value);
        if (!g) { toast('กรอกยอดรวมก่อน แล้วค่อยคิดภาษี', 'err'); f.value = ''; return; }
        var rate = Number(f.value.charAt(0)), vat = f.value.indexOf('v') > 0;
        row.querySelector('[data-f="tax"]').value = r2((vat ? g / 1.07 : g) * rate / 100).toFixed(2);
        var payee = row.querySelector('[data-f="payee"]').value;
        row.querySelector('[data-f="taxType"]').value = isCompany(payee) ? 'ภ.ง.ด.53' : 'ภ.ง.ด.3';
        f.value = '';
      }
      if (f.getAttribute('data-f') === 'tax' && cleanNum(f.value) === 0) row.querySelector('[data-f="taxType"]').value = 'ไม่มีภาษี';
      recalc(box);
    });
    box.addEventListener('click', function (e) {
      var d = e.target.closest('[data-del]'); if (!d) return;
      if (box.querySelectorAll('[data-line]').length === 1) { toast('ขบ. ต้องมีอย่างน้อย 1 รายการ', 'err'); return; }
      var row = d.closest('[data-line]'); row.parentNode.removeChild(row); recalc(box);
    });
    el.querySelector('#kAdd').onclick = function () {
      var ls = readLines(box), tmp = document.createElement('div');
      tmp.innerHTML = lineHtml(blankLine(ls[ls.length - 1]), ls.length, false);
      box.appendChild(tmp.firstChild); recalc(box);
      var last = box.lastChild.querySelector('[data-f="payee"]'); last.focus();
      last.scrollIntoView({ block: 'nearest', behavior: REDUCE ? 'auto' : 'smooth' });
    };
    el.querySelector('#kSave').onclick = function () {
      var btn = this;
      busy(btn, api('saveKhb', { no: h ? h.no : null, date: el.querySelector('#kDate').value, note: el.querySelector('#kNote').value, lines: readLines(box) }))
        .then(function (r) {
          toast('บันทึก ขบ.' + r.no + '/' + r.fy + ' แล้ว', 'good');
          m.close();
          return reloadDocs().then(function () { seg = 'khb'; rerender(); });
        }).catch(handleError);
    };
    if (el.querySelector('#kPrint')) el.querySelector('#kPrint').onclick = function () { openPaper('khb', h.no); };
    if (el.querySelector('#kCancel')) el.querySelector('#kCancel').onclick = function () {
      askReason('ยกเลิก ขบ.' + h.no + '/' + h.fy, 'ยืนยันยกเลิก ขบ.', function (reason, am, btn) {
        busy(btn, api('cancelKhb', { no: h.no, reason: reason })).then(function () {
          am.close(); m.close(); toast('ยกเลิก ขบ.' + h.no + ' แล้ว', 'good');
          return reloadDocs().then(rerender);
        }).catch(handleError);
      });
    };
  }

  /* ================= รอจ่าย → สร้าง ขจ. ================= */
  function pendingLines() {
    var out = [];
    khbs().forEach(function (h) {
      if (h.status === 'ยกเลิก') return;
      h.lines.forEach(function (l) { if (l.state === 'รอจ่าย') out.push({ h: h, l: l, key: h.fy + '/' + h.no + '/' + l.seq }); });
    });
    return out;
  }
  function renderPending(dv) {
    var list = pendingLines(), byG = {}, order = [];
    var keys = {}; list.forEach(function (x) { keys[x.key] = true; });
    Object.keys(sel).forEach(function (k) { if (!keys[k]) delete sel[k]; });
    list.forEach(function (x) {
      var g = typeGroup(x.l.type);
      if (!byG[g]) { byG[g] = []; order.push(g); }
      byG[g].push(x);
    });
    if (!list.length) {
      dv.innerHTML = '<div class="empty"><b>ไม่มีรายการรอจ่าย</b>ทุกรายการใน ขบ. ถูกนำไปทำ ขจ. แล้ว</div>';
      return;
    }
    var h = '<p class="hint">เลือกรายการที่จะจ่ายรอบนี้ แล้วกด "สร้าง ขจ." ระบบจะแยกตามกลุ่มเงินในเอกสารให้เอง</p>';
    order.forEach(function (g) {
      var items = byG[g], all = items.every(function (x) { return sel[x.key]; });
      h += '<div class="grp"><label style="display:flex;gap:8px;align-items:center"><input type="checkbox" data-gall="' + esc(g) + '"' + (all ? ' checked' : '') + '> ' + esc(g) + '</label>' +
        '<span class="sum money">' + money(sumSat(items, function (x) { return x.l.net; })) + '</span></div><div class="rows stagger">';
      items.forEach(function (x, i) {
        h += '<label class="row' + (sel[x.key] ? ' sel' : '') + '" style="--i:' + Math.min(i, 12) + '"><input type="checkbox" data-k="' + x.key + '"' + (sel[x.key] ? ' checked' : '') + '>' +
          '<span><span class="who2">' + esc(x.l.payee) + '</span><br><span class="tag">ขบ.' + x.h.no + '-' + x.l.seq + ' · ' + esc(thaiDate(x.h.date)) + '</span></span>' +
          '<span class="tag hide-sm">' + esc(typeName(x.l.type)) + '<br>' + esc(x.l.method) + ' · ' + esc(x.l.kind) + '</span>' +
          '<span class="amt">' + money(x.l.net) + (x.l.tax ? '<br><span class="tag">ภาษี ' + money(x.l.tax) + '</span>' : '') + '</span></label>';
      });
      h += '</div>';
    });
    dv.innerHTML = h;
    dv.onchange = function (e) {
      var t = e.target;
      if (t.hasAttribute('data-k')) { if (t.checked) sel[t.getAttribute('data-k')] = true; else delete sel[t.getAttribute('data-k')]; }
      if (t.hasAttribute('data-gall')) byG[t.getAttribute('data-gall')].forEach(function (x) { if (t.checked) sel[x.key] = true; else delete sel[x.key]; });
      renderPending(dv);
    };
    drawDock(list);
  }
  function drawDock(list) {
    leave();
    var chosen = list.filter(function (x) { return sel[x.key]; });
    var d = document.createElement('div');
    d.id = 'dock'; d.className = 'dock';
    d.innerHTML = '<div class="in glass"><div class="tot">เลือก ' + chosen.length + ' รายการ · <span class="money">' + money(sumSat(chosen, function (x) { return x.l.net; })) + '</span> บาท</div>' +
      (can.fin()
        ? '<input type="date" id="jDate" value="' + esc(defaultDate()) + '" min="' + S.st.fyStart + '" max="' + S.st.fyEnd + '" aria-label="วันที่ ขจ.">' +
          '<input id="jNote" placeholder="หมายเหตุ (ถ้ามี)" aria-label="หมายเหตุ"><button class="btn" type="button" id="jMake">สร้าง ขจ. ' + ICON.arrow + '</button>'
        : '<span class="hint" style="margin:0">เฉพาะการเงินสร้าง ขจ. ได้</span>') + '</div>';
    document.body.appendChild(d);
    requestAnimationFrame(function () { if (chosen.length) d.classList.add('on'); });
    var mk = $('jMake');
    if (mk) mk.onclick = function () {
      var items = chosen.map(function (x) { return { fy: x.h.fy, no: x.h.no, seq: x.l.seq }; });
      busy(mk, api('createKhj', { date: $('jDate').value, note: $('jNote').value, items: items })).then(function (r) {
        sel = {};
        toast('สร้าง ขจ.' + r.no + '/' + r.fy + ' แล้ว (' + r.count + ' รายการ) — บันทึกเลขเช็ค/วันที่จ่ายต่อได้เลย', 'good');
        return reloadDocs().then(function () { seg = 'khj'; rerender(); openKhj(r.no); });
      }).catch(handleError);
    };
  }

  /* ================= ขจ. และการจ่าย ================= */
  function renderKhjList(dv) {
    var list = khjs().filter(function (j) {
      if (!q) return true;
      return ('ขจ.' + j.no + ' ' + j.note + ' ' + j.items.map(function (i) { return i.payee + ' ' + i.ref; }).join(' ')).toLowerCase().indexOf(q.toLowerCase()) >= 0;
    });
    var h = '<div class="toolbar"><input class="grow" type="search" id="q" placeholder="ค้นหา เลข ขจ. / ผู้รับ / เลขเช็ค" value="' + esc(q) + '" aria-label="ค้นหา">' +
      '<button class="btn soft" type="button" data-to="pending">' + ICON.plus + ' สร้างจากรายการรอจ่าย</button></div>';
    if (!list.length) h += '<div class="empty"><b>' + (khjs().length ? 'ไม่พบ ขจ. ที่ตรงคำค้น' : 'ยังไม่มี ขจ.') + '</b>สร้าง ขจ. ได้จากแท็บ "รอจ่าย"</div>';
    else h += '<div class="grid stagger">' + list.map(function (j, i) {
      var st = j.status === 'ยกเลิก' ? 'ยกเลิก' : j.paid === j.count ? 'จ่ายแล้ว' : 'อยู่ใน ขจ.';
      return '<button class="doc glass' + (j.status === 'ยกเลิก' ? ' cancel' : '') + '" type="button" data-khj="' + j.no + '" style="--i:' + Math.min(i, 12) + '">' +
        '<div style="display:flex;justify-content:space-between;gap:8px;align-items:center"><span class="no">ขจ.' + j.no + '/' + j.fy + '</span>' +
        badge(st === 'อยู่ใน ขจ.' ? 'รอจ่ายเงิน' : st) + '</div>' +
        '<div class="meta">' + esc(thaiDate(j.date)) + ' · ' + j.count + ' รายการ' + (j.note ? ' · ' + esc(j.note) : '') + '</div>' +
        '<div class="amt">' + money(j.total) + ' <small class="meta">บาท</small></div>' +
        (j.status === 'ยกเลิก' ? '' : '<div class="bar"><i class="p" style="flex-grow:' + j.paid + '"></i><i class="k" style="flex-grow:' + (j.count - j.paid) + '"></i></div>' +
          '<div class="legend"><span><i style="background:var(--ok)"></i>จ่ายแล้ว ' + j.paid + '/' + j.count + '</span></div>') + '</button>';
    }).join('') + '</div>';
    dv.innerHTML = h;
    $('q').oninput = function () { q = this.value; var pos = this.selectionStart; renderKhjList(dv); var qq = $('q'); qq.focus(); qq.setSelectionRange(pos, pos); };
    dv.querySelector('[data-to]').onclick = function () { switchSeg('pending'); };
    Array.prototype.forEach.call(dv.querySelectorAll('[data-khj]'), function (b) {
      b.onclick = function () { openKhj(Number(b.getAttribute('data-khj'))); };
    });
  }
  function storeOptions(sel_) { return opts(S.st.stores, sel_, true); }
  function openKhj(no) {
    var j = findKhj(no); if (!j) return;
    var locked = j.status === 'ยกเลิก' || !can.fin(), dis = locked ? ' disabled' : '';
    var byG = {}, order = [];
    j.items.forEach(function (it) { var g = typeGroup(it.type); if (!byG[g]) { byG[g] = []; order.push(g); } byG[g].push(it); });
    var refs = {}; j.items.forEach(function (it) { refs['ขบ.' + it.khbNo] = true; });
    var body = '<p class="hint">' + esc(thaiDateLong(j.date)) + ' · อ้างถึง ' + Object.keys(refs).join(', ') + ' · รวม <b class="money">' + money(j.total) + '</b> บาท' +
      (j.status === 'ยกเลิก' ? '<br><b style="color:var(--bad)">ยกเลิกแล้ว · ' + esc(j.note) + '</b>' : '') + '</p>';
    if (!locked) body += '<div class="erow" style="background:color-mix(in srgb,var(--c2) 6%,#fff)"><b style="grid-column:1/-1">เติมให้ทุกแถวที่ติ๊กไว้</b>' +
      '<label class="f">วิธีจ่าย<select id="bMethod"><option value="">(ไม่เปลี่ยน)</option>' + plainOpts(S.schema.payMethods, '') + '</select></label>' +
      '<label class="f">เลขเช็ค / เลขอ้างอิง KTB<input id="bRef" inputmode="numeric"></label>' +
      '<label class="f">ที่เก็บที่จ่ายออก<select id="bStore"><option value="">(ไม่เปลี่ยน)</option>' + opts(S.st.stores, '', false) + '</select></label>' +
      '<label class="f">วันที่จ่ายจริง<input type="date" id="bDate" min="' + j.date + '" max="' + S.st.fyEnd + '"></label>' +
      '<div><button class="btn soft" type="button" id="bApply">ใช้กับแถวที่เลือก</button></div></div>';
    order.forEach(function (g) {
      body += '<div class="grp">' + esc(g) + '<span class="sum money">' + money(sumSat(byG[g], function (x) { return x.amount; })) + '</span></div><div class="rows">';
      byG[g].forEach(function (it) {
        body += '<div class="erow" data-pay data-khbfy="' + it.khbFy + '" data-khbno="' + it.khbNo + '" data-seq="' + it.seq + '">' +
          '<label class="chk" style="grid-column:1/-1;padding:0">' + (locked ? '' : '<input type="checkbox" data-pick checked>') +
          '<span><b>' + esc(it.payee) + '</b> · ขบ.' + it.khbNo + '-' + it.seq + ' · ' + esc(typeName(it.type)) + '</span>' +
          '<span style="margin-left:auto" class="money"><b>' + money(it.amount) + '</b></span>' + (it.date ? badge('จ่ายแล้ว') : badge('อยู่ใน ขจ.')) + '</label>' +
          '<label class="f">วิธีจ่าย<select data-p="method"' + dis + '>' + plainOpts(S.schema.payMethods, it.method) + '</select></label>' +
          '<label class="f">เลขเช็ค / เลขอ้างอิง<input data-p="ref" value="' + esc(it.ref) + '" inputmode="numeric"' + dis + '></label>' +
          '<label class="f">ที่เก็บที่จ่ายออก<select data-p="store"' + dis + '>' + storeOptions(it.store) + '</select></label>' +
          '<label class="f">วันที่จ่ายจริง<input type="date" data-p="date" value="' + esc(it.date) + '" min="' + j.date + '" max="' + S.st.fyEnd + '"' + dis + '></label></div>';
      });
      body += '</div>';
    });
    var m = openModal({
      title: 'ขจ.' + j.no + '/' + j.fy, width: 1040, body: body,
      footer: (!locked ? '<button class="btn danger" type="button" id="jCancel">ยกเลิก ขจ.</button>' : '') +
        '<button class="btn ghost" type="button" id="jPrint">' + ICON.print + ' พิมพ์ ขจ.</button><span class="sp"></span>' +
        '<button class="btn ghost" type="button" data-close>ปิด</button>' + (!locked ? '<button class="btn" type="button" id="jSave">บันทึกการจ่าย</button>' : '')
    });
    var el = m.el;
    el.querySelector('#jPrint').onclick = function () { openPaper('khj', j.no); };
    Array.prototype.forEach.call(el.querySelectorAll('input[type="date"]'), thaiDateHint);
    if (locked) return;
    el.querySelector('#bApply').onclick = function () {
      var bm = el.querySelector('#bMethod').value, br = el.querySelector('#bRef').value.trim(), bs = el.querySelector('#bStore').value, bd = el.querySelector('#bDate').value, n = 0;
      Array.prototype.forEach.call(el.querySelectorAll('[data-pay]'), function (row) {
        if (!row.querySelector('[data-pick]').checked) return;
        n++;
        if (bm) row.querySelector('[data-p="method"]').value = bm;
        if (br) row.querySelector('[data-p="ref"]').value = br;
        if (bs) row.querySelector('[data-p="store"]').value = bs;
        if (bd) { var di = row.querySelector('[data-p="date"]'); di.value = bd; thaiDateHint(di); }
      });
      toast('เติมให้ ' + n + ' แถวแล้ว อย่าลืมกด "บันทึกการจ่าย"');
    };
    el.querySelector('#jSave').onclick = function () {
      var rows = Array.prototype.map.call(el.querySelectorAll('[data-pay]'), function (row) {
        return { khbFy: Number(row.getAttribute('data-khbfy')), khbNo: Number(row.getAttribute('data-khbno')), seq: Number(row.getAttribute('data-seq')),
          method: row.querySelector('[data-p="method"]').value, ref: row.querySelector('[data-p="ref"]').value,
          store: row.querySelector('[data-p="store"]').value, date: row.querySelector('[data-p="date"]').value };
      });
      busy(this, api('savePayments', { no: j.no, rows: rows })).then(function (r) {
        toast('บันทึกการจ่ายแล้ว · จ่ายแล้ว ' + r.paid + '/' + rows.length + ' รายการ', 'good');
        m.close();
        return reloadDocs().then(rerender);
      }).catch(handleError);
    };
    el.querySelector('#jCancel').onclick = function () {
      askReason('ยกเลิก ขจ.' + j.no + '/' + j.fy, 'ยืนยันยกเลิก ขจ.', function (reason, am, btn) {
        busy(btn, api('cancelKhj', { no: j.no, reason: reason })).then(function () {
          am.close(); m.close(); toast('ยกเลิก ขจ.' + j.no + ' แล้ว รายการกลับไปเป็น "รอจ่าย"', 'good');
          return reloadDocs().then(rerender);
        }).catch(handleError);
      });
    };
  }

  /* ================= สายโยง ขบ. → ขจ. ================= */
  function renderLinks(dv) {
    var left = khbs().filter(function (h) { return h.status !== 'ยกเลิก'; });
    var right = khjs().filter(function (j) { return j.status !== 'ยกเลิก'; });
    if (!left.length) { dv.innerHTML = '<div class="empty"><b>ยังไม่มีเอกสารให้โยง</b>สร้าง ขบ. ก่อน แล้วสายโยงจะขึ้นที่นี่</div>'; return; }
    var edges = [];
    left.forEach(function (h) {
      var agg = {};
      h.lines.forEach(function (l) {
        var to = l.khjNo ? 'j' + l.khjNo : 'wait';
        if (!agg[to]) agg[to] = { a: 0, paid: 0, n: 0 };
        agg[to].a += l.net; agg[to].n++; if (l.state === 'จ่ายแล้ว') agg[to].paid++;
      });
      Object.keys(agg).forEach(function (to) {
        var x = agg[to];
        edges.push({ from: 'b' + h.no, to: to, a: x.a, cls: to === 'wait' ? 'wait' : x.paid === x.n ? 'paid' : 'in' });
      });
    });
    var hasWait = edges.some(function (e) { return e.to === 'wait'; });
    var h = '<p class="hint">เส้นเขียวทึบ = จ่ายแล้ว · เส้นประสีแท็บ = อยู่ใน ขจ. รอจ่าย · เส้นประส้ม = ยังไม่ได้ทำ ขจ. · ความหนาตามยอดเงิน · ชี้หรือแตะที่เอกสารเพื่อดูสายของใบนั้น</p>' +
      '<div class="links" id="links"><svg id="linkSvg" aria-hidden="true"></svg><div class="col"><h4>ขบ. ขอเบิก</h4>' +
      left.map(function (x) {
        return '<button class="node glass" type="button" data-node="b' + x.no + '"><b>ขบ.' + x.no + '</b> <span class="meta">' + esc(thaiDate(x.date)) + '</span><br>' +
          '<span class="money">' + money(x.total.net) + '</span> <span class="meta">· ' + x.lines.length + ' รายการ</span></button>';
      }).join('') + '</div><div></div><div class="col"><h4>ขจ. ขอจ่าย</h4>' +
      (hasWait ? '<button class="node glass waitnode" type="button" data-node="wait"><b style="color:#b26200">ยังไม่ได้ทำ ขจ.</b><br><span class="meta">กดเพื่อเลือกทำ ขจ.</span></button>' : '') +
      right.map(function (j) {
        return '<button class="node glass" type="button" data-node="j' + j.no + '"><b>ขจ.' + j.no + '</b> <span class="meta">' + esc(thaiDate(j.date)) + '</span><br>' +
          '<span class="money">' + money(j.total) + '</span> <span class="meta">· จ่ายแล้ว ' + j.paid + '/' + j.count + '</span></button>';
      }).join('') + '</div></div>';
    dv.innerHTML = h;
    var box = $('links');
    function draw() {
      var svg = $('linkSvg'); if (!svg) return;
      var br = box.getBoundingClientRect(), max = 0, out = '';
      edges.forEach(function (e) { if (e.a > max) max = e.a; });
      edges.forEach(function (e, i) {
        var a = box.querySelector('[data-node="' + e.from + '"]'), b = box.querySelector('[data-node="' + e.to + '"]');
        if (!a || !b) return;
        var ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
        var x1 = ra.right - br.left, y1 = ra.top + ra.height / 2 - br.top, x2 = rb.left - br.left, y2 = rb.top + rb.height / 2 - br.top, mx = (x1 + x2) / 2;
        var w = 2 + 7 * (max ? e.a / max : 0);
        var dim = linkHover && linkHover !== e.from && linkHover !== e.to;
        out += '<path class="' + e.cls + (dim ? ' dim' : '') + '" stroke-width="' + w.toFixed(1) + '" d="M' + x1 + ',' + y1 + ' C' + mx + ',' + y1 + ' ' + mx + ',' + y2 + ' ' + x2 + ',' + y2 + '"><title>' +
          esc(e.from.replace('b', 'ขบ.') + ' → ' + (e.to === 'wait' ? 'ยังไม่ได้ทำ ขจ.' : e.to.replace('j', 'ขจ.')) + ' · ' + money(e.a) + ' บาท') + '</title></path>';
      });
      svg.innerHTML = out;
      Array.prototype.forEach.call(box.querySelectorAll('[data-node]'), function (n) {
        var id = n.getAttribute('data-node');
        var on = !linkHover || linkHover === id || edges.some(function (e) { return (e.from === linkHover && e.to === id) || (e.to === linkHover && e.from === id); });
        n.classList.toggle('dim', !on); n.classList.toggle('hot', linkHover === id);
      });
    }
    box.addEventListener('mouseover', function (e) { var n = e.target.closest('[data-node]'); var v = n ? n.getAttribute('data-node') : null; if (v !== linkHover) { linkHover = v; draw(); } });
    box.addEventListener('mouseleave', function () { linkHover = null; draw(); });
    box.addEventListener('focusin', function (e) { var n = e.target.closest('[data-node]'); if (n) { linkHover = n.getAttribute('data-node'); draw(); } });
    box.addEventListener('click', function (e) {
      var n = e.target.closest('[data-node]'); if (!n) return;
      var id = n.getAttribute('data-node');
      if (id === 'wait') switchSeg('pending');
      else if (id.charAt(0) === 'b') openKhb(Number(id.slice(1)));
      else openKhj(Number(id.slice(1)));
    });
    requestAnimationFrame(draw);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(draw);
    window.onresize = function () { clearTimeout(resizeT); resizeT = setTimeout(function () { if ($('links')) draw(); }, 120); };
  }

  /* ================= เอกสาร A4 ================= */
  function signHtml(d) {
    return '<div class="sign">' + d.signers.map(function (s) {
      return '<div><div class="sp"></div>' + esc(s.name) + '<br>' + esc(s.pos) + '</div>';
    }).join('') + '</div><div class="dir">ความเห็นผู้อำนวยการ<br>.............................................................................................................<br><br>' +
      esc(d.director.name) + '<br>' + esc(d.director.pos) + '</div>';
  }
  function headHtml(d) {
    return (d.cancelled ? '<div class="void">ยกเลิก</div>' : '') + '<h1>บันทึกข้อความ</h1>' +
      '<p><b>ส่วนราชการ</b> ' + esc(d.org) + '</p><div class="mh"><span><b>ที่</b> ' + esc(d.noText) + '</span><span><b>วันที่</b> ' + esc(d.dateLong) + '</span><span></span></div>' +
      '<p><b>เรื่อง</b> ' + esc(d.subject) + '</p><div class="rule"></div><p><b>เรียน</b> ' + esc(d.to) + '</p>';
  }
  function paperKhb(d) {
    return headHtml(d) + '<p class="ind" style="margin-top:6px">' + esc(d.paras[0]) + '</p><p>' + esc(d.paras[1]) + '</p>' +
      '<table style="margin-top:8px"><thead><tr><th style="width:6%">ที่</th><th style="width:18%">ประเภทเงิน</th><th>รายการ - ชื่อผู้เบิก/ผู้ยืม</th><th style="width:15%">ขอเบิกเงิน</th><th style="width:11%">ภาษี</th><th style="width:15%">รวมเป็นเงิน</th></tr></thead><tbody>' +
      d.rows.map(function (r) {
        return '<tr><td class="c">' + r.i + '</td><td>' + esc(r.type) + '</td><td>' + esc(r.payee) + '</td><td class="r">' + money(r.net) + '</td><td class="r">' + money(r.tax) + '</td><td class="r">' + money(r.gross) + '</td></tr>';
      }).join('') +
      '<tr class="tot"><td colspan="3" style="text-align:center">รวม</td><td class="r">' + money(d.total.net) + '</td><td class="r">' + money(d.total.tax) + '</td><td class="r">' + money(d.total.gross) + '</td></tr></tbody></table>' +
      '<p class="bt">(' + esc(d.totalText) + ')</p><p class="ind" style="margin-top:8px">จึงเรียนมาเพื่อโปรดพิจารณาอนุมัติ</p>' + signHtml(d);
  }
  function paperKhj(d) {
    var h = headHtml(d) + '<p class="ind" style="margin-top:6px">' + esc(d.paras[0]) + '</p>';
    d.sections.forEach(function (s, i) {
      h += '<h3>' + (i + 1) + '. ' + esc(s.title) + ' จำนวน ' + s.rows.length + ' รายการ</h3>' +
        '<table><thead><tr><th style="width:7%">ที่</th><th style="width:21%">เลขที่เช็ค</th><th>ชื่อผู้รับ</th><th style="width:17%">จำนวนเงิน</th><th style="width:15%">หมายเหตุ</th></tr></thead><tbody>' +
        s.rows.map(function (r) {
          return '<tr><td class="c">' + r.i + '</td><td class="c">' + esc(r.ref) + '</td><td>' + esc(r.payee) + '</td><td class="r">' + money(r.amount) + '</td><td class="c">' + esc(r.note) + '</td></tr>';
        }).join('') +
        '<tr class="tot"><td colspan="3" style="text-align:center">เป็นจำนวนเงินทั้งสิ้น</td><td class="r">' + money(s.total) + '</td><td></td></tr></tbody></table>' +
        '<p class="bt">(' + esc(s.totalText) + ')</p>';
    });
    return h + '<p style="margin-top:8px"><b>รวมเป็นเงินทั้งสิ้น ' + money(d.grand) + ' บาท (' + esc(d.grandText) + ')</b></p>' +
      '<p class="ind" style="margin-top:8px">จึงเรียนมาเพื่อโปรดพิจารณา</p>' + signHtml(d);
  }
  function openPaper(kind, no) {
    var m = openModal({
      title: (kind === 'khb' ? 'ขบ.' : 'ขจ.') + no + '/' + fy() + ' · ตัวอย่างก่อนพิมพ์', width: 980,
      body: '<div class="paperwrap"><div class="skel" style="min-height:400px"></div></div>',
      footer: '<span class="hint" style="margin:0">ตรวจชื่อผู้ลงนามได้ที่หน้า ตั้งค่า</span><span class="sp"></span><button class="btn ghost" type="button" data-close>ปิด</button>' +
        '<button class="btn" type="button" id="pPrint" disabled>' + ICON.print + ' พิมพ์ / บันทึกเป็น PDF</button>',
      onClose: function () { document.body.classList.remove('printing'); }
    });
    api(kind === 'khb' ? 'khbDoc' : 'khjDoc', { no: no }).then(function (d) {
      var wrap = m.el.querySelector('.paperwrap');
      wrap.innerHTML = '<div class="paper">' + (kind === 'khb' ? paperKhb(d) : paperKhj(d)) + '</div>';
      var paper = wrap.firstChild, avail = wrap.clientWidth - 16;
      if (avail > 0 && paper.offsetWidth > avail) paper.style.zoom = String(Math.max(0.42, avail / paper.offsetWidth));
      var pb = m.el.querySelector('#pPrint');
      pb.disabled = false;
      pb.onclick = function () {
        document.body.classList.add('printing');
        setTimeout(function () { window.print(); document.body.classList.remove('printing'); }, 60);
      };
    }).catch(function (e) { m.close(); handleError(e); });
  }

  return { render: render, leave: leave, openKhb: openKhb, openKhj: openKhj };
})();
