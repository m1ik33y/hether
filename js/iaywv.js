
/* ══════════════════════════════════════════════
   ALOFT — black & white pixel platformer
   Player-controlled: A/D or arrows to move
   SPACE / W / ↑ to jump. Gravity. Camera tracks player.
   Regions: Sky → Ruins → Storm → Crystal → repeats
══════════════════════════════════════════════ */
(function() {

// ── CANVAS / WORLD DIMENSIONS ──
// The canvas fills the aloftView div minus sidebar
// We use a virtual grid (VIRT_W × VIRT_H game units) rendered at SCALE px each
const SCALE = 3;
let VIRT_W = 160;    // game units wide — recalculated on resize to match screen aspect (full screen)
let VIRT_H = 120;  // game units tall (viewport) — recalculated on resize for narrow/portrait screens
let canvas, ctx, viewW, viewH;
let raf = null;
// Fixed-timestep physics: keeps jump/move speed consistent across all monitor
// refresh rates (60Hz, 90Hz, 120Hz, 144Hz...) instead of tying speed to how
// often requestAnimationFrame fires.
const ALOFT_STEP_MS = 1000 / 60; // update() always represents 1/60th of a second
const ALOFT_MAX_STEPS = 5;       // cap catch-up steps (e.g. after tab was backgrounded)
let aloftAccumulator = 0;
let aloftLastTime = null;
let gameState = 'start';

// ── REGIONS (all black & white tones) ──
const REGIONS = [
  { name: 'Sky',     scoreStart: 0,   style: 'cloud',   bgDark: '#000',  bgLight: '#111', starDensity: 8 },
  { name: 'Ruins',   scoreStart: 120, style: 'pillar',  bgDark: '#000',  bgLight: '#0a0a0a', starDensity: 20 },
  { name: 'Storm',   scoreStart: 280, style: 'storm',   bgDark: '#000',  bgLight: '#050505', starDensity: 4 },
  { name: 'Crystal', scoreStart: 480, style: 'crystal', bgDark: '#000',  bgLight: '#080808', starDensity: 30 },
  { name: 'Castle',  scoreStart: 700, style: 'castle',  bgDark: '#000',  bgLight: '#0a0a0a', starDensity: 10 },
];
function getRegion(sc) {
  let r = REGIONS[0];
  for (let i = REGIONS.length - 1; i >= 0; i--) {
    if (sc >= REGIONS[i].scoreStart) { r = REGIONS[i]; break; }
  }
  return r;
}

// ── PLAYER SPRITE (8×12, 0=transparent, 1=white body, 2=light grey, 3=dark outline) ──
const PW = 8, PH = 12;
const C = { _: 0, W: 1, G: 2, D: 3 }; // transparent, white, grey, dark
const S_IDLE1 = [
  0,0,3,3,3,3,0,0,
  0,3,2,2,2,2,3,0,
  0,3,2,1,1,2,3,0,
  0,3,2,1,1,2,3,0,
  0,0,3,1,1,3,0,0,
  0,3,1,2,2,1,3,0,
  0,3,1,1,1,1,3,0,
  0,0,3,2,2,3,0,0,
  0,3,2,0,0,2,3,0,
  0,3,2,0,0,2,3,0,
  0,3,1,0,0,1,3,0,
  0,0,3,0,0,3,0,0,
];
const S_IDLE2 = [
  0,0,3,3,3,3,0,0,
  0,3,2,2,2,2,3,0,
  0,3,2,1,1,2,3,0,
  0,3,2,1,1,2,3,0,
  0,0,3,1,1,3,0,0,
  0,3,1,2,2,1,3,0,
  0,3,1,1,1,1,3,0,
  0,0,3,2,2,3,0,0,
  0,3,2,3,0,2,0,0,
  3,2,0,3,0,2,0,0,
  3,1,0,0,1,3,0,0,
  0,3,0,0,3,0,0,0,
];
const S_JUMP = [
  0,0,3,3,3,3,0,0,
  0,3,2,2,2,2,3,0,
  0,3,2,1,1,2,3,0,
  3,1,3,1,1,3,1,3,
  3,1,1,3,3,1,1,3,
  0,3,1,2,2,1,3,0,
  0,3,1,1,1,1,3,0,
  0,0,3,2,2,3,0,0,
  0,0,3,2,2,3,0,0,
  0,0,3,2,2,3,0,0,
  0,0,3,1,1,3,0,0,
  0,0,0,3,3,0,0,0,
];
const SPAL = ['', '#ffffff', '#aaaaaa', '#222222'];

function drawSprite(data, px, py, flip) {
  for (let row = 0; row < PH; row++) {
    for (let col = 0; col < PW; col++) {
      const c = data[row * PW + (flip ? PW - 1 - col : col)];
      if (!c) continue;
      ctx.fillStyle = SPAL[c];
      ctx.fillRect((px + col) * SCALE, (py + row) * SCALE, SCALE, SCALE);
    }
  }
}

// ── PLATFORM DRAWING (B&W pixel art per region) ──
function drawPlatform(p, style, camY) {
  const sx = p.x;
  const sy = p.y - camY;
  if (sy + 6 < 0 || sy > VIRT_H + 2) return;
  switch (style) {
    case 'cloud': drawCloud(sx, sy, p.w); break;
    case 'pillar': drawPillar(sx, sy, p.w); break;
    case 'storm': drawStorm(sx, sy, p.w); break;
    case 'crystal': drawCrystal(sx, sy, p.w); break;
    case 'castle': drawIsland(sx, sy, p.w); break;
  }
}

function px(x, y, col) { ctx.fillStyle = col; ctx.fillRect(x * SCALE, y * SCALE, SCALE, SCALE); }

function drawCloud(x, y, w) {
  // Rounded multi-lump cloud silhouette (light/mid/dark grey shading)
  const lumpW = 6;
  const lumps = Math.max(2, Math.round(w / lumpW));

  // main body (slightly inset from edges, rounded ends)
  for (let i = 1; i < w - 1; i++) {
    px(x+i, y, '#ffffff');
    px(x+i, y+1, (i % 4 === 1) ? '#cccccc' : '#eeeeee');
  }
  px(x, y+0, '#eeeeee');
  px(x+w-1, y+0, '#eeeeee');

  // rounded lumps along the top — each lump is a 3-pixel-tall rounded bump
  for (let l = 0; l < lumps; l++) {
    const cx = x + Math.floor((l + 0.5) * (w / lumps));
    const r = 2 + (l % 2); // alternate bump sizes for organic look
    for (let dx = -r; dx <= r; dx++) {
      const px_ = cx + dx;
      if (px_ < x || px_ >= x + w) continue;
      const dist = Math.abs(dx);
      if (dist <= r - 1) px(px_, y - 2, dist === 0 ? '#ffffff' : '#f5f5f5');
      if (dist <= r)     px(px_, y - 1, '#ffffff');
    }
  }

  // bottom shading row, inset (stepped underside, rounded corners)
  for (let i = 1; i < w - 1; i++) {
    px(x+i, y+2, '#cccccc');
  }
  for (let i = 2; i < w - 2; i++) {
    px(x+i, y+3, '#999999');
  }
}

function drawPillar(x, y, w) {
  // Flat baseplate styled as a horizontal row of broken stone pillar segments
  const seed = Math.floor((x * 7 + y * 13));
  const segW = 6; // each "drum" segment width

  for (let i = 0; i < w; i++) {
    const seg = Math.floor(i / segW);
    const localX = i % segW;
    const segSeed = (seed + seg) % 4;

    // top surface line
    px(x+i, y, '#ffffff');
    // body
    let tone = (localX === 0 || localX === segW - 1) ? '#999999' : '#cccccc'; // seam lines between segments
    if (segSeed === 1 && localX === 2) tone = '#444444'; // crack
    if (segSeed === 2 && localX === 4) tone = '#888888'; // shading
    px(x+i, y+1, tone);
    // bottom shading
    px(x+i, y+2, '#888888');
  }
}

function drawStorm(x, y, w) {
  // Same rounded cloud silhouette but darker/stormy tones
  const lumpW = 6;
  const lumps = Math.max(2, Math.round(w / lumpW));

  for (let i = 1; i < w - 1; i++) {
    px(x+i, y, '#cccccc');
    px(x+i, y+1, (i % 4 === 1) ? '#888888' : '#aaaaaa');
  }
  px(x, y, '#aaaaaa');
  px(x+w-1, y, '#aaaaaa');

  for (let l = 0; l < lumps; l++) {
    const cx = x + Math.floor((l + 0.5) * (w / lumps));
    const r = 2 + (l % 2);
    for (let dx = -r; dx <= r; dx++) {
      const px_ = cx + dx;
      if (px_ < x || px_ >= x + w) continue;
      const dist = Math.abs(dx);
      if (dist <= r - 1) px(px_, y - 2, dist === 0 ? '#cccccc' : '#bbbbbb');
      if (dist <= r)     px(px_, y - 1, '#cccccc');
    }
  }

  for (let i = 1; i < w - 1; i++) px(x+i, y+2, '#888888');
  for (let i = 2; i < w - 2; i++) px(x+i, y+3, '#555555');

  // Wind streaks flying past
  const t = Math.floor(Date.now() / 80);
  for (let s = 0; s < 3; s++) {
    const sy = y - 4 - s * 3;
    const sx = (x - ((t * (3+s)) % (w + 20)));
    px(sx, sy, '#ffffff');
    px(sx+1, sy, '#ffffff');
    px(sx+2, sy, '#aaaaaa');
  }
}

function drawCrystal(x, y, w) {
  // Faceted crystal spires
  for (let i = 0; i < w; i++) {
    const v = i % 4;
    ctx.fillStyle = v === 0 ? '#ffffff' : v === 1 ? '#cccccc' : v === 2 ? '#888888' : '#555555';
    ctx.fillRect((x+i)*SCALE, y*SCALE, SCALE, SCALE*3);
    if (i % 2 === 0 && i < w-1) {
      px(x+i, y-1, '#ffffff');
      px(x+i, y-2, '#cccccc');
      if (i % 4 === 0) px(x+i, y-3, '#ffffff');
    }
  }
}

function drawFloater(x, y, w, style) {
  // Draw moving block to match the region it belongs to
  if (style === 'castle') {
    drawIsland(x, y, w);
  } else {
    // 'cloud' region (and default) — draw a moving cloud
    drawCloud(x, y, w);
  }
}

function drawCrow(x, y, dir, flap) {
  // Simple 6x3 pixel crow silhouette, wings flap up/down, flies horizontally
  const up = Math.sin(flap) > 0;
  const f = Math.round(x), gy = Math.round(y);
  ctx.fillStyle = '#ffffff';
  // body
  px(f+2, gy+1, '#ffffff'); px(f+3, gy+1, '#ffffff');
  // head (front depends on direction)
  px(f + (dir === 1 ? 4 : 1), gy, '#ffffff');
  // wings
  if (up) {
    px(f+1, gy, '#ffffff'); px(f+4, gy, '#ffffff');
  } else {
    px(f+1, gy+2, '#ffffff'); px(f+4, gy+2, '#ffffff');
  }
}

function drawIsland(x, y, w) {
  // Floating rock island: grassy/stone top surface, jagged rocky underside, roots dangling
  const seed = Math.floor((x * 7 + y * 13));

  // top surface (grass-like light layer)
  for (let i = 0; i < w; i++) {
    px(x+i, y, '#ffffff');
    px(x+i, y+1, '#dddddd');
  }
  // rocky body, tapering inward as it goes down (irregular underside)
  const depth = 4;
  for (let r = 2; r < 2 + depth; r++) {
    const inset = r - 1; // taper amount
    for (let i = 0; i < w; i++) {
      if (i < inset || i >= w - inset) continue;
      const tone = ((i + r + seed) % 3 === 0) ? '#888888' : '#aaaaaa';
      px(x+i, y+r, tone);
    }
  }
  // jagged bottom points (roots/rock spikes)
  for (let i = 1; i < w - 1; i += 2) {
    if ((i + seed) % 3 !== 0) {
      px(x+i, y + 2 + depth, '#666666');
    }
  }
}

// ── BACKGROUND DRAWING ──
// Star field seeded by world Y to feel infinite
const STAR_CACHE = [];
for (let i = 0; i < 200; i++) {
  STAR_CACHE.push({
    rx: (i * 1731 + 17) % 1000 / 1000,
    ry: (i * 2311 + 41) % 1000 / 1000,
    b:  (i * 379)  % 3,  // brightness: 0=dim 1=mid 2=bright
    sz: i % 7 === 0 ? 2 : 1,
  });
}

function drawBackground(camY, region) {
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, viewW, viewH);

  // Stars — parallax with camera
  const starColors = ['rgba(255,255,255,0.25)', 'rgba(255,255,255,0.55)', '#ffffff'];
  const parallax = camY * 0.3;
  STAR_CACHE.forEach(s => {
    const sx = Math.floor(s.rx * VIRT_W);
    const sy = Math.floor(((s.ry * 800 + parallax) % 800 / 800) * VIRT_H);
    ctx.fillStyle = starColors[s.b];
    ctx.fillRect(sx * SCALE, sy * SCALE, s.sz, s.sz);
  });

  // Region-specific deco
  if (region.style === 'cloud') {
    // Distant faint cloud shapes (lumpy, not flat rectangles)
    ctx.fillStyle = 'rgba(255,255,255,0.06)';
    for (let i = 0; i < 4; i++) {
      const cx = (i * 53 + Math.floor(camY * 0.08) * 17 + i * 29) % (VIRT_W - 20);
      const cy = ((i * 31 + Math.floor(camY * 0.05)) % VIRT_H);
      // body
      ctx.fillRect(cx * SCALE, cy * SCALE, 18 * SCALE, 5 * SCALE);
      // lumps
      ctx.fillRect((cx+2) * SCALE, (cy-2) * SCALE, 6 * SCALE, 2 * SCALE);
      ctx.fillRect((cx+9) * SCALE, (cy-3) * SCALE, 7 * SCALE, 3 * SCALE);
    }
  } else if (region.style === 'pillar') {
    // Distant ruin silhouettes
    ctx.fillStyle = 'rgba(255,255,255,0.05)';
    for (let i = 0; i < 5; i++) {
      const rx = (i * 37 + 8) % (VIRT_W - 6);
      const h = 20 + (i * 13 % 30);
      ctx.fillRect(rx * SCALE, (VIRT_H - h) * SCALE, 4 * SCALE, h * SCALE);
      // chipped top notch
      ctx.fillRect((rx+1) * SCALE, (VIRT_H - h - 2) * SCALE, 2 * SCALE, 2 * SCALE);
    }
  } else if (region.style === 'storm') {
    // Occasional lightning flash
    if (Math.random() < 0.015) {
      ctx.fillStyle = 'rgba(255,255,255,0.07)';
      ctx.fillRect(0, 0, viewW, viewH);
    }
  } else if (region.style === 'crystal') {
    // Faint geometric shimmer lines
    ctx.strokeStyle = 'rgba(255,255,255,0.04)';
    ctx.lineWidth = 1;
    for (let i = 0; i < 6; i++) {
      const lx = ((i * 29 + Math.floor(camY * 0.04)) % VIRT_W) * SCALE;
      ctx.beginPath(); ctx.moveTo(lx, 0); ctx.lineTo(lx + 30 * SCALE, viewH); ctx.stroke();
    }
  } else if (region.style === 'castle') {
    // Distant shadow castle silhouette, parallax with camera
    ctx.fillStyle = 'rgba(255,255,255,0.07)';
    const baseY = VIRT_H - 24 + (camY * 0.05) % 10;
    const baseX = -10 + Math.floor(camY * 0.03) % 20;
    // main keep body
    ctx.fillRect((baseX + 10) * SCALE, baseY * SCALE, 40 * SCALE, 24 * SCALE);
    // central tower
    ctx.fillRect((baseX + 24) * SCALE, (baseY - 14) * SCALE, 12 * SCALE, 14 * SCALE);
    // side turrets
    ctx.fillRect((baseX + 6) * SCALE, (baseY - 8) * SCALE, 8 * SCALE, 8 * SCALE);
    ctx.fillRect((baseX + 46) * SCALE, (baseY - 8) * SCALE, 8 * SCALE, 8 * SCALE);
    // crenellations on main body
    for (let i = 0; i < 7; i++) {
      ctx.fillRect((baseX + 10 + i * 6) * SCALE, (baseY - 3) * SCALE, 3 * SCALE, 3 * SCALE);
    }
    // tower crenellations
    for (let i = 0; i < 3; i++) {
      ctx.fillRect((baseX + 24 + i * 4) * SCALE, (baseY - 17) * SCALE, 2 * SCALE, 3 * SCALE);
    }
    // turret peaks
    ctx.fillRect((baseX + 9) * SCALE, (baseY - 10) * SCALE, 2 * SCALE, 2 * SCALE);
    ctx.fillRect((baseX + 49) * SCALE, (baseY - 10) * SCALE, 2 * SCALE, 2 * SCALE);
  }
}

// ── PARTICLES ──
let particles = [];
function spawnLand(x, y) {
  for (let i = 0; i < 5; i++) {
    particles.push({ x: x + PW/2 + (Math.random()-0.5)*3, y, vx: (Math.random()-0.5)*1.2, vy: Math.random()*0.6+0.1, life: 14, maxLife: 14 });
  }
}
function spawnDoubleJump(x, y) {
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    particles.push({ x: x + PW/2, y, vx: Math.cos(a)*1.0, vy: Math.sin(a)*1.0, life: 12, maxLife: 12 });
  }
}

