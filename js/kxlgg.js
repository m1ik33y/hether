let profileDropdownOpen = false;
function toggleProfileDropdown() {
  var dropdown = document.getElementById('profileDropdown');
  // Reset any mobile positioning
  dropdown.style.left = '';
  dropdown.style.right = '';
  dropdown.style.top = '';
  dropdown.style.bottom = '';
  profileDropdownOpen = !profileDropdownOpen;
  dropdown.classList.toggle('show', profileDropdownOpen);
}
function closeProfileDropdown() {
  profileDropdownOpen = false;
  document.getElementById('profileDropdown').classList.remove('show');
  document.getElementById('pdAccounts').classList.remove('show');
  document.getElementById('switchArrow').style.transform = '';
}
function toggleProfileDropdownMobile() {
  var dropdown = document.getElementById('profileDropdown');
  var btn = document.getElementById('mobileProfileBtn');
  var rect = btn.getBoundingClientRect();
  dropdown.style.left = 'auto';
  dropdown.style.right = '8px';
  dropdown.style.bottom = 'auto';
  dropdown.style.top = (rect.bottom + 8) + 'px';
  profileDropdownOpen = !profileDropdownOpen;
  dropdown.classList.toggle('show', profileDropdownOpen);
}
document.addEventListener('click', function(e) {
  var profileBtn = document.getElementById('profileBtn');
  var mobileProfileBtn = document.getElementById('mobileProfileBtn');
  var dropdown = document.getElementById('profileDropdown');
  var clickedTrigger = (profileBtn && profileBtn.contains(e.target)) || (mobileProfileBtn && mobileProfileBtn.contains(e.target));
  if (!clickedTrigger && !dropdown.contains(e.target)) closeProfileDropdown();
});

let accountSwitcherOpen = false;
function toggleAccountSwitcher() {
  accountSwitcherOpen = !accountSwitcherOpen;
  document.getElementById('pdAccounts').classList.toggle('show', accountSwitcherOpen);
  document.getElementById('switchArrow').style.transform = accountSwitcherOpen ? 'rotate(90deg)' : '';
}
function switchAccount(idx) {
  closeProfileDropdown();
  // Only the current account (idx 0) is valid; guest mode removed
}
function addAccount() { closeProfileDropdown(); alert('Add account flow — integrate your auth provider here.'); }

function logOut() { closeProfileDropdown(); document.getElementById('logoutOverlay').classList.add('show'); }
function closeLogout() { document.getElementById('logoutOverlay').classList.remove('show'); }
async function confirmLogout() {
  await supabaseClient.auth.signOut();
  currentUser = null;
  window._cachedUserRole = undefined;
  vaultAuthenticated = false;
  _vaultSessionValid = false;
  profile = { name: 'User', username: '@user', email: 'user@example.com', avatarUrl: null };
  renderProfileEverywhere();
  showAuthPage();
}

// ── PROFILE DETAILS POPUP ──
function openProfileEdit() {
  closeProfileDropdown();
  const input = document.getElementById('pdpDisplayName');
  if (input) input.value = profile.name;
  const avEl = document.getElementById('pdpAvatar');
  if (avEl) setAvatarEl(avEl, profile.avatarUrl);
  document.getElementById('profileEditOverlay').classList.add('show');
  setTimeout(() => input && input.focus(), 50);
}
function closeProfileEdit() { document.getElementById('profileEditOverlay')?.classList.remove('show'); }
function openAvatarPicker() { document.getElementById('bannerAvatarUpload').click(); }

async function saveProfileDetails() {
  const input = document.getElementById('pdpDisplayName');
  const newName = input ? input.value.trim() : '';
  if (newName && newName !== profile.name) {
    try {
      const { data: { user } } = await supabaseClient.auth.getUser();
      await supabaseClient.from('profiles').update({ display_name: newName }).eq('id', user.id);
      profile.name = newName;
      renderProfileEverywhere();
    } catch (e) { /* keep previous name on failure */ }
  }
  closeProfileEdit();
}

