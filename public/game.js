'use strict';
/* ═══════════════════════════════════════════════════════════════════
   GAME.JS — Code complet corrigé (Calculs, clics et interface)
   ═══════════════════════════════════════════════════════════════════ */

// ── SYSTÈME AUDIO SYNTHÉTIQUE (Web Audio API) ───────────────────────
const AudioFx = (() => {
  let ctx = null;

  function init() {
    if (!ctx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (AudioCtx) ctx = new AudioCtx();
    }
    if (ctx && ctx.state === 'suspended') {
      ctx.resume();
    }
  }

  function playTone(freq, type, duration, vol = 0.1) {
    if (!ctx) return;
    try {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, ctx.currentTime);
      gain.gain.setValueAtTime(vol, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + duration);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + duration);
    } catch (e) {}
  }

  return {
    init,
    playClick: () => { init(); playTone(600, 'triangle', 0.05, 0.1); },
    playDiceRoll: () => { init(); playTone(300, 'square', 0.08, 0.05); },
    playStep: () => { init(); playTone(440, 'sine', 0.08, 0.1); },
    playSix: () => { 
      init(); 
      playTone(523.25, 'sine', 0.1, 0.15);
      setTimeout(() => playTone(659.25, 'sine', 0.15, 0.15), 100);
    },
    playCapture: () => {
      init();
      playTone(150, 'sawtooth', 0.2, 0.2);
    },
    playVictory: () => {
      init();
      [261.63, 329.63, 392.00, 523.25].forEach((f, i) => {
        setTimeout(() => playTone(f, 'sine', 0.2, 0.15), i * 120);
      });
    }
  };
})();