// ── GAME STATE ──
let player, platforms, score, bestScore;
let cameraY = 0;          // world Y of camera top
let targetCameraY = 0;
let regionTransAlpha = 0;
let regionAnnounceTimer = 0;
let prevRegionName = '';
let animTick = 0;
let keys = {};
let tapJumpFrames = 0; // grace period so click/tap jumps reach full height, like a held spacebar
let nextPlatId = 0;
let floaters = []; // moving blocks (sky/castle)
let crows = [];     // moving hazards (ruins)
let nextFloaterId = 0;
let highestPlatformY = 0; // track topmost platform world Y for generation
let peakPlayerY = 9999;  // lowest world Y player reached (smaller = higher up)

function initGame() {
  keys = {};
  tapJumpFrames = 0;
  particles = [];
  animTick = 0;
  score = 0;
  regionTransAlpha = 0;
  regionAnnounceTimer = 0;
  prevRegionName = '';
  nextPlatId = 0;
  platforms = [];
  floaters = [];
  crows = [];
  nextFloaterId = 0;

  // Starting platform right under player
  const startPlatY = 200;
  platforms.push({ x: VIRT_W/2 - 14, y: startPlatY, w: 28, id: nextPlatId++ });

  // Spawn initial set of platforms upward
  highestPlatformY = startPlatY;
  for (let i = 0; i < 18; i++) spawnPlatformAbove();

  // Player starts on the starting platform
  player = {
    x: VIRT_W/2 - PW/2,
    y: startPlatY - PH,
    vx: 0,
    vy: 0,
    onGround: false,
    coyoteTime: 0,
    facing: 1,
    jumped: false,
    airJumpsLeft: 1,
    onFloaterId: null,  // id of floater player is standing on
  };

  cameraY = startPlatY - VIRT_H * 0.65;
  targetCameraY = cameraY;
  // bestScore loaded from Supabase via aloftOnShow — keep current value
  peakPlayerY = startPlatY;  // reset peak to start
}

