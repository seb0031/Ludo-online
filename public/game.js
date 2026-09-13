'use strict';
/* ═══════════════════════════════════════════════════════════════════
   GAME.JS — Plateau personnalisé (Cases blanches & étoiles de départ)
   ═══════════════════════════════════════════════════════════════════ */
const Game = (() => {
  const canvas = document.getElementById('ludo-board');
  const ctx    = canvas.getContext('2d');
  function $(id) { return document.getElementById(id); }

  let socket = null, myColor = 'green', state = null;
  let pendingMoves = [], waitingForPawn = false;
  let animating = false, isDiceRolling = false;

  const PAL = {
    green:  { main:'#3cb043', light:'#6dd672', dark:'#267328', bg:'#e8f8e9', home:'#3cb043' },
    red:    { main:'#e02020', light:'#ff5555', dark:'#a01010', bg:'#fdeaea', home:'#e02020' },
    blue:   { main:'#2060e0', light:'#5090ff', dark:'#1040a0', bg:'#eaeffd', home:'#2060e0' },
    yellow: { main:'#e0b800', light:'#ffe040', dark:'#a08000', bg:'#fdf8e1', home:'#e0b800' },
  };
  const COLOR_NAMES = { green:'Vert', red:'Rouge', blue:'Bleu', yellow:'Jaune' };
  const DICE_SYMBOLS = { 1:'⚀', 2:'⚁', 3:'⚂', 4:'⚃', 5:'⚄', 6:'⚅' };

  let SZ = 40;
  const N  = 11;

  function resize() {
    if (!canvas) return;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const topBarH = parseInt(getComputedStyle(document.querySelector('.game-top-bar'))?.height) || 52;
    const botBarH = parseInt(getComputedStyle(document.querySelector('.game-bottom-bar'))?.height) || 80;
    const bannerH = 36;
    const available = Math.min(vw - 8, vh - topBarH - botBarH - bannerH - 20);
    SZ = Math.max(20, Math.floor(available / N));
    const size = SZ * N;
    canvas.width  = size;
    canvas.height = size;
    if (state) render();
  }

  const TRACK = [
    [0,4],
    [1,4],[2,4],[3,4],[4,4],
    [4,3],[4,2],[4,1],[4,0],
    [5,0],
    [6,0],[6,1],[6,2],[6,3],
    [6,4],
    [7,4],[8,4],[9,4],[10,4],
    [10,5],
    [10,6],[9,6],[8,6],[7,6],
    [6,6],
    [6,7],[6,8],[6,9],[6,10],
    [5,10],
    [4,10],[4,9],[4,8],[4,7],
    [4,6],
    [3,6],[2,6],[1,6],[0,6],
    [0,5],
    [0,4],
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
      BASE_SLOTS[color].forEach(([sc, sr]) => {
        const px = sc*s + s/2, py = sr*s + s/2;
        ctx.beginPath(); ctx.arc(px, py, s*0.32, 0, Math.PI*2);
        ctx.fillStyle = 'rgba(255,255,255,0.5)'; ctx.fill();
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
        const colorKey = startColorEntry[0];
        ctx.fillStyle = PAL[colorKey].main;
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

    const stairColors = { green: PAL.green.main, red: PAL.red.main, blue: PAL.blue.main, yellow: PAL.yellow.main };
    Object.entries(STAIRS_CELLS).forEach(([color, cells]) => {
      cells.slice(0, 5).forEach(([c, r], stepIdx) => {
        const x = c*s, y = r*s;
        ctx.fillStyle = stairColors[color] + '55';
        ctx.fillRect(x, y, s, s);
        ctx.strokeStyle = stairColors[color]; ctx.lineWidth = 1;
        ctx.strokeRect(x, y, s, s);

        ctx.fillStyle = stairColors[color];
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

    if (waitingForPawn && pendingMoves.length > 0) {
      const playableIds = pendingMoves.map(m => m.pawnId);
      state.pawns[myColor]?.forEach(pawn => {
        if (!playableIds.includes(pawn.id)) return;
        const pos = getPawnCanvasPos(pawn, myColor);
        if (!pos) return;
        ctx.beginPath();
        ctx.arc(pos.x, pos.y, SZ*0.42, 0, Math.PI*2);
        ctx.strokeStyle = '#fff'; ctx.lineWidth = 3;
        ctx.setLineDash([4, 3]); ctx.stroke(); ctx.setLineDash([]);
      });
    }
  }

  function getPawnCanvasPos(pawn, color) {
    const s = SZ;
    if (pawn.state === 'base') {
      const [c, r] = BASE_SLOTS[color][pawn.id];
      return { x: c*s + s/2, y: r*s + s/2 };
    }
    if (pawn.state === 'track') {
      if (pawn.trackPos < 0 || pawn.trackPos > 51) return null;
      const abs = (START_ABS[color] + pawn.trackPos) % 52;
      const [c, r] = TRACK[abs];
      
      const stack = getPawnsOnAbsCell(abs);
      const off = getCenteringOffset(stack, color, pawn.id);
      return { x: c*s + s/2 + off.x, y: r*s + s/2 + off.y };
    }
    if (pawn.state === 'stairs') {
      if (pawn.stairsPos < 0 || pawn.stairsPos > 5) return { x: 5*s+s/2, y: 5*s+s/2 };
      const [c, r] = STAIRS_CELLS[color][Math.min(pawn.stairsPos, 4)];
      return { x: c*s + s/2, y: r*s + s/2 };
    }
    if (pawn.state === 'finished') {
      const offsets = { green:[-s*0.22,-s*0.22], red:[s*0.22,-s*0.22], blue:[s*0.22,s*0.22], yellow:[-s*0.22,s*0.22] };
      const [ox, oy] = offsets[color];
      return { x: 5*s+s/2+ox, y: 5*s+s/2+oy };
    }
    return null;
  }

  function getPawnsOnAbsCell(abs) {
    if (!state || !state.pawns) return [];
    const list = [];
    Object.entries(state.pawns).forEach(([col, pawns]) => {
      pawns.forEach(p => {
        if (p.state === 'track') {
          const pAbs = (START_ABS[col] + p.trackPos) % 52;
          if (pAbs === abs) list.push({ color: col, id: p.id });
        }
      });
    });
    return list;
  }

  function getCenteringOffset(stack, color, pawnId) {
    if (stack.length <= 1) return { x: 0, y: 0 };
    const index = stack.findIndex(p => p.color === color && p.id === pawnId);
    const d = SZ * 0.15;
    const offsets2 = [{x: -d, y: -d}, {x: d, y: d}];
    const offsets3 = [{x: -d, y: -d}, {x: d, y: -d}, {x: 0, y: d}];
    const offsets4 = [{x: -d, y: -d}, {x: d, y: -d}, {x: -d, y: d}, {x: d, y: d}];
    
    if (stack.length === 2) return offsets2[index] || {x:0, y:0};
    if (stack.length === 3) return offsets3[index] || {x:0, y:0};
    return offsets4[index % 4] || {x:0, y:0};
  }

  function drawPawns(overridePawn) {
    if (!state || !state.pawns) return;
    Object.entries(state.pawns).forEach(([color, pawns]) => {
      pawns.forEach(pawn => {
        if (overridePawn && overridePawn.color === color && overridePawn.id === pawn.id) return;
        const pos = getPawnCanvasPos(pawn, color);
        if (pos) drawPawn(pos.x, pos.y, color, pawn.id + 1, pawn.state === 'finished');
      });
    });
    if (overridePawn) {
      drawPawn(overridePawn.x, overridePawn.y, overridePawn.color, overridePawn.id + 1, false);
    }

    if (waitingForPawn) {
      const playableIds = pendingMoves.map(m => m.pawnId);
      state.pawns[myColor]?.forEach(pawn => {
        if (!playableIds.includes(pawn.id)) return;
        const pos = getPawnCanvasPos(pawn, myColor);
        if (!pos) return;
        const t = Date.now() / 300;
        const r = SZ * 0.36 + Math.sin(t) * 3;
        ctx.beginPath(); ctx.arc(pos.x, pos.y, r, 0, Math.PI*2);
        ctx.strokeStyle = '#fff'; ctx.lineWidth = 2.5; ctx.stroke();
      });
      requestAnimationFrame(() => { drawBoard(); drawPawns(null); });
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
    if (!steps || steps.length === 0 || !window.animEnabled) { callback(); return; }
    let stepIdx = 0;

    function doStep() {
      if (stepIdx >= steps.length) { callback(); return; }
      const step = steps[stepIdx];
      stepIdx++;

      const s = SZ;
      let targetPos;
      if (step.type === 'track') {
        const abs = (START_ABS[color] + step.rel) % 52;
        const [c, r] = TRACK[abs];
        targetPos = { x: c*s + s/2, y: r*s + s/2 };
      } else {
        targetPos = { x: 5*s + s/2, y: 5*s + s/2 };
      }

      const pawn = state.pawns[color][pawnId];
      const startPos = getPawnCanvasPos(pawn, color) || targetPos;
      if (typeof Audio !== 'undefined' && Audio.playStep) Audio.playStep();

      const duration = Math.min(180, 600 / steps.length);
      const start = performance.now();
      const override = { color, id: pawnId, x: startPos.x, y: startPos.y };

      function frame(now) {
        const p = Math.min(1, (now - start) / duration);
        const ease = 1 - (1 - p) * (1 - p);
        override.x = startPos.x + (targetPos.x - startPos.x) * ease;
        override.y = startPos.y + (targetPos.y - startPos.y) * ease;
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

  function animateCapture(x, y, color, callback) {
    if (typeof Audio !== 'undefined' && Audio.playCapture) Audio.playCapture();
    let frame = 0;
    const totalFrames = 18;
    function bounce() {
      frame++;
      const scale = 1 + Math.sin(frame / totalFrames * Math.PI) * 0.5;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      drawBoard(); drawPawns(null);
      ctx.save();
      ctx.translate(x, y);
      ctx.scale(scale, scale);
      ctx.globalAlpha = 1 - frame / totalFrames;
      drawPawn(0, 0, color, '✕', false);
      for (let i = 0; i < 6; i++) {
        const angle = (i / 6) * Math.PI * 2;
        const dist = (frame / totalFrames) * SZ * 0.8;
        ctx.fillStyle = '#ffd700';
        ctx.font = `${SZ * 0.3}px serif`;
        ctx.fillText('★', Math.cos(angle) * dist, Math.sin(angle) * dist);
      }
      ctx.restore();
      if (frame < totalFrames) requestAnimationFrame(bounce);
      else { render(); callback(); }
    }
    requestAnimationFrame(bounce);
  }

  function triggerDiceRollAnimation(finalDiceValue, onComplete) {
    const diceEl = $('dice');
    const faceEl = $('dice-face');
    if (!diceEl || !faceEl) { onComplete(); return; }

    isDiceRolling = true;
    diceEl.classList.add('rolling');
    if (typeof Audio !== 'undefined' && Audio.playDiceRoll) Audio.playDiceRoll();

    let rollCount = 0;
    const maxRolls = 12;
    const interval = setInterval(() => {
      rollCount++;
      const tempVal = Math.floor(Math.random() * 6) + 1;
      faceEl.textContent = DICE_SYMBOLS[tempVal];

      if (rollCount >= maxRolls) {
        clearInterval(interval);
        diceEl.classList.remove('rolling');
        faceEl.textContent = DICE_SYMBOLS[finalDiceValue] || '🎲';
        diceEl.classList.add('bounce');
        setTimeout(() => diceEl.classList.remove('bounce'), 300);
        isDiceRolling = false;
        onComplete();
      }
    }, 55);
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
      const dist = Math.sqrt((mx-pos.x)**2 + (my-pos.y)**2);
      if (dist <= SZ * 0.48) {
        waitingForPawn = false;
        pendingMoves   = [];
        socket.emit('move_pawn', { pawnId: pawn.id });
        if (typeof Audio !== 'undefined' && Audio.playClick) Audio.playClick();
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
      if (nameEl) nameEl.textContent = (p.pseudo || p.nickname || c) + (p.isBot ? ' 🤖' : '');
      chip.classList.toggle('active-turn', state.turn === c);
    });

    const banner = $('turn-banner');
    if (banner) {
      const isMyTurn = state.turn === myColor;
      const isBot = state.players && state.players[state.turn]?.isBot;
      if (isMyTurn) {
        banner.textContent = state.diceRolled ? '👆 Choisissez un cheval' : '🎲 À vous de lancer !';
        banner.className   = 'turn-banner my-turn';
      } else {
        const pseudo = (state.players && state.players[state.turn]?.pseudo) || state.turn || '?';
        banner.textContent = `⏳ Tour de ${pseudo}${isBot ? ' 🤖' : ''}…`;
        banner.className   = isBot ? 'turn-banner bot-turn' : 'turn-banner';
      }
    }

    const diceEl = $('dice');
    const faceEl = $('dice-face');
    if (diceEl && faceEl && !isDiceRolling) {
      faceEl.textContent = state.dice ? DICE_SYMBOLS[state.dice] : '🎲';
      const canRoll = (state.turn === myColor) && !state.diceRolled && state.phase === 'playing' && !animating;
      diceEl.classList.toggle('disabled', !canRoll);
    }
  }

  function onEvent(event, data) {
    if (data && (data.gameState || data.state)) {
      state = data.gameState || data.state;
    }

    switch (event) {

      case 'dice_rolled': {
        triggerDiceRollAnimation(data.dice, () => {
          if (data.dice === 6 && typeof Audio !== 'undefined' && Audio.playSix) Audio.playSix();

          if (data.skipped) {
            updateUI(); render();
            showToast(`3 six de suite — tour perdu !`, 2200);
            return;
          }
          if (data.autoPass) {
            updateUI(); render();
            showToast(`${COLOR_NAMES[data.color] || data.color} ne peut pas jouer !`, 1600);
            return;
          }
          if (data.moves?.length > 0 && data.color === myColor) {
            pendingMoves   = data.moves;
            waitingForPawn = true;
          }
          updateUI(); render();
        });
        break;
      }

      case 'move_made':
      case 'pawn_moved': {
        const { color, pawnId, captures, steps } = data;
        animating = true;
        waitingForPawn = false;
        pendingMoves   = [];

        animatePawnSteps(color, pawnId, steps || [], () => {
          if (captures && captures.length > 0) {
            let captureIdx = 0;
            function doNextCapture() {
              if (captureIdx >= captures.length) { finishMove(); return; }
              const cap = captures[captureIdx++];
              const abs = START_ABS[color];
              const [c, r] = TRACK[abs];
              animateCapture(c*SZ + SZ/2, r*SZ + SZ/2, cap.color, doNextCapture);
              showToast(`💥 ${COLOR_NAMES[cap.color]} retourne à l'écurie !`, 2000);
            }
            doNextCapture();
          } else {
            finishMove();
          }
        });

        function finishMove() {
          animating = false;
          render();
          updateUI();
          if (data.replay) showToast(`${COLOR_NAMES[color]} rejoue !`, 1200);
        }
        break;
      }

      case 'turn_changed': {
        updateUI(); render();
        break;
      }

      case 'game_over': {
        animating = false;
        render(); updateUI();
        if (typeof Audio !== 'undefined' && Audio.playVictory) Audio.playVictory();
        setTimeout(() => showGameOver(data), 800);
        break;
      }

      case 'opponent_disconnected':
        if ($('modal-disconnect')) $('modal-disconnect').style.display = 'flex'; break;
      case 'opponent_reconnected':
        if ($('modal-disconnect')) $('modal-disconnect').style.display = 'none'; break;
      case 'rematch_requested':
        if ($('rematch-status')) $('rematch-status').textContent = 'Un joueur veut rejouer !'; break;

      case 'game_start':
      case 'game_started':
      case 'rematch_start':
        if ($('modal-gameover')) $('modal-gameover').style.display = 'none';
        if ($('rematch-status')) $('rematch-status').textContent   = '';
        if ($('btn-rematch')) {
          $('btn-rematch').textContent       = '🔄 Rejouer';
          $('btn-rematch').disabled          = false;
        }
        animating      = false;
        waitingForPawn = false;
        pendingMoves   = [];
        updateUI(); render();
        if (typeof Audio !== 'undefined' && Audio.playStart) Audio.playStart();
        break;
    }
  }

  function showToast(msg, dur) {
    let t = document.getElementById('toast');
    if (!t) {
      t = document.createElement('div'); t.id = 'toast';
      Object.assign(t.style, {
        position:'fixed', bottom:'90px', left:'50%', transform:'translateX(-50%)',
        background:'rgba(0,0,0,.82)', color:'#fff', padding:'10px 22px',
        borderRadius:'22px', zIndex:'999', fontSize:'.9rem',
        fontFamily:'Nunito,sans-serif', fontWeight:'700',
        pointerEvents:'none', transition:'opacity .3s', whiteSpace:'nowrap',
      });
      document.body.appendChild(t);
    }
    t.textContent = msg; t.style.opacity = '1';
    clearTimeout(t._h);
    t._h = setTimeout(() => { t.style.opacity = '0'; }, dur || 2000);
  }

  function showGameOver(data) {
    const medals = ['🥇','🥈','🥉','4️⃣'];
    const dotColor = { green:'#3cb043', red:'#e02020', blue:'#2060e0', yellow:'#e0b800' };
    if ($('gameover-trophies')) $('gameover-trophies').textContent = data.winner === myColor ? '🏆🎉🏆' : '🎲';
    if ($('gameover-title')) {
      $('gameover-title').textContent = data.winner === myColor ? 'VICTOIRE !' :
        `${state?.players[data.winner]?.pseudo || '?'} gagne !`;
    }
    if ($('gameover-rankings')) {
      $('gameover-rankings').innerHTML = (data.rankings || []).map((c, i) =>
        `<div class="ranking-row">
          <span class="ranking-pos">${medals[i]||i+1}</span>
          <span class="ranking-color" style="background:${dotColor[c]}"></span>
          <span class="ranking-name">${state?.players[c]?.pseudo || c}</span>
        </div>`
      ).join('');
    }
    if ($('modal-gameover')) $('modal-gameover').style.display = 'flex';
  }

  function init(sock, payload, isReconnect) {
    socket  = sock;
    state   = payload.gameState || payload.state;

    if (payload.color) {
      myColor = payload.color;
    } else if (isReconnect && localStorage.getItem('ludo_color')) {
      myColor = localStorage.getItem('ludo_color');
    } else if (state && state.players) {
      const foundColor = Object.keys(state.players).find(
        c => state.players[c].id === socket.id
      );
      if (foundColor) myColor = foundColor;
    }

    localStorage.setItem('ludo_color', myColor);

    animating = false; waitingForPawn = false; pendingMoves = []; isDiceRolling = false;
    window.animEnabled = $('opt-anim')?.checked !== false;

    resize(); updateUI(); render();

    canvas.removeEventListener('click',    handleClick);
    canvas.removeEventListener('touchend', handleClick);
    canvas.addEventListener('click',    handleClick);
    canvas.addEventListener('touchend', handleClick, { passive: false });

    const diceBtn = $('dice');
    if (diceBtn) {
      diceBtn.onclick = (e) => {
        e.preventDefault();
        if (animating || isDiceRolling) return;
        if (typeof Audio !== 'undefined' && Audio.init) Audio.init();
        if (!state || state.phase !== 'playing') return;
        if (state.turn !== myColor || state.diceRolled) return;

        socket.emit('roll_dice');
      };
    }

    $('opt-anim')?.addEventListener('change', e => { window.animEnabled = e.target.checked; });
  }

  window.addEventListener('resize', () => { if (state) resize(); });

  return { init, onEvent };
})();