// ── MOTEUR VISUEL ET RÉSEAU DU JEU ───────────────────────────────────
const Game = (() => {
  const canvas = document.getElementById('ludo-board');
  const ctx    = canvas.getContext('2d');
  function $(id) { return document.getElementById(id); }

  let socket = null, myColor = 'green', state = null;
  let pendingMoves = [], waitingForPawn = false;
  let animating = false, isDiceRolling = false;

  const PAL = {
    green:  { main:'#3cb043', light:'#6dd672', dark:'#267328', bg:'#e8f8e9' },
    red:    { main:'#e02020', light:'#ff5555', dark:'#a01010', bg:'#fdeaea' },
    blue:   { main:'#2060e0', light:'#5090ff', dark:'#1040a0', bg:'#eaeffd' },
    yellow: { main:'#e0b800', light:'#ffe040', dark:'#a08000', bg:'#fdf8e1' },
  };
  const DICE_SYMBOLS = { 1:'⚀', 2:'⚁', 3:'⚂', 4:'⚃', 5:'⚄', 6:'⚅' };

  let SZ = 40;
  const N  = 11;

  function resize() {
    if (!canvas) return;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const topBarH = parseInt(getComputedStyle(document.querySelector('.game-top-bar'))?.height) || 52;
    const botBarH = parseInt(getComputedStyle(document.querySelector('.game-bottom-bar'))?.height) || 80;
    const available = Math.min(vw - 8, vh - topBarH - botBarH - 50);
    SZ = Math.max(20, Math.floor(available / N));
    const size = SZ * N;
    canvas.width  = size;
    canvas.height = size;
    if (state) render();
  }

  const TRACK = [
    [0,4],[1,4],[2,4],[3,4],[4,4],[4,3],[4,2],[4,1],[4,0],[5,0],
    [6,0],[6,1],[6,2],[6,3],[6,4],[7,4],[8,4],[9,4],[10,4],[10,5],
    [10,6],[9,6],[8,6],[7,6],[6,6],[6,7],[6,8],[6,9],[6,10],[5,10],
    [4,10],[4,9],[4,8],[4,7],[4,6],[3,6],[2,6],[1,6],[0,6],[0,5],[0,4]
  ].slice(0, 52);

  const STAIRS_CELLS = {
    green:  [[1,5],[2,5],[3,5],[4,5],[5,5]],
    red:    [[5,1],[5,2],[5,3],[5,4],[5,5]],
    blue:   [[9,5],[8,5],[7,5],[6,5],[5,5]],
    yellow: [[5,9],[5,8],[5,7],[5,6],[5,5]],
  };

  const BASE_SLOTS = {
    green:  [[1,1],[2,1],[1,2],[2,2]],
    red:    [[8,1],[9,1],[8,2],[9,2]],
    blue:   [[8,8],[9,8],[8,9],[9,9]],
    yellow: [[1,8],[2,8],[1,9],[2,9]],
  };

  const START_ABS = { red:10, blue:20, yellow:30, green:40 };

  function render() {
    if (!state) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    drawBoard();
    drawPawns(null);
  }

  function drawBoard() {
    const s = SZ;
    ctx.fillStyle = '#d0d0d0';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const bases = {
      green:  {x:0,   y:0,   w:4*s, h:4*s, color:'green'},
      red:    {x:7*s, y:0,   w:4*s, h:4*s, color:'red'},
      blue:   {x:7*s, y:7*s, w:4*s, h:4*s, color:'blue'},
      yellow: {x:0,   y:7*s, w:4*s, h:4*s, color:'yellow'},
    };

    Object.entries(bases).forEach(([color, b]) => {
      ctx.fillStyle = PAL[color].bg;
      ctx.fillRect(b.x, b.y, b.w, b.h);
      ctx.strokeStyle = PAL[color].dark;
      ctx.lineWidth = 2;
      ctx.strokeRect(b.x+1, b.y+1, b.w-2, b.h-2);
      const cx = b.x + b.w/2, cy = b.y + b.h/2, r = b.w/2 - s*0.3;
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI*2);
      ctx.fillStyle = PAL[color].main; ctx.fill();

      // Dessiner les emplacements d'écurie uniquement si le pion s'y trouve encore
      BASE_SLOTS[color].forEach(([sc, sr], idx) => {
        const pawnAtBase = state.pawns?.[color]?.find(p => p.id === idx && p.state === 'base');
        if (pawnAtBase) {
          const px = sc*s + s/2, py = sr*s + s/2;
          ctx.beginPath(); ctx.arc(px, py, s*0.32, 0, Math.PI*2);
          ctx.fillStyle = 'rgba(255,255,255,0.5)'; ctx.fill();
        }
      });
    });

    TRACK.forEach(([c, r], idx) => {
      const x = c*s, y = r*s;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(x, y, s, s);
      ctx.strokeStyle = '#aaa'; ctx.lineWidth = 0.5;
      ctx.strokeRect(x, y, s, s);

      const startColorEntry = Object.entries(START_ABS).find(([_, pos]) => pos === idx);
      if (startColorEntry) {
        ctx.fillStyle = PAL[startColorEntry[0]].main;
        ctx.font = `${s*0.65}px serif`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText('★', x+s/2, y+s/2);
      } else {
        ctx.fillStyle = 'rgba(0,0,0,0.35)';
        ctx.font = `bold ${Math.max(9, s*0.25)}px Nunito, sans-serif`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(idx, x + s/2, y + s/2);
      }
    });

    Object.entries(STAIRS_CELLS).forEach(([color, cells]) => {
      cells.slice(0, 5).forEach(([c, r], stepIdx) => {
        const x = c*s, y = r*s;
        ctx.fillStyle = PAL[color].main + '55';
        ctx.fillRect(x, y, s, s);
        ctx.strokeStyle = PAL[color].main; ctx.lineWidth = 1;
        ctx.strokeRect(x, y, s, s);

        ctx.fillStyle = PAL[color].main;
        ctx.font = `bold ${Math.max(9, s*0.25)}px Nunito, sans-serif`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(stepIdx + 1, x + s/2, y + s/2);
      });
    });

    const cx = 5*s, cy = 5*s, cw = s, ch = s;
    ctx.fillStyle = PAL.green.main;
    ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx+cw/2, cy+ch/2); ctx.lineTo(cx, cy+ch); ctx.closePath(); ctx.fill();
    ctx.fillStyle = PAL.red.main;
    ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx+cw/2, cy+ch/2); ctx.lineTo(cx+cw, cy); ctx.closePath(); ctx.fill();
    ctx.fillStyle = PAL.blue.main;
    ctx.beginPath(); ctx.moveTo(cx+cw, cy); ctx.lineTo(cx+cw/2, cy+ch/2); ctx.lineTo(cx+cw, cy+ch); ctx.closePath(); ctx.fill();
    ctx.fillStyle = PAL.yellow.main;
    ctx.beginPath(); ctx.moveTo(cx, cy+ch); ctx.lineTo(cx+cw/2, cy+ch/2); ctx.lineTo(cx+cw, cy+ch); ctx.closePath(); ctx.fill();
    ctx.font = `${s*0.7}px serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('⭐', cx+cw/2, cy+ch/2);
  }

  function getPawnCanvasPos(pawn, color) {
    if (!pawn) return null;
    const s = SZ;

    if (pawn.state === 'base') {
      const slot = BASE_SLOTS[color]?.[pawn.id];
      if (!slot) return null;
      return { x: slot[0]*s + s/2, y: slot[1]*s + s/2 };
    }

    if (pawn.state === 'track') {
      const relPos = pawn.trackPos;
      if (relPos === undefined || relPos < 0) return null;
      const abs = (START_ABS[color] + relPos) % 52;
      const cell = TRACK[abs];
      if (!cell) return null;

      const stack = getPawnsOnAbsCell(abs);
      const off = getCenteringOffset(stack, color, pawn.id);
      return { x: cell[0]*s + s/2 + off.x, y: cell[1]*s + s/2 + off.y };
    }

    if (pawn.state === 'stairs') {
      const stepIndex = Math.min(Math.max(0, (pawn.stairsPos || 1) - 1), 4);
      const cell = STAIRS_CELLS[color]?.[stepIndex];
      if (!cell) return { x: 5*s+s/2, y: 5*s+s/2 };
      return { x: cell[0]*s + s/2, y: cell[1]*s + s/2 };
    }

    if (pawn.state === 'finished') {
      const offsets = { green:[-s*0.22,-s*0.22], red:[s*0.22,-s*0.22], blue:[s*0.22,s*0.22], yellow:[-s*0.22,s*0.22] };
      const [ox, oy] = offsets[color] || [0,0];
      return { x: 5*s+s/2+ox, y: 5*s+s/2+oy };
    }

    return null;
  }

  function getPawnsOnAbsCell(abs) {
    if (!state || !state.pawns) return [];
    const list = [];
    Object.entries(state.pawns).forEach(([col, pawns]) => {
      if (Array.isArray(pawns)) {
        pawns.forEach(p => {
          if (p && p.state === 'track') {
            const pAbs = (START_ABS[col] + p.trackPos) % 52;
            if (pAbs === abs) list.push({ color: col, id: p.id });
          }
        });
      }
    });
    return list;
  }

  function getCenteringOffset(stack, color, pawnId) {
    if (stack.length <= 1) return { x: 0, y: 0 };
    const index = stack.findIndex(p => p.color === color && p.id === pawnId);
    const d = SZ * 0.15;
    const offsets = [{x: -d, y: -d}, {x: d, y: d}, {x: -d, y: d}, {x: d, y: -d}];
    return offsets[index % 4] || {x:0, y:0};
  }

  function drawPawns(overridePawn) {
    if (!state || !state.pawns) return;
    Object.entries(state.pawns).forEach(([color, pawns]) => {
      if (Array.isArray(pawns)) {
        pawns.forEach(pawn => {
          if (overridePawn && overridePawn.color === color && overridePawn.id === pawn.id) return;
          const pos = getPawnCanvasPos(pawn, color);
          if (pos) drawPawn(pos.x, pos.y, color, pawn.id + 1, pawn.state === 'finished');
        });
      }
    });

    if (overridePawn) {
      drawPawn(overridePawn.x, overridePawn.y, overridePawn.color, overridePawn.id + 1, false);
    }

    if (waitingForPawn && pendingMoves.length > 0) {
      const playableIds = pendingMoves.map(m => m.pawnId);
      state.pawns[myColor]?.forEach(pawn => {
        if (!playableIds.includes(pawn.id)) return;
        const pos = getPawnCanvasPos(pawn, myColor);
        if (!pos) return;
        ctx.beginPath();
        ctx.arc(pos.x, pos.y, SZ*0.44, 0, Math.PI*2);
        ctx.strokeStyle = '#ffffff'; 
        ctx.lineWidth = 3;
        ctx.stroke();
      });
    }
  }

  function drawPawn(x, y, color, num, isFinished) {
    const s = SZ;
    const r = s * 0.33;
    ctx.beginPath(); ctx.arc(x+1, y+1.5, r, 0, Math.PI*2);
    ctx.fillStyle = 'rgba(0,0,0,0.22)'; ctx.fill();
    const grad = ctx.createRadialGradient(x-r*0.3, y-r*0.3, 1, x, y, r);
    grad.addColorStop(0, PAL[color]?.light || '#fff');
    grad.addColorStop(1, PAL[color]?.dark || '#000');
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI*2);
    ctx.fillStyle = grad; ctx.fill();
    ctx.strokeStyle = isFinished ? '#ffd700' : 'rgba(255,255,255,0.9)';
    ctx.lineWidth = isFinished ? 2.5 : 1.8; ctx.stroke();
    ctx.fillStyle = '#fff';
    ctx.font = `bold ${Math.max(8, s*0.26)}px Nunito,sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(num, x, y);
  }

  function animatePawnSteps(color, pawnId, steps, callback) {
    if (!steps || steps.length === 0) { callback(); return; }
    let stepIdx = 0;

    function doStep() {
      if (stepIdx >= steps.length) { callback(); return; }
      const step = steps[stepIdx++];
      const s = SZ;
      let targetPos;

      if (step.type === 'track') {
        const abs = (START_ABS[color] + step.rel) % 52;
        const cell = TRACK[abs];
        targetPos = { x: cell[0]*s + s/2, y: cell[1]*s + s/2 };
      } else if (step.type === 'stairs') {
        const stepIndex = Math.min(Math.max(0, step.pos - 1), 4);
        const cell = STAIRS_CELLS[color][stepIndex];
        targetPos = { x: cell[0]*s + s/2, y: cell[1]*s + s/2 };
      } else {
        targetPos = { x: 5*s + s/2, y: 5*s + s/2 };
      }

      const pawn = state.pawns[color][pawnId];
      const startPos = getPawnCanvasPos(pawn, color) || targetPos;
      AudioFx.playStep();

      const duration = Math.min(180, 500 / steps.length);
      const start = performance.now();
      const override = { color, id: pawnId, x: startPos.x, y: startPos.y };

      function frame(now) {
        const p = Math.min(1, (now - start) / duration);
        override.x = startPos.x + (targetPos.x - startPos.x) * p;
        override.y = startPos.y + (targetPos.y - startPos.y) * p;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        drawBoard();
        drawPawns(override);
        if (p < 1) requestAnimationFrame(frame);
        else doStep();
      }
      requestAnimationFrame(frame);
    }
    doStep();
  }

  function triggerDiceRollAnimation(finalDiceValue, onComplete) {
    const diceEl = $('dice');
    const faceEl = $('dice-face');

    if (!diceEl || !faceEl) { 
      isDiceRolling = false;
      if (onComplete) onComplete(); 
      return; 
    }

    isDiceRolling = true;
    diceEl.classList.add('rolling');
    AudioFx.playDiceRoll();

    let rollCount = 0;
    const maxRolls = 10;
    const interval = setInterval(() => {
      rollCount++;
      const tempVal = Math.floor(Math.random() * 6) + 1;
      faceEl.textContent = DICE_SYMBOLS[tempVal];

      if (rollCount >= maxRolls) {
        clearInterval(interval);
        diceEl.classList.remove('rolling');
        faceEl.textContent = DICE_SYMBOLS[finalDiceValue] || String(finalDiceValue);
        isDiceRolling = false;
        if (onComplete) onComplete();
      }
    }, 50);
  }

  function handleClick(e) {
    if (!waitingForPawn || animating || isDiceRolling) return;
    const rect = canvas.getBoundingClientRect();
    const touch = e.touches ? e.touches[0] : e;
    const mx = (touch.clientX - rect.left) * (canvas.width / rect.width);
    const my = (touch.clientY - rect.top)  * (canvas.height / rect.height);

    const playableIds = pendingMoves.map(m => m.pawnId);
    const pawns = state.pawns[myColor] || [];

    for (const pawn of pawns) {
      if (!playableIds.includes(pawn.id)) continue;
      const pos = getPawnCanvasPos(pawn, myColor);
      if (!pos) continue;
      
      const dist = Math.sqrt((mx - pos.x) ** 2 + (my - pos.y) ** 2);
      if (dist <= SZ * 0.8) {
        AudioFx.playClick();
        waitingForPawn = false;
        pendingMoves   = [];
        socket.emit('move_pawn', { pawnId: pawn.id });
        render();
        return;
      }
    }
  }

  function updateUI() {
    if (!state) return;

    if (socket && state.players) {
      const foundColor = Object.keys(state.players).find(
        c => state.players[c].id === socket.id
      );
      if (foundColor) myColor = foundColor;
    }

    ['green','red','blue','yellow'].forEach(c => {
      const chip = $(`chip-${c}`);
      if (!chip) return;
      const p = state.players ? state.players[c] : null;
      if (!p || (state.activeColors && !state.activeColors.includes(c))) { chip.style.display = 'none'; return; }
      chip.style.display = 'flex';
      const nameEl = $(`name-${c}`);
      if (nameEl) nameEl.textContent = (p.pseudo || c) + (p.isBot ? ' 🤖' : '');
      chip.classList.toggle('active-turn', state.turn === c);
    });

    const banner = $('turn-banner');
    if (banner) {
      const isMyTurn = state.turn === myColor;
      const isBot = state.players && state.players[state.turn]?.isBot;
      if (isMyTurn) {
        banner.textContent = state.diceRolled ? '👆 Choisissez un cheval' : '🎲 À votre tour : lancez le dé !';
        banner.className   = 'turn-banner my-turn';
      } else {
        const pseudo = (state.players && state.players[state.turn]?.pseudo) || state.turn;
        banner.textContent = state.diceRolled ? `⏳ ${pseudo} choisit un cheval…` : `⏳ Tour de ${pseudo}${isBot ? ' 🤖' : ''}`;
        banner.className   = isBot ? 'turn-banner bot-turn' : 'turn-banner';
      }
    }

    const diceEl = $('dice');
    const faceEl = $('dice-face');
    if (diceEl && faceEl) {
      if (state.dice && !isDiceRolling) {
        faceEl.textContent = DICE_SYMBOLS[state.dice] || String(state.dice);
      }
      const canRoll = (state.turn === myColor) && !state.diceRolled && state.phase === 'playing' && !animating && !isDiceRolling;
      diceEl.classList.toggle('disabled', !canRoll);
    }
  }

  function onEvent(event, data) {
    if (data && (data.gameState || data.state)) {
      state = data.gameState || data.state;
    }

    if (socket && state && state.players) {
      const c = Object.keys(state.players).find(col => state.players[col].id === socket.id);
      if (c) myColor = c;
    }

    switch (event) {
      case 'dice_rolled': {
        const diceVal = data.dice || (state ? state.dice : 1);
        triggerDiceRollAnimation(diceVal, () => {
          if (diceVal === 6) AudioFx.playSix();

          if (data.skipped || data.autoPass) {
            waitingForPawn = false;
            pendingMoves = [];
          } else if (data.moves?.length > 0 && data.color === myColor) {
            pendingMoves   = data.moves;
            waitingForPawn = true;
          } else {
            waitingForPawn = false;
            pendingMoves = [];
          }
          updateUI(); 
          render();
        });
        break;
      }

      case 'pawn_moved': {
        const { color, pawnId, steps, captures } = data;
        animating = true;
        waitingForPawn = false;
        pendingMoves   = [];

        animatePawnSteps(color, pawnId, steps || [], () => {
          if (captures && captures.length > 0) {
            AudioFx.playCapture();
          }
          animating = false;
          render();
          updateUI();
        });
        break;
      }

      case 'turn_changed': {
        waitingForPawn = false;
        pendingMoves = [];
        isDiceRolling = false;
        updateUI(); 
        render();
        break;
      }

      case 'game_start':
      case 'game_started':
        AudioFx.playVictory();
        animating      = false;
        waitingForPawn = false;
        isDiceRolling  = false;
        pendingMoves   = [];
        updateUI(); 
        render();
        break;

      case 'game_over':
        AudioFx.playVictory();
        updateUI();
        render();
        break;
    }
  }

  function init(sock, payload) {
    socket = sock;
    state  = payload.gameState || payload.state;
    if (payload.color) myColor = payload.color;

    animating = false; 
    waitingForPawn = false; 
    pendingMoves = []; 
    isDiceRolling = false;

    resize(); 
    updateUI(); 
    render();

    canvas.removeEventListener('click', handleClick);
    canvas.addEventListener('click', handleClick);

    const diceBtn = $('dice');
    if (diceBtn) {
      diceBtn.onclick = (e) => {
        e.preventDefault();
        AudioFx.init();
        if (animating || isDiceRolling) return;
        if (!state || state.phase !== 'playing') return;
        if (state.turn !== myColor || state.diceRolled) return;

        socket.emit('roll_dice');
      };
    }
  }

  window.addEventListener('resize', () => { if (state) resize(); });

  return { init, onEvent };
})();