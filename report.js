/* ระบบการเงินโรงเรียน — report.js
   หน้าภาพรวม = รายงานสรุป: รายวัน · รายเดือน · ยอดคงเหลือ · บัญชีแยกประเภท
   ทุกตัวเลขมาจาก Ledger ชุดเดียว (action getLedger) ไม่คำนวณจากแหล่งอื่น */

var Report = (function () {
  var tab = 'day', month = '', ledType = '', ledStore = '', host = null;

  function rows() { return (S.led && S.led.rows) || []; }
  function sat(v) { return Math.round(v * 100); }
  function storeKind(id) { var s = S.st.stores.filter(function (x) { return x[0] === id; })[0]; return s ? s[2] : ''; }
  function monthsOfFy() {
    var out = [], d = new Date(S.st.fyStart + 'T00:00:00');
    for (var i = 0; i < 12; i++) {
      var x = new Date(d.getFullYear(), d.getMonth() + i, 1);
      out.push({ key: x.getFullYear() + '-' + ('0' + (x.getMonth() + 1)).slice(-2), name: MONTHS_L[x.getMonth()] + ' ' + (x.getFullYear() + 543), short: MONTHS[x.getMonth()] });
    }
    return out;
  }
  function lastDay(key) { var y = Number(key.slice(0, 4)), m = Number(key.slice(5)); return new Date(y, m, 0).getDate(); }
  /** ยอดยกมา + รายการที่ไม่ใช่ยกมาก่อนวันที่ */
  function carryBefore(date) {
    var s = 0;
    rows().forEach(function (r) { if (r[2] === 'ยอดยกมา' || r[0] < date) s += sat(r[5]); });
    return s;
  }
  function seg(id, label) { return '<button type="button" data-rs="' + id + '" aria-pressed="' + (tab === id) + '">' + esc(label) + '</button>'; }
  function cell(v, cls) { return '<td class="money' + (cls ? ' ' + cls : '') + '">' + (v === 0 ? '<span class="zero">–</span>' : money(v / 100)) + '</td>'; }

  function mount(el) {
    host = el;
    if (!month) month = (S.date || defaultDate()).slice(0, 7);
    host.innerHTML = '<div class="seg glass rseg" role="group" aria-label="รายงาน">' + seg('day', 'รายวัน') + seg('month', 'รายเดือน') + seg('bal', 'ยอดคงเหลือ') + seg('led', 'บัญชีแยกประเภท') + '</div><div id="rbody" class="view-in"></div>';
    Array.prototype.forEach.call(host.querySelectorAll('[data-rs]'), function (b) {
      b.onclick = function () { setTab(b.getAttribute('data-rs')); };
    });
    load().then(draw);
  }
  function load() {
    if (S.led) return Promise.resolve();
    $('rbody').innerHTML = '<div class="skel"></div>';
    return api('getLedger').then(function (d) { S.led = d; }).catch(function (e) { $('rbody').innerHTML = '<div class="err-box"><b>แสดงรายงานไม่ได้</b><br>' + esc(e.message) + '</div>'; throw e; });
  }
  function setTab(id) {
    if (id === tab) return;
    var run = function () {
      tab = id;
      Array.prototype.forEach.call(host.querySelectorAll('[data-rs]'), function (b) { b.setAttribute('aria-pressed', String(b.getAttribute('data-rs') === tab)); });
      var b = $('rbody'); b.className = ''; void b.offsetWidth; b.className = 'view-in';
      draw();
    };
    if (document.startViewTransition && !REDUCE) { try { document.startViewTransition(run); return; } catch (e) {} }
    run();
  }
  function draw() {
    if (!$('rbody')) return;
    if (window.Bento) Bento.unmount();
    if (tab === 'day') drawDay(); else if (tab === 'month') drawMonth(); else if (tab === 'bal') drawBal(); else drawLed();
    observeReveal();
  }

  /* ---------- รายวัน ---------- */
  function monthSelect(id) {
    return '<label class="f inl">เดือน<select id="' + id + '">' + monthsOfFy().map(function (m) { return '<option value="' + m.key + '"' + (m.key === month ? ' selected' : '') + '>' + esc(m.name) + '</option>'; }).join('') + '</select></label>';
  }
  function drawDay() {
    var start = month + '-01', n = lastDay(month), end = month + '-' + ('0' + n).slice(-2), carry = carryBefore(start), by = {}, days = [];
    for (var i = 1; i <= n; i++) days.push(month + '-' + ('0' + i).slice(-2));
    rows().forEach(function (r) {
      if (r[2] === 'ยอดยกมา' || r[0] < start || r[0] > end) return;
      var o = by[r[0]] || (by[r[0]] = { cash: 0, bank: 0, pay: 0 });
      if (r[2] === 'รับ') { if (storeKind(r[4]) === 'เงินสด') o.cash += sat(r[5]); else o.bank += sat(r[5]); } else o.pay += -sat(r[5]);
    });
    var run = carry, tc = 0, tb = 0, tp = 0, body = '', rc = [], pd = [];
    days.forEach(function (d) {
      var o = by[d] || { cash: 0, bank: 0, pay: 0 }; rc.push((o.cash + o.bank) / 100); pd.push(o.pay / 100);
      if (!by[d]) return;
      var inn = o.cash + o.bank, net = inn - o.pay; run += net; tc += o.cash; tb += o.bank; tp += o.pay;
      body += '<tr><td>' + esc(thaiDate(d)) + '</td>' + cell(o.cash) + cell(o.bank) + cell(inn, 'b') + cell(o.pay, 'neg') + cell(net, net < 0 ? 'neg' : '') + '<td class="money"><b>' + money(run / 100) + '</b></td></tr>';
    });
    var h = '<section class="card glass reveal"><div class="rhead"><h2>รายงานรายวัน</h2>' + monthSelect('rMonth') + '</div>' +
      '<div class="rsum"><div><span>ยกมาต้นเดือน</span><b class="money">' + money(carry / 100) + '</b></div><div><span>รับ</span><b class="money g">' + money((tc + tb) / 100) + '</b></div><div><span>จ่าย</span><b class="money r">' + money(tp / 100) + '</b></div><div><span>คงเหลือปลายเดือน</span><b class="money">' + money(run / 100) + '</b></div></div>' +
      '<div class="bpanel tall" id="rChart"></div>' +
      (body ? '<div class="tablewrap"><table class="rt"><thead><tr><th>วันที่</th><th class="money">รับเงินสด</th><th class="money">รับโอน/บัญชี</th><th class="money">รวมรับ</th><th class="money">จ่าย</th><th class="money">สุทธิ</th><th class="money">คงเหลือสิ้นวัน</th></tr></thead><tbody>' + body +
        '<tr class="sum-row"><td>รวมเดือน</td>' + cell(tc) + cell(tb) + cell(tc + tb, 'b') + cell(tp, 'neg') + cell(tc + tb - tp) + '<td class="money">' + money(run / 100) + '</td></tr></tbody></table></div>'
        : '<div class="empty"><b>เดือนนี้ยังไม่มีรายการรับ/จ่าย</b>เลือกเดือนอื่น หรือบันทึกใบเสร็จ / การจ่าย</div>') + '</section>';
    $('rbody').innerHTML = h;
    $('rMonth').onchange = function () { month = this.value; drawDay(); observeReveal(); };
    if (window.Bento && body) Bento.waves($('rChart'), days, rc, pd); else $('rChart').style.display = 'none';
  }

  /* ---------- รายเดือน ---------- */
  function drawMonth() {
    var ms = monthsOfFy(), total = { r: 0, p: 0 }, body = '', rc = [], pd = [], run0 = 0;
    rows().forEach(function (r) { if (r[2] === 'ยอดยกมา') run0 += sat(r[5]); });
    var run = run0;
    ms.forEach(function (m) {
      var r0 = 0, p0 = 0;
      rows().forEach(function (r) { if (r[2] !== 'ยอดยกมา' && r[0].slice(0, 7) === m.key) { if (r[2] === 'รับ') r0 += sat(r[5]); else p0 += -sat(r[5]); } });
      var begin = run; run += r0 - p0; total.r += r0; total.p += p0; rc.push(r0 / 100); pd.push(p0 / 100);
      body += '<tr' + (m.key === (S.date || '').slice(0, 7) ? ' class="now"' : '') + '><td>' + esc(m.name) + '</td><td class="money">' + money(begin / 100) + '</td>' + cell(r0, 'b') + cell(p0, 'neg') + cell(r0 - p0, r0 - p0 < 0 ? 'neg' : '') + '<td class="money"><b>' + money(run / 100) + '</b></td></tr>';
    });
    var h = '<section class="card glass reveal"><div class="rhead"><h2>รายงานรายเดือน ปีงบ ' + esc(S.st.fy) + '</h2></div>' +
      '<div class="rsum"><div><span>ยกมาต้นปีงบ</span><b class="money">' + money(run0 / 100) + '</b></div><div><span>รับทั้งปีงบ</span><b class="money g">' + money(total.r / 100) + '</b></div><div><span>จ่ายทั้งปีงบ</span><b class="money r">' + money(total.p / 100) + '</b></div><div><span>คงเหลือ</span><b class="money">' + money(run / 100) + '</b></div></div>' +
      '<div class="bpanel tall" id="rChart"></div>' +
      '<div class="tablewrap"><table class="rt"><thead><tr><th>เดือน</th><th class="money">ยกมา</th><th class="money">รับ</th><th class="money">จ่าย</th><th class="money">สุทธิ</th><th class="money">คงเหลือปลายเดือน</th></tr></thead><tbody>' + body +
      '<tr class="sum-row"><td>รวมปีงบ</td><td class="money">' + money(run0 / 100) + '</td>' + cell(total.r, 'b') + cell(total.p, 'neg') + cell(total.r - total.p) + '<td class="money">' + money(run / 100) + '</td></tr></tbody></table></div></section>';
    $('rbody').innerHTML = h;
    var nowKey = (S.date || '').slice(0, 7);
    if (window.Bento) Bento.bars($('rChart'), ms.map(function (m) { return m.short; }), rc, pd, ms.map(function (m) { return m.key; }).indexOf(nowKey));
  }

  /* ---------- ยอดคงเหลือ (ประเภท × ที่เก็บ) ---------- */
  function drawBal() {
    $('rbody').innerHTML = '<section class="card glass"><div class="rhead"><h2>ยอดคงเหลือ ณ วันที่เลือก</h2><label class="f inl">วันที่<input type="date" id="rDate" value="' + esc(S.date) + '" min="' + esc(S.st.fyStart) + '" max="' + esc(S.st.fyEnd) + '"></label></div><div id="ov"><div class="skel"></div></div></section>';
    $('rDate').onchange = function () { if (this.value) { S.date = this.value; fetchBalances(); } };
    if (S.bal && S.bal.date === S.date) renderBalanceTable(S.bal); else fetchBalances();
  }

  /* ---------- บัญชีแยกประเภท ---------- */
  function drawLed() {
    var types = S.st.types;
    if (!ledType) ledType = (types.filter(function (t) { return rows().some(function (r) { return r[3] === t[0]; }); })[0] || types[0] || [''])[0];
    var groups = {}, order = [];
    types.forEach(function (t) { var g = t[2] || 'อื่น ๆ'; if (!groups[g]) { groups[g] = []; order.push(g); } groups[g].push(t); });
    var sel = '<select id="rType">' + order.map(function (g) { return '<optgroup label="' + esc(g) + '">' + groups[g].map(function (t) { return '<option value="' + esc(t[0]) + '"' + (t[0] === ledType ? ' selected' : '') + '>' + esc(t[1]) + '</option>'; }).join('') + '</optgroup>'; }).join('') + '</select>';
    var ssel = '<select id="rStore"><option value="">ทุกที่เก็บ</option>' + S.st.stores.map(function (s) { return '<option value="' + esc(s[0]) + '"' + (s[0] === ledStore ? ' selected' : '') + '>' + esc(s[1]) + '</option>'; }).join('') + '</select>';
    var list = rows().filter(function (r) { return r[3] === ledType && (!ledStore || r[4] === ledStore); });
    list.sort(function (a, b) { return (a[2] === 'ยอดยกมา' ? 0 : 1) - (b[2] === 'ยอดยกมา' ? 0 : 1) || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0); });
    var run = 0, tr = 0, tp = 0, body = '';
    list.forEach(function (r) {
      var a = sat(r[5]), inn = a > 0 ? a : 0, out = a < 0 ? -a : 0; run += a; tr += inn; tp += out;
      body += '<tr' + (r[2] === 'ยอดยกมา' ? ' class="open"' : '') + '><td>' + esc(thaiDate(r[0])) + '</td><td class="doc">' + esc(r[1]) + (ledStore ? '' : ' <small>· ' + esc(storeName(r[4])) + '</small>') + '</td>' + cell(inn, 'b') + cell(out, 'neg') + '<td class="money"><b>' + money(run / 100) + '</b></td></tr>';
    });
    $('rbody').innerHTML = '<section class="card glass reveal"><div class="rhead"><h2>บัญชีแยกประเภท</h2><div class="rfil"><label class="f inl">ประเภทเงิน' + sel + '</label><label class="f inl">ที่เก็บ' + ssel + '</label></div></div>' +
      '<div class="rsum"><div><span>รวมรับ (รวมยกมา)</span><b class="money g">' + money(tr / 100) + '</b></div><div><span>รวมจ่าย</span><b class="money r">' + money(tp / 100) + '</b></div><div><span>คงเหลือ</span><b class="money">' + money(run / 100) + '</b></div><div><span>จำนวนรายการ</span><b class="money">' + list.length + '</b></div></div>' +
      (list.length ? '<div class="tablewrap"><table class="rt led"><thead><tr><th>วันที่</th><th>เอกสารต้นทาง</th><th class="money">รับ / เพิ่ม</th><th class="money">จ่าย</th><th class="money">คงเหลือ</th></tr></thead><tbody>' + body +
        '<tr class="sum-row"><td colspan="2">รวม</td>' + cell(tr, 'b') + cell(tp, 'neg') + '<td class="money">' + money(run / 100) + '</td></tr></tbody></table></div>'
        : '<div class="empty"><b>ประเภทเงินนี้ยังไม่มีรายการ</b>เลือกประเภทอื่น หรือบันทึกรับ/จ่ายก่อน</div>') + '</section>';
    $('rType').onchange = function () { ledType = this.value; drawLed(); observeReveal(); };
    $('rStore').onchange = function () { ledStore = this.value; drawLed(); observeReveal(); };
  }

  return { mount: mount, refreshBal: function () { if (tab === 'bal' && S.bal && $('ov')) renderBalanceTable(S.bal); } };
})();