// ── AVATAR CROP MODAL ──
let _cropImg = null;
let _cropFile = null;
let _cropOffX = 0, _cropOffY = 0;
let _cropScale = 1;
let _cropBaseScale = 1;
let _cropCircleR = 0, _cropCircleCX = 0, _cropCircleCY = 0;
let _cropCanvasSize = 0;
let _cropDragging = false;
let _cropDragSX = 0, _cropDragSY = 0, _cropDragOX = 0, _cropDragOY = 0;

// Open: read file → show modal → THEN init (double rAF ensures layout paint)
// ── CROP STATE ──
// _cropBox: { x, y, w, h } in canvas (display) pixels
// _cropImg, _cropOffX/Y, _cropScale: image position/scale
// _cropActiveHandle: null | 'tl'|'tr'|'bl'|'br'|'t'|'b'|'l'|'r'|'move'

let _cropBox = { x: 0, y: 0, w: 0, h: 0 };
let _cropActiveHandle = null;
let _cropHandleSX = 0, _cropHandleSY = 0;
let _cropHandleStartBox = null;
let _cropHandleStartOff = null;

const MIN_CROP = 60; // minimum crop box side length in px

function openCropModal(e) {
  const file = e.target.files[0];
  if (!file) return;
  _cropFile = file;
  e.target.value = '';
  const reader = new FileReader();
  reader.onload = ev => {
    const img = new Image();
    img.onload = () => {
      _cropImg = img;
      document.getElementById('avatarCropOverlay').classList.add('show');
      requestAnimationFrame(() => requestAnimationFrame(() => initCropCanvas()));
    };
    img.src = ev.target.result;
  };
  reader.readAsDataURL(file);
}

function initCropCanvas() {
  const wrap = document.getElementById('acmCanvasWrap');
  const canvas = document.getElementById('acmCanvas');
  const wSize = wrap.offsetWidth || 380;
  _cropCanvasSize = wSize;
  canvas.width = wSize;
  canvas.height = wSize;

  // Default: fit image at 100% (natural size capped to canvas)
  const fitScale = Math.min(wSize / _cropImg.width, wSize / _cropImg.height, 1);
  _cropScale = fitScale;
  _cropOffX = (wSize - _cropImg.width * _cropScale) / 2;
  _cropOffY = (wSize - _cropImg.height * _cropScale) / 2;

  // Initial crop box: 80% of canvas, centered and square
  const boxSize = Math.round(wSize * 0.80);
  _cropBox = {
    x: Math.round((wSize - boxSize) / 2),
    y: Math.round((wSize - boxSize) / 2),
    w: boxSize,
    h: boxSize
  };

  document.getElementById('acmApplyBtn').onclick = applyCrop;

  renderCropFrame();
  positionCropUI();
  renderPreview();
  setupCropPointerEvents();
}

function renderCropFrame() {
  if (!_cropImg) return;
  const canvas = document.getElementById('acmCanvas');
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(_cropImg, _cropOffX, _cropOffY,
    _cropImg.width * _cropScale, _cropImg.height * _cropScale);
}

function positionCropUI() {
  const { x, y, w, h } = _cropBox;
  const S = _cropCanvasSize;

  // Dim panels
  const dimT = document.getElementById('acmDimTop');
  const dimB = document.getElementById('acmDimBottom');
  const dimL = document.getElementById('acmDimLeft');
  const dimR = document.getElementById('acmDimRight');
  if (dimT) { dimT.style.cssText = `position:absolute;background:rgba(40,40,44,0.6);pointer-events:none;top:0;left:0;width:${S}px;height:${y}px;`; }
  if (dimB) { dimB.style.cssText = `position:absolute;background:rgba(40,40,44,0.6);pointer-events:none;top:${y+h}px;left:0;width:${S}px;height:${S-(y+h)}px;`; }
  if (dimL) { dimL.style.cssText = `position:absolute;background:rgba(40,40,44,0.6);pointer-events:none;top:${y}px;left:0;width:${x}px;height:${h}px;`; }
  if (dimR) { dimR.style.cssText = `position:absolute;background:rgba(40,40,44,0.6);pointer-events:none;top:${y}px;left:${x+w}px;width:${S-(x+w)}px;height:${h}px;`; }

  // Crop box
  const box = document.getElementById('acmCropBox');
  if (box) {
    box.style.left = x + 'px';
    box.style.top = y + 'px';
    box.style.width = w + 'px';
    box.style.height = h + 'px';
  }

  // Circle inside crop box
  const circ = document.getElementById('acmCropCircle');
  if (circ) {
    const cs = Math.min(w, h);
    const cx = (w - cs) / 2, cy = (h - cs) / 2;
    circ.style.left = cx + 'px';
    circ.style.top = cy + 'px';
    circ.style.width = cs + 'px';
    circ.style.height = cs + 'px';
  }

  // Corner handles (positioned relative to wrap)
  const hl = 24, he = 22;
  const setHandle = (id, left, top) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.style.left = left + 'px';
    el.style.top  = top  + 'px';
  };
  setHandle('acmHtl', x - hl/2, y - hl/2);
  setHandle('acmHtr', x + w - hl/2, y - hl/2);
  setHandle('acmHbl', x - hl/2, y + h - hl/2);
  setHandle('acmHbr', x + w - hl/2, y + h - hl/2);

  // Edge handles
  const edgeEl = (id, left, top) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.style.left = left + 'px';
    el.style.top  = top  + 'px';
    el.style.transform = '';
  };
  edgeEl('acmHt',  x + w/2 - 18, y - 2);
  edgeEl('acmHb',  x + w/2 - 18, y + h - 2);
  edgeEl('acmHl',  x - 2,        y + h/2 - 18);
  edgeEl('acmHr',  x + w - 2,    y + h/2 - 18);
}