const PLAT_ZONE_W = 124; // fixed-width centre column that platforms/floaters spawn within, independent of screen width
function spawnPlatformAbove() {
  const gap = 18 + Math.random() * 12;
  const y = highestPlatformY - gap;
  const w = Math.max(12, Math.floor(12 + Math.random() * 18));
  const zoneLeft = (VIRT_W - PLAT_ZONE_W) / 2; // keeps platforms centered on wide/full-screen canvases
  const x = Math.floor(Math.random() * (PLAT_ZONE_W - w)) + zoneLeft;
  highestPlatformY = y;

  // Region-specific: sometimes replace this platform with a moving floater
  const region = getRegion(Math.max(0, Math.floor((200 - y) / 3)));
  if ((region.style === 'cloud' || region.style === 'castle') && Math.random() < 0.2) {
    const dir = Math.random() < 0.5 ? -1 : 1;
    floaters.push({
      x, y, w,
      baseX: x, range: 18 + Math.random() * 12,
      speed: (0.15 + Math.random() * 0.2) * dir,
      phase: Math.random() * Math.PI * 2,
      style: region.style,
      id: nextFloaterId++
    });
  } else {
    platforms.push({ x, y, w, id: nextPlatId++ });
  }
  if (region.style === 'pillar' && Math.random() < 0.35) {
    const dir = Math.random() < 0.5 ? 1 : -1;
    crows.push({
      x: dir === 1 ? -8 : VIRT_W + 8,
      y: y - 8 - Math.random() * 20,
      vx: (0.6 + Math.random() * 0.5) * dir,
      dir, flap: 0
    });
  }
}

