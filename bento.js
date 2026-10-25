/* ระบบการเงินโรงเรียน — bento.js
   การ์ดสรุป 4 ใบหน้าภาพรวม (ตามแบบ Analytics Bento): เส้นรับสะสม · คลื่นรับ/จ่ายรายวัน · treemap ยอดคงเหลือแยกประเภท · เรดาร์รายเดือน
   วาดด้วย SVG ล้วน คำนวณจากข้อมูลที่หน้าเว็บมีอยู่แล้ว (ใบเสร็จ, ขบ./ขจ., ยอดคงเหลือ) ไม่เรียกเซิร์ฟเวอร์เพิ่ม */

var Bento = (function () {
  var NS = 'http://www.w3.org/2000/svg', GROUP_COLORS = ['#7CFF5B', '#8B3DFF', '#FFB800', '#FF5A1F', '#9aa3b5', '#22D3EE'], GROUP_INK = ['dark', 'light', 'dark', 'dark', 'dark', 'dark'];
  var raf = 0, timers = [], tipEl = null;
  function ease(t) { return 1 - Math.pow(1 - t, 3); }
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

  /* ---------- A: เส้นรับสะสม ---------- */
  function lineChart(box, days, vals, cap) {
    var cum = [], s = 0; vals.forEach(function (v) { s += v; cum.push(s); });
    box.innerHTML = '<div class="bcap">' + esc(cap) + '</div>';
    var W = box.clientWidth, H = box.clientHeight; if (!W) return;
    var lo = Math.min.apply(null, cum), hi = Math.max.apply(null, cum), span = hi - lo || 1, top = 30, bot = 14, mn = lo - span * 0.3, mx = hi + span * 0.08;
    function Y(v) { return top + (1 - (v - mn) / (mx - mn)) * (H - top - bot); }
    var P = cum.map(function (v, i) { return [14 + (i / Math.max(1, cum.length - 1)) * (W - 66), Y(v)]; });
    var d = smooth(P), last = P[P.length - 1], id = 'bl' + Math.random().toString(36).slice(2, 6);
    var g = svg('svg', { width: W, height: H, 'class': 'bsvg', role: 'img', 'aria-label': cap });
    g.innerHTML = '<defs><linearGradient id="' + id + 'l" x1="0" x2="1"><stop offset="0" stop-color="#12b863"/><stop offset="1" stop-color="#22d3a0"/></linearGradient>' +
      '<linearGradient id="' + id + 'a" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#12b863" stop-opacity=".22"/><stop offset="1" stop-color="#12b863" stop-opacity="0"/></linearGradient></defs>';
    [0.25, 0.5, 0.75, 1].forEach(function (k) {
      var v = lo + (hi - lo) * k, y = Y(v);
      g.appendChild(svg('line', { x1: 0, x2: W, y1: y, y2: y, 'class': 'bgrid' }));
      var t = svg('text', { x: W - 10, y: y - 5, 'text-anchor': 'end', 'class': 'blbl' }); t.textContent = v >= 1000 ? (v / 1000).toFixed(1).replace(/\.0$/, '') + 'K' : n0(v); g.appendChild(t);
    });
    g.appendChild(svg('path', { d: d + 'L' + last[0] + ',' + H + 'L' + P[0][0] + ',' + H + 'Z', fill: 'url(#' + id + 'a)' }));
    var line = svg('path', { d: d, fill: 'none', stroke: 'url(#' + id + 'l)', 'stroke-width': 2.5, 'stroke-linecap': 'round', pathLength: 1 });
    line.style.strokeDasharray = 1; line.style.strokeDashoffset = REDUCE ? 0 : 1; line.style.transition = REDUCE ? 'none' : 'stroke-dashoffset 1.5s cubic-bezier(.3,.8,.2,1) .2s';
    g.appendChild(line); requestAnimationFrame(function () { requestAnimationFrame(function () { line.style.strokeDashoffset = 0; }); });
    g.appendChild(svg('circle', { cx: last[0], cy: last[1], r: 4.5, fill: '#12b863', stroke: '#fff', 'stroke-width': 2 }));
    var cur = svg('line', { y1: 0, y2: H, 'class': 'bcur' }), dot = svg('circle', { r: 4.5, fill: '#12b863', stroke: '#fff', 'stroke-width': 2 }); cur.style.display = dot.style.display = 'none';
    g.appendChild(cur); g.appendChild(dot);
    var hit = svg('rect', { width: W, height: H, fill: 'transparent' });
    hit.addEventListener('pointermove', function (e) {
      var r = g.getBoundingClientRect(), i = Math.max(0, Math.min(cum.length - 1, Math.round(((e.clientX - r.left - 14) / (W - 66)) * (cum.length - 1))));
      cur.setAttribute('x1', P[i][0]); cur.setAttribute('x2', P[i][0]); dot.setAttribute('cx', P[i][0]); dot.setAttribute('cy', P[i][1]); cur.style.display = dot.style.display = '';
      tip(r.left + P[i][0], r.top + P[i][1], thaiDate(days[i]), [{ l: 'รับสะสม', v: money(cum[i]), c: '#12b863' }, { l: 'รับวันนั้น', v: money(vals[i]) }]);
    });
    hit.addEventListener('pointerleave', function () { cur.style.display = dot.style.display = 'none'; tip(); });
    g.appendChild(hit); box.appendChild(g);
  }

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

  /* ---------- C: treemap ---------- */
  function squarify(items, x, y, w, h) {
    var total = items.reduce(function (a, b) { return a + b.v; }, 0) || 1, scale = (w * h) / total, out = [];
    var rest = items.map(function (i) { return { name: i.name, group: i.group, v: i.v, a: i.v * scale }; });
    function worst(row, len) {
      var s = 0, mx = 0, mn = Infinity; row.forEach(function (r) { s += r.a; mx = Math.max(mx, r.a); mn = Math.min(mn, r.a); });
      return Math.max((len * len * mx) / (s * s), (s * s) / (len * len * mn));
    }
    while (rest.length) {
      var len = Math.min(w, h), row = [rest[0]], i = 1;
      while (i < rest.length && worst(row.concat([rest[i]]), len) <= worst(row, len)) row.push(rest[i++]);
      rest = rest.slice(i);
      var s = row.reduce(function (a, b) { return a + b.a; }, 0), r;
      if (w >= h) { var cw = s / h, cy = y; for (r = 0; r < row.length; r++) { var rh = row[r].a / cw; out.push({ name: row[r].name, group: row[r].group, v: row[r].v, x: x, y: cy, w: cw, h: rh }); cy += rh; } x += cw; w -= cw; }
      else { var rh2 = s / w, cx = x; for (r = 0; r < row.length; r++) { var rw = row[r].a / rh2; out.push({ name: row[r].name, group: row[r].group, v: row[r].v, x: cx, y: y, w: rw, h: rh2 }); cx += rw; } y += rh2; h -= rh2; }
    }
    return out;
  }
  function treemap(box, items, groups, periodName) {
    box.innerHTML = '';
    var W = box.clientWidth, H = box.clientHeight, G = 6; if (!W) return;
    items = items.filter(function (i) { return i.v > 0; }).sort(function (a, b) { return b.v - a.v; });
    if (!items.length) { box.innerHTML = '<div class="empty" style="margin:8px 0"><b>ยังไม่มีข้อมูล</b>ช่วงนี้ยังไม่มียอดในประเภทเงินใด</div>'; return; }
    var total = items.reduce(function (a, b) { return a + b.v; }, 0), rects = squarify(items, 0, 0, W + G, H + G);
    rects.forEach(function (r, idx) {
      var gi = groups.indexOf(r.group), col = GROUP_COLORS[gi % GROUP_COLORS.length], ink = GROUP_INK[gi % GROUP_INK.length] === 'light' ? '#fff' : '#0b0b0f';
      var w = r.w - G, h = r.h - G, share = (r.v / total * 100).toFixed(1).replace(/\.0$/, '') + '%', chars = n0(r.v).length;
      var fs = Math.min(28, (w - 24 - 54) / (chars * 0.62)), showPct = true;
      if (fs < 15) { showPct = false; fs = Math.min(28, (w - 24) / (chars * 0.62)); }
      var tiny = fs < 11 || h < 54 || w < 60, showName = h >= 70 && w >= 84;
      var t = document.createElement('div'); t.className = 'btile'; t.style.cssText = 'background:' + col + ';color:' + ink + ';left:' + (W / 2) + 'px;top:' + (H / 2) + 'px;width:0;height:0';
      t.innerHTML = '<div class="bn">' + (showName ? esc(r.name) : '') + '</div>' + (tiny ? '' : '<div class="bv"><span style="font-size:' + fs.toFixed(1) + 'px">' + n0(r.v) + '</span>' + (showPct ? '<em>' + share + '</em>' : '') + '</div>');
      t.addEventListener('pointermove', function (e) { tip(e.clientX, e.clientY, periodName + ' · ' + r.group, [{ l: r.name, v: money(r.v), c: col }, { l: 'สัดส่วน', v: share }]); });
      t.addEventListener('pointerleave', function () { tip(); });
      box.appendChild(t);
      var set = function () { t.style.left = r.x + 'px'; t.style.top = r.y + 'px'; t.style.width = w + 'px'; t.style.height = h + 'px'; };
      if (REDUCE) set(); else timers.push(setTimeout(set, 30 + idx * 25));
    });
  }

  /* ---------- D: เรดาร์รายเดือน ---------- */
  function radar(box, vals, axis, color, label) {
    box.innerHTML = '';
    var S0 = Math.min(box.clientWidth, 420); if (!S0) return;
    var N = vals.length, R = S0 / 2 - 34, C = S0 / 2;
    function ang(i) { return -Math.PI / 2 + (i / N) * Math.PI * 2; }
    function norm(v) { var lo = Math.min.apply(null, v), hi = Math.max.apply(null, v); return v.map(function (x) { return 0.42 + ((x - lo) / (hi - lo || 1)) * 0.58; }); }
    function fit(v) {
      var K = Math.min(5, Math.floor(N / 2)), co = [];
      for (var k = 0; k <= K; k++) { var a = 0, b = 0; for (var i = 0; i < v.length; i++) { var th = (i / N) * Math.PI * 2; a += v[i] * Math.cos(k * th); b += v[i] * Math.sin(k * th); } co.push([(a * (k ? 2 : 1)) / N, (b * (k ? 2 : 1)) / N]); }
      return function (th) { var r = 0; for (var k2 = 0; k2 < co.length; k2++) r += co[k2][0] * Math.cos(k2 * th) + co[k2][1] * Math.sin(k2 * th); return r; };
    }
    function at(f, th) { var v = Math.max(0.05, f(th)), a = -Math.PI / 2 + th; return [C + Math.cos(a) * (R * 0.2 + v * R * 0.8), C + Math.sin(a) * (R * 0.2 + v * R * 0.8)]; }
    function shape(v) { var f = fit(norm(v)), d = ''; for (var j = 0; j <= 180; j++) { var p = at(f, (j / 180) * Math.PI * 2); d += (j ? 'L' : 'M') + p[0].toFixed(2) + ',' + p[1].toFixed(2); } return d + 'Z'; }
    function point(v, i) { return at(fit(norm(v)), (i / N) * Math.PI * 2); }
    var g = svg('svg', { width: S0, height: S0, 'class': 'bsvg radar', role: 'img', 'aria-label': label });
    [0.33, 0.66, 1].forEach(function (k) { g.appendChild(svg('circle', { cx: C, cy: C, r: R * k, fill: 'none', 'class': 'bgrid' })); });
    axis.forEach(function (m, i) {
      g.appendChild(svg('line', { x1: C + Math.cos(ang(i)) * R * 0.2, y1: C + Math.sin(ang(i)) * R * 0.2, x2: C + Math.cos(ang(i)) * R, y2: C + Math.sin(ang(i)) * R, 'class': 'bgrid' }));
      var t = svg('text', { x: C + Math.cos(ang(i)) * (R + 18), y: C + Math.sin(ang(i)) * (R + 18), 'text-anchor': 'middle', 'dominant-baseline': 'central', 'class': 'blbl', 'font-size': 11 }); t.textContent = m; g.appendChild(t);
    });
    var line = svg('path', { fill: 'none', 'stroke-width': 2.5, 'stroke-linejoin': 'round', stroke: color, 'fill-opacity': 0.1 }); line.setAttribute('fill', color); g.appendChild(line);
    g.appendChild(svg('circle', { cx: C, cy: C, r: R * 0.2, 'class': 'bhub' }));
    g.appendChild(svg('path', { d: 'M11 1.5l8.5 5v9L11 20.5l-8.5-5v-9z M11 1.5v19 M2.5 6.5L19.5 15.5 M19.5 6.5L2.5 15.5', transform: 'translate(' + (C - 11) + ' ' + (C - 11) + ')', fill: 'none', 'class': 'bhubi', 'stroke-width': 1.4, 'stroke-linejoin': 'round' }));
    var dot = svg('circle', { r: 4.5, fill: color, stroke: '#fff', 'stroke-width': 2 }); dot.style.display = 'none'; g.appendChild(dot);
    var t0 = performance.now(), from = vals.map(function () { return 1; });
    (function step(now) {
      var t = REDUCE ? 1 : ease(Math.min(1, (now - t0) / 900));
      line.setAttribute('d', shape(vals.map(function (v, i) { return from[i] + (v - from[i]) * t; })));
      if (t < 1) requestAnimationFrame(step);
    })(t0);
    var hit = svg('rect', { width: S0, height: S0, fill: 'transparent' });
    hit.addEventListener('pointermove', function (e) {
      var r = g.getBoundingClientRect(), x = e.clientX - r.left - C, y = e.clientY - r.top - C;
      if (Math.hypot(x, y) < R * 0.2) { dot.style.display = 'none'; tip(); return; }
      var a = Math.atan2(y, x) + Math.PI / 2; if (a < 0) a += Math.PI * 2;
      var i = Math.round((a / (Math.PI * 2)) * N) % N, p = point(vals, i);
      dot.setAttribute('cx', p[0]); dot.setAttribute('cy', p[1]); dot.style.display = '';
      tip(r.left + p[0], r.top + p[1], axis[i], [{ l: label, v: money(vals[i]), c: color }]);
    });
    hit.addEventListener('pointerleave', function () { dot.style.display = 'none'; tip(); });
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
    var types = S.bal.types, groups = []; types.forEach(function (t) { if (groups.indexOf(t.group) < 0) groups.push(t.group); });
    function byType(list) { var m = {}; list.forEach(function (x) { m[x.t] = (m[x.t] || 0) + Math.round(x.v * 100); }); return types.map(function (t) { return { name: t.name, group: t.group, v: (m[t.id] || 0) / 100 }; }); }
    var periods = [
      { label: 'คงเหลือ', note: 'ถึงวันที่เลือก', items: types.map(function (t, i) { return { name: t.name, group: t.group, v: S.bal.rowTotals[i] }; }), total: S.bal.grand },
      { label: 'รับ', note: 'ตั้งแต่ต้นปีงบ', items: byType(D.rc), total: sumBy(D.rc, S.st.fyStart, S.st.fyEnd) },
      { label: 'จ่าย', note: 'ตั้งแต่ต้นปีงบ', items: byType(D.pd), total: sumBy(D.pd, S.st.fyStart, S.st.fyEnd) }
    ];
    var axis = [], mstart = new Date(S.st.fyStart + 'T00:00:00'), mkeys = [];
    for (var m = 0; m < 12; m++) { var dm = new Date(mstart.getFullYear(), mstart.getMonth() + m, 1); axis.push(MONTHS[dm.getMonth()]); mkeys.push(dm.getFullYear() + '-' + ('0' + (dm.getMonth() + 1)).slice(-2)); }
    function monthly(list) { var o = mkeys.map(function () { return 0; }); list.forEach(function (x) { var i = mkeys.indexOf(x.d.slice(0, 7)); if (i >= 0) o[i] += Math.round(x.v * 100); }); return o.map(function (v) { return v / 100; }); }
    var rad = [{ label: 'รับ', color: '#12b863', vals: monthly(D.rc), list: D.rc }, { label: 'จ่าย', color: '#e0354f', vals: monthly(D.pd), list: D.pd }];
    var per = 0, rv = 0;

    host.innerHTML =
      '<div class="bgrid12">' +
      '<section class="bcard c5 enter" style="--i:0"><div class="brow"><div class="bhead"><div class="bk">รับ 30 วันล่าสุด</div><div class="bbig"><span id="bA" data-v="0">0</span><span class="bd ' + (rcTot >= rcPrev ? 'up' : 'dn') + '">' + esc(pct(rcTot, rcPrev)) + '</span></div><div class="bnote">เฉลี่ยวันละ ' + money(rcTot / Math.max(1, days.length)) + ' บาท</div></div><div class="bpanel" id="bAc"></div></div></section>' +
      '<section class="bcard c7 enter" style="--i:1"><div class="brow"><div class="bhead"><div class="bk">รับ − จ่าย รายวัน (30 วัน)</div><div class="bbig"><span id="bB" data-v="0">0</span><span class="bd ' + (pdTot <= pdPrev ? 'up' : 'dn') + '">จ่าย ' + esc(pct(pdTot, pdPrev)) + '</span></div><div class="bnote">รับ ' + money(rcTot) + ' · จ่าย ' + money(pdTot) + '</div>' +
      '<div class="blegend"><span><i style="background:linear-gradient(90deg,#22D3EE,#2e6bff)"></i>รับ (ขึ้น)</span><span><i style="background:linear-gradient(90deg,#FFB800,#FF3DA5)"></i>จ่าย (ลง)</span></div></div><div class="bpanel" id="bBc"></div></div></section>' +
      '<section class="bcard c7 enter" style="--i:2"><div class="bhd"><h3>ยอดแยกตามประเภทเงิน</h3><div class="blegend">' + groups.map(function (g, i) { return '<span><i style="background:' + GROUP_COLORS[i % GROUP_COLORS.length] + '"></i>' + esc(g) + '</span>'; }).join('') + '</div></div>' +
      '<div class="bper" id="bPer">' + periods.map(function (p, i) { return '<button type="button" data-p="' + i + '" aria-pressed="' + (i === 0) + '"><b><i></i>' + esc(p.label) + '</b><span class="bnum" data-v="0">0</span><small>' + esc(p.note) + '</small></button>'; }).join('') + '</div>' +
      '<div class="btree" id="bTree"></div></section>' +
      '<section class="bcard c5 enter" style="--i:3"><div class="bhd"><h3>รายเดือนตลอดปีงบ</h3><div class="bseg" id="bSeg" role="tablist">' + rad.map(function (r, i) { return '<button type="button" role="tab" data-r="' + i + '" aria-selected="' + (i === 0) + '">' + r.label + '</button>'; }).join('') + '</div></div>' +
      '<div class="brad" id="bRad"></div><div class="bstats" id="bSt"></div><div id="bRows"></div></section></div>';

    countTo($('bA'), rcTot, '', 1100); countTo($('bB'), Math.abs(net), net < 0 ? '−' : '', 1100);
    Array.prototype.forEach.call(host.querySelectorAll('.bnum'), function (el, i) { countTo(el, periods[i].total, '', 1000); });
    function drawAll() {
      drawRadar();
      lineChart($('bAc'), days, rcDay, '30 วันล่าสุด · สะสม');
      waves($('bBc'), days, rcDay, pdDay);
      treemap($('bTree'), periods[per].items, groups, periods[per].label);
    }
    function drawRadar() {
      var r = rad[rv], tot = 0, mx = 0; r.vals.forEach(function (v) { tot += v; mx = Math.max(mx, v); });
      var active = r.vals.filter(function (v) { return v > 0; }).length, byT = {}; r.list.forEach(function (x) { byT[x.t] = (byT[x.t] || 0) + Math.round(x.v * 100); });
      var top = Object.keys(byT).map(function (k) { return { k: k, v: byT[k] / 100 }; }).sort(function (a, b) { return b.v - a.v; }).slice(0, 3);
      radar($('bRad'), r.vals.map(function (v) { return v; }), axis, r.color, r.label);
      $('bSt').innerHTML = '<div><div class="bk">เฉลี่ยต่อเดือนที่มียอด</div><div class="bstat bnum2">' + money(active ? tot / active : 0) + '</div><div class="bnote">' + active + ' เดือนที่มีข้อมูล</div></div>' +
        '<div><div class="bk">รวมทั้งปีงบ</div><div class="bstat bnum2">' + money(tot) + '</div><div class="bnote">เดือนสูงสุด ' + money(mx) + '</div></div>';
      $('bRows').innerHTML = top.map(function (t) { return '<div class="brw"><span>' + esc(typeName(t.k)) + '</span><b>' + money(t.v) + '</b></div>'; }).join('') || '<div class="hint">ยังไม่มีข้อมูล</div>';
    }
    host.querySelector('#bPer').addEventListener('click', function (e) {
      var b = e.target.closest('[data-p]'); if (!b) return; per = Number(b.getAttribute('data-p'));
      Array.prototype.forEach.call(host.querySelectorAll('#bPer button'), function (x) { x.setAttribute('aria-pressed', String(x === b)); });
      treemap($('bTree'), periods[per].items, groups, periods[per].label);
    });
    host.querySelector('#bSeg').addEventListener('click', function (e) {
      var b = e.target.closest('[data-r]'); if (!b) return; rv = Number(b.getAttribute('data-r'));
      Array.prototype.forEach.call(host.querySelectorAll('#bSeg button'), function (x) { x.setAttribute('aria-selected', String(x === b)); });
      drawRadar();
    });
    var rt = 0; window.addEventListener('resize', onResize); function onResize() { clearTimeout(rt); rt = setTimeout(function () { if ($('bAc')) drawAll(); }, 200); }
    Bento._rs = onResize;
    drawAll();
    observeReveal();
  }
  function unmount() {
    cancelAnimationFrame(raf); timers.forEach(clearTimeout); timers = [];
    if (Bento._rs) { window.removeEventListener('resize', Bento._rs); Bento._rs = null; }
    tip();
  }
  return { mount: mount, unmount: unmount };
})();
