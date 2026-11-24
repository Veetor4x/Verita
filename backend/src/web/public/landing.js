/* Verità landing: tiny vanilla JS. Spotlight, example chips, submit state, live numbers (count-up) and the hash marquee.
   Nothing here is needed to use the page: the form works without it. */
(function () {
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Spotlight follows the pointer (desktop only).
  var spot = document.querySelector('.spot');
  if (spot && !reduce && window.matchMedia('(hover: hover)').matches) {
    window.addEventListener('pointermove', function (e) {
      spot.style.setProperty('--mx', e.clientX + 'px'); spot.style.setProperty('--my', e.clientY + 'px'); spot.classList.add('on');
    }, { passive: true });
  }
  // Bento tiles: light follows the pointer inside each tile.
  document.querySelectorAll('.tile').forEach(function (t) {
    t.addEventListener('pointermove', function (e) {
      var r = t.getBoundingClientRect();
      t.style.setProperty('--tx', (e.clientX - r.left) + 'px'); t.style.setProperty('--ty', (e.clientY - r.top) + 'px');
    }, { passive: true });
  });

  // Example chips fill the box.
  var box = document.getElementById('text');
  document.querySelectorAll('.ex').forEach(function (b) {
    b.addEventListener('click', function () { if (box) { box.value = b.getAttribute('data-fill') || ''; box.focus(); } });
  });
  // "Try it here" lands in the box.
  var tryIt = document.getElementById('try');
  if (tryIt && box) tryIt.addEventListener('click', function () { setTimeout(function () { box.focus({ preventScroll: true }); }, reduce ? 0 : 500); });

  // Live numbers.
  var nums = document.querySelectorAll('[data-stat]');
  var track = document.getElementById('track');
  if (!nums.length && !track) return;
  var fmt = function (n, d) { return d ? '$' + n.toFixed(2) : Math.round(n).toLocaleString('en-US'); };
  var count = function (el, to, d) {
    if (reduce || !to) { el.textContent = fmt(to, d); return; }
    var t0 = performance.now(), dur = 1200;
    (function tick(now) {
      var p = Math.min(1, (now - t0) / dur), e = 1 - Math.pow(1 - p, 3);
      el.textContent = fmt(to * e, d);
      if (p < 1) requestAnimationFrame(tick);
    })(t0);
  };
  fetch('/api/stats').then(function (r) { return r.ok ? r.json() : Promise.reject(); }).then(function (s) {
    var map = { checks: s.checks, receipts: s.receipts, spent: s.spentUsd };
    nums.forEach(function (el) { var k = el.getAttribute('data-stat'); count(el, Number(map[k]) || 0, k === 'spent'); });
    if (track && s.latest && s.latest.length) {
      var base = track.getAttribute('data-verify') || '';
      var links = s.latest.filter(function (x) { return /^0x[0-9a-fA-F]{64}$/.test(x.signalHash); }).map(function (x) {
        var a = document.createElement('a');
        a.href = base + '/engine/v1/signal/' + x.signalHash; a.target = '_blank'; a.rel = 'noopener';
        a.textContent = '✓ ' + x.signalHash.slice(0, 8) + '…' + x.signalHash.slice(-4);
        a.title = 'Verify this receipt on Telegraph';
        return a;
      });
      links.forEach(function (a) { track.appendChild(a); });
      if (!reduce) links.forEach(function (a) { var c = a.cloneNode(true); c.setAttribute('aria-hidden', 'true'); c.tabIndex = -1; track.appendChild(c); });
      if (!links.length) track.parentNode.hidden = true;
    } else if (track) track.parentNode.hidden = true;
  }).catch(function () { nums.forEach(function (el) { el.textContent = '–'; }); if (track) track.parentNode.hidden = true; });
})();