// ── INPUT ──
function onAloftKey(e) {
  keys[e.code] = true;
  if (['Space','ArrowUp','KeyW','ArrowLeft','ArrowRight','KeyA','KeyD'].includes(e.code)) e.preventDefault();
  if (gameState === 'start' || gameState === 'over') {
    if (['Space','ArrowUp','KeyW','Enter'].includes(e.code)) aloftStart();
  }
}
function onAloftKeyUp(e) { keys[e.code] = false; }
function onAloftTap(e) {
  if (gameState === 'start' || gameState === 'over') return;
  if (gameState === 'playing') { doJump(); tapJumpFrames = 14; }
}

// ── TOUCH CONTROLS (phone/mobile): left-half arrow buttons move, right-half tap jumps ──
function isAloftTouchDevice() {
  return ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);
}
function onAloftLeftDown(e) { e.preventDefault(); keys['ArrowLeft'] = true; }
function onAloftLeftUp(e) { e.preventDefault(); keys['ArrowLeft'] = false; }
function onAloftRightDown(e) { e.preventDefault(); keys['ArrowRight'] = true; }
function onAloftRightUp(e) { e.preventDefault(); keys['ArrowRight'] = false; }
function onAloftJumpZoneDown(e) {
  e.preventDefault();
  if (gameState === 'playing') { doJump(); tapJumpFrames = 14; }
}
function setAloftTouchControlsVisible(visible) {
  const tc = document.getElementById('aloftTouchControls');
  if (tc) tc.style.display = (visible && isAloftTouchDevice()) ? 'block' : 'none';
}
function bindAloftTouchControls() {
  const btnL = document.getElementById('aloftBtnLeft');
  const btnR = document.getElementById('aloftBtnRight');
  const jumpZone = document.getElementById('aloftJumpZone');
  if (btnL) {
    btnL.addEventListener('pointerdown', onAloftLeftDown);
    btnL.addEventListener('pointerup', onAloftLeftUp);
    btnL.addEventListener('pointercancel', onAloftLeftUp);
    btnL.addEventListener('pointerleave', onAloftLeftUp);
  }
  if (btnR) {
    btnR.addEventListener('pointerdown', onAloftRightDown);
    btnR.addEventListener('pointerup', onAloftRightUp);
    btnR.addEventListener('pointercancel', onAloftRightUp);
    btnR.addEventListener('pointerleave', onAloftRightUp);
  }
  if (jumpZone) jumpZone.addEventListener('pointerdown', onAloftJumpZoneDown);
}
function unbindAloftTouchControls() {
  const btnL = document.getElementById('aloftBtnLeft');
  const btnR = document.getElementById('aloftBtnRight');
  const jumpZone = document.getElementById('aloftJumpZone');
  if (btnL) {
    btnL.removeEventListener('pointerdown', onAloftLeftDown);
    btnL.removeEventListener('pointerup', onAloftLeftUp);
    btnL.removeEventListener('pointercancel', onAloftLeftUp);
    btnL.removeEventListener('pointerleave', onAloftLeftUp);
  }
  if (btnR) {
    btnR.removeEventListener('pointerdown', onAloftRightDown);
    btnR.removeEventListener('pointerup', onAloftRightUp);
    btnR.removeEventListener('pointercancel', onAloftRightUp);
    btnR.removeEventListener('pointerleave', onAloftRightUp);
  }
  if (jumpZone) jumpZone.removeEventListener('pointerdown', onAloftJumpZoneDown);
  keys['ArrowLeft'] = false;
  keys['ArrowRight'] = false;
}

