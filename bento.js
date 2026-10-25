/* ระบบการเงินโรงเรียน — bento.js
   การ์ดสรุป 4 ใบหน้าภาพรวม (ตามแบบ Analytics Bento): เส้นรับสะสม · คลื่นรับ/จ่ายรายวัน · treemap ยอดคงเหลือแยกประเภท · เรดาร์รายเดือน
   วาดด้วย SVG ล้วน คำนวณจากข้อมูลที่หน้าเว็บมีอยู่แล้ว (ใบเสร็จ, ขบ./ขจ., ยอดคงเหลือ) ไม่เรียกเซิร์ฟเวอร์เพิ่ม */

var Bento = (function () {
  var NS = 'http://www.w3.org/2000/svg', GROUP_COLORS = ['#7CFF5B', '#8B3DFF', '#FFB800', '#FF5A1F', '#9aa3b5', '#22D3EE'], GROUP_INK = ['dark', 'light', 'dark', 'dark', 'dark', 'dark'];
  var raf = 0, timers = [], tipEl = null;
  function ease(t) { t = Math.max(0, Math.min(1, t)); return 1 - Math.pow(1 - t, 3); }
  function n0(v) { return Math.round(v).toLocaleString('en-US'); }
  function svg(tag, attrs, html) {
    var e = document.createElementNS(NS, tag);
    for (var k in attrs) e.setAttribute(k, attrs[k]);
    if (html) e.innerHTML = html;
    return e;
  }
  function smooth(P) {
    var n = P.length; if (n < 2) return '';
    function g(i) { return P[Math.max(0, Math.min(n - 1, i))]; }
    var d = 'M' + P[0][0] + ',' + P[0][1];
    for (var i = 0; i < n - 1; i++) {
      var p0 = g(i - 1), p1 = g(i), p2 = g(i + 1), p3 = g(i + 2), k = 0.18;
      d += 'C' + (p1[0] + (p2[0] - p0[0]) * k) + ',' + (p1[1] + (p2[1] - p0[1]) * k) + ' ' + (p2[0] - (p3[0] - p1[0]) * k) + ',' + (p2[1] - (p3[1] - p1[1]) * k) + ' ' + p2[0] + ',' + p2[1];
    }
    return d;
  }
  function countTo(el, to, prefix, dur) {
    if (REDUCE) { el.textContent = prefix + n0(to); return; }
    var t0 = performance.now(), a = Number(el.getAttribute('data-v') || 0);
    (function f(now) {
      var t = Math.min(1, (now - t0) / (dur || 1000)), v = a + (to - a) * ease(t);
      el.textContent = prefix + n0(v); el.setAttribute('data-v', v);
      if (t < 1) requestAnimationFrame(f);
    })(t0);
  }
  /* ---------- tooltip ---------- */
  function tip(x, y, title, rows) {
    if (!tipEl) { tipEl = document.createElement('div'); tipEl.className = 'btip'; tipEl.setAttribute('role', 'tooltip'); document.body.appendChild(tipEl); }
    if (!rows) { tipEl.classList.remove('on'); return; }
    tipEl.innerHTML = '<div class="tt">' + esc(title) + '</div>' + rows.map(function (r) {
      return '<div class="tr"><span>' + (r.c ? '<i style="background:' + r.c + '"></i>' : '') + esc(r.l) + '</span><b>' + esc(r.v) + '</b></div>';
    }).join('');
    tipEl.classList.add('on');
    var w = tipEl.offsetWidth, h = tipEl.offsetHeight, l = x + 14, t = y - h - 12;
    if (l + w > window.innerWidth - 8) l = x - w - 14;
    if (t < 8) t = y + 16;
    tipEl.style.left = l + 'px'; tipEl.style.top = t + 'px';
  }
  /* ---------- ข้อมูล ---------- */
  function iso(d) { return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); }
  function addDays(s, n) { var d = new Date(s + 'T00:00:00'); d.setDate(d.getDate() + n); return iso(d); }
  function collect() {
    var rc = (S.rcv && S.rcv.rows || []).filter(function (r) { return !r[8]; }).map(function (r) { return { d: String(r[3]), v: Number(r[7]) || 0, t: r[5], m: r[6] }; });
    var pd = [];
    ((S.docs && S.docs.khbs) || []).forEach(function (h) {
      if (h.status === 'ยกเลิก') return;
      h.lines.forEach(function (l) { if (l.state === 'จ่ายแล้ว' && l.paidDate) pd.push({ d: String(l.paidDate), v: Number(l.net) || 0, t: l.type, m: l.method }); });
    });
    return { rc: rc, pd: pd };
  }
  function sumBy(list, from, to) { var s = 0; list.forEach(function (x) { if (x.d >= from && x.d <= to) s += Math.round(x.v * 100); }); return s / 100; }
  function dayVals(list, days) { var m = {}; list.forEach(function (x) { m[x.d] = (m[x.d] || 0) + Math.round(x.v * 100); }); return days.map(function (d) { return (m[d] || 0) / 100; }); }
  function pct(a, b) { if (!b) return a ? 'ใหม่' : '—'; var p = (a - b) / b * 100; return (p >= 0 ? '+' : '') + p.toFixed(1).replace(/\.0$/, '') + '%'; }

  /* ---------- B: คลื่นรับ/จ่ายรายวัน ---------- */
  function waves(box, days, rc, pd) {
    box.innerHTML = '';
    var W = box.clientWidth, H = box.clientHeight; if (!W) return;
    var max = Math.max(1, Math.max.apply(null, rc), Math.max.apply(null, pd)), pad = 18, mid = H / 2, amp = H / 2 - 14, n = days.length, id = 'bw' + Math.random().toString(36).slice(2, 6);
    function X(i) { return pad + 6 + (i / Math.max(1, n - 1)) * (W - 2 * pad - 12); }
    var g = svg('svg', { width: W, height: H, 'class': 'bsvg', role: 'img', 'aria-label': 'รับและจ่ายรายวัน' });
    g.innerHTML = '<defs><linearGradient id="' + id + 'u" x1="0" x2="1"><stop offset=".1" stop-color="#22D3EE"/><stop offset=".9" stop-color="#2e6bff"/></linearGradient>' +
      '<linearGradient id="' + id + 'd" x1="0" x2="1"><stop offset=".15" stop-color="#FFB800"/><stop offset=".85" stop-color="#FF3DA5"/></linearGradient></defs>';
    for (var k = 0; k < 9; k++) { var y = 10 + (H - 20) * k / 8; g.appendChild(svg('line', { x1: 8, x2: 14, y1: y, y2: y, 'class': 'btick' })); g.appendChild(svg('line', { x1: W - 14, x2: W - 8, y1: y, y2: y, 'class': 'btick' })); }
    g.appendChild(svg('line', { x1: pad + 6, x2: W - pad - 6, y1: mid, y2: mid, 'class': 'bgrid' }));
    var up = svg('path', { fill: 'none', stroke: 'url(#' + id + 'u)', 'stroke-width': 2.5, 'stroke-linecap': 'round' }), dn = svg('path', { fill: 'none', stroke: 'url(#' + id + 'd)', 'stroke-width': 2.5, 'stroke-linecap': 'round' });
    g.appendChild(up); g.appendChild(dn);
    var cur = svg('line', { y1: 4, y2: H - 4, 'class': 'bcur' }); cur.style.display = 'none'; g.appendChild(cur);
    var t0 = performance.now();
    function frame(now) {
      var t = (now - t0) / 1000, grow = REDUCE ? 1 : ease(Math.min(1, t / 1.3));
      var b1 = REDUCE ? 1 : 1 + Math.sin(t * 1.2) * 0.035, b2 = REDUCE ? 1 : 1 + Math.sin(t * 1.2 + 0.9) * 0.035;
      up.setAttribute('d', smooth(rc.map(function (v, i) { return [X(i), mid - (3 + (v / max) * amp * grow * b1)]; })));
      dn.setAttribute('d', smooth(pd.map(function (v, i) { return [X(i), mid + (3 + (v / max) * amp * grow * b2)]; })));
      if (!REDUCE) raf = requestAnimationFrame(frame);
    }
    cancelAnimationFrame(raf); raf = requestAnimationFrame(frame);
    var hit = svg('rect', { width: W, height: H, fill: 'transparent' });
    hit.addEventListener('pointermove', function (e) {
      var r = g.getBoundingClientRect(), i = Math.max(0, Math.min(n - 1, Math.round(((e.clientX - r.left - pad - 6) / (W - 2 * pad - 12)) * (n - 1))));
      cur.setAttribute('x1', X(i)); cur.setAttribute('x2', X(i)); cur.style.display = '';
      tip(r.left + X(i), r.top + 12, thaiDate(days[i]), [{ l: 'รับ', v: money(rc[i]), c: '#22D3EE' }, { l: 'จ่าย', v: money(pd[i]), c: '#FF3DA5' }]);
    });
    hit.addEventListener('pointerleave', function () { cur.style.display = 'none'; tip(); });
    g.appendChild(hit); box.appendChild(g);
  }

  /* ---------- รายเดือน: แท่งคู่ รับ/จ่าย ---------- */
  function bars(box, axis, rc, pd, nowIdx) {
    box.innerHTML = '';
    var W = box.clientWidth, H = box.clientHeight; if (!W) return;
    var max = Math.max(1, Math.max.apply(null, rc), Math.max.apply(null, pd)), top = 14, bot = 26, left = 6, n = axis.length, cw = (W - left * 2) / n, bw = Math.max(4, Math.min(14, cw * 0.32));
    var g = svg('svg', { width: W, height: H, 'class': 'bsvg', role: 'img', 'aria-label': 'รับและจ่ายรายเดือน' });
    [0.25, 0.5, 0.75, 1].forEach(function (k) { var y = top + (H - top - bot) * (1 - k); g.appendChild(svg('line', { x1: 0, x2: W, y1: y, y2: y, 'class': 'bgrid' })); });
    var rects = [];
    axis.forEach(function (m, i) {
      var cx = left + cw * (i + 0.5), x0 = cx - bw - 1;
      [[rc[i], '#12b863', x0], [pd[i], '#ff4d6d', cx + 1]].forEach(function (s) {
        var h = (H - top - bot) * (s[0] / max), r = svg('rect', { x: s[2], width: bw, rx: Math.min(4, bw / 2), fill: s[1], y: H - bot, height: 0, opacity: i === nowIdx ? 1 : 0.85 });
        g.appendChild(r); rects.push([r, h]);
      });
      var t = svg('text', { x: cx, y: H - 8, 'text-anchor': 'middle', 'class': 'blbl' + (i === nowIdx ? ' now' : ''), 'font-size': 11 }); t.textContent = m; g.appendChild(t);
    });
    var t0 = performance.now();
    (function step(now) {
      var t = REDUCE ? 1 : ease(Math.min(1, (now - t0) / 900));
      rects.forEach(function (x) { var h = x[1] * t; x[0].setAttribute('height', h); x[0].setAttribute('y', H - bot - h); });
      if (t < 1) requestAnimationFrame(step);
    })(t0);
    var hit = svg('rect', { width: W, height: H, fill: 'transparent' });
    hit.addEventListener('pointermove', function (e) {
      var r = g.getBoundingClientRect(), i = Math.max(0, Math.min(n - 1, Math.floor((e.clientX - r.left - left) / cw)));
      tip(e.clientX, r.top + 20, axis[i], [{ l: 'รับ', v: money(rc[i]), c: '#12b863' }, { l: 'จ่าย', v: money(pd[i]), c: '#ff4d6d' }]);
    });
    hit.addEventListener('pointerleave', function () { tip(); });
    g.appendChild(hit); box.appendChild(g);
  }

  /* ---------- ประกอบการ์ด ---------- */
  function mount(host) {
    unmount();
    if (!host || !S.bal || !S.st) return;
    var D = collect(), end = S.date && S.date < S.st.fyEnd ? S.date : S.st.fyEnd, start = addDays(end, -29), pStart = addDays(end, -59), pEnd = addDays(end, -30);
    if (start < S.st.fyStart) start = S.st.fyStart;
    var days = []; for (var d = start; d <= end; d = addDays(d, 1)) days.push(d);
    var rcDay = dayVals(D.rc, days), pdDay = dayVals(D.pd, days);
    var rcTot = sumBy(D.rc, start, end), rcPrev = sumBy(D.rc, pStart, pEnd), pdTot = sumBy(D.pd, start, end), pdPrev = sumBy(D.pd, pStart, pEnd), net = Math.round((rcTot - pdTot) * 100) / 100;
    var axis = [], mstart = new Date(S.st.fyStart + 'T00:00:00'), mkeys = [], nowKey = end.slice(0, 7);
    for (var m = 0; m < 12; m++) { var dm = new Date(mstart.getFullYear(), mstart.getMonth() + m, 1); axis.push(MONTHS[dm.getMonth()]); mkeys.push(dm.getFullYear() + '-' + ('0' + (dm.getMonth() + 1)).slice(-2)); }
    function monthly(list) { var o = mkeys.map(function () { return 0; }); list.forEach(function (x) { var i = mkeys.indexOf(x.d.slice(0, 7)); if (i >= 0) o[i] += Math.round(x.v * 100); }); return o.map(function (v) { return v / 100; }); }
    var mr = monthly(D.rc), mp = monthly(D.pd), mrT = 0, mpT = 0; mr.forEach(function (v) { mrT += v; }); mp.forEach(function (v) { mpT += v; });

    host.innerHTML =
      '<div class="bgrid12">' +
      '<section class="bcard c7 enter" style="--i:0"><div class="bhd"><h3>รับ − จ่าย 30 วันล่าสุด</h3><div class="blegend"><span><i style="background:linear-gradient(90deg,#22D3EE,#2e6bff)"></i>รับ (ขึ้น)</span><span><i style="background:linear-gradient(90deg,#FFB800,#FF3DA5)"></i>จ่าย (ลง)</span></div></div>' +
      '<div class="bsum"><div><div class="bk">รับ</div><div class="bnum2 g">' + money(rcTot) + '</div><div class="bd ' + (rcTot >= rcPrev ? 'up' : 'dn') + '">' + esc(pct(rcTot, rcPrev)) + ' เทียบ 30 วันก่อน</div></div>' +
      '<div><div class="bk">จ่าย</div><div class="bnum2 r">' + money(pdTot) + '</div><div class="bd ' + (pdTot <= pdPrev ? 'up' : 'dn') + '">' + esc(pct(pdTot, pdPrev)) + ' เทียบ 30 วันก่อน</div></div>' +
      '<div><div class="bk">รับ − จ่าย</div><div class="bnum2 ' + (net >= 0 ? 'g' : 'r') + '">' + (net < 0 ? '−' : '') + money(Math.abs(net)) + '</div><div class="bd" style="color:var(--muted)">เฉลี่ยวันละ ' + money(rcTot / Math.max(1, days.length)) + '</div></div></div>' +
      '<div class="bpanel tall" id="bBc"></div></section>' +
      '<section class="bcard c5 enter" style="--i:1"><div class="bhd"><h3>รายเดือนตลอดปีงบ</h3><div class="blegend"><span><i style="background:#12b863"></i>รับ</span><span><i style="background:#ff4d6d"></i>จ่าย</span></div></div>' +
      '<div class="bsum two"><div><div class="bk">รับทั้งปีงบ</div><div class="bnum2 g">' + money(mrT) + '</div></div><div><div class="bk">จ่ายทั้งปีงบ</div><div class="bnum2 r">' + money(mpT) + '</div></div></div>' +
      '<div class="bpanel tall" id="bMo"></div></section></div>';

    function drawAll() {
      waves($('bBc'), days, rcDay, pdDay);
      bars($('bMo'), axis, mr, mp, mkeys.indexOf(nowKey));
    }
    var rt = 0; window.addEventListener('resize', onResize); function onResize() { clearTimeout(rt); rt = setTimeout(function () { if ($('bBc')) drawAll(); }, 200); }
    Bento._rs = onResize;
    drawAll();
  }
  function unmount() {
    cancelAnimationFrame(raf); timers.forEach(clearTimeout); timers = [];
    if (Bento._rs) { window.removeEventListener('resize', Bento._rs); Bento._rs = null; }
    tip();
  }
  return { mount: mount, unmount: unmount };
})();