function renderPreview() {
  if (!_cropImg) return;
  const prev = document.getElementById('acmPreviewCanvas');
  const ctx = prev.getContext('2d');
  const size = 52;
  prev.width = size; prev.height = size;
  ctx.clearRect(0, 0, size, size);
  ctx.beginPath();
  ctx.arc(size/2, size/2, size/2, 0, Math.PI * 2);
  ctx.clip();
  const { x, y, w, h } = _cropBox;
  const scaleX = size / w, scaleY = size / h;
  ctx.drawImage(_cropImg,
    (_cropOffX - x) * scaleX,
    (_cropOffY - y) * scaleY,
    _cropImg.width  * _cropScale * scaleX,
    _cropImg.height * _cropScale * scaleY
  );
}

function clampImageOffset() {
  const iw = _cropImg.width  * _cropScale;
  const ih = _cropImg.height * _cropScale;
  const { x, y, w, h } = _cropBox;
  if (_cropOffX > x)        _cropOffX = x;
  if (_cropOffY > y)        _cropOffY = y;
  if (_cropOffX + iw < x+w) _cropOffX = x + w - iw;
  if (_cropOffY + ih < y+h) _cropOffY = y + h - ih;
}

function clampCropBox() {
  const S = _cropCanvasSize;
  _cropBox.w = Math.max(MIN_CROP, _cropBox.w);
  _cropBox.h = Math.max(MIN_CROP, _cropBox.h);
  _cropBox.x = Math.max(0, Math.min(S - _cropBox.w, _cropBox.x));
  _cropBox.y = Math.max(0, Math.min(S - _cropBox.h, _cropBox.y));
  _cropBox.w = Math.min(_cropBox.w, S - _cropBox.x);
  _cropBox.h = Math.min(_cropBox.h, S - _cropBox.y);
}