function doJump() {
  if (player.onGround || player.coyoteTime > 0) {
    player.vy = -5.0;
    player.onGround = false;
    player.coyoteTime = 0;
    player.jumped = true;
    player.onFloaterId = null;
    player.airJumpsLeft = 1; // can still double jump after this
    spawnLand(player.x, player.y + PH);
  } else if (player.airJumpsLeft > 0) {
    player.vy = -4.6;
    player.airJumpsLeft--;
    player.jumped = true;
    spawnDoubleJump(player.x, player.y + PH/2);
  }
}

// ── PHYSICS ──
const GRAVITY = 0.28;
const MOVE_SPEED = 1.55;
const MAX_FALL = 7;

function update() {
  animTick++;

  // Horizontal movement
  const goLeft  = keys['ArrowLeft']  || keys['KeyA'];
  const goRight = keys['ArrowRight'] || keys['KeyD'];
  const curRegion = getRegion(score);
  const inStorm = curRegion.style === 'storm';

  if (inStorm && (goLeft || goRight || !player.onGround)) {
    // Gusting wind speeds up or slows down horizontal movement depending on direction
    const windPhase = Date.now() / 600;
    const gust = Math.sin(windPhase) * 0.5 + Math.sin(windPhase * 2.7) * 0.3; // -0.8..0.8
    // gust > 0 = wind blowing right, gust < 0 = wind blowing left
    let mult = 1;
    if (goRight) mult = 1 + gust * 0.7;       // aided if wind right, hindered if wind left
    else if (goLeft) mult = 1 - gust * 0.7;   // aided if wind left, hindered if wind right
    else mult = 1; // airborne with no input: drift slightly with wind
    mult = Math.max(0.3, mult);

    if (goLeft)  { player.vx = -MOVE_SPEED * mult; player.facing = -1; }
    else if (goRight) { player.vx = MOVE_SPEED * mult; player.facing = 1; }
    else {
      // airborne, no input: gentle wind drift
      player.vx += gust * 0.05;
      player.vx *= 0.9;
    }
  } else if (goLeft)  { player.vx = -MOVE_SPEED; player.facing = -1; }
  else if (goRight) { player.vx =  MOVE_SPEED; player.facing =  1; }
  else player.vx *= 0.75; // friction

  // Jump input
  if (keys['Space'] || keys['ArrowUp'] || keys['KeyW']) {
    if (!player._jumpHeld) { doJump(); player._jumpHeld = true; }
  } else if (tapJumpFrames > 0) {
    // Click/tap jump in progress — let it play out at full height instead of cutting it short
    tapJumpFrames--;
  } else {
    player._jumpHeld = false;
    // Cut jump short on release
    if (player.vy < -2) player.vy = Math.max(player.vy * 0.85, -2);
  }

  // Gravity
  player.vy = Math.min(player.vy + GRAVITY, MAX_FALL);

  // Move
  player.x += player.vx;
  player.y += player.vy;

  // Wrap horizontally
  if (player.x + PW < 0) player.x = VIRT_W;
  if (player.x > VIRT_W) player.x = -PW;

  // Move floaters and carry player BEFORE clearing onGround,
  // so we still know if the player was standing last frame.
  for (const f of floaters) {
    const prevX = f.x;
    f.x = f.baseX + Math.sin(animTick * 0.02 * Math.abs(f.speed) * 5 + f.phase) * f.range;
    const dx = f.x - prevX;
    // If player was standing on this floater last frame, drag them along
    if (player.onFloaterId === f.id && player.onGround) {
      player.x += dx;
    }
  }

  // Coyote time (uses onGround from LAST frame, before we clear it)
  if (player.onGround) player.coyoteTime = 7;
  else if (player.coyoteTime > 0) player.coyoteTime--;
  player.onGround = false;
  player.onFloaterId = null; // will be re-set below if still on a floater

  // Platform collisions (top landing only)
  for (const p of platforms) {
    if (player.vy > 0 &&
        player.x + PW > p.x + 1 &&
        player.x < p.x + p.w - 1 &&
        player.y + PH >= p.y &&
        player.y + PH <= p.y + player.vy + 2) {
      player.y = p.y - PH;
      player.vy = 0;
      player.onGround = true;
      player.jumped = false;
      player.airJumpsLeft = 1;
    }
  }

  // Floater landing collisions (floaters already moved above)
  for (const f of floaters) {
    if (player.vy > 0 &&
        player.x + PW > f.x + 1 &&
        player.x < f.x + f.w - 1 &&
        player.y + PH >= f.y &&
        player.y + PH <= f.y + player.vy + 2) {
      player.y = f.y - PH;
      player.vy = 0;
      player.onGround = true;
      player.jumped = false;
      player.airJumpsLeft = 1;
      player.onFloaterId = f.id;
    }
  }

  // Keep onFloaterId if player is still resting on the same floater (snapped, vy==0)
  if (player.onFloaterId === null && player.onGround) {
    for (const f of floaters) {
      if (player.x + PW > f.x + 1 &&
          player.x < f.x + f.w - 1 &&
          Math.abs(player.y + PH - f.y) <= 1) {
        player.onFloaterId = f.id;
        break;
      }
    }
  }

  for (const c of crows) {
    c.x += c.vx;
    c.flap += 0.25;
    if (player.x + PW > c.x + 1 && player.x < c.x + 6 &&
        player.y + PH > c.y + 1 && player.y < c.y + 4) {
      triggerGameOver();
    }
  }
  // Prune off-screen crows, recycle far ones
  crows = crows.filter(c => c.x > -20 && c.x < VIRT_W + 20 && c.y < cameraY + VIRT_H + 30 && c.y > cameraY - VIRT_H);

  // Score = highest world Y reached (inverted: lower y = higher up)
  const heightScore = Math.max(0, Math.floor((200 - player.y) / 3));
  score = Math.max(score, heightScore);
  bestScore = Math.max(bestScore, score);

  // Camera — smoothly follows player, keeping them ~38% from bottom
  targetCameraY = player.y - VIRT_H * 0.62;
  cameraY += (targetCameraY - cameraY) * 0.12;

  // Generate more platforms above
  while (highestPlatformY > cameraY - VIRT_H * 0.5) spawnPlatformAbove();

  // Prune platforms far below camera
  platforms = platforms.filter(p => p.y < cameraY + VIRT_H + 20);
  floaters = floaters.filter(f => f.y < cameraY + VIRT_H + 20);

  // Particles
  particles = particles.filter(p => p.life > 0);
  particles.forEach(p => { p.x += p.vx; p.y += p.vy; p.vy += 0.05; p.life--; });

  // Region transition
  const region = getRegion(score);
  if (region.name !== prevRegionName) {
    regionAnnounceTimer = 2.5; // seconds to display
    prevRegionName = region.name;
  }
  if (regionAnnounceTimer > 0) regionAnnounceTimer -= 1/60;

  // Track peak (highest point reached — smallest world Y)
  if (player.y < peakPlayerY) peakPlayerY = player.y;
  // Death: fell more than 2 screen heights below the player's personal peak
  if (player.y > peakPlayerY + VIRT_H * 2.2) triggerGameOver();
}

