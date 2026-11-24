/* Verità landing: tiny vanilla JS. Spotlight and example chips. The form works without it. */
(function () {
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var spot = document.querySelector('.spot');
  if (spot && !reduce && window.matchMedia('(hover: hover)').matches) {
    window.addEventListener('pointermove', function (e) {
      spot.style.setProperty('--mx', e.clientX + 'px'); spot.style.setProperty('--my', e.clientY + 'px'); spot.classList.add('on');
    }, { passive: true });
  }
  var box = document.getElementById('text');
  document.querySelectorAll('.ex').forEach(function (b) {
    b.addEventListener('click', function () { if (box) { box.value = b.getAttribute('data-fill') || ''; box.focus(); } });
  });
  var tryIt = document.getElementById('try');
  if (tryIt && box) tryIt.addEventListener('click', function () { setTimeout(function () { box.focus({ preventScroll: true }); }, reduce ? 0 : 500); });
})();
