/* cheques.js — ทะเบียนคุมเช็ค: แท็บในหน้ารายจ่าย (เช็คอุดหนุน / บกศ. / รายได้) ตรวจว่าเช็คใบไหนค้างอยู่
   ข้อมูลมาจาก action getCheques (คำนวณที่หลังบ้านจาก ขจ. + ข้อมูลขึ้นเงิน) · การเงินวางข้อมูลขึ้นเงินจากธนาคารได้ตลอด (saveChequeClear)
   ผู้บริหารดูได้อย่างเดียว */
var Cheques = (function () {
  var f = { g: 'ทั้งหมด', st: 'ค้าง', q: '' }, picked = {}, opened = {}, host = null, ctx = null;
  var GROUP_NOTE = { 'อุดหนุน': 'บัญชีเงินอุดหนุน', 'บกศ.': 'บัญชีเงิน บกศ.', 'รายได้': 'บัญชีเงินรายได้', 'อื่น ๆ': 'อื่น ๆ · ภาษี' };

  function days(iso) { if (!iso) return 0; var a = Date.parse(iso + 'T00:00:00'), b = Date.parse(todayISO() + 'T00:00:00'); return Math.max(0, Math.round((b - a) / 86400000)); }
  /** เช็คค้างนานแค่ไหน: ≥180 วัน = เกิน 6 เดือน (เช็คหมดอายุ) · ≥150 = ใกล้หมดอายุ */
  function age(c) { var d = days(c.date); return { d: d, lv: d >= 180 ? 'x' : d >= 150 ? 'w' : '' }; }
  function load() { return S.chq && !S.chqStale ? Promise.resolve(S.chq) : takeFresh('cheques', 'getCheques').then(function (d) { S.chq = d; S.chqStale = false; return d; }); }
  function canEdit() { return can.fin() && mode() === 'fin'; }

  function render(dv, opt) {
    host = dv; ctx = opt || {};
    dv.innerHTML = '<div class="skel" style="min-height:220px"></div>';
    load().then(function (d) { if (host === dv) draw(d); }).catch(function (e) { dv.innerHTML = '<div class="err-box">' + esc(e.message || e) + '</div>'; });
  }
  function refresh() { S.chqStale = true; if (host && document.contains(host)) render(host, ctx); if (window.drawSegsNow) window.drawSegsNow(); }
  function shown(d) {
    var q = f.q.trim().toLowerCase();
    return d.rows.filter(function (c) {
      if (f.g !== 'ทั้งหมด' && c.group !== f.g) return false;
      if (f.st !== 'ทั้งหมด' && c.status !== f.st) return false;
      if (q && (c.ref + ' ' + c.payees.join(' ') + ' ' + c.khjNos.map(function (n) { return 'ขจ' + n; }).join(' ')).toLowerCase().indexOf(q) < 0) return false;
      return true;
    });
  }
  function sumOf(rows) { var s = 0; rows.forEach(function (c) { s += Math.round(c.amount * 100); }); return s / 100; }

  function draw(d) {
    var sm = d.summary, groups = ['อุดหนุน', 'บกศ.', 'รายได้'].concat(sm['อื่น ๆ'].open + sm['อื่น ๆ'].done ? ['อื่น ๆ'] : []);
    var late = d.rows.filter(function (c) { return c.status === 'ค้าง' && age(c).lv === 'x'; }).length;
    var h = '';
    if (d.unissued.length) {
      h += '<div class="draftbar"><span>มีรายการจ่ายด้วยเช็คใน ขจ. อีก <b>' + d.unissued.length + '</b> รายการที่ยังไม่ระบุเลขเช็ค/วันที่จ่าย — ยังไม่ขึ้นทะเบียนเช็ค</span>' +
        (ctx.goKhj ? '<button class="btn sm soft" type="button" id="cqGoKhj">ไประบุที่ ขจ.</button>' : '') + '</div>';
    }
    h += '<div class="cq-cards" role="group" aria-label="กลุ่มเงิน">';
    ['ทั้งหมด'].concat(groups).forEach(function (g) {
      var s = sm[g] || { open: 0, openAmt: 0, done: 0 };
      h += '<button type="button" class="cq-card" data-g="' + esc(g) + '" aria-pressed="' + (f.g === g) + '"><span class="cq-k">' + (g === 'ทั้งหมด' ? 'ค้างทั้งหมด' : 'เช็ค' + esc(g)) + '</span>' +
        '<span class="cq-n"><b>' + s.open + '</b> ใบ</span><span class="cq-a money">' + money(s.openAmt) + '</span><span class="cq-s">ขึ้นเงินแล้ว ' + s.done + ' ใบ</span></button>';
    });
    h += '</div>';
    if (late) h += '<p class="cq-warn" role="status">⚠ มีเช็คค้างเกิน 6 เดือน <b>' + late + '</b> ใบ — เช็คหมดอายุแล้ว ควรติดตามหรือออกเช็คใหม่</p>';
    h += '<div class="toolbar cq-tools"><div class="fchips" role="group" aria-label="สถานะ">' +
      ['ค้าง', 'ขึ้นเงินแล้ว', 'ทั้งหมด'].map(function (s) {
        var n = s === 'ทั้งหมด' ? (f.g === 'ทั้งหมด' ? d.rows.length : sm[f.g].open + sm[f.g].done) : (f.g === 'ทั้งหมด' ? sm['ทั้งหมด'][s === 'ค้าง' ? 'open' : 'done'] : sm[f.g][s === 'ค้าง' ? 'open' : 'done']);
        return '<button type="button" class="fchip" data-st="' + s + '" aria-pressed="' + (f.st === s) + '">' + s + ' <b>' + n + '</b></button>';
      }).join('') + '</div><label class="f grow cq-q"><span class="sr">ค้นหา</span><input id="cqQ" type="search" placeholder="ค้นหาเลขเช็ค / ผู้รับ / ขจ." value="' + esc(f.q) + '" autocomplete="off"></label>' +
      '<button class="btn ghost sm" type="button" id="cqXls">ส่งออก Excel</button>' +
      (canEdit() ? '<button class="btn sm" type="button" id="cqUpd">อัปเดตข้อมูลขึ้นเงิน (วางจาก Excel)</button>' : '') + '</div>';
    h += '<div id="cqTable"></div>';
    host.innerHTML = h;
    Array.prototype.forEach.call(host.querySelectorAll('[data-g]'), function (b) { b.onclick = function () { f.g = b.getAttribute('data-g'); picked = {}; draw(d); }; });
    Array.prototype.forEach.call(host.querySelectorAll('[data-st]'), function (b) { b.onclick = function () { f.st = b.getAttribute('data-st'); picked = {}; draw(d); }; });
    var qt = 0; $('cqQ').oninput = function () { var v = this.value; clearTimeout(qt); qt = setTimeout(function () { f.q = v; drawTable(d); }, 160); };
    if ($('cqGoKhj')) $('cqGoKhj').onclick = function () { ctx.goKhj(); };
    $('cqXls').onclick = function () { exportXls(d); };
    if ($('cqUpd')) $('cqUpd').onclick = function () { openUpdate(d); };
    drawTable(d);
  }

  function badges(c) {
    var h = '';
    if (c.status === 'ค้าง') {
      var a = age(c);
      h += '<span class="badge wait">ค้าง</span> <span class="cq-age' + (a.lv ? ' ' + a.lv : '') + '">' + a.d + ' วัน</span>';
      if (a.lv === 'x') h += ' <span class="badge bad">เกิน 6 เดือน</span>'; else if (a.lv === 'w') h += ' <span class="badge wait">ใกล้หมดอายุ</span>';
    } else {
      h += '<span class="badge paid">ขึ้นเงินแล้ว</span> <span class="cq-age">' + esc(thaiDate(c.clearedDate)) + '</span>';
      if (c.diff) h += ' <span class="badge bad" title="ยอดที่บันทึกตอนขึ้นเงินไม่เท่ากับยอดเช็คในระบบ">ยอดต่าง</span>';
    }
    if (c.mixed) h += ' <span class="badge in" title="รายการในเช็คใบนี้มาจากหลายกลุ่มเงิน">หลายกลุ่ม</span>';
    return h;
  }
  function drawTable(d) {
    var rows = shown(d), box = $('cqTable'), edit = canEdit();
    if (!rows.length) {
      box.innerHTML = '<div class="empty"><b>' + (f.q ? 'ไม่พบเช็คที่ค้นหา' : f.st === 'ค้าง' ? 'ไม่มีเช็คค้าง 🎉' : 'ยังไม่มีเช็คในกลุ่มนี้') + '</b>' +
        (d.rows.length ? 'ลองเปลี่ยนกลุ่มเงินหรือสถานะด้านบน' : 'เช็คจะขึ้นทะเบียนเมื่อระบุ "เลขเช็ค + วันที่จ่าย" ในหน้า ขจ. (วิธีจ่าย = เช็ค)') + '</div>';
      return;
    }
    var h = '<div class="tablewrap cq-wrap"><table class="cq"><thead><tr>' + (edit ? '<th class="cq-c"><input type="checkbox" id="cqAll" aria-label="เลือกทั้งหมด"></th>' : '') +
      '<th>เลขที่เช็ค</th><th class="hide-sm">วันที่ออก</th><th>ผู้รับ</th><th class="hide-sm">ขจ.</th><th class="money">จำนวน</th><th class="hide-sm">สถานะ</th></tr></thead><tbody>';
    rows.forEach(function (c) {
      var k = esc(c.key), who = esc(c.payees[0]) + (c.payees.length > 1 ? ' <span class="cq-more">+' + (c.payees.length - 1) + '</span>' : '');
      h += '<tr class="cq-r' + (c.status === 'ขึ้นเงินแล้ว' ? ' done' : '') + '" data-k="' + k + '">' + (edit ? '<td class="cq-c"><input type="checkbox" data-pick="' + k + '"' + (picked[c.key] ? ' checked' : '') + ' aria-label="เลือกเช็ค ' + esc(c.ref) + '"></td>' : '') +
        '<td><b class="cq-no">' + esc(c.ref) + '</b>' + (f.g === 'ทั้งหมด' ? ' <span class="cq-g g-' + esc(c.group === 'บกศ.' ? 'b' : c.group === 'อุดหนุน' ? 'a' : c.group === 'รายได้' ? 'r' : 'o') + '">' + esc(c.group) + '</span>' : '') + '<small class="cq-st hide-sm">' + esc(c.storeName) + '</small><span class="cq-mst">' + badges(c) + '</span></td>' +
        '<td class="hide-sm">' + esc(thaiDate(c.date)) + '</td><td>' + who + '</td><td class="hide-sm">' + c.khjNos.map(function (n) { return 'ขจ.' + n; }).join(', ') + '</td>' +
        '<td class="money">' + money(c.amount) + '</td><td class="cq-sc hide-sm">' + badges(c) + '</td></tr>';
      if (opened[c.key]) {
        h += '<tr class="cq-d"><td colspan="' + (edit ? 7 : 6) + '"><ul>' + c.lines.map(function (l) { return '<li><span>' + esc(l.payee) + '</span><em>ขบ.' + l.khbNo + '-' + l.seq + ' · ขจ.' + l.khjNo + '</em><b class="money">' + money(l.amount) + '</b></li>'; }).join('') + '</ul>' +
          (c.clearNote ? '<p class="hint">หมายเหตุขึ้นเงิน: ' + esc(c.clearNote) + '</p>' : '') + '</td></tr>';
      }
    });
    h += '</tbody><tfoot><tr><td colspan="' + (edit ? 5 : 4) + '" class="hide-sm-span">แสดง ' + rows.length + ' ใบ</td><td class="money">' + money(sumOf(rows)) + '</td><td></td></tr></tfoot></table></div>';
    if (edit) h += '<div class="cq-bar" id="cqBar" hidden><span id="cqSel"></span><span class="sp"></span><button class="btn sm" type="button" id="cqMark">ทำเครื่องหมายขึ้นเงินแล้ว</button><button class="btn sm danger" type="button" id="cqVoid">ยกเลิกการขึ้นเงิน</button></div>';
    box.innerHTML = h;
    Array.prototype.forEach.call(box.querySelectorAll('.cq-r'), function (tr) {
      tr.onclick = function (e) { if (e.target.closest('input')) return; var k = tr.getAttribute('data-k'); opened[k] = !opened[k]; drawTable(d); };
    });
    if (edit) {
      Array.prototype.forEach.call(box.querySelectorAll('[data-pick]'), function (cb) { cb.onchange = function () { picked[cb.getAttribute('data-pick')] = cb.checked; if (!cb.checked) delete picked[cb.getAttribute('data-pick')]; bar(d, rows); }; });
      $('cqAll').onchange = function () { var on = this.checked; picked = {}; if (on) rows.forEach(function (c) { picked[c.key] = true; }); Array.prototype.forEach.call(box.querySelectorAll('[data-pick]'), function (cb) { cb.checked = on; }); bar(d, rows); };
      $('cqMark').onclick = function () { openMark(d, pickedRows(d, 'ค้าง')); };
      $('cqVoid').onclick = function () { voidPicked(d, pickedRows(d, 'ขึ้นเงินแล้ว')); };
      bar(d, rows);
    }
  }
  function pickedRows(d, st) { return d.rows.filter(function (c) { return picked[c.key] && c.status === st; }); }
  function bar(d, rows) {
    var n1 = pickedRows(d, 'ค้าง').length, n2 = pickedRows(d, 'ขึ้นเงินแล้ว').length, b = $('cqBar'); if (!b) return;
    b.hidden = !(n1 + n2);
    $('cqSel').textContent = 'เลือก ' + (n1 + n2) + ' ใบ' + (n1 ? ' · ค้าง ' + n1 : '') + (n2 ? ' · ขึ้นเงินแล้ว ' + n2 : '');
    $('cqMark').hidden = !n1; $('cqVoid').hidden = !n2;
  }

  /* ---------- ทำเครื่องหมายขึ้นเงิน (เลือกเช็ค + วันที่) ---------- */
  function openMark(d, list) {
    if (!list.length) return;
    var minD = list.reduce(function (a, c) { return c.date > a ? c.date : a; }, '');
    var m = openModal({ title: 'ทำเครื่องหมายขึ้นเงินแล้ว ' + list.length + ' ใบ', width: 480,
      body: '<p class="hint">รวม <b>' + money(sumOf(list)) + '</b> บาท · เลือกวันที่ธนาคารตัดเงิน (ต้องไม่ก่อนวันที่ออกเช็ค ' + esc(thaiDate(minD)) + ')</p><label class="f">วันที่ขึ้นเงิน<input type="date" id="cqD" value="' + (todayISO() < minD ? minD : todayISO()) + '" min="' + minD + '" max="' + S.st.fyEnd + '"></label>',
      footer: '<button class="btn ghost" type="button" data-close>ยกเลิก</button><span class="sp"></span><button class="btn" type="button" id="cqOk">บันทึก</button>' });
    m.el.querySelector('#cqOk').onclick = function () {
      var dt = m.el.querySelector('#cqD').value;
      busy(this, api('saveChequeClear', { commit: true, items: list.map(function (c) { return { ref: c.ref, store: c.store, date: dt }; }) })).then(function (r) {
        m.close(); picked = {}; toast('ทำเครื่องหมายขึ้นเงิน ' + r.added + ' ใบแล้ว', 'good'); refresh();
      }).catch(handleError);
    };
  }
  function voidPicked(d, list) {
    if (!list.length) return;
    askReason('ยกเลิกการขึ้นเงิน ' + list.length + ' ใบ (เช็คกลับเป็น "ค้าง")', 'ยืนยัน', function (reason, am, btn) {
      busy(btn, api('voidChequeClear', { reason: reason, items: list.map(function (c) { return { ref: c.ref, store: c.store }; }) })).then(function () {
        am.close(); picked = {}; toast('ยกเลิกการขึ้นเงินแล้ว', 'good'); refresh();
      }).catch(handleError);
    });
  }

  /* ---------- อัปเดตข้อมูลขึ้นเงินจาก Excel ---------- */
  /** วางตารางจาก Excel -> [{ref, date, amount, note}] (มีหัวคอลัมน์ก็จับคู่ให้ ไม่มีก็ใช้ เลขเช็ค | วันที่ขึ้นเงิน | จำนวนเงิน | หมายเหตุ) */
  function toItems(text) {
    var rows = Paste.parseTSV(text).filter(function (r) { return r.some(function (c) { return String(c).trim(); }); });
    if (!rows.length) return [];
    var ix = { ref: 0, date: 1, amount: 2, note: 3 }, start = 0, hdr = rows[0].map(function (c) { return String(c).trim(); });
    if (hdr.some(function (h) { return /[ก-๙]/.test(h); }) && !hdr.some(function (h) { return /^\d{4,}$/.test(h); })) {
      var find = function (re, not) { for (var i = 0; i < hdr.length; i++) if (re.test(hdr[i]) && !(not && not.test(hdr[i]))) return i; return -1; };
      var a = find(/เลขที่|เลข/, /วันที่/); if (a < 0) a = find(/เช็ค/, /วันที่/);
      var b = find(/วันที่/), c = find(/จำนวน|ยอด/), n = find(/หมายเหตุ/);
      ix = { ref: a >= 0 ? a : 0, date: b >= 0 ? b : 1, amount: c, note: n }; start = 1;
    }
    return rows.slice(start).map(function (r) {
      var g = function (i) { return i >= 0 && r[i] !== undefined ? String(r[i]).trim() : ''; };
      return { ref: g(ix.ref).replace(/\s+/g, ''), date: g(ix.date), amount: g(ix.amount), note: g(ix.note) };
    }).filter(function (x) { return /\d/.test(x.ref); });
  }
  var ST = { 'new': ['ใหม่', 'paid'], same: ['เหมือนเดิม', 'cancel'], changed: ['วันที่ต่าง', 'wait'], error: ['ผิด', 'bad'] };
  function openUpdate(d) {
    var m = openModal({ title: 'อัปเดตข้อมูลขึ้นเงิน', width: 940,
      body: '<p class="hint">วางตารางจาก Excel/ธนาคาร ที่มีคอลัมน์ <b>เลขที่เช็ค · วันที่ขึ้นเงิน · จำนวนเงิน (ไม่บังคับ — ใส่แล้วระบบตรวจยอดให้)</b> · เช็คที่ไม่อยู่ในรายการวาง จะยังเป็น "ค้าง" · วางซ้ำเมื่อไรก็ได้ เช็คที่ขึ้นเงินแล้วไม่ถูกบันทึกซ้ำ</p>' +
        '<textarea id="cqPaste" rows="7" placeholder="เลขที่เช็ค&#9;วันที่ขึ้นเงิน&#9;จำนวนเงิน&#10;10393584&#9;12/10/69&#9;9,600.00" aria-label="วางข้อมูลขึ้นเงิน"></textarea>' +
        '<div class="actions"><button class="btn soft" type="button" id="cqCheck">ตรวจสอบ</button><span class="hint" id="cqHint"></span></div><div id="cqPv"></div>',
      footer: '<button class="btn ghost" type="button" data-close>ปิด</button><span class="sp"></span><label class="chkline" id="cqUpdW" hidden><input type="checkbox" id="cqUpdC"> อัปเดตเช็คที่วันที่ต่าง</label><button class="btn" type="button" id="cqSave" disabled>บันทึก</button>' });
    var el = m.el, items = [];
    el.querySelector('#cqCheck').onclick = function () {
      items = toItems(el.querySelector('#cqPaste').value);
      if (!items.length) { el.querySelector('#cqHint').textContent = 'ไม่พบแถวที่มีเลขเช็ค — ตรวจว่าวางตารางครบ'; return; }
      el.querySelector('#cqHint').textContent = '';
      busy(this, api('saveChequeClear', { items: items })).then(function (pv) {
        var c = pv.count, h = '<div class="pvsum"><span class="badge paid">ใหม่ ' + c['new'] + '</span><span class="badge cancel">เหมือนเดิม ' + c.same + '</span><span class="badge wait">วันที่ต่าง ' + c.changed + '</span><span class="badge bad">ผิด ' + c.error + '</span></div>' +
          '<div class="pvtable"><table><thead><tr><th>#</th><th>เลขที่เช็ค</th><th>กลุ่ม</th><th>ผู้รับ</th><th class="r">จำนวน</th><th>วันที่ขึ้นเงิน</th><th>ผล</th></tr></thead><tbody>';
        pv.rows.forEach(function (x) {
          h += '<tr class="' + x.status + '"><td>' + x.n + '</td><td>' + esc(x.ref) + '</td><td>' + esc(x.group || '') + '</td><td>' + esc(x.payee || '') + '</td><td class="r">' + (x.amount != null ? money(x.amount) : '') + '</td><td>' + (x.date ? esc(thaiDate(x.date)) : esc(items[x.n - 1].date)) + '</td>' +
            '<td><span class="badge ' + ST[x.status][1] + '">' + ST[x.status][0] + '</span> ' + esc(x.msg || '') + '</td></tr>';
        });
        el.querySelector('#cqPv').innerHTML = h + '</tbody></table></div>';
        el.querySelector('#cqSave').disabled = !(c['new'] || c.changed);
        el.querySelector('#cqUpdW').hidden = !c.changed;
      }).catch(handleError);
    };
    el.querySelector('#cqSave').onclick = function () {
      busy(this, api('saveChequeClear', { items: items, commit: true, updateChanged: el.querySelector('#cqUpdC').checked })).then(function (r) {
        m.close(); toast('บันทึกขึ้นเงิน ' + r.added + ' ใบ' + (r.count.error ? ' · ข้ามแถวที่ผิด ' + r.count.error : ''), 'good'); refresh();
      }).catch(handleError);
    };
  }

  function exportXls(d) {
    var rows = shown(d), out = rows.map(function (c) {
      return [c.ref, thaiDate(c.date), c.payees.join(', '), c.khjNos.map(function (n) { return 'ขจ.' + n; }).join(', '), c.group, c.storeName, c.amount, c.status, c.clearedDate ? thaiDate(c.clearedDate) : '', c.status === 'ค้าง' ? days(c.date) : ''];
    });
    var cols = [{ label: 'เลขที่เช็ค', w: 14, type: 'center' }, { label: 'วันที่ออกเช็ค', w: 15, type: 'center' }, { label: 'ผู้รับ', w: 36 }, { label: 'ขจ.', w: 10, type: 'center' }, { label: 'กลุ่มเงิน', w: 11, type: 'center' },
      { label: 'ที่เก็บเงิน', w: 22 }, { label: 'จำนวนเงิน', w: 15, type: 'money', sum: true }, { label: 'สถานะ', w: 13, type: 'center' }, { label: 'วันที่ขึ้นเงิน', w: 15, type: 'center' }, { label: 'ค้าง (วัน)', w: 10, type: 'center' }];
    previewSheet('ทะเบียนคุมเช็ค ปีงบ ' + d.fy + (f.g !== 'ทั้งหมด' ? ' · เช็ค' + f.g : '') + (f.st !== 'ทั้งหมด' ? ' · ' + f.st : ''), cols, out, 'ส่งออกจากระบบการเงินโรงเรียน · ' + thaiDateLong(todayISO()), 'ทะเบียนคุมเช็ค.xlsx');
  }

  return { render: render, refresh: refresh, toItems: toItems };
})();