// ── RENDER ──
function render() {
  const region = getRegion(score);
  drawBackground(cameraY, region);

  // Platforms
  for (const p of platforms) drawPlatform(p, region.style, cameraY);

  // Moving floating blocks
  for (const f of floaters) drawFloater(f.x, f.y - cameraY, f.w, f.style);

  // Crows (ruins hazard)
  for (const c of crows) drawCrow(c.x, c.y - cameraY, c.dir, c.flap);


  // Particles
  particles.forEach(p => {
    const a = p.life / p.maxLife;
    ctx.fillStyle = `rgba(255,255,255,${a})`;
    ctx.fillRect(Math.round(p.x) * SCALE, Math.round(p.y - cameraY) * SCALE, SCALE, SCALE);
  });

  // Player
  const screenY = player.y - cameraY;
  let sprite = S_IDLE1;
  if (player.jumped || player.vy < -0.3) sprite = S_JUMP;
  else if (Math.floor(animTick / 10) % 2 === 0) sprite = S_IDLE1;
  else sprite = S_IDLE2;
  drawSprite(sprite, Math.round(player.x), Math.round(screenY), player.facing < 0);

  // Region announcement (stays for 2.5s, fades out at the end)
  if (regionAnnounceTimer > 0) {
    const fadeOut = Math.min(1, regionAnnounceTimer / 0.4);
    ctx.save();
    ctx.globalAlpha = fadeOut;
    ctx.fillStyle = 'rgba(255,255,255,0.08)';
    ctx.fillRect(0, 0, viewW, viewH);
    ctx.fillStyle = '#ffffff';
    ctx.font = `bold ${4 * SCALE}px "DM Mono", monospace`;
    ctx.textAlign = 'center';
    ctx.fillText(region.name.toUpperCase(), viewW / 2, viewH / 2);
    ctx.restore();
  }

  drawHUD();
}

