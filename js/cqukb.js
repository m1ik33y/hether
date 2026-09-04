
// Spotlight's center card and the playlist rows beside it are literally
// library card/row markup (same classes) so playback clicks, the "Now
// Playing" label, and the play/pause icon all just work via the existing
// lib-card/lib-row wiring (updateLibGridPlayingState matches on
// .lib-playable-item + data-index regardless of which view it's in).
async function renderSpotlightView() {
  await loadLibrary();
  renderSpotlightCard();
  renderSpotlightPlaylist();
}

function renderSpotlightCard() {
  const wrap = document.getElementById('spotlightCardWrap');
  const titleEl = document.getElementById('spotlightSongTitle');
  if (!wrap) return;
  if (!libSongsCache.length) {
    wrap.innerHTML = '<div class="spotlight-card-empty">No songs yet. Add some in Library.</div>';
    if (titleEl) titleEl.textContent = '';
    return;
  }
  const index = (libCurrentIndex !== null && libSongsCache[libCurrentIndex]) ? libCurrentIndex : 0;
  const song = libSongsCache[index];
  wrap.innerHTML = libCardHtml(song, index);
  if (titleEl) {
    titleEl.textContent = song.title || 'Untitled';
    fitSpotlightTitle();
  }
}

// Scales the title's font-size so the rendered text width lands at ~80% of
// the card's width, regardless of how long/short the song title is.
let spotlightTitleMeasureCanvas = null;
function fitSpotlightTitle() {
  const titleEl = document.getElementById('spotlightSongTitle');
  const wrap = document.getElementById('spotlightCardWrap');
  if (!titleEl || !wrap || !titleEl.textContent) return;
  const cardWidth = wrap.offsetWidth;
  if (!cardWidth) return;
  const targetWidth = cardWidth * 0.8;

  if (!spotlightTitleMeasureCanvas) spotlightTitleMeasureCanvas = document.createElement('canvas');
  const ctx = spotlightTitleMeasureCanvas.getContext('2d');
  const probeSize = 100;
  ctx.font = `800 ${probeSize}px 'DM Sans', sans-serif`;
  const measuredWidth = ctx.measureText(titleEl.textContent).width;
  if (!measuredWidth) return;

  let fontSize = (targetWidth / measuredWidth) * probeSize;
  fontSize = Math.max(20, Math.min(fontSize, 96)); // keep it readable either way
  titleEl.style.fontSize = fontSize + 'px';
}
window.addEventListener('resize', () => { if (currentView === 'notes') fitSpotlightTitle(); });

function renderSpotlightPlaylist() {
  const list = document.getElementById('spotlightPlaylist');
  if (!list) return;
  list.innerHTML = libSongsCache.length
    ? libSongsCache.map((s, i) => libRowHtml(s, i, i + 1)).join('')
    : '';
  loadLibCardDurations();
}

// ── FOCUS TIMER ──
let spotlightFocusInterval = null;
let spotlightFocusEndTime = null;
let spotlightFocusTotalSecs = 0;
let spotlightFocusActive = false;
let spotlightFocusPaused = false;
let spotlightFocusRemainingSecs = 0;

// Clicking "Start Focus" opens the duration picker; clicking it again while
// a session is running ("Stop Focus") ends the session early.
function startSpotlightFocus() {
  if (spotlightFocusActive) { stopSpotlightFocus(); return; }
  openFocusDurationPopup();
}

function openFocusDurationPopup() {
  const overlay = document.getElementById('focusDurationOverlay');
  if (!overlay) return;
  const customBtn = document.getElementById('focusCustomOptBtn');
  if (customBtn) {
    customBtn.classList.remove('is-custom');
    customBtn.innerHTML = 'Custom';
  }
  overlay.classList.add('show');
}

function closeFocusDurationPopup() {
  const overlay = document.getElementById('focusDurationOverlay');
  if (overlay) overlay.classList.remove('show');
}

function showFocusCustomInput() {
  const btn = document.getElementById('focusCustomOptBtn');
  if (!btn || btn.classList.contains('is-custom')) return;

  // Keep the button's exact box. Only replace its contents; do not change
  // display, padding, dimensions, transform, or animation.
  btn.classList.add('is-custom');
  btn.innerHTML = `
    <span class="focus-custom-inputs">
      <input class="focus-custom-input" id="focusCustomHr" type="number" min="0" max="8" aria-label="Hours" inputmode="numeric">
      <span class="focus-custom-divider"></span>
      <input class="focus-custom-input" id="focusCustomMin" type="number" min="0" max="59" aria-label="Minutes" inputmode="numeric">
    </span>
  `;

  btn.querySelectorAll('.focus-custom-input').forEach(input => {
    input.addEventListener('click', e => e.stopPropagation());
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); confirmFocusCustom(); }
    });
  });

  const input = document.getElementById('focusCustomHr');
  if (input) input.focus();
}

function confirmFocusCustom() {
  const hrInput = document.getElementById('focusCustomHr');
  const minInput = document.getElementById('focusCustomMin');
  const hrs = parseInt(hrInput && hrInput.value, 10) || 0;
  const mins = parseInt(minInput && minInput.value, 10) || 0;
  const totalMins = hrs * 60 + mins;
  if (totalMins < 1) { (minInput || hrInput)?.focus(); return; }
  selectFocusDuration(totalMins);
}

function selectFocusDuration(minutes) {
  closeFocusDurationPopup();
  beginFocusSession(minutes);
}

function formatFocusTime(totalSecs) {
  const m = Math.floor(totalSecs / 60);
  const s = totalSecs % 60;
  return { mins: String(m).padStart(2, '0'), secs: String(s).padStart(2, '0') };
}

