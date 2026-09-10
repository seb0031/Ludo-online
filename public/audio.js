'use strict';
const Audio = (() => {
  let ctx = null, master = null, musicGain = null;
  let musicRunning = false, musicTimeout = null, musicNodes = [];
  const settings = { sfx: true, music: false };

  function getCtx() {
    if (!ctx) {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      master = ctx.createGain(); master.gain.value = 0.65; master.connect(ctx.destination);
      musicGain = ctx.createGain(); musicGain.gain.value = 0.14; musicGain.connect(master);
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  function osc(freq, type, start, dur, vol, dst) {
    const c = getCtx();
    const o = c.createOscillator(), g = c.createGain();
    o.type = type; o.frequency.value = freq;
    g.gain.setValueAtTime(vol, start);
    g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
    o.connect(g); g.connect(dst || master);
    o.start(start); o.stop(start + dur);
  }

  function noise(start, dur, vol, lp) {
    const c = getCtx();
    const size = Math.ceil(c.sampleRate * dur);
    const buf = c.createBuffer(1, size, c.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < size; i++) d[i] = Math.random() * 2 - 1;
    const src = c.createBufferSource(), g = c.createGain();
    const f = c.createBiquadFilter();
    f.type = 'lowpass'; f.frequency.value = lp || 800;
    src.buffer = buf;
    g.gain.setValueAtTime(vol, start);
    g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
    src.connect(f); f.connect(g); g.connect(master);
    src.start(start); src.stop(start + dur);
  }

  // ── Son : un pas de déplacement (petit clic/toc) ─────────────
  function playStep() {
    if (!settings.sfx) return;
    const c = getCtx(), now = c.currentTime;
    // Petit toc de sabot de cheval
    noise(now, 0.04, 0.25, 2500);
    osc(480, 'triangle', now, 0.04, 0.18);
  }

  // ── Son : lancer de dé (bruit de roulement) ───────────────────
  function playDiceRoll() {
    if (!settings.sfx) return;
    const c = getCtx(), now = c.currentTime;
    for (let i = 0; i < 6; i++) {
      noise(now + i * 0.055, 0.05, 0.28, 1800);
    }
    osc(200, 'sine', now + 0.3, 0.08, 0.15);
  }

  // ── Son : 6 (fanfare) ─────────────────────────────────────────
  function playSix() {
    if (!settings.sfx) return;
    const c = getCtx(), now = c.currentTime;
    [330, 415, 523, 659].forEach((f, i) =>
      osc(f, 'triangle', now + i * 0.07, 0.18, 0.35));
  }

  // ── Son : collision / retour à l'écurie ───────────────────────
  function playCapture() {
    if (!settings.sfx) return;
    const c = getCtx(), now = c.currentTime;
    // Impact sourd + descente dramatique
    noise(now, 0.12, 0.55, 700);
    osc(300, 'sawtooth', now,       0.1,  0.4);
    osc(200, 'sawtooth', now + 0.05, 0.12, 0.3);
    osc(120, 'sine',     now + 0.12, 0.15, 0.3);
    // Petite mélodie triste descendante
    [440, 370, 294, 220].forEach((f, i) =>
      osc(f, 'triangle', now + 0.2 + i * 0.09, 0.1, 0.2));
  }

  // ── Son : sortie de l'écurie ──────────────────────────────────
  function playExitBase() {
    if (!settings.sfx) return;
    const c = getCtx(), now = c.currentTime;
    [261, 329, 392].forEach((f, i) =>
      osc(f, 'triangle', now + i * 0.07, 0.15, 0.35));
  }

  // ── Son : victoire ────────────────────────────────────────────
  function playVictory() {
    if (!settings.sfx) return;
    const c = getCtx(), now = c.currentTime;
    [523, 523, 659, 523, 784, 740, 784].forEach((f, i) =>
      osc(f, 'triangle', now + i * 0.14, 0.18, 0.4));
  }

  // ── Son : début de partie ─────────────────────────────────────
  function playStart() {
    if (!settings.sfx) return;
    const c = getCtx(), now = c.currentTime;
    [261, 329, 392, 523].forEach((f, i) =>
      osc(f, 'triangle', now + i * 0.1, 0.2, 0.35));
  }

  // ── Son : clic bouton ─────────────────────────────────────────
  function playClick() {
    if (!settings.sfx) return;
    const c = getCtx(), now = c.currentTime;
    osc(680, 'sine', now, 0.04, 0.22);
  }

  // ── Musique générative joyeuse ────────────────────────────────
  const SCALE = [0,2,4,5,7,9,11];
  const ROOT  = 60;
  function mf(m) { return 440 * Math.pow(2, (m-69)/12); }

  function scheduleMusic() {
    if (!musicRunning) return;
    const c = getCtx(), now = c.currentTime;
    [0,4,7].forEach(d => {
      const o = c.createOscillator(), g = c.createGain();
      o.type = 'triangle'; o.frequency.value = mf(ROOT + SCALE[d % 7]);
      g.gain.setValueAtTime(0, now); g.gain.linearRampToValueAtTime(0.05, now+.12);
      g.gain.exponentialRampToValueAtTime(0.0001, now+1.9);
      o.connect(g); g.connect(musicGain); o.start(now); o.stop(now+2);
      musicNodes.push(o);
    });
    for (let i = 0; i < 3; i++) {
      const deg = SCALE[Math.floor(Math.random() * SCALE.length)];
      const oct = Math.random() < 0.25 ? 12 : 0;
      const t = now + .06 + i * 0.52;
      const o = c.createOscillator(), g = c.createGain();
      o.type = 'sine'; o.frequency.value = mf(ROOT + deg + oct);
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.13, t+.04);
      g.gain.exponentialRampToValueAtTime(0.0001, t+.38);
      o.connect(g); g.connect(musicGain); o.start(t); o.stop(t+.45);
      musicNodes.push(o);
    }
    musicTimeout = setTimeout(scheduleMusic, 1750);
  }

  function startMusic() { if (musicRunning) return; musicRunning = true; scheduleMusic(); }
  function stopMusic() {
    musicRunning = false;
    if (musicTimeout) { clearTimeout(musicTimeout); musicTimeout = null; }
    musicNodes.forEach(n => { try{n.stop()}catch(e){} });
    musicNodes = [];
  }

  return {
    playStep, playDiceRoll, playSix, playCapture, playExitBase,
    playVictory, playStart, playClick,
    startMusic, stopMusic,
    setSfx: v => { settings.sfx = v; },
    setMusic: v => { settings.music = v; v ? startMusic() : stopMusic(); },
    init: getCtx, settings,
  };
})();