function drawHUD() {

  const region = getRegion(score);
  const fs = Math.round(3.5 * SCALE);

  ctx.font = `bold ${fs}px "DM Mono", monospace`;
  ctx.fillStyle = 'rgba(255,255,255,0.9)';
  ctx.textAlign = 'left';
  ctx.fillText('SCORE  ' + score, 4 * SCALE, 11 * SCALE);

  ctx.fillStyle = 'rgba(255,255,255,0.45)';
  ctx.textAlign = 'center';
  ctx.font = `${Math.round(2 * SCALE)}px "DM Mono", monospace`;
  ctx.fillText(region.name.toUpperCase(), viewW / 2, 11 * SCALE);

  ctx.fillStyle = 'rgba(255,255,255,0.55)';
  ctx.textAlign = 'right';
  ctx.font = `bold ${fs}px "DM Mono", monospace`;
  ctx.fillText('BEST  ' + bestScore, viewW - 4 * SCALE, 11 * SCALE);
}

function triggerGameOver() {
  gameState = 'over';
  // Save high score to Supabase if it's a new best
  (async () => {
    try {
      if (currentUser && score > 0) {
        const { data: profile } = await supabaseClient
          .from('profiles').select('high_score').eq('id', currentUser.id).single();
        if (!profile || score > (profile.high_score || 0)) {
          await supabaseClient.from('profiles')
            .update({ high_score: score }).eq('id', currentUser.id);
          bestScore = score;
        }
      }
    } catch(e) { console.warn('Failed to save high score', e); }
  })();
  const fs = document.getElementById('aloftFinalScore');
  if (fs) fs.textContent = 'SCORE: ' + score + '     BEST: ' + bestScore;
  const nb = document.getElementById('aloftNewBest');
  if (nb) nb.style.display = (score > 0 && score >= bestScore) ? 'block' : 'none';
  document.getElementById('aloftGameOverScreen').style.display = 'flex';
  setAloftTouchControlsVisible(false);
  if (raf) { cancelAnimationFrame(raf); raf = null; }
  render();
}

