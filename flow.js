/* ระบบการเงินโรงเรียน — flow.js
   หน้าของโหมดครู (ส่งคำขอเบิก + ติดตามสถานะ) และโหมดผู้บริหาร (อนุมัติ / ส่งกลับ ขบ.)
   สายงาน: ครูส่ง ขบ. → ผู้บริหารอนุมัติ → การเงินรับเรื่อง → ออก ขจ. → จ่ายเงิน */

var Flow = (function () {
  var tFilt = 'all', picked = {};

  function khbs() { return (S.docs && S.docs.khbs) || []; }
  function badge(t, cls) { return '<span class="badge ' + (cls || '') + '">' + esc(t) + '</span>'; }
  var FLOW_CLS = { 'รออนุมัติ': 'appr', 'ส่งกลับแก้ไข': 'back', 'อนุมัติแล้ว': 'ok', 'รับเรื่องแล้ว': 'wait' };

  /** ขั้นปัจจุบันของคำขอ (0..5) และข้อมูลแต่ละขั้น */
  function progress(h) {
    var sent = null, appr = null, back = null, take = null;
    (h.steps || []).forEach(function (s) {
      if (s.step === 'ส่ง') { sent = s; appr = null; back = null; take = null; }
      else if (s.step === 'อนุมัติ') appr = s;
      else if (s.step === 'ส่งกลับ') back = s;
      else if (s.step === 'รับเรื่อง') take = s;
    });
    var legacy = !(h.steps || []).length, n = h.lines.length, inKhj = 0, paid = 0, khjNos = {}, lastPaid = '';
    h.lines.forEach(function (l) {
      if (l.khjNo) { inKhj++; khjNos[l.khjNo] = true; }
      if (l.state === 'จ่ายแล้ว') { paid++; if (l.paidDate > lastPaid) lastPaid = l.paidDate; }
    });
    var at = h.flow === 'รออนุมัติ' ? 1 : h.flow === 'ส่งกลับแก้ไข' ? 1 : h.flow === 'อนุมัติแล้ว' ? 2 : !inKhj ? 3 : paid < n ? 4 : 5;
    return { at: at, back: h.flow === 'ส่งกลับแก้ไข' ? back : null, sent: sent, appr: appr, take: take, legacy: legacy, n: n, inKhj: inKhj, paid: paid,
      khj: Object.keys(khjNos).map(function (k) { return 'ขจ.' + k; }).join(', '), lastPaid: lastPaid };
  }
  /** แถบขั้นตอน 5 ขั้น: ส่งคำขอ → ผู้บริหารอนุมัติ → การเงินรับเรื่อง → ออก ขจ. → ได้รับเงิน */
  function stepper(h) {
    var p = progress(h), st = Docs.stampText;
    var items = [
      ['ส่งคำขอ', p.sent ? st(p.sent.at) : thaiDate(h.date)],
      [p.back ? 'ส่งกลับให้แก้' : 'ผู้บริหารอนุมัติ', p.back ? st(p.back.at) : p.appr ? st(p.appr.at) : ''],
      ['การเงินรับเรื่อง', p.take ? st(p.take.at) : ''],
      ['ออก ขจ.', p.khj],
      ['ได้รับเงิน', p.paid ? (p.paid < p.n ? p.paid + '/' + p.n + ' รายการ' : thaiDate(p.lastPaid)) : '']
    ];
    return '<ol class="stp' + (p.back ? ' is-back' : '') + '" aria-label="ความคืบหน้า">' + items.map(function (x, i) {
      var cls = i < p.at ? 'done' : i === p.at ? (p.back && i === 1 ? 'back' : 'cur') : '';
      if (p.at === 5 && i === 4) cls = 'done';
      return '<li class="' + cls + '"' + (cls === 'cur' ? ' aria-current="step"' : '') + '><i aria-hidden="true"></i><b>' + esc(x[0]) + '</b><small>' + esc(x[1] || (cls === 'cur' ? 'กำลังดำเนินการ' : '')) + '</small></li>';
    }).join('') + '</ol>';
  }
  function linesBrief(h, max) {
    var names = h.lines.map(function (l) { return l.payee; });
    return names.slice(0, max).join(', ') + (names.length > max ? ' และอีก ' + (names.length - max) + ' รายการ' : '');
  }
  function daysWaiting(h) {
    var p = progress(h), at = p.sent ? String(p.sent.at).slice(0, 10) : h.date;
    return /^\d{4}-\d{2}-\d{2}$/.test(at) ? Math.max(0, daysBetween(at, todayISO())) : 0;
  }
  function done(h) { return h.status !== 'ยกเลิก' && progress(h).at === 5; }

  /* ================= โหมดครู ================= */
  function teacher(v, opt) {
    var list = myKhbs(), c = { appr: 0, back: 0, doing: 0, done: 0 }, unpaid = 0;
    list.forEach(function (h) {
      if (h.status === 'ยกเลิก') return;
      var k = h.flow === 'รออนุมัติ' ? 'appr' : h.flow === 'ส่งกลับแก้ไข' ? 'back' : done(h) ? 'done' : 'doing';
      c[k]++;
      h.lines.forEach(function (l) { if (l.state !== 'จ่ายแล้ว') unpaid += Math.round(l.net * 100); });
    });
    function tile(f, label, n, sub) { return '<button class="tile' + (tFilt === f ? ' on' : '') + '" type="button" data-tf="' + f + '"><div class="k">' + esc(label) + '</div><div class="v">' + n + ' <small>ฉบับ</small></div><div class="s">' + esc(sub) + '</div></button>'; }
    v.innerHTML = '<section class="hero">' + heroDeco('request') +
      '<div class="lbl">คำขอเบิกของฉัน · ' + esc(S.me.name) + '</div>' +
      '<div class="big money">' + money(unpaid / 100) + '</div><div class="sub">ยอดที่ขอเบิกแล้ว ยังไม่ได้รับเงิน</div>' +
      '<div class="tiles t4">' + tile('appr', 'รอผู้บริหารอนุมัติ', c.appr, 'แก้ไขได้ระหว่างรอ') + tile('back', 'ส่งกลับให้แก้', c.back, c.back ? 'แก้แล้วส่งใหม่ได้เลย' : 'ไม่มี') +
      tile('doing', 'กำลังดำเนินการ', c.doing, 'การเงินกำลังทำจ่าย') + tile('done', 'ได้รับเงินแล้ว', c.done, 'ครบทุกรายการ') + '</div></section>' +
      '<section class="cta glass reveal"><div><h2>ขอเบิกเงิน</h2><p class="hint">กรอกผู้รับเงิน จำนวน และประเภทเงิน ส่งแล้วผู้บริหารเห็นทันที ไม่ต้องเดินเอกสาร · ติดตามได้ทุกขั้นจากหน้านี้</p></div>' +
      '<button class="btn big" type="button" id="rqNew">' + ICON.plus + ' ขอเบิกเงินใหม่</button></section>' +
      '<div class="fchips rqf" role="group" aria-label="กรอง">' + [['all', 'ทั้งหมด'], ['appr', 'รออนุมัติ'], ['back', 'ส่งกลับ'], ['doing', 'กำลังดำเนินการ'], ['done', 'ได้รับเงินแล้ว'], ['cancel', 'ยกเลิก']].map(function (x) {
        return '<button type="button" class="fchip" data-tf="' + x[0] + '" aria-pressed="' + (tFilt === x[0]) + '">' + x[1] + '</button>';
      }).join('') + '</div><div id="rqList" class="rqlist"></div>';
    drawRequests(list);
    Array.prototype.forEach.call(v.querySelectorAll('[data-tf]'), function (b) { b.onclick = function () { var f = b.getAttribute('data-tf'); tFilt = tFilt === f && f !== 'all' ? 'all' : f; teacher(v, null); }; });
    $('rqNew').onclick = function () { Docs.openKhb(null); };
    if (opt && opt.draft) Docs.openKhb(null);
  }
  function drawRequests(list) {
    var box = $('rqList');
    var show = list.filter(function (h) {
      if (tFilt === 'all') return true;
      if (tFilt === 'cancel') return h.status === 'ยกเลิก';
      if (h.status === 'ยกเลิก') return false;
      if (tFilt === 'appr') return h.flow === 'รออนุมัติ';
      if (tFilt === 'back') return h.flow === 'ส่งกลับแก้ไข';
      if (tFilt === 'done') return done(h);
      return h.flow !== 'รออนุมัติ' && h.flow !== 'ส่งกลับแก้ไข' && !done(h);
    });
    if (!show.length) {
      box.innerHTML = '<div class="empty"><b>' + (list.length ? 'ไม่มีคำขอในกลุ่มนี้' : 'ยังไม่มีคำขอเบิก') + '</b>' + (list.length ? 'กด "ทั้งหมด" เพื่อดูคำขอทุกฉบับ' : 'กด "ขอเบิกเงินใหม่" เพื่อเริ่มฉบับแรก') + '</div>';
      return;
    }
    box.innerHTML = show.map(function (h, i) {
      var p = progress(h), cancel = h.status === 'ยกเลิก', editable = !cancel && (h.flow === 'รออนุมัติ' || h.flow === 'ส่งกลับแก้ไข');
      return '<article class="rq glass reveal' + (cancel ? ' cancel' : '') + (p.back ? ' is-back' : '') + '" style="--i:' + Math.min(i, 10) + '">' +
        '<header><b class="no">ขบ.' + h.no + '/' + h.fy + '</b>' + (cancel ? badge('ยกเลิก', 'cancel') : done(h) ? badge('ได้รับเงินแล้ว', 'paid') : h.flow === 'รับเรื่องแล้ว' ? badge('การเงินกำลังทำจ่าย', 'in') : badge(h.flow, FLOW_CLS[h.flow])) +
        '<span class="meta">' + esc(thaiDate(h.date)) + '</span><span class="sp"></span><span class="money rq-amt">' + money(h.total.net) + '</span></header>' +
        '<p class="rq-sub">' + esc(h.note ? h.note + ' · ' : '') + esc(linesBrief(h, 3)) + '</p>' +
        (cancel ? '' : stepper(h)) +
        (p.back ? '<div class="rq-back"><b>ผู้บริหารส่งกลับ:</b> ' + esc(p.back.note) + '</div>' : '') +
        '<footer><button class="btn ghost sm" type="button" data-open="' + h.no + '">ดูรายละเอียด</button>' +
        (editable ? '<button class="btn ' + (p.back ? '' : 'soft ') + 'sm" type="button" data-open="' + h.no + '">' + (p.back ? 'แก้ไขแล้วส่งใหม่' : 'แก้ไข') + '</button>' : '') + '</footer></article>';
    }).join('');
    Array.prototype.forEach.call(box.querySelectorAll('[data-open]'), function (b) { b.onclick = function () { Docs.openKhb(Number(b.getAttribute('data-open'))); }; });
    observeReveal();
  }

  /* ================= โหมดผู้บริหาร ================= */
  var balCache = null;
  function exec(v) {
    var pend = khbs().filter(function (h) { return h.status !== 'ยกเลิก' && h.flow === 'รออนุมัติ'; })
      .sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : a.no - b.no; });
    var keys = {}; pend.forEach(function (h) { keys[h.no] = true; });
    Object.keys(picked).forEach(function (k) { if (!keys[k]) delete picked[k]; });
    var who = {}, today = todayISO(), decidedToday = 0, backs = 0, apprYear = 0, hist = [];
    pend.forEach(function (h) { who[h.owner] = true; });
    khbs().forEach(function (h) {
      if (h.status === 'ยกเลิก') return;
      if (h.flow === 'ส่งกลับแก้ไข') backs++;
      if (h.flow === 'อนุมัติแล้ว' || h.flow === 'รับเรื่องแล้ว') apprYear += Math.round(h.total.net * 100);
      (h.steps || []).forEach(function (s) {
        if (s.step !== 'อนุมัติ' && s.step !== 'ส่งกลับ') return;
        if (s.note.indexOf('อนุมัติบนกระดาษ') >= 0) return;
        if (String(s.at).slice(0, 10) === today) decidedToday++;
        hist.push({ h: h, s: s });
      });
    });
    hist.sort(function (a, b) { return a.s.at < b.s.at ? 1 : a.s.at > b.s.at ? -1 : 0; });
    var total = sumSat(pend, function (h) { return h.total.net; }), canAct = can.approve();
    v.innerHTML = '<section class="hero">' + heroDeco('approve') +
      '<div class="lbl">รอท่านพิจารณา</div>' +
      '<div class="big money">' + money(total) + '</div><div class="sub">' + (pend.length ? pend.length + ' ฉบับ จาก ' + Object.keys(who).length + ' คน · เรียงจากเรื่องที่รอนานที่สุด' : 'ไม่มีเรื่องรออนุมัติ') + '</div>' +
      '<div class="tiles t4"><div class="tile"><div class="k">รออนุมัติ</div><div class="v">' + pend.length + ' <small>ฉบับ</small></div><div class="s">ตัดสินใจได้จากหน้านี้</div></div>' +
      '<div class="tile"><div class="k">ตัดสินใจวันนี้</div><div class="v">' + decidedToday + ' <small>ฉบับ</small></div><div class="s">' + esc(thaiDateLong(today)) + '</div></div>' +
      '<div class="tile"><div class="k">ส่งกลับ รอผู้ขอแก้</div><div class="v">' + backs + ' <small>ฉบับ</small></div><div class="s">แก้แล้วจะกลับมาที่นี่</div></div>' +
      '<div class="tile"><div class="k">อนุมัติแล้วทั้งปีงบ</div><div class="v money">' + money(apprYear / 100) + '</div><div class="s">รวมที่การเงินกำลังทำจ่าย</div></div></div></section>' +
      (pend.length && canAct ? '<div class="apbar glass" id="apBar"><label class="chkline"><input type="checkbox" id="apAll"> เลือกทั้งหมด</label><span class="fstep" id="apSel"></span><span class="sp"></span><button class="btn" type="button" id="apMany" disabled>อนุมัติที่เลือก</button></div>' : '') +
      '<div id="apList" class="aplist"></div>' +
      '<section class="card glass reveal aphist"><h2>ตัดสินใจล่าสุด</h2><div id="apHist"></div></section>';
    drawPending(pend, canAct);
    $('apHist').innerHTML = hist.length ? '<ul class="hist">' + hist.slice(0, 8).map(function (x) {
      return '<li><span class="badge ' + (x.s.step === 'อนุมัติ' ? 'ok' : 'back') + '">' + esc(x.s.step === 'อนุมัติ' ? 'อนุมัติ' : 'ส่งกลับ') + '</span><b>ขบ.' + x.h.no + '</b><span>' + esc(personName(x.h.owner)) + ' · ' + money(x.h.total.net) + ' บาท</span>' +
        (x.s.note ? '<em>' + esc(x.s.note) + '</em>' : '') + '<small>' + esc(Docs.stampText(x.s.at)) + '</small></li>';
    }).join('') + '</ul>' : '<p class="hint">ยังไม่มีการตัดสินใจในปีงบนี้</p>';
    if (!balCache) api('getBalances', { date: defaultDate() }).then(function (d) { balCache = d; if (S.tab === 'approve') drawFunds(); }).catch(function () {});
    else drawFunds();
  }
  function drawPending(pend, canAct) {
    var box = $('apList');
    if (!pend.length) { box.innerHTML = '<div class="empty ok"><b>ไม่มีเรื่องค้าง</b>คำขอใหม่จากครูจะมาแสดงที่นี่ทันที</div>'; return; }
    box.innerHTML = pend.map(function (h, i) {
      var dw = daysWaiting(h), byT = {};
      h.lines.forEach(function (l) { byT[l.type] = (byT[l.type] || 0) + Math.round(l.net * 100); });
      return '<article class="ap glass reveal" data-no="' + h.no + '" style="--i:' + Math.min(i, 10) + '">' +
        (canAct ? '<label class="ap-chk" aria-label="เลือก ขบ.' + h.no + '"><input type="checkbox" data-pick="' + h.no + '"' + (picked[h.no] ? ' checked' : '') + '></label>' : '') +
        '<div class="ap-main"><header><b class="no">ขบ.' + h.no + '/' + h.fy + '</b>' + (dw >= 3 ? badge('รอ ' + dw + ' วัน', 'back') : dw ? badge('รอ ' + dw + ' วัน', 'appr') : badge('ส่งวันนี้', 'appr')) +
        '<span class="meta">' + esc(thaiDate(h.date)) + '</span><span class="sp"></span><span class="money ap-amt">' + money(h.total.net) + '</span></header>' +
        '<p class="ap-who"><b>' + esc(personName(h.owner)) + '</b>' + (h.note ? ' · ' + esc(h.note) : '') + '</p>' +
        '<table class="ap-lines"><tbody>' + h.lines.slice(0, 5).map(function (l) {
          return '<tr><td>' + esc(l.payee) + '</td><td class="t">' + esc(typeName(l.type)) + '</td><td class="m money">' + money(l.net) + '</td></tr>';
        }).join('') + (h.lines.length > 5 ? '<tr><td colspan="3" class="more">และอีก ' + (h.lines.length - 5) + ' รายการ (ดูในเอกสาร)</td></tr>' : '') + '</tbody></table>' +
        '<div class="ap-fund" data-fund="' + esc(JSON.stringify(byT)) + '"></div>' +
        '<footer><button class="btn ghost sm" type="button" data-doc="' + h.no + '">' + ICON.print + ' ดูเอกสาร</button><span class="sp"></span>' +
        (canAct ? '<button class="btn ghost sm warnbtn" type="button" data-back="' + h.no + '">ส่งกลับ</button><button class="btn sm" type="button" data-ok="' + h.no + '">อนุมัติ</button>' : '') + '</footer></div></article>';
    }).join('');
    Array.prototype.forEach.call(box.querySelectorAll('[data-doc]'), function (b) { b.onclick = function () { Docs.openPaper('khb', Number(b.getAttribute('data-doc'))); }; });
    if (!canAct) return;
    function selBar() {
      var n = Object.keys(picked).length, sum = 0;
      pend.forEach(function (h) { if (picked[h.no]) sum += Math.round(h.total.net * 100); });
      $('apSel').textContent = n ? 'เลือก ' + n + ' ฉบับ · ' + money(sum / 100) + ' บาท' : '';
      $('apMany').disabled = !n; $('apMany').textContent = n ? 'อนุมัติที่เลือก ' + n + ' ฉบับ' : 'อนุมัติที่เลือก';
      $('apAll').checked = n === pend.length;
    }
    box.onchange = function (e) {
      var t = e.target; if (!t.hasAttribute('data-pick')) return;
      var no = Number(t.getAttribute('data-pick')); if (t.checked) picked[no] = true; else delete picked[no];
      t.closest('.ap').classList.toggle('sel', t.checked); selBar();
    };
    $('apAll').onchange = function () {
      var on = this.checked; picked = {};
      pend.forEach(function (h) { if (on) picked[h.no] = true; });
      Array.prototype.forEach.call(box.querySelectorAll('[data-pick]'), function (c) { c.checked = on; c.closest('.ap').classList.toggle('sel', on); });
      selBar();
    };
    $('apMany').onclick = function () { decide(Object.keys(picked).map(Number), 'อนุมัติ', '', this); };
    Array.prototype.forEach.call(box.querySelectorAll('[data-ok]'), function (b) { b.onclick = function () { decide([Number(b.getAttribute('data-ok'))], 'อนุมัติ', '', b); }; });
    Array.prototype.forEach.call(box.querySelectorAll('[data-back]'), function (b) {
      b.onclick = function () {
        var no = Number(b.getAttribute('data-back'));
        askReason('ส่ง ขบ.' + no + ' กลับให้ผู้ขอแก้ไข', 'ส่งกลับ', function (reason, am, btn) { decide([no], 'ส่งกลับ', reason, btn, am); });
      };
    });
    selBar();
  }
  /** ยอดคงเหลือของประเภทเงินที่ขอ: คงเหลือจริง − ที่อนุมัติแล้วยังไม่จ่าย − ฉบับนี้ */
  function drawFunds() {
    if (!balCache) return;
    var bal = {}, committed = {};
    balCache.types.forEach(function (t, i) { bal[t.id] = Math.round(balCache.rowTotals[i] * 100); });
    khbs().forEach(function (h) {
      if (h.status === 'ยกเลิก' || (h.flow !== 'อนุมัติแล้ว' && h.flow !== 'รับเรื่องแล้ว')) return;
      h.lines.forEach(function (l) { if (l.state !== 'จ่ายแล้ว') committed[l.type] = (committed[l.type] || 0) + Math.round(l.net * 100); });
    });
    Array.prototype.forEach.call(document.querySelectorAll('[data-fund]'), function (el) {
      var byT = JSON.parse(el.getAttribute('data-fund'));
      el.innerHTML = Object.keys(byT).map(function (t) {
        var b = bal[t] || 0, c = committed[t] || 0, after = b - c - byT[t];
        return '<span class="fund' + (after < 0 ? ' neg' : '') + '" title="คงเหลือ ' + money(b / 100) + ' · อนุมัติแล้วรอจ่าย ' + money(c / 100) + ' · ฉบับนี้ ' + money(byT[t] / 100) + '">' +
          esc(typeName(t)) + ' <b>เหลือ ' + money(after / 100) + '</b>' + (after < 0 ? ' ไม่พอจ่าย' : ' หลังอนุมัติ') + '</span>';
      }).join('');
    });
  }
  function decide(nos, decision, note, btn, modal) {
    if (!nos.length) return;
    busy(btn, api('approveKhb', { nos: nos, decision: decision, note: note })).then(function () {
      if (modal) modal.close();
      nos.forEach(function (n) { delete picked[n]; var c = document.querySelector('.ap[data-no="' + n + '"]'); if (c) { c.classList.add('gone'); if (decision !== 'อนุมัติ') c.classList.add('back'); } });
      return reloadDocs().then(function () {
        setTimeout(function () {
          if (S.tab === 'approve') exec($('view'));
          toast(decision === 'อนุมัติ' ? 'อนุมัติ ' + nos.map(function (n) { return 'ขบ.' + n; }).join(', ') + ' แล้ว — ส่งต่อให้การเงินรับเรื่อง' : 'ส่ง ขบ.' + nos[0] + ' กลับให้ผู้ขอแก้ไขแล้ว', 'good');
        }, REDUCE ? 0 : 420);
      });
    }).catch(handleError);
  }

  return { teacher: teacher, exec: exec, stepper: stepper, resetBal: function () { balCache = null; } };
})();
