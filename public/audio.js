'use strict';
const Audio = (() => {
  let ctx = null, master = null, musicGain = null;
  let musicRunning = false, musicTimeout = null, musicNodes = [];
  const settings = { sfx: true, music: false };

  function getCtx() {
    if (!ctx) {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      master = ctx.createGain(); master.gain.value = 0.7; master.connect(ctx.destination);
      musicGain = ctx.createGain(); musicGain.gain.value = 0.15; musicGain.connect(master);
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
    const c = getCtx(), size = c.sampleRate * dur;
    const buf = c.createBuffer(1, size, c.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < size; i++) d[i] = Math.random() * 2 - 1;
    const src = c.createBufferSource(), g = c.createGain();
    const f = c.createBiquadFilter();
    f.type = 'lowpass'; f.frequency.value = lp || 800;
    src.buffer = buf; g.gain.setValueAtTime(vol, start);
    g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
    src.connect(f); f.connect(g); g.connect(master);
    src.start(start); src.stop(start + dur);
  }

  // Sons
  function playDiceRoll() {
    if (!settings.sfx) return;
    const c = getCtx(), now = c.currentTime;
    for (let i = 0; i < 5; i++) noise(now + i * 0.06, 0.07, 0.3, 1200);
  }

  function playMove() {
    if (!settings.sfx) return;
    const c = getCtx(), now = c.currentTime;
    osc(440, 'sine', now, 0.08, 0.4);
    osc(550, 'sine', now + 0.06, 0.06, 0.3);
  }

  function playCapture() {
    if (!settings.sfx) return;
    const c = getCtx(), now = c.currentTime;
    noise(now, 0.15, 0.5, 600);
    osc(150, 'sawtooth', now, 0.18, 0.35);
    osc(200, 'sawtooth', now + 0.08, 0.1, 0.2);
  }

  function playSix() {
    if (!settings.sfx) return;
    const c = getCtx(), now = c.currentTime;
    [261, 329, 392, 523].forEach((f, i) => osc(f, 'triangle', now + i * 0.07, 0.15, 0.35));
  }

  function playFinish() {
    if (!settings.sfx) return;
    const c = getCtx(), now = c.currentTime;
    [523, 659, 784, 1046, 1318].forEach((f, i) => osc(f, 'triangle', now + i * 0.09, 0.2, 0.4));
  }

  function playVictory() {
    if (!settings.sfx) return;
    const c = getCtx(), now = c.currentTime;
    const notes = [523, 523, 659, 523, 784, 740];
    notes.forEach((f, i) => osc(f, 'triangle', now + i * 0.15, 0.18, 0.4));
  }

  function playStart() {
    if (!settings.sfx) return;
    const c = getCtx(), now = c.currentTime;
    [261, 329, 392, 523].forEach((f, i) => osc(f, 'triangle', now + i * 0.1, 0.2, 0.35));
  }

  function playClick() {
    if (!settings.sfx) return;
    const c = getCtx(), now = c.currentTime;
    osc(700, 'sine', now, 0.04, 0.25);
  }

  function playExitBase() {
    if (!settings.sfx) return;
    const c = getCtx(), now = c.currentTime;
    osc(392, 'triangle', now,      0.08, 0.4);
    osc(523, 'triangle', now+0.08, 0.1,  0.4);
  }

  // Musique générative joyeuse
  const SCALE = [0, 2, 4, 5, 7, 9, 11]; // Majeur
  const ROOT  = 60; // Do4
  function mf(midi) { return 440 * Math.pow(2, (midi - 69) / 12); }

  function scheduleMusic() {
    if (!musicRunning) return;
    const c = getCtx(), now = c.currentTime;
    // Accord
    [0, 4, 7].forEach(d => {
      const o = c.createOscillator(), g = c.createGain();
      o.type = 'triangle'; o.frequency.value = mf(ROOT + SCALE[d % 7]);
      g.gain.setValueAtTime(0, now); g.gain.linearRampToValueAtTime(0.04, now+.1);
      g.gain.exponentialRampToValueAtTime(0.0001, now+1.8);
      o.connect(g); g.connect(musicGain); o.start(now); o.stop(now+2);
      musicNodes.push(o);
    });
    // Mélodie
    for (let i = 0; i < 3; i++) {
      const deg = SCALE[Math.floor(Math.random() * SCALE.length)];
      const oct = Math.random() < 0.3 ? 12 : 0;
      const t = now + .05 + i * 0.55;
      const o = c.createOscillator(), g = c.createGain();
      o.type = 'sine'; o.frequency.value = mf(ROOT + deg + oct);
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.12, t+.04);
      g.gain.exponentialRampToValueAtTime(0.0001, t+.4);
      o.connect(g); g.connect(musicGain); o.start(t); o.stop(t+.5);
      musicNodes.push(o);
    }
    musicTimeout = setTimeout(scheduleMusic, 1800);
  }

  function startMusic() {
    if (musicRunning) return;
    musicRunning = true; scheduleMusic();
  }
  function stopMusic() {
    musicRunning = false;
    if (musicTimeout) { clearTimeout(musicTimeout); musicTimeout = null; }
    musicNodes.forEach(n => { try{n.stop()}catch(e){} });
    musicNodes = [];
  }

  return {
    playDiceRoll, playMove, playCapture, playSix, playFinish,
    playVictory, playStart, playClick, playExitBase,
    startMusic, stopMusic,
    setSfx: v => { settings.sfx = v; },
    setMusic: v => { settings.music = v; v ? startMusic() : stopMusic(); },
    init: getCtx, settings,
  };
})();