function gameLoop(now) {
  if (gameState !== 'playing') { raf = null; aloftLastTime = null; return; }
  raf = requestAnimationFrame(gameLoop);

  if (aloftLastTime === null) aloftLastTime = now;
  let delta = now - aloftLastTime;
  aloftLastTime = now;

  // Guard against huge deltas (tab backgrounded, devtools pause, etc.)
  if (delta > ALOFT_STEP_MS * ALOFT_MAX_STEPS) delta = ALOFT_STEP_MS * ALOFT_MAX_STEPS;

  aloftAccumulator += delta;
  let steps = 0;
  while (aloftAccumulator >= ALOFT_STEP_MS && steps < ALOFT_MAX_STEPS) {
    update();
    aloftAccumulator -= ALOFT_STEP_MS;
    steps++;
  }
  render();
}

// ── LIFECYCLE ──
function aloftStart() {
  document.getElementById('aloftStartScreen').style.display = 'none';
  document.getElementById('aloftGameOverScreen').style.display = 'none';
  initGame();
  gameState = 'playing';
  setAloftTouchControlsVisible(true);
  aloftAccumulator = 0;
  aloftLastTime = null;
  if (!raf) raf = requestAnimationFrame(gameLoop);
}

function aloftOnShow() {
  canvas = document.getElementById('aloftCanvas');
  ctx = canvas.getContext('2d');

  // Resize canvas: fill the ENTIRE view edge-to-edge (true full screen, no side margins).
  // VIRT_W is widened to match the screen's aspect ratio so the background/world extends
  // all the way to both edges. Crows/birds use VIRT_W so they roam the full screen width;
  // platforms stay confined to a fixed-width centre column (see PLAT_ZONE_W) regardless.
  function resize() {
    const view = document.getElementById('aloftView');
    if (!view || !canvas) return;
    const vw = view.clientWidth;
    const vh = view.clientHeight;
    const MIN_VIRT_W = 160; // minimum world width in game units (keeps platform zone sane)
    const BASE_VIRT_H = 120; // reference world height for landscape-ish screens
    if (vw >= vh * (MIN_VIRT_W / BASE_VIRT_H)) {
      // Wide / landscape-ish screen: keep world height fixed, widen world to match aspect.
      VIRT_H = BASE_VIRT_H;
      VIRT_W = Math.max(MIN_VIRT_W, Math.round(VIRT_H * (vw / vh)));
    } else {
      // Narrow / portrait screen (phones): keep world width fixed at the minimum and
      // grow world height to match the aspect ratio instead of clamping width, which is
      // what caused the buffer's aspect ratio to mismatch the screen's and stretch the game.
      VIRT_W = MIN_VIRT_W;
      VIRT_H = Math.round(VIRT_W * (vh / vw));
    }
    canvas.width  = VIRT_W * SCALE;
    canvas.height = VIRT_H * SCALE;
    canvas.style.width  = vw + 'px';
    canvas.style.height = vh + 'px';
    canvas.style.left   = '0px';
    canvas.style.top    = '0px';
    viewW = VIRT_W * SCALE;
    viewH = VIRT_H * SCALE;
  }
  resize();
  window._aloftResize = resize;
  window.addEventListener('resize', resize);

  bestScore = 0;
  (async () => {
    try {
      if (currentUser) {
        const { data: profile } = await supabaseClient
          .from('profiles').select('high_score').eq('id', currentUser.id).single();
        if (profile && profile.high_score) {
          bestScore = profile.high_score;
          const bd = document.getElementById('aloftBestDisplay');
          if (bd) bd.textContent = 'BEST: ' + bestScore;
        }
      }
    } catch(e) { console.warn('Failed to load high score', e); }
  })();

  window.addEventListener('keydown', onAloftKey);
  window.addEventListener('keyup', onAloftKeyUp);
  canvas.addEventListener('click', onAloftTap);
  bindAloftTouchControls();
  setAloftTouchControlsVisible(false);
  document.getElementById('aloftStartScreen').style.display = 'flex';
  document.getElementById('aloftGameOverScreen').style.display = 'none';

  // Draw a preview
  viewW = VIRT_W * SCALE; viewH = VIRT_H * SCALE;
  ctx.fillStyle = '#000'; ctx.fillRect(0,0,viewW,viewH);
  ctx.fillStyle = 'rgba(255,255,255,0.08)';
  STAR_CACHE.slice(0,60).forEach(s => {
    ctx.fillRect(Math.floor(s.rx * VIRT_W)*SCALE, Math.floor(s.ry * VIRT_H)*SCALE, s.sz, s.sz);
  });
}

function aloftOnHide() {
  gameState = 'start';
  keys = {};
  if (raf) { cancelAnimationFrame(raf); raf = null; }
  window.removeEventListener('keydown', onAloftKey);
  window.removeEventListener('keyup', onAloftKeyUp);
  window.removeEventListener('resize', window._aloftResize);
  const c = document.getElementById('aloftCanvas');
  if (c) c.removeEventListener('click', onAloftTap);
  unbindAloftTouchControls();
  setAloftTouchControlsVisible(false);
}

window.aloftStart   = aloftStart;
window.aloftOnShow  = aloftOnShow;
window.aloftOnHide  = aloftOnHide;

})();

