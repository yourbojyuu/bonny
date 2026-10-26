/* ระบบการเงินโรงเรียน — receipts.js
   รายรับ: บันทึกใบเสร็จต่อเนื่อง · วางจาก Excel ทีเดียวทั้งก้อน · สรุปรายเดือน/วัน · ยกเลิกใบเสร็จ */

var Receipts = (function () {
  var seg = 'enter', q = '', last = { book: '', no: '', date: '', type: '', method: 'สด' }, pasted = null;

  function rows() { return (S.rcv && S.rcv.rows) || []; }
  function live() { return rows().filter(function (r) { return !r[8]; }); }
  function amountOf(list) { return sumSat(list, function (r) { return Number(r[7]) || 0; }); }
  function methodSum(list, m) { return amountOf(list.filter(function (r) { return r[6] === m; })); }
  function segBtn(id, label) { return '<button type="button" data-rseg="' + id + '" aria-pressed="' + (seg === id) + '">' + esc(label) + '</button>'; }
  function leave() {}

  function render(v, opt) {
    if (opt && opt.seg) seg = opt.seg;
    var lv = live(), today = defaultDate(), mon = today.slice(0, 7);
    var tm = lv.filter(function (r) { return String(r[3]).slice(0, 7) === mon; });
    v.innerHTML =
      '<section class="hero">' + heroDeco('income') +
      '<div class="lbl">รายรับปีงบ ' + esc(S.docs ? S.docs.fy : '') + '</div>' +
      '<div class="big money">' + money(amountOf(lv)) + '</div><div class="sub">รวมใบเสร็จที่บันทึกแล้ว ' + lv.length + ' รายการ</div>' +
      '<div class="flow">' +
      '<div class="tile"><div class="k">เดือนนี้</div><div class="v money">' + money(amountOf(tm)) + '</div><div class="s">' + tm.length + ' รายการ</div></div>' +
      '<div class="tile"><div class="k">เงินสด (ทั้งปี)</div><div class="v money">' + money(methodSum(lv, 'สด')) + '</div><div class="s">เข้าที่เก็บเงินสด</div></div>' +
      '<div class="tile"><div class="k">เงินโอน (ทั้งปี)</div><div class="v money">' + money(methodSum(lv, 'โอน')) + '</div><div class="s">เข้าบัญชีหลักของประเภทเงิน</div></div>' +
      '</div></section>' +
      '<div class="seg glass" role="group" aria-label="มุมมอง">' +
      (can.fin() && mode() === 'fin' ? segBtn('enter', 'บันทึกใบเสร็จ') + segBtn('grid', 'ตาราง Excel') : '') + segBtn('day', 'สรุปรายวัน') + segBtn('sum', 'สรุปรายเดือน') + segBtn('list', 'รายการใบเสร็จ') + '</div>' +
      '<div id="rv"></div>';
    if ((seg === 'enter' || seg === 'grid') && !(can.fin() && mode() === 'fin')) seg = 'day';
    Array.prototype.forEach.call(v.querySelectorAll('[data-rseg]'), function (b) {
      b.setAttribute('aria-pressed', String(b.getAttribute('data-rseg') === seg));
      b.onclick = function () { switchSeg(b.getAttribute('data-rseg')); };
    });
    renderSeg();
  }
  function switchSeg(id) {
    if (id === seg) return;
    var run = function () {
      seg = id;
      Array.prototype.forEach.call(document.querySelectorAll('[data-rseg]'), function (b) { b.setAttribute('aria-pressed', String(b.getAttribute('data-rseg') === seg)); });
      renderSeg();
    };
    if (document.startViewTransition && !REDUCE) { try { document.startViewTransition(run); return; } catch (e) {} }
    run();
  }
  function renderSeg() {
    var dv = $('rv'); if (!dv) return;
    dv.className = ''; void dv.offsetWidth; dv.className = 'view-in';
    if (seg === 'grid') renderGrid(dv); else if (seg === 'enter') renderEnter(dv); else if (seg === 'day') renderDay(dv); else if (seg === 'sum') renderSum(dv); else renderList(dv);
    observeReveal();
  }
  function refresh() { return reloadReceipts().then(function () { if (S.tab === 'income') render($('view'), null); else renderTabs(); }); }


  /* ================= ตารางกรอกแบบ Excel ================= */
  var gRows = null, gMonth = '';
  function typeIdOfName(name) { return name ? Paste.matchType(name, { types: S.st.types, aliases: S.st.aliases || [] }, true) || '' : ''; }
  function gBlank(prev) {
    return { date: prev ? prev.date : defaultDate(), book: prev ? prev.book : last.book, no: prev && prev.no ? nextNo(prev.no) : last.no, type: prev ? prev.type : '', method: prev ? prev.method : 'สด', amount: '', payer: '' };
  }
  function renderGrid(dv) {
    if (!can.fin()) { dv.innerHTML = '<div class="empty"><b>บันทึกรายรับได้เฉพาะเจ้าหน้าที่การเงิน</b></div>'; return; }
    if (!gMonth) gMonth = (S.date || defaultDate()).slice(0, 7);
    var mons = []; for (var i = 0; i < 12; i++) { var d0 = new Date(S.st.fyStart + 'T00:00:00'), x = new Date(d0.getFullYear(), d0.getMonth() + i, 1); mons.push([x.getFullYear() + '-' + ('0' + (x.getMonth() + 1)).slice(-2), MONTHS_L[x.getMonth()] + ' ' + (x.getFullYear() + 543)]); }
    var cols = [
      { k: 'date', label: 'วันที่', w: 118, type: 'date', ph: 'วว/ดด/ปป' },
      { k: 'book', label: 'เล่มที่', w: 86 },
      { k: 'no', label: 'เลขที่', w: 86 },
      { k: 'type', label: 'ประเภทเงิน', w: 196, list: function () { return S.st.types.filter(function (t) { return t[4] !== 'ไม่ใช่'; }).map(function (t) { return t[1]; }); } },
      { k: 'method', label: 'วิธีรับ', w: 80, list: function () { return ['สด', 'โอน']; } },
      { k: 'amount', label: 'จำนวนเงิน', w: 128, type: 'money' },
      { k: 'payer', label: 'ผู้ชำระ (ถ้ามี)', w: 190 },
      { k: 'status', label: 'สถานะ', w: 80, ro: true }
    ];
    var pre = rows().filter(function (x) { return !gMonth || gMonth === '-' ? gMonth !== '-' : String(x[3]).slice(0, 7) === gMonth; }).sort(function (a, b) { return a[3] < b[3] ? -1 : a[3] > b[3] ? 1 : 0; }).map(function (x) {
      return { _old: true, date: x[3], book: x[0], no: x[1] + (Number(x[2]) > 1 ? '.' + x[2] : ''), type: typeName(x[5]), method: x[6], amount: x[7], payer: x[4], status: x[8] ? 'ยกเลิก' : '' };
    });
    dv.innerHTML = '<section class="card glass xcard"><div class="xbar"><div><h2 style="margin:0">ตารางกรอกใบเสร็จ (แถวละรายการ)</h2><p class="hint" style="margin:4px 0 0">พิมพ์ต่อท้ายตาราง หรือคัดลอกจากไฟล์ใบเสร็จเดิมแล้ว Ctrl+V · เลขที่เพิ่มให้ทีละ 1 · แถวที่ครบจะบันทึกอัตโนมัติเมื่อออกจากแถว (ระบบตรวจซ้ำและวันที่ที่ปิดแล้วให้ก่อนเสมอ)</p></div>' +
      '<div class="xtools"><label class="f inl">แสดงข้อมูลเดิม<select id="rxMon"><option value="">ทั้งหมด</option>' + mons.map(function (m) { return '<option value="' + m[0] + '"' + (m[0] === gMonth ? ' selected' : '') + '>' + esc(m[1]) + '</option>'; }).join('') + '<option value="-"' + (gMonth === '-' ? ' selected' : '') + '>ซ่อน</option></select></label>' +
      '<button class="btn ghost sm" type="button" id="rxXls">ส่งออก Excel</button><button class="btn ghost sm" type="button" id="rxClear">ล้างแถวใหม่</button><button class="btn" type="button" id="rxSave">บันทึกตอนนี้</button></div></div><div id="rxHost"></div><div class="xstat" id="rxStat"></div></section>';
    var cfgLeave = function () {};
    var g = Grid.create($('rxHost'), {
      cols: cols, rows: (gMonth === '-' ? [] : pre).concat(gRows || []), blank: gBlank,
      isEmpty: function (r) { return !r.amount && !r.payer; },
      onRow: function () { stat(); },
      onLeaveRow: function () { cfgLeave(); },
      rowCls: function (r) { return r._fresh ? 'fresh' : ''; },
      onPaste: function (text, api) {
        var res = Paste.receiptRows(Paste.parseTSV(text), { types: S.st.types, aliases: S.st.aliases || [], defaultMethod: 'สด' });
        if (!res.items.length) return false;
        api.append(res.items.map(function (it) { var t = S.st.types.filter(function (x) { return x[0] === it.type; })[0]; return { date: Grid.parseDate(it.date) || it.date, book: it.book, no: it.no, type: t ? t[1] : it.type, method: it.method || 'สด', amount: Grid.num(it.amount) || '', payer: it.payer || '' }; }));
        stat(); toast('วางแล้ว ' + res.items.length + ' แถว — กำลังตรวจและบันทึกอัตโนมัติ', 'good'); cfgLeave(); return true;
      },
      totals: function (rs) { var s = 0; rs.forEach(function (r) { s += Math.round((Number(r.amount) || 0) * 100); }); return '<td colspan="5" class="tl">รวมแถวใหม่ ' + rs.filter(function (r) { return r.amount || r.payer; }).length + ' แถว</td><td class="mn">' + Grid.fmtN(s / 100) + '</td><td colspan="2"></td>'; }
    });
    function stat() { var n = g.filled().length; $('rxStat').textContent = rxMsg && !n ? rxMsg : n ? (rxMsg && /^กำลัง/.test(rxMsg) ? rxMsg : 'แถวที่ยังไม่ครบ/รอบันทึก ' + n + ' แถว — แถวที่ครบจะบันทึกให้เองเมื่อออกจากแถว') : ''; gRows = g.rows().filter(function (x) { return !x._old; }); }
    stat();
    $('rxMon').onchange = function () { gMonth = this.value; stat(); renderGrid(dv); };
    $('rxXls').onclick = function () {
      var all = (gMonth === '-' ? [] : pre).map(function (p) { return [thaiDate(p.date), p.book, p.no, p.type, p.method, p.amount, p.payer, p.status]; });
      g.filled().forEach(function (x) { all.push([x.date ? thaiDate(x.date) : '', x.book, x.no, x.type, x.method, Number(x.amount) || 0, x.payer, '']); });
      var cc = [{ label: 'วันที่', w: 14, type: 'center' }, { label: 'เล่มที่', w: 10, type: 'center' }, { label: 'เลขที่', w: 10, type: 'center' }, { label: 'ประเภทเงิน', w: 30 }, { label: 'วิธีรับ', w: 9, type: 'center' }, { label: 'จำนวนเงิน', w: 17, type: 'money', sum: true }, { label: 'ผู้ชำระ', w: 28 }, { label: 'สถานะ', w: 10, type: 'center' }];
      previewSheet('ทะเบียนใบเสร็จ ปีงบ ' + S.st.fy, cc, all, 'ส่งออกจากระบบการเงินโรงเรียน · ' + thaiDateLong(defaultDate()), 'ใบเสร็จ-' + S.st.fy + '.xlsx');
    };
    $('rxClear').onclick = function () { gRows = null; g.replace(g.rows().filter(function (x) { return x._old; })); stat(); toast('ล้างแถวใหม่แล้ว'); };
    /* บันทึกอัตโนมัติ: แถวที่ครบแล้วจะถูกตรวจ (ซ้ำ/วันที่ปิดแล้ว) และบันทึกทันทีเมื่อออกจากแถว — เข้าคิวทีละงาน ไม่ชนกัน */
    var q = Promise.resolve(), rxMsg = '';
    function ready(r) { return Number(r.amount) > 0 && /^\d{4}-\d{2}-\d{2}$/.test(r.date || '') && !!r.book && !!r.no && !!typeIdOfName(r.type); }
    function sigOf(r) { return JSON.stringify([r.date, r.book, r.no, r.type, r.method, r.amount, r.payer]); }
    function flush(manual) { q = q.then(function () { return doFlush(manual); }).catch(function (e) { rxMsg = ''; stat(); handleError(e); }); return q; }
    function doFlush(manual) {
      var rowsAll = g.rows(), pend = [], incomplete = 0;
      rowsAll.forEach(function (r, ri) {
        if (r._old || (!r.amount && !r.payer)) return;
        if (!ready(r)) {
          if (manual) { incomplete++; if (!typeIdOfName(r.type)) g.mark(ri, 'type'); if (!(Number(r.amount) > 0)) g.mark(ri, 'amount'); if (!/^\d{4}-\d{2}-\d{2}$/.test(r.date || '')) g.mark(ri, 'date'); if (!r.book) g.mark(ri, 'book'); if (!r.no) g.mark(ri, 'no'); }
          return;
        }
        if (!manual && r._badSig === sigOf(r)) return; // เคยถูกปฏิเสธและยังไม่ได้แก้ — ไม่ส่งซ้ำ
        pend.push(r);
      });
      if (!pend.length) { if (manual) toast(incomplete ? 'มี ' + incomplete + ' แถวที่ยังไม่ครบ (ช่องสีแดง)' : 'ไม่มีแถวใหม่ที่ต้องบันทึก — แถวที่ครบจะบันทึกให้เองเมื่อออกจากแถว', incomplete ? 'err' : ''); return null; }
      var items = pend.map(function (r) { return { date: r.date, book: r.book, no: r.no, type: typeIdOfName(r.type), method: r.method, amount: String(r.amount), payer: r.payer }; });
      rxMsg = 'กำลังบันทึกอัตโนมัติ ' + pend.length + ' แถว…'; stat();
      return api('importReceipts', { items: items }).then(function (pv) {
        var okI = [], okR = [], bad = [];
        pv.rows.forEach(function (x, n) { if (x.status === 'new') { okI.push(items[n]); okR.push(pend[n]); } else { bad.push(x); pend[n]._badSig = sigOf(pend[n]); g.markRow(rowsAll.indexOf(pend[n])); } });
        if (bad.length) { var x0 = bad[0]; toast('แถว ' + (x0.n || '') + ' ไม่ถูกบันทึก: ' + (x0.status === 'same' ? 'มีเล่ม/เลขที่นี้แล้ว (ข้อมูลเหมือนเดิม)' : x0.status === 'changed' ? 'มีเล่ม/เลขที่นี้แล้วแต่ข้อมูลต่างกัน' : x0.msg) + (bad.length > 1 ? ' (และอีก ' + (bad.length - 1) + ' แถว)' : ''), 'err'); }
        if (!okI.length) { rxMsg = ''; stat(); return null; }
        return api('importReceipts', { items: okI, commit: true }).then(function (res) {
          var lr = okR[okR.length - 1]; last = { book: lr.book, no: nextNo(lr.no), date: lr.date, type: lr.type, method: lr.method };
          okR.forEach(function (r) { r.status = ''; g.lock(r); });
          rxMsg = '✓ บันทึกอัตโนมัติแล้ว ' + res.added + ' รายการ'; stat();
          return reloadReceipts();
        });
      });
    }
    var leaveT = 0;
    cfgLeave = function () { clearTimeout(leaveT); leaveT = setTimeout(function () { flush(false); }, 250); };
    $('rxSave').onclick = function () { var b = this; busy(b, flush(true)); };
  }

  /* ================= บันทึกใบเสร็จ (กรอกเอง + แพ็กเกจ) ================= */
  var GRPS = ['บกศ.', 'รายได้', 'อื่น ๆ'];
  function grpOf(tid) { var t = tid ? typeById(tid) : null, g = t ? t[2] : ''; return /บกศ/.test(g) ? 'บกศ.' : /รายได้/.test(g) ? 'รายได้' : 'อื่น ๆ'; }
  function typeOpts(g, sel) {
    return '<option value="">— ประเภทเงิน —</option>' + S.st.types.filter(function (t) { return t[4] !== 'ไม่ใช่' && grpOf(t[0]) === g; }).map(function (t) {
      return '<option value="' + esc(t[0]) + '"' + (t[0] === sel ? ' selected' : '') + '>' + esc(t[1]) + '</option>';
    }).join('');
  }
  function lineHtml(l, i) {
    var g = l.type ? grpOf(l.type) : (l.grp || 'บกศ.');
    return '<div class="line rline qr-line' + (l.drop ? ' drop' : '') + '" data-rl style="--i:' + Math.min(i, 8) + '"><span class="i">' + (i + 1) + '</span>' +
      '<div class="qr-g" role="group" aria-label="กลุ่มเงิน">' + GRPS.map(function (x) { return '<button type="button" class="qchip" data-g="' + x + '" aria-pressed="' + (x === g) + '">' + x + '</button>'; }).join('') + '</div>' +
      '<label class="f" data-c="type"><select data-f="type" aria-label="ประเภทเงิน"' + (l.bad ? ' class="bad"' : '') + '>' + typeOpts(g, l.type) + '</select></label>' +
      '<label class="f" data-c="method"><select data-f="method" aria-label="วิธีรับ">' + plainOpts(['สด', 'โอน'], l.method) + '</select></label>' +
      '<label class="f" data-c="gross"><input class="money" data-f="amount" aria-label="จำนวนเงิน" inputmode="decimal" value="' + esc(l.amount || '') + '" placeholder="0.00"></label>' +
      '<button class="del" type="button" data-del aria-label="ลบบรรทัด" data-c="del">×</button></div>';
  }
  function nextNo(no) { var m = /^(.*?)(\d+)$/.exec(String(no || '')); return m ? m[1] + String(Number(m[2]) + 1) : ''; }
  /** ใบเสร็จล่าสุดที่บันทึกในระบบ (วันที่มากสุด แล้วเลขที่มากสุด) */
  function latestReceipt() {
    var best = null;
    live().forEach(function (r) {
      if (!best || r[3] > best[3] || (r[3] === best[3] && (parseInt(r[1], 10) || 0) > (parseInt(best[1], 10) || 0))) best = r;
    });
    return best;
  }
  /** แถวใบเสร็จ (ต่อบรรทัด) -> ใบเสร็จ (ต่อใบ) เรียงเลขที่ */
  function groupReceipts(list) {
    var by = {}, order = [];
    list.forEach(function (r) {
      var k = r[0] + '|' + r[1];
      if (!by[k]) { by[k] = { book: r[0], no: r[1], date: r[3], payer: r[4], lines: [], total: 0, cancelled: !!r[8], note: r[9] }; order.push(k); }
      by[k].lines.push(r); if (!r[8]) by[k].total += Math.round((Number(r[7]) || 0) * 100);
    });
    return order.map(function (k) { by[k].total /= 100; return by[k]; }).sort(function (a, b) { return a.book === b.book ? (parseInt(a.no, 10) || 0) - (parseInt(b.no, 10) || 0) : (a.book < b.book ? -1 : 1); });
  }
  function cancelFlow(rc) {
    askReason('ยกเลิกใบเสร็จ เล่ม ' + rc.book + ' เลขที่ ' + rc.no + ' (ทุกบรรทัดของใบนี้)', 'ยืนยันยกเลิก', function (reason, am, btn) {
      busy(btn, api('cancelReceipt', { book: rc.book, no: rc.no, reason: reason })).then(function () {
        am.close(); toast('ยกเลิกใบเสร็จแล้ว', 'good'); return refresh();
      }).catch(handleError);
    });
  }
  function rcSummary(rc) { return rc.lines.filter(function (l) { return !l[8]; }).map(function (l) { return typeName(l[5]) + ' ' + money(l[7]) + (l[6] === 'โอน' ? ' (โอน)' : ''); }).join(' · '); }
  function rcRowHtml(rc, ix, canCx) {
    return '<div class="qr-rc' + (rc.cancelled ? ' cx' : '') + '"><b class="no">' + esc(rc.book) + '/' + esc(rc.no) + '</b><span class="sm">' + (rc.payer ? esc(rc.payer) + ' · ' : '') + esc(rcSummary(rc) || (rc.note || 'ยกเลิก')) + '</span>' +
      '<span class="am money">' + (rc.cancelled ? '<span class="badge cancel">ยกเลิก</span>' : money(rc.total)) + '</span>' +
      (canCx && !rc.cancelled ? '<button class="btn ghost sm" type="button" data-cxr="' + ix + '">ยกเลิก</button>' : '<span></span>') + '</div>';
  }
  function pkLabel(p) {
    return (p[1] ? p[1] + ': ' : '') + p[2].map(function (it) { var t = typeById(it[0]); return (t ? t[1] : it[0]) + ' ' + money(it[1]); }).join(' + ');
  }

  function renderEnter(dv) {
    if (!can.fin()) { dv.innerHTML = '<div class="empty"><b>บันทึกรายรับได้เฉพาะเจ้าหน้าที่การเงิน</b>ดูสรุปได้ที่แท็บ "สรุปรายวัน"</div>'; return; }
    if (!last.no) { var lr = latestReceipt(); if (lr) last = { book: lr[0], no: nextNo(lr[1]), date: '', type: '', method: 'สด' }; }
    var dr = Draft.get('rcv'), d = dr && dr.data ? dr.data : null;
    if (d && !(d.lines || []).some(function (l) { return l.amount; })) d = null;
    var data = d || { book: last.book, no: last.no, date: last.date || defaultDate(), payer: '', total: '', method: last.method || 'สด', lines: [{ type: '', method: last.method || 'สด', amount: '' }] };
    var rm = data.method || 'สด', lt = latestReceipt(), pkN = (S.st.packages || []).length;
    dv.innerHTML =
      '<div class="card glass reveal qr-card"><div class="qr-head"><h2>บันทึกใบเสร็จ</h2>' +
      '<span class="qr-last">' + (lt ? 'ใบล่าสุดในระบบ: เล่ม ' + esc(lt[0]) + ' เลขที่ ' + esc(lt[1]) + ' (' + esc(thaiDate(lt[3])) + ')' : 'ยังไม่มีใบเสร็จในระบบ') + '</span></div>' +
      (d ? '<div class="draftbar" id="rDraft"><span>กู้ฉบับร่างที่ค้างไว้เมื่อ ' + esc(clockText(dr.at)) + ' กลับมาแล้ว</span><button class="link" type="button" id="rDraftDel">ทิ้งฉบับร่าง</button></div>' : '') +
      '<div class="form-head r3"><label class="f">เล่มที่<input id="rBook" value="' + esc(data.book) + '" placeholder="เช่น 1"></label>' +
      '<label class="f">เลขที่<input id="rNo" value="' + esc(data.no) + '" placeholder="เช่น 101"></label>' +
      '<label class="f">วันที่รับเงิน<input type="date" id="rDate" value="' + esc(data.date) + '" min="' + S.st.fyStart + '" max="' + S.st.fyEnd + '"></label></div>' +
      '<div class="qr-total"><label class="f qr-tot">ยอดรวมใบเสร็จ (ไม่บังคับ — ใส่แล้วระบบหาแพ็กเกจให้)<input id="rTotal" class="money" inputmode="decimal" autocomplete="off" placeholder="เช่น 1,325" value="' + esc(data.total || '') + '"></label>' +
      '<div class="qr-cg"><span>วิธีรับ</span><div id="rMeth">' + ['สด', 'โอน'].map(function (m) { return '<button type="button" class="qchip" data-m="' + m + '" aria-pressed="' + (m === rm) + '">' + m + '</button>'; }).join('') + '</div></div></div>' +
      '<div class="qr-pk" id="rPk" aria-live="polite"></div>' +
      '<details class="more rpayer"' + (data.payer ? ' open' : '') + '><summary>ผู้ชำระ (ไม่บังคับ)</summary><label class="f"><input id="rPayer" value="' + esc(data.payer || '') + '" placeholder="ชื่อผู้ชำระเงิน"></label></details>' +
      '<div id="rLines">' + data.lines.map(lineHtml).join('') + '</div>' +
      '<div class="qr-diff" id="rDiff" aria-live="polite"></div>' +
      '<div class="toolbar"><button class="btn soft" type="button" id="rAdd">' + ICON.plus + ' เพิ่มบรรทัด</button><button class="link" type="button" id="rPkMgr">แพ็กเกจรับเงิน (' + pkN + ')</button><span class="grow"></span>' +
      '<span class="hint" style="margin:0">Ctrl+Enter เพื่อบันทึก</span><button class="btn" type="button" id="rSave">บันทึกใบเสร็จ</button></div></div>' +
      '<div class="card glass reveal qr-card" id="rToday"></div>' +
      '<details class="card glass reveal pastecard"' + (pasted ? ' open' : '') + '><summary><h2>วางจาก Excel ทีเดียวทั้งก้อน</h2></summary>' +
      '<p class="hint">คัดลอกแถวจากไฟล์ใบเสร็จเดิม (หัวตาราง: ' + esc(Paste.RECEIPT_HEADER.join(' | ')) + ') แล้ววางด้านล่าง ระบบจะตรวจให้ก่อนบันทึกเสมอ — ใบที่มีอยู่แล้วจะไม่ถูกบันทึกซ้ำ</p>' +
      '<textarea id="rPaste" rows="4" placeholder="วางข้อมูลจาก Excel ที่นี่ (Ctrl+V)"></textarea>' +
      '<div class="actions"><button class="btn soft" type="button" id="rCheck">ตรวจข้อมูลที่วาง</button><button class="link" type="button" id="rCopyHead">คัดลอกหัวตาราง</button></div>' +
      '<div id="rPrev"></div></details>';
    var el = dv, box = el.querySelector('#rLines'), saveT = 0, curPk = -1, dirty = false;
    thaiDateHint(el.querySelector('#rDate'));
    function lineEls() { return box.querySelectorAll('[data-rl]'); }
    function readLines() {
      return Array.prototype.map.call(lineEls(), function (row) {
        var o = {}; Array.prototype.forEach.call(row.querySelectorAll('[data-f]'), function (f) { o[f.getAttribute('data-f')] = f.value; });
        return o;
      });
    }
    function totalVal() { return cleanNum(el.querySelector('#rTotal').value); }
    function lineSum() { return sumSat(readLines(), function (l) { return cleanNum(l.amount); }); }
    function renumber() { Array.prototype.forEach.call(lineEls(), function (r, i) { r.querySelector('.i').textContent = i + 1; }); }
    function diff() {
      var t = totalVal(), s = lineSum(), box2 = el.querySelector('#rDiff'), df = Math.round((t - s) * 100) / 100;
      if (!t) box2.innerHTML = '<span>รวมรายการ <b class="money">' + money(s) + '</b> บาท</span>';
      else if (df === 0) box2.innerHTML = '<span class="ok">✓ ตรงกับยอดรวม <b class="money">' + money(t) + '</b> บาท</span>';
      else box2.innerHTML = '<span class="bad">' + (df > 0 ? 'ยังขาดอีก ' : 'เกินยอดรวม ') + '<b class="money">' + money(Math.abs(df)) + '</b> บาท (รวมรายการ ' + money(s) + ' / ยอดรวม ' + money(t) + ')</span>' + (df > 0 ? '<button class="link" type="button" id="rFill">เติมส่วนต่างให้บรรทัดสุดท้าย</button>' : '');
    }
    function readAll() { return { book: el.querySelector('#rBook').value, no: el.querySelector('#rNo').value, date: el.querySelector('#rDate').value, payer: el.querySelector('#rPayer').value, total: el.querySelector('#rTotal').value, method: rm, lines: readLines() }; }
    function draft() {
      var a = readAll();
      if (a.lines.some(function (l) { return l.amount; })) Draft.set('rcv', a); else Draft.del('rcv');
    }
    function queue() { clearTimeout(saveT); saveT = setTimeout(draft, 500); diff(); }
    /* ---- แพ็กเกจตามยอดรวม ---- */
    function showPk(auto) {
      var t = totalVal(), host = el.querySelector('#rPk');
      if (!t) { host.innerHTML = ''; curPk = -1; return; }
      var c = Math.round(t * 100), hits = []; (S.st.packages || []).forEach(function (p, i) { if (Math.round(p[0] * 100) === c) hits.push(i); });
      if (!hits.length) { host.innerHTML = '<span class="qr-pkn">ไม่มีแพ็กเกจยอด ' + money(t) + ' — เพิ่มรายการเองด้านล่างได้เลย</span>'; curPk = -1; return; }
      host.innerHTML = '<span class="qr-pkn">แพ็กเกจยอด ' + money(t) + (hits.length > 1 ? ' (' + hits.length + ' แบบ — เลือกให้ตรงกับใบนี้)' : '') + '</span>' +
        hits.map(function (i) { return '<button type="button" class="qchip pk" data-pk="' + i + '" aria-pressed="' + (i === curPk) + '">' + esc(pkLabel(S.st.packages[i])) + '</button>'; }).join('');
      var empty = !readLines().some(function (l) { return cleanNum(l.amount); });
      if (auto && hits.length === 1 && (empty || !dirty)) applyPk(hits[0]);
    }
    function applyPk(i) {
      var p = S.st.packages[i]; if (!p) return; curPk = i; dirty = false;
      box.innerHTML = p[2].map(function (it, k) { return lineHtml({ type: it[0], method: rm, amount: it[1], drop: true }, k); }).join('');
      Array.prototype.forEach.call(el.querySelectorAll('#rPk [data-pk]'), function (b) { b.setAttribute('aria-pressed', String(Number(b.getAttribute('data-pk')) === i)); });
      queue();
    }
    el.querySelector('#rPk').addEventListener('click', function (e) { var b = e.target.closest('[data-pk]'); if (b) applyPk(Number(b.getAttribute('data-pk'))); });
    el.querySelector('#rTotal').addEventListener('input', function () { curPk = -1; clearTimeout(el._pkT); el._pkT = setTimeout(function () { showPk(true); diff(); }, 250); queue(); });
    el.querySelector('#rMeth').addEventListener('click', function (e) {
      var b = e.target.closest('[data-m]'); if (!b) return; rm = b.getAttribute('data-m');
      Array.prototype.forEach.call(el.querySelectorAll('#rMeth [data-m]'), function (x) { x.setAttribute('aria-pressed', String(x === b)); });
      Array.prototype.forEach.call(el.querySelectorAll('[data-f="method"]'), function (s) { s.value = rm; }); queue();
    });
    /* ---- รายการ ---- */
    el.addEventListener('input', function (e) { if (e.target.classList) e.target.classList.remove('bad'); if (box.contains(e.target)) dirty = true; if (e.target.id !== 'rPaste') queue(); });
    el.addEventListener('change', function (e) {
      if (e.target.id === 'rDate') today();
      if (box.contains(e.target)) dirty = true;
      if (e.target.id !== 'rPaste') queue();
    });
    function addLine(type) {
      var ls = readLines(), p = ls[ls.length - 1] || {}, tmp = document.createElement('div');
      tmp.innerHTML = lineHtml({ type: type || '', grp: type ? '' : (p.type ? grpOf(p.type) : 'บกศ.'), method: rm, amount: '', drop: true }, ls.length);
      box.appendChild(tmp.firstChild); renumber();
      box.lastChild.querySelector('[data-f="amount"]').focus(); diff();
    }
    el.querySelector('#rAdd').onclick = function () { addLine(''); };
    el.querySelector('#rPkMgr').onclick = function () { openPackages(); };
    el.querySelector('#rDiff').addEventListener('click', function (e) {
      if (!e.target.closest('#rFill')) return;
      var ls = lineEls(), t = totalVal(), others = 0, lastEl = ls[ls.length - 1], amtEl = lastEl.querySelector('[data-f="amount"]');
      Array.prototype.forEach.call(ls, function (r, i) { if (i < ls.length - 1) others += Math.round(cleanNum(r.querySelector('[data-f="amount"]').value) * 100); });
      amtEl.value = String(Math.round(t * 100 - others) / 100); queue();
    });
    box.addEventListener('click', function (e) {
      var g = e.target.closest('[data-g]');
      if (g) { // เปลี่ยนกลุ่มเงิน = เปลี่ยนรายการประเภทเงินที่เลือกได้
        var row = g.closest('[data-rl]'), sel = row.querySelector('[data-f="type"]');
        Array.prototype.forEach.call(row.querySelectorAll('[data-g]'), function (x) { x.setAttribute('aria-pressed', String(x === g)); });
        sel.innerHTML = typeOpts(g.getAttribute('data-g'), ''); sel.focus(); queue(); return;
      }
      var b = e.target.closest('[data-del]'); if (!b) return;
      if (lineEls().length === 1) { toast('ต้องมีอย่างน้อย 1 บรรทัด', 'err'); return; }
      b.closest('[data-rl]').remove(); renumber(); queue();
    });
    box.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && e.target.getAttribute('data-f') === 'amount' && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        var row = e.target.closest('[data-rl]');
        if (!row.nextElementSibling && cleanNum(e.target.value)) addLine('');
        else if (row.nextElementSibling) row.nextElementSibling.querySelector('[data-f="amount"]').focus();
      }
    });
    if (el.querySelector('#rDraftDel')) el.querySelector('#rDraftDel').onclick = function () {
      Draft.del('rcv'); clearTimeout(saveT); renderEnter(dv); toast('ทิ้งฉบับร่างแล้ว');
    };
    /* ---- ใบของวันที่เลือก (ยกเลิกได้ทันที) ---- */
    function today() {
      var dt = el.querySelector('#rDate').value, host = el.querySelector('#rToday');
      var rcs = groupReceipts(rows().filter(function (r) { return r[3] === dt; }));
      host.innerHTML = '<div class="qr-head"><h3>ใบเสร็จวันที่ ' + esc(dt ? thaiDate(dt) : '') + '</h3><span class="qr-last">' + (rcs.length ? rcs.length + ' ใบ · ' + money(sumSat(rcs.filter(function (x) { return !x.cancelled; }), function (x) { return x.total; })) + ' บาท' : 'ยังไม่มีใบในวันนี้') + '</span></div>' +
        (rcs.length ? '<div class="qr-rcs">' + rcs.slice().reverse().slice(0, 12).map(function (rc, i) { return rcRowHtml(rc, i, true); }).join('') + '</div>' + (rcs.length > 12 ? '<p class="hint">แสดง 12 ใบล่าสุด — ดูทั้งหมดที่แท็บ "สรุปรายวัน"</p>' : '') : '');
      var shown = rcs.slice().reverse().slice(0, 12);
      Array.prototype.forEach.call(host.querySelectorAll('[data-cxr]'), function (b) { b.onclick = function () { cancelFlow(shown[Number(b.getAttribute('data-cxr'))]); }; });
    }
    today(); diff(); if (totalVal()) showPk(false);
    function save() {
      var a = readAll(), btn = el.querySelector('#rSave');
      var items = a.lines.filter(function (l) { return l.amount || l.type; }).map(function (l) { return { book: a.book, no: a.no, date: a.date, payer: a.payer, type: l.type, method: l.method, amount: l.amount }; });
      if (!items.length) { toast('กรอกจำนวนเงินอย่างน้อย 1 บรรทัด', 'err'); return; }
      var t = totalVal(), s = lineSum();
      if (t && Math.round((t - s) * 100) !== 0) { toast('ยอดรวมใบเสร็จ ' + money(t) + ' ไม่ตรงกับผลรวมรายการ ' + money(s) + ' — ปรับรายการ หรือลบยอดรวมออก', 'err'); return; }
      busy(btn, api('importReceipts', { items: items })).then(function (pv) {
        var bad = pv.rows.filter(function (r) { return r.status !== 'new'; })[0];
        if (bad) {
          var i = bad.n - 1, rowEl = lineEls()[i];
          if (rowEl && bad.status === 'error' && /ประเภท/.test(bad.msg)) rowEl.querySelector('[data-f="type"]').classList.add('bad');
          toast((pv.rows.length > 1 ? 'บรรทัดที่ ' + bad.n + ': ' : '') + (bad.status === 'same' ? 'เล่ม/เลขที่นี้มีอยู่แล้ว (ข้อมูลเหมือนเดิม)' : bad.status === 'changed' ? 'เล่ม/เลขที่นี้มีอยู่แล้วแต่ข้อมูลต่างกัน' : bad.msg), 'err');
          return null;
        }
        return busy(btn, api('importReceipts', { items: items, commit: true })).then(function (r) {
          Draft.del('rcv'); clearTimeout(saveT);
          last = { book: a.book, no: nextNo(a.no), date: a.date, type: '', method: rm };
          toast('บันทึกใบเสร็จ เล่ม ' + a.book + ' เลขที่ ' + a.no + ' แล้ว (' + r.added + ' บรรทัด) — ใบถัดไป เลขที่ ' + (last.no || '-'), 'good');
          return refresh().then(function () { var n = $('rTotal'); if (n) n.focus(); });
        });
      }).catch(handleError);
    }
    el.querySelector('#rSave').onclick = save;
    el.addEventListener('keydown', function (e) { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && el.querySelector('#rSave')) { e.preventDefault(); save(); } });

    /* ---- วางจาก Excel ---- */
    var ta = el.querySelector('#rPaste'), prev = el.querySelector('#rPrev');
    function check() {
      var p = Paste.receiptRows(Paste.parseTSV(ta.value), { types: S.st.types, aliases: S.st.aliases || [], defaultMethod: 'สด' });
      if (!p.items.length) { toast('ไม่พบแถวใบเสร็จในข้อมูลที่วาง', 'err'); prev.innerHTML = ''; return; }
      busy(el.querySelector('#rCheck'), api('importReceipts', { items: p.items })).then(function (pv) {
        pasted = { items: p.items, pv: pv, skipped: p.skipped };
        showPreview(prev);
      }).catch(handleError);
    }
    ta.addEventListener('paste', function () { setTimeout(check, 30); });
    el.querySelector('#rCheck').onclick = check;
    el.querySelector('#rCopyHead').onclick = function () {
      var t = Paste.RECEIPT_HEADER.join('\t');
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(t).then(function () { toast('คัดลอกหัวตารางแล้ว', 'good'); }, function () { toast(t); });
      else toast(t);
    };
  }

  /* ================= สรุปรายวัน: ใช้ใบเสร็จเล่ม/เลขที่ใด · แยก บกศ. / รายได้ / อื่น ๆ · สด / โอน ================= */
  var dayMon = '';
  function noRanges(list) { // เลขที่ -> "101–118, 120"
    var by = {}, order = [];
    list.forEach(function (rc) { if (!by[rc.book]) { by[rc.book] = []; order.push(rc.book); } by[rc.book].push(rc.no); });
    return order.map(function (b) {
      var nums = by[b].filter(function (n) { return /^\d+$/.test(n); }).map(Number).sort(function (x, y) { return x - y; }), other = by[b].filter(function (n) { return !/^\d+$/.test(n); }), parts = [], s = null, p = null;
      nums.forEach(function (n) { if (s === null) { s = p = n; } else if (n === p + 1) p = n; else { parts.push(s === p ? String(s) : s + '–' + p); s = p = n; } });
      if (s !== null) parts.push(s === p ? String(s) : s + '–' + p);
      return 'เล่ม ' + b + ' เลขที่ ' + parts.concat(other).join(', ');
    }).join(' · ');
  }
  function renderDay(dv) {
    var all = rows();
    if (!all.length) { dv.innerHTML = '<div class="empty"><b>ยังไม่มีใบเสร็จในปีงบนี้</b>' + (can.fin() ? 'เริ่มจากแท็บ "บันทึกใบเสร็จ"' : '') + '</div>'; return; }
    var mons = {}; all.forEach(function (r) { mons[String(r[3]).slice(0, 7)] = 1; });
    var mk = Object.keys(mons).sort().reverse();
    if (!dayMon || (dayMon !== '-' && !mons[dayMon])) dayMon = mons[defaultDate().slice(0, 7)] ? defaultDate().slice(0, 7) : mk[0];
    var sel = all.filter(function (r) { return dayMon === '-' || String(r[3]).slice(0, 7) === dayMon; });
    var byDay = {}, dk = []; sel.forEach(function (r) { if (!byDay[r[3]]) { byDay[r[3]] = []; dk.push(r[3]); } byDay[r[3]].push(r); }); dk.sort().reverse();
    var canCx = can.fin() && mode() === 'fin', gtot = { 'บกศ.': 0, 'รายได้': 0, 'อื่น ๆ': 0 };
    function gsum(list) {
      var s = { 'บกศ.': { 'สด': 0, 'โอน': 0 }, 'รายได้': { 'สด': 0, 'โอน': 0 }, 'อื่น ๆ': { 'สด': 0, 'โอน': 0 } };
      list.forEach(function (r) { if (r[8]) return; var g = grpOf(r[5]), m = r[6] === 'โอน' ? 'โอน' : 'สด'; s[g][m] += Math.round((Number(r[7]) || 0) * 100); });
      return s;
    }
    var cards = dk.map(function (d, di) {
      var list = byDay[d], rcs = groupReceipts(list), live = rcs.filter(function (x) { return !x.cancelled; }), s = gsum(list), tot = 0, gh = '';
      GRPS.forEach(function (g) {
        var c = s[g]['สด'] + s[g]['โอน']; tot += c; gtot[g] += c;
        gh += '<div class="qr-gb' + (c ? '' : ' z') + '"><span class="gl">' + esc(g) + '</span><b class="money">' + money(c / 100) + '</b><small>สด ' + money(s[g]['สด'] / 100) + ' · โอน ' + money(s[g]['โอน'] / 100) + '</small></div>';
      });
      var cx = rcs.length - live.length;
      return '<details class="card glass qr-day" data-d="' + esc(d) + '"' + (di === 0 ? ' open' : '') + '><summary><div class="qd-top"><b class="qd-date">' + esc(thaiDate(d)) + '</b><span class="qd-no">' + esc(noRanges(rcs)) + '</span>' +
        '<span class="qd-n">' + live.length + ' ใบ' + (cx ? ' · ยกเลิก ' + cx : '') + '</span><span class="sp"></span><b class="money tot">' + money(tot / 100) + '</b></div></summary>' +
        '<div class="qr-gsum">' + gh + '</div><div class="qr-rcs" data-day="' + di + '">' + rcs.map(function (rc, i) { return rcRowHtml(rc, i, canCx); }).join('') + '</div></details>';
    }).join('');
    var gt = GRPS.map(function (g) { return '<div class="qr-gb"><span class="gl">' + esc(g) + '</span><b class="money">' + money(gtot[g] / 100) + '</b></div>'; }).join('');
    dv.innerHTML = '<div class="toolbar"><label class="f inl">เดือน<select id="dayMon">' + mk.map(function (m) { return '<option value="' + m + '"' + (m === dayMon ? ' selected' : '') + '>' + esc(MONTHS_L[Number(m.slice(5)) - 1] + ' ' + (Number(m.slice(0, 4)) + 543)) + '</option>'; }).join('') + '<option value="-"' + (dayMon === '-' ? ' selected' : '') + '>ทั้งปีงบ</option></select></label>' +
      '<span class="grow"></span><span class="hint" style="margin:0">กดที่วันเพื่อดูใบเสร็จแต่ละใบ และยกเลิกใบที่ผิด</span></div>' +
      '<div class="card glass qr-mon"><span class="gl">รวม' + (dayMon === '-' ? 'ทั้งปีงบ' : 'เดือนนี้') + '</span><div class="qr-gsum">' + gt + '</div></div>' +
      '<div class="stagger">' + (cards || '<div class="empty"><b>ไม่มีใบเสร็จในเดือนนี้</b></div>') + '</div>';
    $('dayMon').onchange = function () { dayMon = this.value; renderDay(dv); };
    Array.prototype.forEach.call(dv.querySelectorAll('.qr-rcs[data-day]'), function (host) {
      var rcs = groupReceipts(byDay[dk[Number(host.getAttribute('data-day'))]]);
      Array.prototype.forEach.call(host.querySelectorAll('[data-cxr]'), function (b) { b.onclick = function () { cancelFlow(rcs[Number(b.getAttribute('data-cxr'))]); }; });
    });
  }

  /* ================= แพ็กเกจรับเงิน (ตั้งค่า: วางตารางจาก Excel แล้วจับคู่คอลัมน์กับประเภทเงิน) ================= */
  function openPackages() {
    var pk = S.st.packages || [], parsed = null;
    var m = openModal({
      title: 'แพ็กเกจรับเงิน', width: 980,
      body: '<p class="hint">แพ็กเกจ = ยอดรวมของใบเสร็จหนึ่งใบ แบ่งเข้าประเภทเงินใดเท่าใด · ตอนบันทึกใบเสร็จ ใส่ยอดรวมแล้วระบบเสนอแพ็กเกจให้ (ยอดเท่ากันแต่ต่างรายการได้ — เลือกเองหรือแก้ทีละบรรทัดได้)</p>' +
        '<div class="qr-pkcur">ตอนนี้มีแพ็กเกจ <b>' + pk.length + '</b> แบบ' + (pk.length ? ' (ยอด ' + money(pk[0][0]) + ' – ' + money(pk[pk.length - 1][0]) + ' บาท)' : ' — ยังไม่ได้ตั้งค่า') + '</div>' +
        '<label class="f">วางตารางแพ็กเกจจาก Excel (หัวตาราง: รวม | … | ชื่อประเภทเงินแต่ละคอลัมน์)<textarea id="kpText" rows="5" placeholder="คัดลอกทั้งตาราง รวมแถวหัวตาราง แล้ววางที่นี่ (Ctrl+V)"></textarea></label>' +
        '<div id="kpMap"></div>',
      footer: '<button class="btn ghost" type="button" data-close>ปิด</button><button class="btn" type="button" id="kpSave" disabled>บันทึกแพ็กเกจ (แทนที่ของเดิมทั้งหมด)</button>'
    });
    var el = m.el, ta = el.querySelector('#kpText'), host = el.querySelector('#kpMap'), t0 = 0;
    function typeSel(i, cur) {
      return '<select data-ci="' + i + '"><option value="">— ไม่ใช้คอลัมน์นี้ —</option>' + S.st.types.filter(function (t) { return t[4] !== 'ไม่ใช่'; }).map(function (t) { return '<option value="' + esc(t[0]) + '"' + (t[0] === cur ? ' selected' : '') + '>' + esc(t[1]) + '</option>'; }).join('') + '</select>';
    }
    function build() {
      if (!parsed) return [];
      var out = [], seen = {};
      parsed.rows.forEach(function (r) {
        var items = r.items.filter(function (it) { return parsed.cols[it.ci].type; }).map(function (it) { return { type: parsed.cols[it.ci].type, amount: it.amount }; });
        var s = Math.round(items.reduce(function (a, b) { return a + b.amount * 100; }, 0));
        r.ok = items.length && s === Math.round(r.total * 100) && items.length === r.items.length;
        if (r.ok) { var k = r.total + '|' + items.map(function (x) { return x.type + '=' + x.amount; }).sort().join(';'); if (!seen[k]) { seen[k] = 1; out.push({ total: r.total, items: items }); } }
      });
      return out;
    }
    function refreshStat() {
      var good = build(), bad = parsed.rows.filter(function (r) { return !r.ok; }).length, byTot = {}; good.forEach(function (g) { byTot[g.total] = (byTot[g.total] || 0) + 1; });
      var same = Object.keys(byTot).filter(function (k) { return byTot[k] > 1; }).length;
      el.querySelector('#kpStat').innerHTML = '<span class="qe-tag ok">พร้อมบันทึก ' + good.length + ' แพ็กเกจ</span>' + (same ? ' ยอดเดียวกันแต่ต่างรายการ ' + same + ' ยอด (ตอนบันทึกใบเสร็จจะให้เลือก)' : '') + (bad ? ' · <em class="qe-miss">ข้าม ' + bad + ' แถว (คอลัมน์ที่มียอดยังไม่ได้จับคู่ หรือผลรวมไม่เท่ายอดรวม)</em>' : '');
      el.querySelector('#kpSave').disabled = !good.length; el.querySelector('#kpSave').textContent = 'บันทึก ' + good.length + ' แพ็กเกจ (แทนที่ของเดิมทั้งหมด)';
    }
    function parse() {
      var res = Paste.packageRows(Paste.parseTSV(ta.value), { types: S.st.types, aliases: S.st.aliases || [] });
      if (!ta.value.trim()) { host.innerHTML = ''; parsed = null; el.querySelector('#kpSave').disabled = true; return; }
      if (!res || !res.rows.length) { host.innerHTML = '<p class="qe-miss">ไม่พบหัวตาราง "รวม" หรือไม่มีแถวข้อมูล — คัดลอกให้มีแถวหัวตารางที่เริ่มด้วยคำว่า "รวม"</p>'; parsed = null; el.querySelector('#kpSave').disabled = true; return; }
      parsed = res;
      var used = {}; res.rows.forEach(function (r) { r.items.forEach(function (it) { used[it.ci] = 1; }); });
      host.innerHTML = '<div class="qr-map"><h4>จับคู่คอลัมน์กับประเภทเงิน</h4><div class="qr-maprows">' + res.cols.filter(function (c, i) { return used[i]; }).map(function (c) { var i = res.cols.indexOf(c);
        return '<label class="qr-mr' + (c.type ? '' : ' un') + '"><span>' + esc(c.label) + '</span>' + typeSel(i, c.type) + '</label>'; }).join('') + '</div></div><div class="qr-pkstat" id="kpStat" aria-live="polite"></div>';
      Array.prototype.forEach.call(host.querySelectorAll('select[data-ci]'), function (s) {
        s.onchange = function () { parsed.cols[Number(s.getAttribute('data-ci'))].type = s.value; s.closest('.qr-mr').classList.toggle('un', !s.value); refreshStat(); };
      });
      refreshStat();
    }
    ta.addEventListener('input', function () { clearTimeout(t0); t0 = setTimeout(parse, 150); });
    el.querySelector('#kpSave').onclick = function () {
      var good = build(); if (!good.length) return;
      busy(this, api('savePackages', { rows: good })).then(function (r) { return reloadSettings().then(function () { m.close(); toast('บันทึกแพ็กเกจ ' + r.saved + ' แบบแล้ว', 'good'); if (S.tab === 'income') Receipts.render($('view'), null); }); }).catch(handleError);
    };
  }

  var STATUS_TXT = { 'new': ['ใหม่', 'paid'], same: ['มีแล้ว', 'cancel'], changed: ['ต่างจากเดิม', 'wait'], error: ['ผิดพลาด', 'bad'] };
  function showPreview(prev) {
    var pv = pasted.pv, c = pv.count;
    var h = '<div class="pvsum"><span class="badge paid">ใหม่ ' + c['new'] + '</span><span class="badge cancel">มีแล้ว ' + c.same + '</span>' +
      '<span class="badge wait">ต่างจากเดิม ' + c.changed + '</span><span class="badge bad">ผิดพลาด ' + c.error + '</span>' +
      (pasted.skipped ? '<span class="hint" style="margin:0">ข้าม ' + pasted.skipped + ' แถวที่ไม่ใช่ใบเสร็จ</span>' : '') + '</div>' +
      '<div class="pvtable"><table><thead><tr><th>#</th><th>สถานะ</th><th>วันที่</th><th>เล่ม/เลขที่</th><th>ประเภท</th><th>วิธี</th><th class="r">จำนวน</th><th>หมายเหตุ</th></tr></thead><tbody>' +
      pv.rows.map(function (r) {
        var s = STATUS_TXT[r.status];
        return '<tr class="' + r.status + '"><td>' + r.n + '</td><td><span class="badge ' + s[1] + '">' + s[0] + '</span></td><td>' + (r.date ? esc(thaiDate(r.date)) : '') + '</td><td>' + esc(r.book) + '/' + esc(r.no) + '</td><td>' +
          esc(r.type ? typeName(r.type) : '') + '</td><td>' + esc(r.method) + '</td><td class="r money">' + (r.amount == null ? '' : money(r.amount)) + '</td><td>' + esc(r.msg) + '</td></tr>';
      }).join('') + '</tbody></table></div>' +
      (c.changed ? '<label class="chk"><input type="checkbox" id="rUpd"> อัปเดตใบที่ต่างจากเดิม ' + c.changed + ' ใบ ให้เป็นตามที่วาง</label>' : '') +
      '<div class="actions"><button class="btn" type="button" id="rCommit">บันทึก' + (c.error ? 'เฉพาะแถวที่ถูกต้อง' : '') + '</button><button class="link" type="button" id="rClear">ล้างข้อมูลที่วาง</button></div>';
    prev.innerHTML = h;
    prev.querySelector('#rClear').onclick = function () { pasted = null; prev.innerHTML = ''; var t = $('rPaste'); if (t) t.value = ''; };
    prev.querySelector('#rCommit').onclick = function () {
      var upd = !!(prev.querySelector('#rUpd') && prev.querySelector('#rUpd').checked);
      if (!c['new'] && !(upd && c.changed)) { toast('ไม่มีแถวใหม่ให้บันทึก' + (c.changed ? ' (ติ๊ก "อัปเดต" ถ้าต้องการแก้ใบเดิม)' : ''), 'err'); return; }
      busy(this, api('importReceipts', { items: pasted.items, commit: true, updateChanged: upd })).then(function (r) {
        pasted = null;
        toast('บันทึกใหม่ ' + r.added + (r.updated ? ' · อัปเดต ' + r.updated : '') + ' ใบเสร็จแล้ว', 'good');
        return refresh();
      }).catch(handleError);
    };
    prev.scrollIntoView({ block: 'nearest', behavior: REDUCE ? 'auto' : 'smooth' });
  }

  /* ================= สรุปรายเดือน ================= */
  function renderSum(dv) {
    var lv = live();
    if (!lv.length) { dv.innerHTML = '<div class="empty"><b>ยังไม่มีใบเสร็จในปีงบนี้</b>' + (can.fin() ? 'เริ่มจากแท็บ "บันทึกรายรับ"' : '') + '</div>'; return; }
    var by = {}, keys = [];
    lv.forEach(function (r) { var k = String(r[3]).slice(0, 7); if (!by[k]) { by[k] = []; keys.push(k); } by[k].push(r); });
    keys.sort().reverse();
    dv.innerHTML = '<div class="stagger">' + keys.map(function (k, i) {
      var list = by[k], days = {}, dk = [];
      list.forEach(function (r) { if (!days[r[3]]) { days[r[3]] = []; dk.push(r[3]); } days[r[3]].push(r); });
      dk.sort().reverse();
      return '<details class="card glass mon"' + (i === 0 ? ' open' : '') + ' style="--i:' + Math.min(i, 12) + '"><summary><b>' + esc(MONTHS_L[Number(k.slice(5)) - 1] + ' ' + (Number(k.slice(0, 4)) + 543)) + '</b>' +
        '<span class="meta">' + list.length + ' รายการ</span><span class="sp"></span><span class="money tot">' + money(amountOf(list)) + '</span></summary>' +
        '<div class="mrow head"><span>วันที่</span><span class="r">เงินสด</span><span class="r">เงินโอน</span><span class="r">รวม</span></div>' +
        dk.map(function (d) {
          return '<div class="mrow"><span>' + esc(thaiDate(d)) + '</span><span class="r money">' + moneyCell(methodSum(days[d], 'สด')) + '</span><span class="r money">' + moneyCell(methodSum(days[d], 'โอน')) +
            '</span><span class="r money"><b>' + money(amountOf(days[d])) + '</b></span></div>';
        }).join('') +
        '<div class="mrow foot"><span>รวมเดือน</span><span class="r money">' + money(methodSum(list, 'สด')) + '</span><span class="r money">' + money(methodSum(list, 'โอน')) + '</span><span class="r money">' + money(amountOf(list)) + '</span></div></details>';
    }).join('') + '</div>';
  }

  /* ================= รายการใบเสร็จ ================= */
  function renderList(dv) {
    var all = rows().slice().sort(function (a, b) { return a[3] < b[3] ? 1 : a[3] > b[3] ? -1 : 0; });
    var ql = q.toLowerCase();
    var list = all.filter(function (r) {
      return !ql || (r[0] + '/' + r[1] + ' ' + r[4] + ' ' + typeName(r[5]) + ' ' + r[6] + ' ' + r[7] + ' ' + r[3]).toLowerCase().indexOf(ql) >= 0;
    });
    var h = '<div class="toolbar"><input class="grow" type="search" id="rq" placeholder="ค้นหา เล่ม/เลขที่ / ผู้ชำระ / ประเภทเงิน" value="' + esc(q) + '" aria-label="ค้นหา"></div>';
    if (!list.length) h += '<div class="empty"><b>' + (all.length ? 'ไม่พบใบเสร็จที่ตรงเงื่อนไข' : 'ยังไม่มีใบเสร็จในปีงบนี้') + '</b></div>';
    else h += '<div class="rows stagger">' + list.slice(0, 300).map(function (r, i) {
      return '<div class="row rrow' + (r[8] ? ' cancelled' : '') + '" style="--i:' + Math.min(i, 12) + '"><span class="no">' + esc(r[0]) + '/' + esc(r[1]) + (Number(r[2]) > 1 ? '.' + esc(r[2]) : '') + '</span>' +
        '<span><span class="who2">' + esc(typeName(r[5])) + '</span><br><span class="tag">' + esc(thaiDate(r[3])) + ' · ' + esc(r[6]) + (r[4] ? ' · ' + esc(r[4]) : '') + (r[8] ? ' · ' + esc(r[9] || 'ยกเลิก') : '') + '</span></span>' +
        '<span class="amt">' + money(r[7]) + '</span>' +
        (can.fin() && !r[8] ? '<button class="btn ghost sm" type="button" data-cx="' + i + '">ยกเลิก</button>' : '<span>' + (r[8] ? '<span class="badge cancel">ยกเลิก</span>' : '') + '</span>') + '</div>';
    }).join('') + (list.length > 300 ? '<p class="hint">แสดง 300 รายการแรก — ใช้ช่องค้นหาเพื่อกรอง</p>' : '') + '</div>';
    dv.innerHTML = h;
    $('rq').oninput = function () { q = this.value; var pos = this.selectionStart; renderList(dv); var e = $('rq'); e.focus(); e.setSelectionRange(pos, pos); };
    Array.prototype.forEach.call(dv.querySelectorAll('[data-cx]'), function (b) {
      b.onclick = function () {
        var r = list[Number(b.getAttribute('data-cx'))];
        askReason('ยกเลิกใบเสร็จ เล่ม ' + r[0] + ' เลขที่ ' + r[1] + ' (ทุกบรรทัดของใบนี้)', 'ยืนยันยกเลิก', function (reason, am, btn) {
          busy(btn, api('cancelReceipt', { book: r[0], no: r[1], reason: reason })).then(function () {
            am.close(); toast('ยกเลิกใบเสร็จแล้ว', 'good'); return refresh();
          }).catch(handleError);
        });
      };
    });
  }

  return { render: render, leave: leave, openPackages: openPackages };
})();
