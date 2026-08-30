
(function() {
  const THUMB_H = 270;
  let scrollTimer;

  function initSettingsScrollbar() {
    const nav = document.getElementById('settingsNav');
    const wrap = document.getElementById('settingsNavWrap');
    const thumb = document.getElementById('settingsScrollThumb');
    if (!nav || !wrap || !thumb) return;

    function update() {
      const scrollable = nav.scrollHeight - nav.clientHeight;
      if (scrollable <= 0) return;
      const trackH = nav.clientHeight;
      const ratio = nav.scrollTop / scrollable;
      const maxTop = trackH - THUMB_H;
      thumb.style.top = (ratio * maxTop) + 'px';
      wrap.classList.add('scrolling');
      clearTimeout(scrollTimer);
      scrollTimer = setTimeout(() => wrap.classList.remove('scrolling'), 900);
    }

    nav.addEventListener('scroll', update, { passive: true });
    new ResizeObserver(update).observe(nav);
    update();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initSettingsScrollbar);
  } else {
    initSettingsScrollbar();
  }
})();
