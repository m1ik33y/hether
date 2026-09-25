(function() {
  const SCALE = 3;
  let VIRT_W = 160;
  let VIRT_H = 120;
  let canvas, ctx, viewW, viewH;
  let raf = null;
  const ALOFT_STEP_MS = 1e3 / 60;
  const ALOFT_MAX_STEPS = 5;
  let aloftAccumulator = 0;
  let aloftLastTime = null;
  let gameState = "start";
  const REGIONS = [ {
    name: "Sky",
    scoreStart: 0,
    style: "cloud",
    bgDark: "#000",
    bgLight: "#111",
    starDensity: 8
  }, {
    name: "Ruins",
    scoreStart: 120,
    style: "pillar",
    bgDark: "#000",
    bgLight: "#0a0a0a",
    starDensity: 20
  }, {
    name: "Storm",
    scoreStart: 280,
    style: "storm",
    bgDark: "#000",
    bgLight: "#050505",
    starDensity: 4
  }, {
    name: "Crystal",
    scoreStart: 480,
    style: "crystal",
    bgDark: "#000",
    bgLight: "#080808",
    starDensity: 30
  }, {
    name: "Castle",
    scoreStart: 700,
    style: "castle",
    bgDark: "#000",
    bgLight: "#0a0a0a",
    starDensity: 10
  } ];
  function getRegion(sc) {
    let r = REGIONS[0];
    for (let i = REGIONS.length - 1; i >= 0; i--) {
      if (sc >= REGIONS[i].scoreStart) {
        r = REGIONS[i];
        break;
      }
    }
    return r;
  }
  const PW = 8, PH = 12;
  const C = {
    _: 0,
    W: 1,
    G: 2,
    D: 3
  };
  const S_IDLE1 = [ 0, 0, 3, 3, 3, 3, 0, 0, 0, 3, 2, 2, 2, 2, 3, 0, 0, 3, 2, 1, 1, 2, 3, 0, 0, 3, 2, 1, 1, 2, 3, 0, 0, 0, 3, 1, 1, 3, 0, 0, 0, 3, 1, 2, 2, 1, 3, 0, 0, 3, 1, 1, 1, 1, 3, 0, 0, 0, 3, 2, 2, 3, 0, 0, 0, 3, 2, 0, 0, 2, 3, 0, 0, 3, 2, 0, 0, 2, 3, 0, 0, 3, 1, 0, 0, 1, 3, 0, 0, 0, 3, 0, 0, 3, 0, 0 ];
  const S_IDLE2 = [ 0, 0, 3, 3, 3, 3, 0, 0, 0, 3, 2, 2, 2, 2, 3, 0, 0, 3, 2, 1, 1, 2, 3, 0, 0, 3, 2, 1, 1, 2, 3, 0, 0, 0, 3, 1, 1, 3, 0, 0, 0, 3, 1, 2, 2, 1, 3, 0, 0, 3, 1, 1, 1, 1, 3, 0, 0, 0, 3, 2, 2, 3, 0, 0, 0, 3, 2, 3, 0, 2, 0, 0, 3, 2, 0, 3, 0, 2, 0, 0, 3, 1, 0, 0, 1, 3, 0, 0, 0, 3, 0, 0, 3, 0, 0, 0 ];
  const S_JUMP = [ 0, 0, 3, 3, 3, 3, 0, 0, 0, 3, 2, 2, 2, 2, 3, 0, 0, 3, 2, 1, 1, 2, 3, 0, 3, 1, 3, 1, 1, 3, 1, 3, 3, 1, 1, 3, 3, 1, 1, 3, 0, 3, 1, 2, 2, 1, 3, 0, 0, 3, 1, 1, 1, 1, 3, 0, 0, 0, 3, 2, 2, 3, 0, 0, 0, 0, 3, 2, 2, 3, 0, 0, 0, 0, 3, 2, 2, 3, 0, 0, 0, 0, 3, 1, 1, 3, 0, 0, 0, 0, 0, 3, 3, 0, 0, 0 ];
  const SPAL = [ "", "#ffffff", "#aaaaaa", "#222222" ];
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
  function drawPlatform(p, style, camY) {
    const sx = p.x;
    const sy = p.y - camY;
    if (sy + 6 < 0 || sy > VIRT_H + 2) return;
    switch (style) {
     case "cloud":
      drawCloud(sx, sy, p.w);
      break;

     case "pillar":
      drawPillar(sx, sy, p.w);
      break;

     case "storm":
      drawStorm(sx, sy, p.w);
      break;

     case "crystal":
      drawCrystal(sx, sy, p.w);
      break;

     case "castle":
      drawIsland(sx, sy, p.w);
      break;
    }
  }
  function px(x, y, col) {
    ctx.fillStyle = col;
    ctx.fillRect(x * SCALE, y * SCALE, SCALE, SCALE);
  }
  function drawCloud(x, y, w) {
    const lumpW = 6;
    const lumps = Math.max(2, Math.round(w / lumpW));
    for (let i = 1; i < w - 1; i++) {
      px(x + i, y, "#ffffff");
      px(x + i, y + 1, i % 4 === 1 ? "#cccccc" : "#eeeeee");
    }
    px(x, y + 0, "#eeeeee");
    px(x + w - 1, y + 0, "#eeeeee");
    for (let l = 0; l < lumps; l++) {
      const cx = x + Math.floor((l + .5) * (w / lumps));
      const r = 2 + l % 2;
      for (let dx = -r; dx <= r; dx++) {
        const px_ = cx + dx;
        if (px_ < x || px_ >= x + w) continue;
        const dist = Math.abs(dx);
        if (dist <= r - 1) px(px_, y - 2, dist === 0 ? "#ffffff" : "#f5f5f5");
        if (dist <= r) px(px_, y - 1, "#ffffff");
      }
    }
    for (let i = 1; i < w - 1; i++) {
      px(x + i, y + 2, "#cccccc");
    }
    for (let i = 2; i < w - 2; i++) {
      px(x + i, y + 3, "#999999");
    }
  }
  function drawPillar(x, y, w) {
    const seed = Math.floor(x * 7 + y * 13);
    const segW = 6;
    for (let i = 0; i < w; i++) {
      const seg = Math.floor(i / segW);
      const localX = i % segW;
      const segSeed = (seed + seg) % 4;
      px(x + i, y, "#ffffff");
      let tone = localX === 0 || localX === segW - 1 ? "#999999" : "#cccccc";
      if (segSeed === 1 && localX === 2) tone = "#444444";
      if (segSeed === 2 && localX === 4) tone = "#888888";
      px(x + i, y + 1, tone);
      px(x + i, y + 2, "#888888");
    }
  }
  function drawStorm(x, y, w) {
    const lumpW = 6;
    const lumps = Math.max(2, Math.round(w / lumpW));
    for (let i = 1; i < w - 1; i++) {
      px(x + i, y, "#cccccc");
      px(x + i, y + 1, i % 4 === 1 ? "#888888" : "#aaaaaa");
    }
    px(x, y, "#aaaaaa");
    px(x + w - 1, y, "#aaaaaa");
    for (let l = 0; l < lumps; l++) {
      const cx = x + Math.floor((l + .5) * (w / lumps));
      const r = 2 + l % 2;
      for (let dx = -r; dx <= r; dx++) {
        const px_ = cx + dx;
        if (px_ < x || px_ >= x + w) continue;
        const dist = Math.abs(dx);
        if (dist <= r - 1) px(px_, y - 2, dist === 0 ? "#cccccc" : "#bbbbbb");
        if (dist <= r) px(px_, y - 1, "#cccccc");
      }
    }
    for (let i = 1; i < w - 1; i++) px(x + i, y + 2, "#888888");
    for (let i = 2; i < w - 2; i++) px(x + i, y + 3, "#555555");
    const t = Math.floor(Date.now() / 80);
    for (let s = 0; s < 3; s++) {
      const sy = y - 4 - s * 3;
      const sx = x - t * (3 + s) % (w + 20);
      px(sx, sy, "#ffffff");
      px(sx + 1, sy, "#ffffff");
      px(sx + 2, sy, "#aaaaaa");
    }
  }
  function drawCrystal(x, y, w) {
    for (let i = 0; i < w; i++) {
      const v = i % 4;
      ctx.fillStyle = v === 0 ? "#ffffff" : v === 1 ? "#cccccc" : v === 2 ? "#888888" : "#555555";
      ctx.fillRect((x + i) * SCALE, y * SCALE, SCALE, SCALE * 3);
      if (i % 2 === 0 && i < w - 1) {
        px(x + i, y - 1, "#ffffff");
        px(x + i, y - 2, "#cccccc");
        if (i % 4 === 0) px(x + i, y - 3, "#ffffff");
      }
    }
  }
  function drawFloater(x, y, w, style) {
    if (style === "castle") {
      drawIsland(x, y, w);
    } else {
      drawCloud(x, y, w);
    }
  }
  function drawCrow(x, y, dir, flap) {
    const up = Math.sin(flap) > 0;
    const f = Math.round(x), gy = Math.round(y);
    ctx.fillStyle = "#ffffff";
    px(f + 2, gy + 1, "#ffffff");
    px(f + 3, gy + 1, "#ffffff");
    px(f + (dir === 1 ? 4 : 1), gy, "#ffffff");
    if (up) {
      px(f + 1, gy, "#ffffff");
      px(f + 4, gy, "#ffffff");
    } else {
      px(f + 1, gy + 2, "#ffffff");
      px(f + 4, gy + 2, "#ffffff");
    }
  }
  function drawIsland(x, y, w) {
    const seed = Math.floor(x * 7 + y * 13);
    for (let i = 0; i < w; i++) {
      px(x + i, y, "#ffffff");
      px(x + i, y + 1, "#dddddd");
    }
    const depth = 4;
    for (let r = 2; r < 2 + depth; r++) {
      const inset = r - 1;
      for (let i = 0; i < w; i++) {
        if (i < inset || i >= w - inset) continue;
        const tone = (i + r + seed) % 3 === 0 ? "#888888" : "#aaaaaa";
        px(x + i, y + r, tone);
      }
    }
    for (let i = 1; i < w - 1; i += 2) {
      if ((i + seed) % 3 !== 0) {
        px(x + i, y + 2 + depth, "#666666");
      }
    }
  }
  const STAR_CACHE = [];
  for (let i = 0; i < 200; i++) {
    STAR_CACHE.push({
      rx: (i * 1731 + 17) % 1e3 / 1e3,
      ry: (i * 2311 + 41) % 1e3 / 1e3,
      b: i * 379 % 3,
      sz: i % 7 === 0 ? 2 : 1
    });
  }
  function drawBackground(camY, region) {
    ctx.fillStyle = "#000000";
    ctx.fillRect(0, 0, viewW, viewH);
    const starColors = [ "rgba(255,255,255,0.25)", "rgba(255,255,255,0.55)", "#ffffff" ];
    const parallax = camY * .3;
    STAR_CACHE.forEach(s => {
      const sx = Math.floor(s.rx * VIRT_W);
      const sy = Math.floor((s.ry * 800 + parallax) % 800 / 800 * VIRT_H);
      ctx.fillStyle = starColors[s.b];
      ctx.fillRect(sx * SCALE, sy * SCALE, s.sz, s.sz);
    });
    if (region.style === "cloud") {
      ctx.fillStyle = "rgba(255,255,255,0.06)";
      for (let i = 0; i < 4; i++) {
        const cx = (i * 53 + Math.floor(camY * .08) * 17 + i * 29) % (VIRT_W - 20);
        const cy = (i * 31 + Math.floor(camY * .05)) % VIRT_H;
        ctx.fillRect(cx * SCALE, cy * SCALE, 18 * SCALE, 5 * SCALE);
        ctx.fillRect((cx + 2) * SCALE, (cy - 2) * SCALE, 6 * SCALE, 2 * SCALE);
        ctx.fillRect((cx + 9) * SCALE, (cy - 3) * SCALE, 7 * SCALE, 3 * SCALE);
      }
    } else if (region.style === "pillar") {
      ctx.fillStyle = "rgba(255,255,255,0.05)";
      for (let i = 0; i < 5; i++) {
        const rx = (i * 37 + 8) % (VIRT_W - 6);
        const h = 20 + i * 13 % 30;
        ctx.fillRect(rx * SCALE, (VIRT_H - h) * SCALE, 4 * SCALE, h * SCALE);
        ctx.fillRect((rx + 1) * SCALE, (VIRT_H - h - 2) * SCALE, 2 * SCALE, 2 * SCALE);
      }
    } else if (region.style === "storm") {
      if (Math.random() < .015) {
        ctx.fillStyle = "rgba(255,255,255,0.07)";
        ctx.fillRect(0, 0, viewW, viewH);
      }
    } else if (region.style === "crystal") {
      ctx.strokeStyle = "rgba(255,255,255,0.04)";
      ctx.lineWidth = 1;
      for (let i = 0; i < 6; i++) {
        const lx = (i * 29 + Math.floor(camY * .04)) % VIRT_W * SCALE;
        ctx.beginPath();
        ctx.moveTo(lx, 0);
        ctx.lineTo(lx + 30 * SCALE, viewH);
        ctx.stroke();
      }
    } else if (region.style === "castle") {
      ctx.fillStyle = "rgba(255,255,255,0.07)";
      const baseY = VIRT_H - 24 + camY * .05 % 10;
      const baseX = -10 + Math.floor(camY * .03) % 20;
      ctx.fillRect((baseX + 10) * SCALE, baseY * SCALE, 40 * SCALE, 24 * SCALE);
      ctx.fillRect((baseX + 24) * SCALE, (baseY - 14) * SCALE, 12 * SCALE, 14 * SCALE);
      ctx.fillRect((baseX + 6) * SCALE, (baseY - 8) * SCALE, 8 * SCALE, 8 * SCALE);
      ctx.fillRect((baseX + 46) * SCALE, (baseY - 8) * SCALE, 8 * SCALE, 8 * SCALE);
      for (let i = 0; i < 7; i++) {
        ctx.fillRect((baseX + 10 + i * 6) * SCALE, (baseY - 3) * SCALE, 3 * SCALE, 3 * SCALE);
      }
      for (let i = 0; i < 3; i++) {
        ctx.fillRect((baseX + 24 + i * 4) * SCALE, (baseY - 17) * SCALE, 2 * SCALE, 3 * SCALE);
      }
      ctx.fillRect((baseX + 9) * SCALE, (baseY - 10) * SCALE, 2 * SCALE, 2 * SCALE);
      ctx.fillRect((baseX + 49) * SCALE, (baseY - 10) * SCALE, 2 * SCALE, 2 * SCALE);
    }
  }
  let particles = [];
  function spawnLand(x, y) {
    for (let i = 0; i < 5; i++) {
      particles.push({
        x: x + PW / 2 + (Math.random() - .5) * 3,
        y: y,
        vx: (Math.random() - .5) * 1.2,
        vy: Math.random() * .6 + .1,
        life: 14,
        maxLife: 14
      });
    }
  }
  function spawnDoubleJump(x, y) {
    for (let i = 0; i < 8; i++) {
      const a = i / 8 * Math.PI * 2;
      particles.push({
        x: x + PW / 2,
        y: y,
        vx: Math.cos(a) * 1,
        vy: Math.sin(a) * 1,
        life: 12,
        maxLife: 12
      });
    }
  }
  let player, platforms, score, bestScore;
  let cameraY = 0;
  let targetCameraY = 0;
  let regionTransAlpha = 0;
  let regionAnnounceTimer = 0;
  let prevRegionName = "";
  let animTick = 0;
  let keys = {};
  let tapJumpFrames = 0;
  let nextPlatId = 0;
  let floaters = [];
  let crows = [];
  let nextFloaterId = 0;
  let highestPlatformY = 0;
  let peakPlayerY = 9999;
  function initGame() {
    keys = {};
    tapJumpFrames = 0;
    particles = [];
    animTick = 0;
    score = 0;
    regionTransAlpha = 0;
    regionAnnounceTimer = 0;
    prevRegionName = "";
    nextPlatId = 0;
    platforms = [];
    floaters = [];
    crows = [];
    nextFloaterId = 0;
    const startPlatY = 200;
    platforms.push({
      x: VIRT_W / 2 - 14,
      y: startPlatY,
      w: 28,
      id: nextPlatId++
    });
    highestPlatformY = startPlatY;
    for (let i = 0; i < 18; i++) spawnPlatformAbove();
    player = {
      x: VIRT_W / 2 - PW / 2,
      y: startPlatY - PH,
      vx: 0,
      vy: 0,
      onGround: false,
      coyoteTime: 0,
      facing: 1,
      jumped: false,
      airJumpsLeft: 1,
      onFloaterId: null
    };
    cameraY = startPlatY - VIRT_H * .65;
    targetCameraY = cameraY;
    peakPlayerY = startPlatY;
  }
  const PLAT_ZONE_W = 124;
  function spawnPlatformAbove() {
    const gap = 18 + Math.random() * 12;
    const y = highestPlatformY - gap;
    const w = Math.max(12, Math.floor(12 + Math.random() * 18));
    const zoneLeft = (VIRT_W - PLAT_ZONE_W) / 2;
    const x = Math.floor(Math.random() * (PLAT_ZONE_W - w)) + zoneLeft;
    highestPlatformY = y;
    const region = getRegion(Math.max(0, Math.floor((200 - y) / 3)));
    if ((region.style === "cloud" || region.style === "castle") && Math.random() < .2) {
      const dir = Math.random() < .5 ? -1 : 1;
      floaters.push({
        x: x,
        y: y,
        w: w,
        baseX: x,
        range: 18 + Math.random() * 12,
        speed: (.15 + Math.random() * .2) * dir,
        phase: Math.random() * Math.PI * 2,
        style: region.style,
        id: nextFloaterId++
      });
    } else {
      platforms.push({
        x: x,
        y: y,
        w: w,
        id: nextPlatId++
      });
    }
    if (region.style === "pillar" && Math.random() < .35) {
      const dir = Math.random() < .5 ? 1 : -1;
      crows.push({
        x: dir === 1 ? -8 : VIRT_W + 8,
        y: y - 8 - Math.random() * 20,
        vx: (.6 + Math.random() * .5) * dir,
        dir: dir,
        flap: 0
      });
    }
  }
  function _aloftInputIsCapturingKeys() {
    const el = document.activeElement;
    if (el) {
      const tag = el.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || el.isContentEditable) return true;
    }
    const vaultOverlay = document.getElementById("vaultOverlay");
    if (vaultOverlay && vaultOverlay.classList.contains("show")) return true;
    return false;
  }
  function onAloftKey(e) {
    if (_aloftInputIsCapturingKeys()) return;
    keys[e.code] = true;
    if ([ "Space", "ArrowUp", "KeyW", "ArrowLeft", "ArrowRight", "KeyA", "KeyD" ].includes(e.code)) e.preventDefault();
    if (gameState === "start" || gameState === "over") {
      if ([ "Space", "ArrowUp", "KeyW", "Enter" ].includes(e.code)) aloftStart();
    }
  }
  function onAloftKeyUp(e) {
    if (_aloftInputIsCapturingKeys()) return;
    keys[e.code] = false;
  }
  function onAloftTap(e) {
    if (gameState === "start" || gameState === "over") return;
    if (gameState === "playing") {
      doJump();
      tapJumpFrames = 14;
    }
  }
  function isAloftTouchDevice() {
    return "ontouchstart" in window || navigator.maxTouchPoints > 0;
  }
  function onAloftLeftDown(e) {
    e.preventDefault();
    keys["ArrowLeft"] = true;
  }
  function onAloftLeftUp(e) {
    e.preventDefault();
    keys["ArrowLeft"] = false;
  }
  function onAloftRightDown(e) {
    e.preventDefault();
    keys["ArrowRight"] = true;
  }
  function onAloftRightUp(e) {
    e.preventDefault();
    keys["ArrowRight"] = false;
  }
  function onAloftJumpZoneDown(e) {
    e.preventDefault();
    if (gameState === "playing") {
      doJump();
      tapJumpFrames = 14;
    }
  }
  function setAloftTouchControlsVisible(visible) {
    const tc = document.getElementById("aloftTouchControls");
    if (tc) tc.style.display = visible && isAloftTouchDevice() ? "block" : "none";
  }
  function bindAloftTouchControls() {
    const btnL = document.getElementById("aloftBtnLeft");
    const btnR = document.getElementById("aloftBtnRight");
    const jumpZone = document.getElementById("aloftJumpZone");
    if (btnL) {
      btnL.addEventListener("pointerdown", onAloftLeftDown);
      btnL.addEventListener("pointerup", onAloftLeftUp);
      btnL.addEventListener("pointercancel", onAloftLeftUp);
      btnL.addEventListener("pointerleave", onAloftLeftUp);
    }
    if (btnR) {
      btnR.addEventListener("pointerdown", onAloftRightDown);
      btnR.addEventListener("pointerup", onAloftRightUp);
      btnR.addEventListener("pointercancel", onAloftRightUp);
      btnR.addEventListener("pointerleave", onAloftRightUp);
    }
    if (jumpZone) jumpZone.addEventListener("pointerdown", onAloftJumpZoneDown);
  }
  function unbindAloftTouchControls() {
    const btnL = document.getElementById("aloftBtnLeft");
    const btnR = document.getElementById("aloftBtnRight");
    const jumpZone = document.getElementById("aloftJumpZone");
    if (btnL) {
      btnL.removeEventListener("pointerdown", onAloftLeftDown);
      btnL.removeEventListener("pointerup", onAloftLeftUp);
      btnL.removeEventListener("pointercancel", onAloftLeftUp);
      btnL.removeEventListener("pointerleave", onAloftLeftUp);
    }
    if (btnR) {
      btnR.removeEventListener("pointerdown", onAloftRightDown);
      btnR.removeEventListener("pointerup", onAloftRightUp);
      btnR.removeEventListener("pointercancel", onAloftRightUp);
      btnR.removeEventListener("pointerleave", onAloftRightUp);
    }
    if (jumpZone) jumpZone.removeEventListener("pointerdown", onAloftJumpZoneDown);
    keys["ArrowLeft"] = false;
    keys["ArrowRight"] = false;
  }
  function doJump() {
    if (player.onGround || player.coyoteTime > 0) {
      player.vy = -5;
      player.onGround = false;
      player.coyoteTime = 0;
      player.jumped = true;
      player.onFloaterId = null;
      player.airJumpsLeft = 1;
      spawnLand(player.x, player.y + PH);
    } else if (player.airJumpsLeft > 0) {
      player.vy = -4.6;
      player.airJumpsLeft--;
      player.jumped = true;
      spawnDoubleJump(player.x, player.y + PH / 2);
    }
  }
  const GRAVITY = .28;
  const MOVE_SPEED = 1.55;
  const MAX_FALL = 7;
  function update() {
    animTick++;
    const goLeft = keys["ArrowLeft"] || keys["KeyA"];
    const goRight = keys["ArrowRight"] || keys["KeyD"];
    const curRegion = getRegion(score);
    const inStorm = curRegion.style === "storm";
    if (inStorm && (goLeft || goRight || !player.onGround)) {
      const windPhase = Date.now() / 600;
      const gust = Math.sin(windPhase) * .5 + Math.sin(windPhase * 2.7) * .3;
      let mult = 1;
      if (goRight) mult = 1 + gust * .7; else if (goLeft) mult = 1 - gust * .7; else mult = 1;
      mult = Math.max(.3, mult);
      if (goLeft) {
        player.vx = -MOVE_SPEED * mult;
        player.facing = -1;
      } else if (goRight) {
        player.vx = MOVE_SPEED * mult;
        player.facing = 1;
      } else {
        player.vx += gust * .05;
        player.vx *= .9;
      }
    } else if (goLeft) {
      player.vx = -MOVE_SPEED;
      player.facing = -1;
    } else if (goRight) {
      player.vx = MOVE_SPEED;
      player.facing = 1;
    } else player.vx *= .75;
    if (keys["Space"] || keys["ArrowUp"] || keys["KeyW"]) {
      if (!player._jumpHeld) {
        doJump();
        player._jumpHeld = true;
      }
    } else if (tapJumpFrames > 0) {
      tapJumpFrames--;
    } else {
      player._jumpHeld = false;
      if (player.vy < -2) player.vy = Math.max(player.vy * .85, -2);
    }
    player.vy = Math.min(player.vy + GRAVITY, MAX_FALL);
    player.x += player.vx;
    player.y += player.vy;
    if (player.x + PW < 0) player.x = VIRT_W;
    if (player.x > VIRT_W) player.x = -PW;
    for (const f of floaters) {
      const prevX = f.x;
      f.x = f.baseX + Math.sin(animTick * .02 * Math.abs(f.speed) * 5 + f.phase) * f.range;
      const dx = f.x - prevX;
      if (player.onFloaterId === f.id && player.onGround) {
        player.x += dx;
      }
    }
    if (player.onGround) player.coyoteTime = 7; else if (player.coyoteTime > 0) player.coyoteTime--;
    player.onGround = false;
    player.onFloaterId = null;
    for (const p of platforms) {
      if (player.vy > 0 && player.x + PW > p.x + 1 && player.x < p.x + p.w - 1 && player.y + PH >= p.y && player.y + PH <= p.y + player.vy + 2) {
        player.y = p.y - PH;
        player.vy = 0;
        player.onGround = true;
        player.jumped = false;
        player.airJumpsLeft = 1;
      }
    }
    for (const f of floaters) {
      if (player.vy > 0 && player.x + PW > f.x + 1 && player.x < f.x + f.w - 1 && player.y + PH >= f.y && player.y + PH <= f.y + player.vy + 2) {
        player.y = f.y - PH;
        player.vy = 0;
        player.onGround = true;
        player.jumped = false;
        player.airJumpsLeft = 1;
        player.onFloaterId = f.id;
      }
    }
    if (player.onFloaterId === null && player.onGround) {
      for (const f of floaters) {
        if (player.x + PW > f.x + 1 && player.x < f.x + f.w - 1 && Math.abs(player.y + PH - f.y) <= 1) {
          player.onFloaterId = f.id;
          break;
        }
      }
    }
    for (const c of crows) {
      c.x += c.vx;
      c.flap += .25;
      if (player.x + PW > c.x + 1 && player.x < c.x + 6 && player.y + PH > c.y + 1 && player.y < c.y + 4) {
        triggerGameOver();
      }
    }
    crows = crows.filter(c => c.x > -20 && c.x < VIRT_W + 20 && c.y < cameraY + VIRT_H + 30 && c.y > cameraY - VIRT_H);
    const heightScore = Math.max(0, Math.floor((200 - player.y) / 3));
    score = Math.max(score, heightScore);
    bestScore = Math.max(bestScore, score);
    targetCameraY = player.y - VIRT_H * .62;
    cameraY += (targetCameraY - cameraY) * .12;
    while (highestPlatformY > cameraY - VIRT_H * .5) spawnPlatformAbove();
    platforms = platforms.filter(p => p.y < cameraY + VIRT_H + 20);
    floaters = floaters.filter(f => f.y < cameraY + VIRT_H + 20);
    particles = particles.filter(p => p.life > 0);
    particles.forEach(p => {
      p.x += p.vx;
      p.y += p.vy;
      p.vy += .05;
      p.life--;
    });
    const region = getRegion(score);
    if (region.name !== prevRegionName) {
      regionAnnounceTimer = 2.5;
      prevRegionName = region.name;
    }
    if (regionAnnounceTimer > 0) regionAnnounceTimer -= 1 / 60;
    if (player.y < peakPlayerY) peakPlayerY = player.y;
    if (player.y > peakPlayerY + VIRT_H * 2.2) triggerGameOver();
  }
  function render() {
    const region = getRegion(score);
    drawBackground(cameraY, region);
    for (const p of platforms) drawPlatform(p, region.style, cameraY);
    for (const f of floaters) drawFloater(f.x, f.y - cameraY, f.w, f.style);
    for (const c of crows) drawCrow(c.x, c.y - cameraY, c.dir, c.flap);
    particles.forEach(p => {
      const a = p.life / p.maxLife;
      ctx.fillStyle = `rgba(255,255,255,${a})`;
      ctx.fillRect(Math.round(p.x) * SCALE, Math.round(p.y - cameraY) * SCALE, SCALE, SCALE);
    });
    const screenY = player.y - cameraY;
    let sprite = S_IDLE1;
    if (player.jumped || player.vy < -.3) sprite = S_JUMP; else if (Math.floor(animTick / 10) % 2 === 0) sprite = S_IDLE1; else sprite = S_IDLE2;
    drawSprite(sprite, Math.round(player.x), Math.round(screenY), player.facing < 0);
    if (regionAnnounceTimer > 0) {
      const fadeOut = Math.min(1, regionAnnounceTimer / .4);
      ctx.save();
      ctx.globalAlpha = fadeOut;
      ctx.fillStyle = "rgba(255,255,255,0.08)";
      ctx.fillRect(0, 0, viewW, viewH);
      ctx.fillStyle = "#ffffff";
      ctx.font = `bold ${4 * SCALE}px "DM Mono", monospace`;
      ctx.textAlign = "center";
      ctx.fillText(region.name.toUpperCase(), viewW / 2, viewH / 2);
      ctx.restore();
    }
    drawHUD();
  }
  function drawHUD() {
    const region = getRegion(score);
    const fs = Math.round(3.5 * SCALE);
    ctx.font = `bold ${fs}px "DM Mono", monospace`;
    ctx.fillStyle = "rgba(255,255,255,0.9)";
    ctx.textAlign = "left";
    ctx.fillText("SCORE  " + score, 4 * SCALE, 11 * SCALE);
    ctx.fillStyle = "rgba(255,255,255,0.45)";
    ctx.textAlign = "center";
    ctx.font = `${Math.round(2 * SCALE)}px "DM Mono", monospace`;
    ctx.fillText(region.name.toUpperCase(), viewW / 2, 11 * SCALE);
    ctx.fillStyle = "rgba(255,255,255,0.55)";
    ctx.textAlign = "right";
    ctx.font = `bold ${fs}px "DM Mono", monospace`;
    ctx.fillText("BEST  " + bestScore, viewW - 4 * SCALE, 11 * SCALE);
  }
  function triggerGameOver() {
    gameState = "over";
    (async () => {
      try {
        if (currentUser && score > 0) {
          const {data: profile} = await supabaseClient.from("profiles").select("high_score").eq("id", currentUser.id).single();
          if (!profile || score > (profile.high_score || 0)) {
            await supabaseClient.from("profiles").update({
              high_score: score
            }).eq("id", currentUser.id);
            bestScore = score;
          }
        }
      } catch (e) {
        console.warn("Failed to save high score", e);
      }
    })();
    const fs = document.getElementById("aloftFinalScore");
    if (fs) fs.textContent = "SCORE: " + score + "     BEST: " + bestScore;
    const nb = document.getElementById("aloftNewBest");
    if (nb) nb.style.display = score > 0 && score >= bestScore ? "block" : "none";
    document.getElementById("aloftGameOverScreen").style.display = "flex";
    setAloftTouchControlsVisible(false);
    if (raf) {
      cancelAnimationFrame(raf);
      raf = null;
    }
    render();
  }
  function gameLoop(now) {
    if (gameState !== "playing") {
      raf = null;
      aloftLastTime = null;
      return;
    }
    raf = requestAnimationFrame(gameLoop);
    if (aloftLastTime === null) aloftLastTime = now;
    let delta = now - aloftLastTime;
    aloftLastTime = now;
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
  function aloftStart() {
    document.getElementById("aloftStartScreen").style.display = "none";
    document.getElementById("aloftGameOverScreen").style.display = "none";
    initGame();
    gameState = "playing";
    setAloftTouchControlsVisible(true);
    aloftAccumulator = 0;
    aloftLastTime = null;
    if (!raf) raf = requestAnimationFrame(gameLoop);
  }
  function aloftOnShow() {
    canvas = document.getElementById("aloftCanvas");
    ctx = canvas.getContext("2d");
    function resize() {
      const view = document.getElementById("aloftView");
      if (!view || !canvas) return;
      const vw = view.clientWidth;
      const vh = view.clientHeight;
      const MIN_VIRT_W = 160;
      const BASE_VIRT_H = 120;
      if (vw >= vh * (MIN_VIRT_W / BASE_VIRT_H)) {
        VIRT_H = BASE_VIRT_H;
        VIRT_W = Math.max(MIN_VIRT_W, Math.round(VIRT_H * (vw / vh)));
      } else {
        VIRT_W = MIN_VIRT_W;
        VIRT_H = Math.round(VIRT_W * (vh / vw));
      }
      canvas.width = VIRT_W * SCALE;
      canvas.height = VIRT_H * SCALE;
      canvas.style.width = vw + "px";
      canvas.style.height = vh + "px";
      canvas.style.left = "0px";
      canvas.style.top = "0px";
      viewW = VIRT_W * SCALE;
      viewH = VIRT_H * SCALE;
    }
    resize();
    window._aloftResize = resize;
    window.addEventListener("resize", resize);
    bestScore = 0;
    (async () => {
      try {
        if (currentUser) {
          const {data: profile} = await supabaseClient.from("profiles").select("high_score").eq("id", currentUser.id).single();
          if (profile && profile.high_score) {
            bestScore = profile.high_score;
            const bd = document.getElementById("aloftBestDisplay");
            if (bd) bd.textContent = "BEST: " + bestScore;
          }
        }
      } catch (e) {
        console.warn("Failed to load high score", e);
      }
    })();
    window.addEventListener("keydown", onAloftKey);
    window.addEventListener("keyup", onAloftKeyUp);
    canvas.addEventListener("click", onAloftTap);
    bindAloftTouchControls();
    setAloftTouchControlsVisible(false);
    document.getElementById("aloftStartScreen").style.display = "flex";
    document.getElementById("aloftGameOverScreen").style.display = "none";
    viewW = VIRT_W * SCALE;
    viewH = VIRT_H * SCALE;
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, viewW, viewH);
    ctx.fillStyle = "rgba(255,255,255,0.08)";
    STAR_CACHE.slice(0, 60).forEach(s => {
      ctx.fillRect(Math.floor(s.rx * VIRT_W) * SCALE, Math.floor(s.ry * VIRT_H) * SCALE, s.sz, s.sz);
    });
  }
  function aloftOnHide() {
    gameState = "start";
    keys = {};
    if (raf) {
      cancelAnimationFrame(raf);
      raf = null;
    }
    window.removeEventListener("keydown", onAloftKey);
    window.removeEventListener("keyup", onAloftKeyUp);
    window.removeEventListener("resize", window._aloftResize);
    const c = document.getElementById("aloftCanvas");
    if (c) c.removeEventListener("click", onAloftTap);
    unbindAloftTouchControls();
    setAloftTouchControlsVisible(false);
  }
  window.aloftStart = aloftStart;
  window.aloftOnShow = aloftOnShow;
  window.aloftOnHide = aloftOnHide;
})();