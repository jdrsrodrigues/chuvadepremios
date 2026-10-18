(() => {
  'use strict';

  // Imagens embutidas por build-assets.ps1 (funciona via file://). Sem elas, carrega da pasta.
  const SRC = window.ASSETS || {
    walk: 'imagens/Mondilene-walk.png',
    start: 'imagens/tela_inicial.jpg',
    bg: 'imagens/fujioka.png',
    cortador: 'imagens/cortador.png',
    escova: 'imagens/escova_rotativa.png',
    secador: 'imagens/secador.png',
    secadorJu: 'imagens/secador_ju.png',
    bomb: 'imagens/bomb.png',
  };

  const PRODUCTS = [
    { key: 'cortador', name: 'Cortador', points: 10, scale: 0.95 },
    { key: 'escova', name: 'Escova', points: 15, scale: 1.05 },
    { key: 'secador', name: 'Secador', points: 10, scale: 1.0 },
    { key: 'secadorJu', name: 'Secador Ju', points: 20, scale: 1.05 },
  ];
  const BOMB = { key: 'bomb', name: 'Bomba', points: -25, scale: 0.85, bomb: true };

  // Geometria do sprite Mondilene-walk.png (408x400), em frações após cortar o piso.
  const WALK_CROP_BOTTOM = 28;               // remove o texto "MONDIAL" do piso
  const BASKET = { x0: 0.50, x1: 0.92, top: 0.54 };
  // Recorte do cenário fujioka.png: borda escura à esquerda e faixa de piso embaixo.
  const BG_CROP = { x: 6, y: 0, w: 767, h: 775 };

  const MAX_LIVES = 3;
  const CATCHES_PER_LEVEL = 10;
  const BEST_KEY = 'mondilene-catch-best';

  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  const $ = (id) => document.getElementById(id);

  const img = {};
  let skyColor = '#dedfe1';
  let floorColor = '#d0d0d0';

  let W = 0, H = 0, dpr = 1;
  let spriteH = 0, spriteW = 0, itemSize = 0, groundY = 0, feetY = 0;

  const player = { x: 0, xr: 0.5, vx: 0, facing: 1, flip: 1, bob: 0 };
  const input = { left: false, right: false, pointerId: null, fingerX: null, accum: 0 };

  const state = {
    mode: 'loading',
    score: 0, best: 0, lives: MAX_LIVES, level: 1, caught: 0, bombs: 0, streak: 0, bestStreak: 0,
    items: [], particles: [], popups: [],
    spawnTimer: 0, shake: 0, flash: 0, time: 0,
  };

  // ---------- utilidades ----------

  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const rand = (a, b) => a + Math.random() * (b - a);
  const approach = (v, target, step) => (v < target ? Math.min(v + step, target) : Math.max(v - step, target));

  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error('Falha ao carregar ' + String(src).slice(0, 60)));
      i.src = src;
    });
  }

  function toCanvas(image, cropBottom = 0) {
    const c = document.createElement('canvas');
    c.width = image.naturalWidth;
    c.height = image.naturalHeight - cropBottom;
    c.getContext('2d').drawImage(image, 0, 0);
    return c;
  }

  // Remove o fundo liso ligado às bordas (flood fill), com borda suavizada.
  // innerTol > 0 também remove áreas fechadas do fundo (ex.: entre o braço e o carrinho).
  function removeBackground(c, tol, feather, innerTol = 0) {
    const w = c.width, h = c.height;
    const cx = c.getContext('2d');
    let data;
    try { data = cx.getImageData(0, 0, w, h); } catch { return c; } // canvas "tainted" em file://
    const px = data.data;

    const corners = [0, w - 1, (h - 1) * w, h * w - 1];
    const opaque = corners.filter((i) => px[i * 4 + 3] > 200);
    if (opaque.length < 2) return c; // já tem transparência

    let r = 0, g = 0, b = 0;
    for (const i of opaque) { r += px[i * 4]; g += px[i * 4 + 1]; b += px[i * 4 + 2]; }
    r /= opaque.length; g /= opaque.length; b /= opaque.length;

    const dist = (i) => {
      const o = i * 4;
      if (px[o + 3] < 16) return 0;
      const dr = px[o] - r, dg = px[o + 1] - g, db = px[o + 2] - b;
      return Math.sqrt(dr * dr + dg * dg + db * db);
    };

    const seen = new Uint8Array(w * h);
    const stack = [];
    const visit = (i) => {
      if (seen[i]) return;
      seen[i] = 1;
      const d = dist(i);
      if (d < tol) { px[i * 4 + 3] = 0; stack.push(i); }
      else if (d < tol + feather) px[i * 4 + 3] = Math.round(px[i * 4 + 3] * (d - tol) / feather);
    };
    for (let x = 0; x < w; x++) { visit(x); visit((h - 1) * w + x); }
    for (let y = 0; y < h; y++) { visit(y * w); visit(y * w + w - 1); }
    while (stack.length) {
      const i = stack.pop();
      const x = i % w;
      if (x > 0) visit(i - 1);
      if (x < w - 1) visit(i + 1);
      if (i >= w) visit(i - w);
      if (i < w * (h - 1)) visit(i + w);
    }
    if (innerTol > 0) {
      for (let i = 0; i < w * h; i++) {
        if (seen[i]) continue;
        const d = dist(i);
        if (d < innerTol) px[i * 4 + 3] = 0;
        else if (d < innerTol + feather / 2) px[i * 4 + 3] = Math.round(px[i * 4 + 3] * (d - innerTol) / (feather / 2));
      }
    }
    cx.putImageData(data, 0, 0);
    return c;
  }

  // Recorta a área transparente ao redor.
  function trim(c) {
    const w = c.width, h = c.height;
    let px;
    try { px = c.getContext('2d').getImageData(0, 0, w, h).data; } catch { return c; }
    let x0 = w, y0 = h, x1 = -1, y1 = -1;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (px[(y * w + x) * 4 + 3] > 10) {
          if (x < x0) x0 = x; if (x > x1) x1 = x;
          if (y < y0) y0 = y; if (y > y1) y1 = y;
        }
      }
    }
    if (x1 < 0) return c;
    const out = document.createElement('canvas');
    out.width = x1 - x0 + 1;
    out.height = y1 - y0 + 1;
    out.getContext('2d').drawImage(c, x0, y0, out.width, out.height, 0, 0, out.width, out.height);
    return out;
  }

  function sampleColor(image, x, y, fallback) {
    try {
      const c = document.createElement('canvas');
      c.width = c.height = 1;
      const cx = c.getContext('2d');
      cx.drawImage(image, x, y, 1, 1, 0, 0, 1, 1);
      const [r, g, b] = cx.getImageData(0, 0, 1, 1).data;
      return `rgb(${r},${g},${b})`;
    } catch {
      return fallback;
    }
  }

  // ---------- som ----------

  const audio = { ctx: null, muted: false };

  function audioCtx() {
    if (audio.muted) return null;
    if (!audio.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      audio.ctx = new AC();
    }
    if (audio.ctx.state === 'suspended') audio.ctx.resume();
    return audio.ctx;
  }

  function tone(freq, start, dur, type = 'triangle', vol = 0.18, slideTo = null) {
    const ac = audioCtx();
    if (!ac) return;
    const t = ac.currentTime + start;
    const osc = ac.createOscillator();
    const gain = ac.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    gain.gain.setValueAtTime(vol, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + dur);
    osc.connect(gain).connect(ac.destination);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  function noise(dur, vol = 0.35) {
    const ac = audioCtx();
    if (!ac) return;
    const buf = ac.createBuffer(1, Math.floor(ac.sampleRate * dur), ac.sampleRate);
    const ch = buf.getChannelData(0);
    for (let i = 0; i < ch.length; i++) ch[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / ch.length, 2);
    const src = ac.createBufferSource();
    const gain = ac.createGain();
    gain.gain.value = vol;
    src.buffer = buf;
    src.connect(gain).connect(ac.destination);
    src.start();
  }

  const sfx = {
    catch: () => { tone(660, 0, 0.08); tone(990, 0.06, 0.12); },
    miss: () => tone(220, 0, 0.3, 'sawtooth', 0.12, 90),
    bomb: () => { noise(0.5); tone(120, 0, 0.4, 'square', 0.15, 40); },
    level: () => [523, 659, 784, 1047].forEach((f, i) => tone(f, i * 0.09, 0.15, 'square', 0.1)),
    over: () => [392, 330, 262].forEach((f, i) => tone(f, i * 0.18, 0.25, 'triangle', 0.18)),
  };

  // ---------- layout ----------

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth;
    H = window.innerHeight;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    groundY = H * 0.9;
    feetY = H * 0.97;
    if (img.walk) {
      const aspect = img.walk.width / img.walk.height;
      spriteH = Math.min(H * 0.38, (W * 0.42) / aspect);
      spriteW = spriteH * aspect;
    }
    itemSize = Math.max(44, spriteH * 0.3);
    player.x = clamp(player.xr * W, spriteW / 2, W - spriteW / 2);
  }

  // Centro e largura do carrinho na tela (acompanha a virada da personagem).
  function basketOffset() {
    return ((BASKET.x0 + BASKET.x1) / 2 - 0.5) * spriteW;
  }

  function basketRect() {
    const half = ((BASKET.x1 - BASKET.x0) / 2) * spriteW;
    const cx = player.x + basketOffset() * player.flip;
    const top = feetY - spriteH * (1 - BASKET.top) + bobOffset();
    return { x0: cx - half, x1: cx + half, top, cx };
  }

  function bobOffset() {
    return Math.abs(Math.sin(player.bob)) * -spriteH * 0.02;
  }

  // ---------- regras ----------

  function fallSpeed() { return H * Math.min(0.24 + 0.045 * (state.level - 1), 0.75); }
  function spawnInterval() { return Math.max(0.42, 1.15 - 0.08 * (state.level - 1)); }
  function bombChance() { return Math.min(0.3, 0.15 + 0.03 * (state.level - 1)); }

  function spawnItem() {
    const def = Math.random() < bombChance() ? BOMB : PRODUCTS[Math.floor(Math.random() * PRODUCTS.length)];
    const pic = img[def.key];
    const box = itemSize * def.scale;
    const s = box / Math.max(pic.width, pic.height);
    const w = pic.width * s, h = pic.height * s;
    // Só nasce onde o carrinho alcança, virado para qualquer lado.
    const halfBasket = ((BASKET.x1 - BASKET.x0) / 2) * spriteW;
    const margin = Math.max(w / 2, spriteW / 2 + basketOffset() - halfBasket * 0.4);
    state.items.push({
      def, w, h,
      x: rand(margin, W - margin),
      y: -h,
      vy: fallSpeed() * rand(0.85, 1.15),
      rot: rand(-0.4, 0.4),
      vr: rand(-1.5, 1.5),
      caught: false, t: 0, tx: 0, ty: 0,
    });
  }

  function addPopup(x, y, text, color) {
    state.popups.push({ x, y, text, color, life: 0.9, max: 0.9 });
  }

  function burst(x, y, colors, n, speed) {
    for (let i = 0; i < n; i++) {
      const a = rand(0, Math.PI * 2);
      const v = rand(speed * 0.3, speed);
      state.particles.push({
        x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - speed * 0.3,
        life: rand(0.4, 0.8), max: 0.8, size: rand(3, 7) * (itemSize / 60),
        color: colors[i % colors.length],
      });
    }
  }

  function loseLife() {
    state.lives--;
    state.streak = 0;
    if (state.lives <= 0) gameOver();
  }

  function onCatch(item, basket) {
    item.caught = true;
    item.t = 0;
    item.tx = basket.cx;
    item.ty = basket.top + spriteH * 0.08;

    if (item.def.bomb) {
      // Bomba tira pontos (sem ficar negativo) e quebra a sequência.
      const lost = Math.min(state.score, -item.def.points);
      state.score -= lost;
      state.bombs++;
      state.streak = 0;
      sfx.bomb();
      burst(item.x, item.y, ['#ffcf33', '#ff7a1a', '#e2363e', '#333'], 36, H * 0.6);
      addPopup(item.x, item.y - item.h, 'BUM! ' + item.def.points, '#e2363e');
      state.shake = 0.45;
      state.flash = 0.35;
      return;
    }

    state.streak++;
    state.bestStreak = Math.max(state.bestStreak, state.streak);
    const bonus = state.streak >= 5 ? 5 * Math.floor(state.streak / 5) : 0;
    const pts = item.def.points + bonus;
    state.score += pts;
    state.caught++;
    sfx.catch();
    burst(basket.cx, basket.top, ['#ffd23f', '#ffffff', '#e2363e'], 14, H * 0.35);
    addPopup(basket.cx, basket.top - itemSize * 0.4, '+' + pts, bonus ? '#d4880f' : '#1a8f4c');

    const level = 1 + Math.floor(state.caught / CATCHES_PER_LEVEL);
    if (level > state.level) {
      state.level = level;
      sfx.level();
      addPopup(W / 2, H * 0.3, 'Nível ' + level + '!', '#222a36');
    }
  }

  function onMiss(item) {
    if (item.def.bomb) {
      burst(item.x, feetY, ['#888', '#bbb'], 10, H * 0.2);
      return;
    }
    sfx.miss();
    burst(item.x, feetY, ['#999', '#666', '#e2363e'], 12, H * 0.25);
    addPopup(item.x, feetY - itemSize, 'Ops!', '#e2363e');
    loseLife();
  }

  // ---------- telas ----------

  function show(id, visible) { $(id).hidden = !visible; }

  function startGame() {
    Object.assign(state, {
      mode: 'playing', score: 0, lives: MAX_LIVES, level: 1, caught: 0, bombs: 0, streak: 0, bestStreak: 0,
      items: [], particles: [], popups: [], spawnTimer: 0.6, shake: 0, flash: 0,
    });
    player.xr = 0.5;
    player.x = W / 2;
    player.vx = 0;
    input.fingerX = null;
    show('screenTitle', false);
    show('screenOver', false);
    show('screenPause', false);
    show('btnPause', true);
    audioCtx();
  }

  function pause() {
    if (state.mode !== 'playing') return;
    state.mode = 'paused';
    show('screenPause', true);
  }

  function resume() {
    if (state.mode !== 'paused') return;
    state.mode = 'playing';
    show('screenPause', false);
    last = performance.now();
  }

  function toMenu() {
    state.mode = 'title';
    state.items = [];
    state.particles = [];
    state.popups = [];
    show('screenPause', false);
    show('screenOver', false);
    show('btnPause', false);
    show('screenTitle', true);
    updateBestLabel();
  }

  function gameOver() {
    state.mode = 'over';
    sfx.over();
    const record = state.score > state.best;
    if (record) {
      state.best = state.score;
      try { localStorage.setItem(BEST_KEY, String(state.best)); } catch { /* sem armazenamento */ }
    }
    $('finalScore').textContent = state.score;
    $('finalStats').textContent =
      `${state.caught} produtos · ${state.bombs} bombas · nível ${state.level} · melhor sequência ${state.bestStreak}`;
    show('newRecord', record && state.score > 0);
    show('btnPause', false);
    setTimeout(() => { if (state.mode === 'over') show('screenOver', true); }, 700);
  }

  function updateBestLabel() {
    $('titleBest').textContent = state.best > 0 ? `Recorde: ${state.best} pontos` : '';
  }

  function startFromTitle() {
    if (state.mode === 'title') startGame();
  }

  // ---------- atualização ----------

  function update(dt) {
    state.time += dt;
    state.shake = Math.max(0, state.shake - dt);
    state.flash = Math.max(0, state.flash - dt);

    if (state.mode === 'playing') {
      updatePlayer(dt);

      state.spawnTimer -= dt;
      if (state.spawnTimer <= 0) {
        spawnItem();
        state.spawnTimer = spawnInterval() * rand(0.8, 1.2);
      }
    }

    const basket = basketRect();
    for (const it of state.items) {
      if (it.caught) {
        it.t += dt;
        continue;
      }
      it.y += it.vy * dt;
      it.rot += it.vr * dt;
      if (state.mode !== 'playing') continue;

      const inX = it.x > basket.x0 && it.x < basket.x1;
      const inY = it.y + it.h * 0.3 >= basket.top && it.y < basket.top + spriteH * 0.18;
      if (inX && inY) onCatch(it, basket);
      else if (it.y - it.h / 2 > feetY) { it.missed = true; onMiss(it); }
    }
    state.items = state.items.filter((it) => !it.missed && !(it.caught && it.t > 0.25) && it.y < H + it.h);

    for (const p of state.particles) {
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += H * 1.2 * dt;
      p.life -= dt;
    }
    state.particles = state.particles.filter((p) => p.life > 0);

    for (const p of state.popups) {
      p.y -= H * 0.12 * dt;
      p.life -= dt;
    }
    state.popups = state.popups.filter((p) => p.life > 0);
  }

  function updatePlayer(dt) {
    const keyDir = (input.right ? 1 : 0) - (input.left ? 1 : 0);
    const maxSpeed = W * 1.6;

    if (keyDir) {
      input.fingerX = null;
      player.facing = keyDir;
      player.vx = keyDir * Math.max(W * 0.6, 420);
    } else if (input.fingerX !== null) {
      // O dedo controla a posição do carrinho, não o centro da personagem.
      const target = input.fingerX - basketOffset() * player.facing;
      const dx = target - player.x;
      player.vx = Math.abs(dx) < 1 ? 0 : clamp(dx * 12, -maxSpeed, maxSpeed);
    } else {
      player.vx = 0;
    }

    player.x = clamp(player.x + player.vx * dt, spriteW / 2, W - spriteW / 2);
    player.xr = player.x / W;
    player.flip = approach(player.flip, player.facing, dt * 9);
    if (Math.abs(player.vx) > 20) player.bob += dt * clamp(Math.abs(player.vx) / 40, 6, 14);
    else player.bob = approach(player.bob % Math.PI, 0, dt * 6);
  }

  // ---------- desenho ----------

  function draw() {
    ctx.save();
    if (state.shake > 0) {
      const m = state.shake * H * 0.03;
      ctx.translate(rand(-m, m), rand(-m, m));
    }

    drawBackground();

    for (const it of state.items) drawItem(it);
    if (img.walk && state.mode !== 'loading') drawPlayer();

    for (const p of state.particles) {
      ctx.globalAlpha = clamp(p.life / p.max, 0, 1);
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    for (const p of state.popups) {
      const a = clamp(p.life / p.max, 0, 1);
      ctx.globalAlpha = a;
      ctx.font = `800 ${Math.round(itemSize * 0.5)}px system-ui, "Segoe UI", Roboto, sans-serif`;
      ctx.textAlign = 'center';
      ctx.lineWidth = Math.max(3, itemSize * 0.08);
      ctx.strokeStyle = '#fff';
      ctx.strokeText(p.text, p.x, p.y);
      ctx.fillStyle = p.color;
      ctx.fillText(p.text, p.x, p.y);
    }
    ctx.globalAlpha = 1;
    ctx.restore();

    if (state.flash > 0) {
      ctx.fillStyle = `rgba(226, 54, 62, ${state.flash * 0.6})`;
      ctx.fillRect(0, 0, W, H);
    }

    if (state.mode === 'playing' || state.mode === 'paused' || state.mode === 'over') drawHud();
  }

  function drawBackground() {
    ctx.fillStyle = skyColor;
    ctx.fillRect(-20, -20, W + 40, H + 40);

    if (img.bg) {
      const s = groundY / BG_CROP.h;
      const dw = BG_CROP.w * s;
      ctx.drawImage(img.bg, BG_CROP.x, BG_CROP.y, BG_CROP.w, BG_CROP.h, (W - dw) / 2, 0, dw, groundY);
    }

    const g = ctx.createLinearGradient(0, groundY, 0, H);
    g.addColorStop(0, floorColor);
    g.addColorStop(1, '#b9bcc2');
    ctx.fillStyle = g;
    ctx.fillRect(-20, groundY, W + 40, H - groundY + 20);
    ctx.fillStyle = 'rgba(34, 42, 54, .18)';
    ctx.fillRect(-20, groundY, W + 40, 2);
  }

  function drawItem(it) {
    const pic = img[it.def.key];
    let x = it.x, y = it.y, scale = 1, alpha = 1;
    if (it.caught) {
      const k = clamp(it.t / 0.25, 0, 1);
      x = it.x + (it.tx - it.x) * k;
      y = it.y + (it.ty - it.y) * k;
      scale = 1 - 0.6 * k;
      alpha = 1 - k;
      if (it.def.bomb) return;
    }
    // sombra no chão
    if (!it.caught) {
      const near = clamp(it.y / feetY, 0, 1);
      ctx.fillStyle = `rgba(0,0,0,${0.08 + near * 0.14})`;
      ctx.beginPath();
      ctx.ellipse(it.x, feetY, it.w * 0.35 * (0.4 + near * 0.6), itemSize * 0.06, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(x, y);
    ctx.rotate(it.rot);
    ctx.scale(scale, scale);
    ctx.drawImage(pic, -it.w / 2, -it.h / 2, it.w, it.h);
    ctx.restore();
  }

  function drawPlayer() {
    const bob = bobOffset();
    const tilt = Math.abs(player.vx) > 20 ? Math.sin(player.bob * 2) * 0.015 : 0;

    ctx.fillStyle = 'rgba(0,0,0,.16)';
    ctx.beginPath();
    ctx.ellipse(player.x, feetY, spriteW * 0.42, spriteH * 0.035, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.save();
    ctx.translate(player.x, feetY + bob);
    ctx.rotate(tilt);
    ctx.scale(player.flip === 0 ? 0.001 : player.flip, 1);
    ctx.drawImage(img.walk, -spriteW / 2, -spriteH, spriteW, spriteH);
    ctx.restore();
  }

  function drawHeart(x, y, s, filled) {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(s / 32, s / 32);
    ctx.beginPath();
    ctx.moveTo(16, 29);
    ctx.bezierCurveTo(4, 20, 0, 13, 0, 8.5);
    ctx.bezierCurveTo(0, 3.5, 4, 0, 8.5, 0);
    ctx.bezierCurveTo(12, 0, 14.5, 2, 16, 4.5);
    ctx.bezierCurveTo(17.5, 2, 20, 0, 23.5, 0);
    ctx.bezierCurveTo(28, 0, 32, 3.5, 32, 8.5);
    ctx.bezierCurveTo(32, 13, 28, 20, 16, 29);
    ctx.closePath();
    ctx.fillStyle = filled ? '#e2363e' : 'rgba(34,42,54,.18)';
    ctx.fill();
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = '#fff';
    ctx.stroke();
    ctx.restore();
  }

  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function drawHud() {
    const pad = 12;
    const fs = clamp(Math.min(W, H) * 0.05, 18, 34);
    const boxH = fs * 1.9;

    ctx.font = `800 ${fs}px system-ui, "Segoe UI", Roboto, sans-serif`;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';

    const scoreText = String(state.score);
    const levelText = `Nível ${state.level}`;
    ctx.font = `800 ${fs}px system-ui, "Segoe UI", Roboto, sans-serif`;
    const sw = ctx.measureText(scoreText).width;
    ctx.font = `600 ${fs * 0.6}px system-ui, "Segoe UI", Roboto, sans-serif`;
    const lw = ctx.measureText(levelText).width;
    const heartS = fs * 1.05;
    const boxW = pad * 2 + sw + fs * 0.7 + lw + fs * 0.7 + MAX_LIVES * (heartS + 6);

    ctx.fillStyle = 'rgba(34, 42, 54, .82)';
    roundRect(pad, pad, boxW, boxH, 14);
    ctx.fill();

    let x = pad * 2;
    const cy = pad + boxH / 2;
    ctx.fillStyle = '#fff';
    ctx.font = `800 ${fs}px system-ui, "Segoe UI", Roboto, sans-serif`;
    ctx.fillText(scoreText, x, cy + 1);
    x += sw + fs * 0.7;

    ctx.fillStyle = '#ffd23f';
    ctx.font = `600 ${fs * 0.6}px system-ui, "Segoe UI", Roboto, sans-serif`;
    ctx.fillText(levelText, x, cy + 1);
    x += lw + fs * 0.7;

    for (let i = 0; i < MAX_LIVES; i++) {
      drawHeart(x + i * (heartS + 6), cy - heartS * 0.45, heartS, i < state.lives);
    }

    if (state.streak >= 3) {
      ctx.textAlign = 'left';
      ctx.font = `700 ${fs * 0.6}px system-ui, "Segoe UI", Roboto, sans-serif`;
      ctx.fillStyle = '#222a36';
      ctx.fillText(`Sequência x${state.streak}`, pad + 4, pad + boxH + fs * 0.6);
    }
    ctx.textBaseline = 'alphabetic';
  }

  // ---------- loop ----------

  let last = performance.now();
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (state.mode !== 'paused') update(dt);
    draw();
    requestAnimationFrame(frame);
  }

  // ---------- entrada ----------

  function setFinger(clientX) {
    if (input.fingerX !== null) {
      input.accum = clamp(input.accum + (clientX - input.fingerX), -40, 40);
      if (input.accum < -12) { player.facing = -1; input.accum = 0; }
      else if (input.accum > 12) { player.facing = 1; input.accum = 0; }
    }
    input.fingerX = clientX;
  }

  canvas.addEventListener('pointerdown', (e) => {
    if (state.mode !== 'playing') return;
    input.pointerId = e.pointerId;
    canvas.setPointerCapture?.(e.pointerId);
    const basketX = player.x + basketOffset() * player.facing;
    if (Math.abs(e.clientX - basketX) > spriteW * 0.2) player.facing = e.clientX < basketX ? -1 : 1;
    input.fingerX = null;
    input.accum = 0;
    setFinger(e.clientX);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (state.mode !== 'playing') return;
    // mouse sem botão pressionado também move (Windows com mouse/trackpad)
    if (e.pointerType === 'mouse' || e.pointerId === input.pointerId) setFinger(e.clientX);
  });
  const release = (e) => {
    if (e.pointerId === input.pointerId) {
      input.pointerId = null;
      if (e.pointerType !== 'mouse') input.fingerX = null;
    }
  };
  canvas.addEventListener('pointerup', release);
  canvas.addEventListener('pointercancel', release);

  const KEYS_LEFT = ['ArrowLeft', 'KeyA'];
  const KEYS_RIGHT = ['ArrowRight', 'KeyD'];
  window.addEventListener('keydown', (e) => {
    if (KEYS_LEFT.includes(e.code)) { input.left = true; e.preventDefault(); }
    else if (KEYS_RIGHT.includes(e.code)) { input.right = true; e.preventDefault(); }
    else if (e.code === 'Escape' || e.code === 'KeyP') state.mode === 'paused' ? resume() : pause();
    else if ((e.code === 'Enter' || e.code === 'Space') && (state.mode === 'title' || state.mode === 'over')) {
      e.preventDefault();
      startGame();
    }
  });
  window.addEventListener('keyup', (e) => {
    if (KEYS_LEFT.includes(e.code)) input.left = false;
    if (KEYS_RIGHT.includes(e.code)) input.right = false;
  });

  window.addEventListener('resize', resize);
  window.addEventListener('blur', () => { input.left = input.right = false; });
  document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });
  document.addEventListener('contextmenu', (e) => e.preventDefault());

  $('screenTitle').addEventListener('click', startFromTitle);
  $('btnAgain').addEventListener('click', startGame);
  $('btnResume').addEventListener('click', resume);
  $('btnPause').addEventListener('click', pause);
  $('btnQuit').addEventListener('click', toMenu);
  $('btnMenu').addEventListener('click', toMenu);

  $('btnSound').addEventListener('click', () => {
    audio.muted = !audio.muted;
    if (audio.muted && audio.ctx) audio.ctx.suspend();
    $('icoSoundOn').hidden = audio.muted;
    $('icoSoundOff').hidden = !audio.muted;
  });

  $('btnFull').addEventListener('click', async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else {
        await document.documentElement.requestFullscreen({ navigationUI: 'hide' });
        await screen.orientation?.lock?.('landscape');
      }
    } catch { /* não suportado neste navegador */ }
  });

  // ---------- início ----------

  async function init() {
    try { state.best = Number(localStorage.getItem(BEST_KEY)) || 0; } catch { state.best = 0; }
    $('startImg').src = SRC.start;
    $('startBlur').style.backgroundImage = `url("${SRC.start}")`;
    resize();
    requestAnimationFrame(frame);

    try {
      const keys = ['walk', 'bg', 'bomb', ...PRODUCTS.map((p) => p.key)];
      const loaded = await Promise.all(keys.map((k) => loadImage(SRC[k])));
      keys.forEach((k, i) => { img[k] = loaded[i]; });
    } catch (err) {
      $('titleBest').textContent = err.message;
      return;
    }

    skyColor = sampleColor(img.bg, 400, 60, skyColor);
    floorColor = sampleColor(img.bg, 400, 850, floorColor);
    img.walk = removeBackground(toCanvas(img.walk, WALK_CROP_BOTTOM), 48, 30, 30);
    for (const def of [...PRODUCTS, BOMB]) img[def.key] = trim(removeBackground(toCanvas(img[def.key]), 28, 24));

    resize();
    state.mode = 'title';
    updateBestLabel();
    $('btnPlay').disabled = false;
  }

  if (new URLSearchParams(location.search).has('debug')) window.__game = { state, player, basketRect };

  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }

  init();
})();