function setupCropPointerEvents() {
  const wrap = document.getElementById('acmCanvasWrap');
  if (wrap._cropCleanup) wrap._cropCleanup();

  const handles = wrap.querySelectorAll('.acm-handle');

  const onHandleDown = e => {
    e.preventDefault();
    e.stopPropagation();
    _cropActiveHandle = e.currentTarget.dataset.handle;
    _cropHandleSX = e.clientX;
    _cropHandleSY = e.clientY;
    _cropHandleStartBox = { ..._cropBox };
    document.addEventListener('pointermove', onHandleMove);
    document.addEventListener('pointerup', onHandleUp);
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onHandleMove = e => {
    if (!_cropActiveHandle) return;
    const dx = e.clientX - _cropHandleSX;
    const dy = e.clientY - _cropHandleSY;
    const { x: sx, y: sy, w: sw, h: sh } = _cropHandleStartBox;
    const S = _cropCanvasSize;
    let { x, y, w, h } = { x: sx, y: sy, w: sw, h: sh };

    const handle = _cropActiveHandle;
    if (handle === 'tl' || handle === 'l' || handle === 'bl') {
      const newX = Math.max(0, Math.min(sx + sw - MIN_CROP, sx + dx));
      w = sw - (newX - sx); x = newX;
    }
    if (handle === 'tr' || handle === 'r' || handle === 'br') {
      w = Math.max(MIN_CROP, Math.min(S - sx, sw + dx));
    }
    if (handle === 'tl' || handle === 't' || handle === 'tr') {
      const newY = Math.max(0, Math.min(sy + sh - MIN_CROP, sy + dy));
      h = sh - (newY - sy); y = newY;
    }
    if (handle === 'bl' || handle === 'b' || handle === 'br') {
      h = Math.max(MIN_CROP, Math.min(S - sy, sh + dy));
    }

    _cropBox = { x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) };
    clampCropBox();
    renderCropFrame();
    positionCropUI();
    renderPreview();
  };

  const onHandleUp = e => {
    _cropActiveHandle = null;
    document.removeEventListener('pointermove', onHandleMove);
    document.removeEventListener('pointerup', onHandleUp);
  };

  handles.forEach(h => h.addEventListener('pointerdown', onHandleDown));

  // Image pan (on wrap, not on handles)
  const onDown = e => {
    if (e.target.classList.contains('acm-handle')) return;
    e.preventDefault();
    _cropDragging = true;
    wrap.style.cursor = 'grabbing';
    wrap.setPointerCapture(e.pointerId);
    _cropDragSX = e.clientX; _cropDragSY = e.clientY;
    _cropDragOX = _cropOffX; _cropDragOY = _cropOffY;
  };
  const onMove = e => {
    if (!_cropDragging) return;
    _cropOffX = _cropDragOX + (e.clientX - _cropDragSX);
    _cropOffY = _cropDragOY + (e.clientY - _cropDragSY);
    clampImageOffset();
    renderCropFrame();
    renderPreview();
  };
  const onUp = () => {
    _cropDragging = false;
    wrap.style.cursor = 'grab';
  };

  wrap.addEventListener('pointerdown', onDown);
  wrap.addEventListener('pointermove', onMove);
  wrap.addEventListener('pointerup', onUp);
  wrap.addEventListener('pointercancel', onUp);

  wrap._cropCleanup = () => {
    handles.forEach(h => h.removeEventListener('pointerdown', onHandleDown));
    wrap.removeEventListener('pointerdown', onDown);
    wrap.removeEventListener('pointermove', onMove);
    wrap.removeEventListener('pointerup', onUp);
    wrap.removeEventListener('pointercancel', onUp);
    document.removeEventListener('pointermove', onHandleMove);
    document.removeEventListener('pointerup', onHandleUp);
  };
}

function closeCropModal() {
  document.getElementById('avatarCropOverlay').classList.remove('show');
  _cropImg = null; _cropFile = null; _cropDragging = false; _cropActiveHandle = null;
}

async function applyCrop() {
  if (!_cropImg) return;
  const btn = document.getElementById('acmApplyBtn');
  btn.disabled = true; btn.textContent = 'Uploading…';
  const OUT = 400;
  const off = document.createElement('canvas');
  off.width = OUT; off.height = OUT;
  const ctx = off.getContext('2d');
  ctx.beginPath(); ctx.arc(OUT/2, OUT/2, OUT/2, 0, Math.PI * 2); ctx.clip();
  const { x, y, w, h } = _cropBox;
  const pxPer = OUT / Math.min(w, h);
  const srcX = x, srcY = y;
  ctx.drawImage(_cropImg,
    (_cropOffX - srcX) * pxPer, (_cropOffY - srcY) * pxPer,
    _cropImg.width * _cropScale * pxPer, _cropImg.height * _cropScale * pxPer);
  off.toBlob(async blob => {
    closeCropModal();
    await uploadCroppedAvatar(new File([blob], 'avatar.png', { type: 'image/png' }));
    btn.disabled = false; btn.textContent = 'Save';
  }, 'image/png', 0.92);
}