function renderFocusTime(totalSecs) {
  const { mins, secs } = formatFocusTime(totalSecs);
  const minsEl = document.getElementById('spotlightTimerMins');
  const secsEl = document.getElementById('spotlightTimerSecs');
  if (minsEl) minsEl.textContent = mins;
  if (secsEl) secsEl.textContent = secs;
}

// Opens the timer with a scroll/expand animation above the spotlight
// layout, pushing it down, and flips the button to "Stop Focus".
function beginFocusSession(minutes) {
  spotlightFocusTotalSecs = Math.max(1, Math.round(minutes * 60));
  spotlightFocusEndTime = Date.now() + spotlightFocusTotalSecs * 1000;
  spotlightFocusActive = true;
  spotlightFocusPaused = false;
  spotlightFocusRemainingSecs = spotlightFocusTotalSecs;

  const wrap = document.getElementById('spotlightTimerWrap');
  const btn = document.getElementById('spotlightStartBtn');
  const pauseBtn = document.getElementById('spotlightPauseBtn');

  renderFocusTime(spotlightFocusTotalSecs);
  setSpotlightWaveProgress(1);

  if (wrap) requestAnimationFrame(() => wrap.classList.add('open'));

  if (btn) {
    btn.textContent = 'Stop Focus';
    btn.classList.add('is-focusing');
  }
  if (pauseBtn) {
    pauseBtn.style.display = '';
    pauseBtn.textContent = 'Pause';
    pauseBtn.classList.remove('is-focusing');
  }

  if (spotlightFocusInterval) clearInterval(spotlightFocusInterval);
  spotlightFocusInterval = setInterval(tickSpotlightFocus, 250);
  tickSpotlightFocus();
}

// Pauses the countdown in place (keeps remaining time and bar position) or
// resumes it by re-deriving the end time from the frozen remaining seconds.
function toggleSpotlightPause() {
  if (!spotlightFocusActive) return;
  const pauseBtn = document.getElementById('spotlightPauseBtn');

  if (spotlightFocusPaused) {
    spotlightFocusPaused = false;
    spotlightFocusEndTime = Date.now() + spotlightFocusRemainingSecs * 1000;
    if (spotlightFocusInterval) clearInterval(spotlightFocusInterval);
    spotlightFocusInterval = setInterval(tickSpotlightFocus, 250);
    if (pauseBtn) { pauseBtn.textContent = 'Pause'; pauseBtn.classList.remove('is-focusing'); }
  } else {
    spotlightFocusPaused = true;
    if (spotlightFocusInterval) { clearInterval(spotlightFocusInterval); spotlightFocusInterval = null; }
    if (pauseBtn) { pauseBtn.textContent = 'Resume'; pauseBtn.classList.add('is-focusing'); }
  }
}

// Draws progress as a vertical bar beside the timestamp, filling from
// full height down to 0 as the remaining time (100% to 0%) ticks down.
function setSpotlightWaveProgress(fraction) {
  const bar = document.getElementById('spotlightTimerBarFill');
  if (!bar) return;
  const pct = Math.max(0, Math.min(1, fraction)) * 100;
  bar.style.height = pct + '%';
}

function tickSpotlightFocus() {
  if (!spotlightFocusActive || spotlightFocusPaused) return;
  const remainingMs = spotlightFocusEndTime - Date.now();
  const remainingSecs = Math.max(0, Math.round(remainingMs / 1000));
  spotlightFocusRemainingSecs = remainingSecs;

  renderFocusTime(remainingSecs);
  if (spotlightFocusTotalSecs > 0) {
    setSpotlightWaveProgress(remainingSecs / spotlightFocusTotalSecs);
  }

  if (remainingSecs <= 0) finishSpotlightFocus();
}

function finishSpotlightFocus() {
  stopSpotlightFocus(800);
}

// Collapses the timer back closed and resets the button. `delayMs` lets a
// finished countdown sit at 00:00 briefly before closing; a manual stop
// closes immediately.
function stopSpotlightFocus(delayMs) {
  spotlightFocusActive = false;
  spotlightFocusPaused = false;
  if (spotlightFocusInterval) { clearInterval(spotlightFocusInterval); spotlightFocusInterval = null; }

  const btn = document.getElementById('spotlightStartBtn');
  if (btn) {
    btn.textContent = 'Start Focus';
    btn.classList.remove('is-focusing');
  }
  const pauseBtn = document.getElementById('spotlightPauseBtn');
  if (pauseBtn) {
    pauseBtn.style.display = 'none';
    pauseBtn.textContent = 'Pause';
    pauseBtn.classList.remove('is-focusing');
  }

  const collapse = () => {
    const wrap = document.getElementById('spotlightTimerWrap');
    if (wrap) wrap.classList.remove('open');
  };
  if (delayMs) setTimeout(collapse, delayMs); else collapse();
}

document.getElementById('focusCustomHr')?.addEventListener('keydown', e => {
  if (e.key === 'Enter') { e.preventDefault(); confirmFocusCustom(); }
});
document.getElementById('focusCustomMin')?.addEventListener('keydown', e => {
  if (e.key === 'Enter') { e.preventDefault(); confirmFocusCustom(); }
});
document.getElementById('focusDurationOverlay')?.addEventListener('keydown', e => {
  if (e.key === 'Escape') closeFocusDurationPopup();
});
document.getElementById('focusDurationOverlay')?.addEventListener('click', e => {
  if (e.target.id === 'focusDurationOverlay') closeFocusDurationPopup();
});