async function uploadCroppedAvatar(file) {
  const { data: { user } } = await supabaseClient.auth.getUser();
  if (!user) return;
  const { data: existingProfile } = await supabaseClient.from('profiles').select('avatar_url').eq('id', user.id).single();
  if (existingProfile?.avatar_url) {
    try { const path = existingProfile.avatar_url.split('/avatars/')[1]; if (path) await supabaseClient.storage.from('avatars').remove([path]); } catch (err) {}
  }
  const filePath = `${user.id}/avatar.png`;
  const { error: uploadError } = await supabaseClient.storage.from('avatars').upload(filePath, file, { upsert: true });
  if (uploadError) { alert('Upload failed: ' + uploadError.message); return; }
  const { data } = supabaseClient.storage.from('avatars').getPublicUrl(filePath);
  const publicUrl = data.publicUrl + `?t=${Date.now()}`;
  const { error: dbError } = await supabaseClient.from('profiles').update({ avatar_url: publicUrl }).eq('id', user.id);
  if (dbError) { alert('DB update failed: ' + dbError.message); return; }
  profile.avatarUrl = publicUrl;
  renderProfileEverywhere();
}

async function handleAvatarUpload(e) {
  const file = e.target.files[0];
  if (!file) return;
  const { data: { user } } = await supabaseClient.auth.getUser();
  if (!user) return;
  const { data: existingProfile } = await supabaseClient.from('profiles').select('avatar_url').eq('id', user.id).single();
  if (existingProfile?.avatar_url) {
    try { const path = existingProfile.avatar_url.split('/avatars/')[1]; if (path) await supabaseClient.storage.from('avatars').remove([path]); } catch (err) {}
  }
  const fileExt = file.name.split('.').pop();
  const filePath = `${user.id}/avatar.${fileExt}`;
  const { error: uploadError } = await supabaseClient.storage.from('avatars').upload(filePath, file, { upsert: true });
  if (uploadError) { alert('Upload failed: ' + uploadError.message); return; }
  const { data } = supabaseClient.storage.from('avatars').getPublicUrl(filePath);
  const publicUrl = data.publicUrl + `?t=${Date.now()}`;
  const { error: dbError } = await supabaseClient.from('profiles').update({ avatar_url: publicUrl }).eq('id', user.id);
  if (dbError) { alert('DB update failed: ' + dbError.message); return; }
  profile.avatarUrl = publicUrl;
  renderProfileEverywhere();
}

async function removeAvatar() {
  const { data: { user } } = await supabaseClient.auth.getUser();
  if (!user) return;
  const { data } = await supabaseClient.from('profiles').select('avatar_url').eq('id', user.id).single();
  if (data?.avatar_url) {
    try { const path = data.avatar_url.split('/avatars/')[1]; if (path) await supabaseClient.storage.from('avatars').remove([path]); } catch (err) {}
  }
  await supabaseClient.from('profiles').update({ avatar_url: null }).eq('id', user.id);
  profile.avatarUrl = null;
  renderProfileEverywhere();
  const bannerUpload = document.getElementById('bannerAvatarUpload');
  if (bannerUpload) bannerUpload.value = '';
}

function clearHistory() { relayHistory = []; newRelay(); }

// ── KEYBOARD SHORTCUTS ──
document.addEventListener('keydown', e => {
  if (e.altKey && e.key === 'k') {
    if (window._guestMode) return; // disabled in guest / "Try for Free" mode
    e.preventDefault();
    const vaultOpen = document.getElementById('vaultOverlay').classList.contains('show');
    if (vaultOpen) { closeVaultPopup(); return; }
    if (fluxOpen) { closeFLUX(); return; }
    openVaultPopup();
  }
  if (e.altKey && e.key === 'Backspace') {
    e.preventDefault();
    if (fluxOpen && activeFluxId) handleFluxHeaderClear();
  }
  if (e.key === 'Escape') {
    if (fluxOpen) { closeFLUX(); return; }
    if (document.getElementById('vaultOverlay')?.classList.contains('show')) { closeVaultPopup(); return; }
    if (document.getElementById('clearRelayOverlay').classList.contains('show')) { closeClearRelayConfirm(); return; }
    if (document.getElementById('confirmOverlay').classList.contains('show')) { closeConfirm(); return; }
    closeMsgActionMenu(); closeProfileEdit(); closeLogout(); closeProfileDropdown(); closeLightbox(); closeCtxMenu();
  }
});

showView('explore');
