'use strict';
/* ═══════════════════════════════════════════════════════════════════
   GAME.JS — Plateau fidèle + animations case par case + sons
   ═══════════════════════════════════════════════════════════════════ */
const Game = (() => {
  const canvas = document.getElementById('ludo-board');
  const ctx    = canvas.getContext('2d');
  function $(id) { return document.getElementById(id); }

  // ── État ─────────────────────────────────────────────────────────
  let socket = null, myColor = 'green', state = null;
  let pendingMoves = [], waitingForPawn = false;
  let animating = false;

  // ── Palette ───────────────────────────────────────────────────────
  const PAL = {
    green:  { main:'#3cb043', light:'#6dd672', dark:'#267328', bg:'#e8f8e9', home:'#3cb043' },
    red:    { main:'#e02020', light:'#ff5555', dark:'#a01010', bg:'#fdeaea', home:'#e02020' },
    blue:   { main:'#2060e0', light:'#5090ff', dark:'#1040a0', bg:'#eaeffd', home:'#2060e0' },
    yellow: { main:'#e0b800', light:'#ffe040', dark:'#a08000', bg:'#fdf8e1', home:'#e0b800' },
  };
  const COLOR_NAMES = { green:'Vert', red:'Rouge', blue:'Bleu', yellow:'Jaune' };

  // ── Taille ────────────────────────────────────────────────────────
  let SZ = 40; // taille d'une cellule
  const N  = 11; // grille 11×11 (sans les coins 6×6)

  function resize() {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const topBarH = parseInt(getComputedStyle(document.querySelector('.game-top-bar')).height) || 52;
    const botBarH = parseInt(getComputedStyle(document.querySelector('.game-bottom-bar')).height) || 80;
    const bannerH = 36;
    const available = Math.min(vw - 8, vh - topBarH - botBarH - bannerH - 20);
    SZ = Math.max(20, Math.floor(available / N));
    const size = SZ * N;
    canvas.width  = size;
    canvas.height = size;
    if (state) render();
  }

  // ════════════════════════════════════════════════════════════════
  // DÉFINITION DES CASES (grille 11×11, coins = bases 6×6 virtuels)
  // Piste commune : 52 cases, sens horaire
  // Layout d'après l'image de référence :
  //   col 0-3 = zone gauche, col 4 = couloir vert/jaune, col 5 = centre, col 6 = couloir rouge/bleu, col 7-10 = zone droite
  //   row 0-3 = zone haute, row 4 = couloir vert/rouge, row 5 = centre, row 6 = couloir bleu/jaune, row 7-10 = zone basse
  // ════════════════════════════════════════════════════════════════

  // Piste commune — 52 cases [col, row]
  // Sens horaire depuis la case de départ verte (col=0, row=4)
  const TRACK = [
    // Vert démarre ici (case 0)
    [0,4],
    // Monte col 1-4, row=4
    [1,4],[2,4],[3,4],[4,4],
    // Vire en haut col=4
    [4,3],[4,2],[4,1],[4,0],
    // Traverse en haut row=0
    [5,0],
    // Descend col=6
    [6,0],[6,1],[6,2],[6,3],
    // Rouge démarre ici (case 13)
    [6,4],
    // Continue col=7-10
    [7,4],[8,4],[9,4],[10,4],
    // Vire droite row=5
    [10,5],
    // Remonte col=10
    [10,6],[9,6],[8,6],[7,6],
    // Bleu démarre ici (case 26) — correction : bleu en bas-droite
    [6,6],
    // Continue bas col=6
    [6,7],[6,8],[6,9],[6,10],
    // Traverse en bas row=10
    [5,10],
    // Monte col=4
    [4,10],[4,9],[4,8],[4,7],
    // Jaune démarre ici (case 39)
    [4,6],
    // Continue gauche row=6
    [3,6],[2,6],[1,6],[0,6],
    // Vire gauche col=0
    [0,5],
    // Retour vers case 0
    [0,4], // case 52 = case 0 (boucle)
  ].slice(0, 52);

  // Couloirs finaux (6 cases vers le centre) [col, row]
  const STAIRS = {
    green:  [[1,5],[2,5],[3,5],[4,5],[5,5],[5,5]], // vers centre
    red:    [[5,1],[5,2],[5,3],[5,4],[5,5],[5,5]],
    blue:   [[9,5],[8,5],[7,5],[6,5],[5,5],[5,5]],
    yellow: [[5,9],[5,8],[5,7],[5,6],[5,5],[5,5]],
  };
  // Cases escalier réelles (sans la dernière qui est le centre)
  const STAIRS_CELLS = {
    green:  [[1,5],[2,5],[3,5],[4,5],[5,5]],
    red:    [[5,1],[5,2],[5,3],[5,4],[5,5]],
    blue:   [[9,5],[8,5],[7,5],[6,5],[5,5]],
    yellow: [[5,9],[5,8],[5,7],[5,6],[5,5]],
  };

  // Positions visuelles des pions dans la base (4 slots par couleur)
  const BASE_SLOTS = {
    green:  [[1,1],[2,1],[1,2],[2,2]],
    red:    [[8,1],[9,1],[8,2],[9,2]],
    blue:   [[8,8],[9,8],[8,9],[9,9]],
    yellow: [[1,8],[2,8],[1,9],[2,9]],
  };

  // ── Couleurs des cases de la piste ──────────────────────────────
  // Cases de départ (colorées)
  const START_ABS = { green:0, red:13, blue:26, yellow:39 };
  // Cases safe (étoilées) — absolues
  const SAFE_ABS = [0,8,13,21,26,34,39,47];

  // ── Rendu complet ───────────────────────────────────────────────
  function render() {
    if (!state) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    drawBoard();
    drawPawns(null);
  }

  // ── DESSIN DU PLATEAU ──────────────────────────────────────────
  function drawBoard() {
    const s = SZ;

    // Fond gris clair global
    ctx.fillStyle = '#d0d0d0';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // ── Zones de base (coins) ──────────────────────────────────
    const bases = {
      green:  {x:0,   y:0,   w:4*s, h:4*s, color:'green'},
      red:    {x:7*s, y:0,   w:4*s, h:4*s, color:'red'},
      blue:   {x:7*s, y:7*s, w:4*s, h:4*s, color:'blue'},
      yellow: {x:0,   y:7*s, w:4*s, h:4*s, color:'yellow'},
    };
    Object.entries(bases).forEach(([color, b]) => {
      // Fond coloré
      ctx.fillStyle = PAL[color].bg;
      ctx.fillRect(b.x, b.y, b.w, b.h);
      // Bordure
      ctx.strokeStyle = PAL[color].dark;
      ctx.lineWidth = 2;
      ctx.strokeRect(b.x+1, b.y+1, b.w-2, b.h-2);
      // Grand cercle coloré
      const cx = b.x + b.w/2, cy = b.y + b.h/2, r = b.w/2 - s*0.3;
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI*2);
      ctx.fillStyle = PAL[color].main; ctx.fill();
      // 4 slots blancs dans le cercle
      BASE_SLOTS[color].forEach(([sc, sr]) => {
        const px = sc*s + s/2, py = sr*s + s/2;
        ctx.beginPath(); ctx.arc(px, py, s*0.32, 0, Math.PI*2);
        ctx.fillStyle = 'rgba(255,255,255,0.5)'; ctx.fill();
      });
    });

    // ── Cases de la piste commune ──────────────────────────────
    TRACK.forEach(([c, r], idx) => {
      const x = c*s, y = r*s;
      // Couleur de la case
      let bg = '#ffffff';
      if (idx === START_ABS.green)  bg = PAL.green.main;
      if (idx === START_ABS.red)    bg = PAL.red.main;
      if (idx === START_ABS.blue)   bg = PAL.blue.main;
      if (idx === START_ABS.yellow) bg = PAL.yellow.main;
      ctx.fillStyle = bg;
      ctx.fillRect(x, y, s, s);
      ctx.strokeStyle = '#aaa'; ctx.lineWidth = 0.5;
      ctx.strokeRect(x, y, s, s);

      // Étoile sur cases safe
      if (SAFE_ABS.includes(idx) && idx !== START_ABS.green && idx !== START_ABS.red && idx !== START_ABS.blue && idx !== START_ABS.yellow) {
        ctx.fillStyle = 'rgba(0,0,0,0.15)';
        ctx.font = `${s*0.55}px serif`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText('⭐', x+s/2, y+s/2);
      }
    });

    // ── Couloirs finaux (escaliers colorés) ──────────────────
    const stairColors = {
      green:  PAL.green.main,
      red:    PAL.red.main,
      blue:   PAL.blue.main,
      yellow: PAL.yellow.main,
    };
    Object.entries(STAIRS_CELLS).forEach(([color, cells]) => {
      cells.slice(0, 5).forEach(([c, r]) => {
        const x = c*s, y = r*s;
        ctx.fillStyle = stairColors[color] + '55';
        ctx.fillRect(x, y, s, s);
        ctx.strokeStyle = stairColors[color]; ctx.lineWidth = 1;
        ctx.strokeRect(x, y, s, s);
      });
    });

    // ── Zone centrale (case d'arrivée) ─────────────────────────
    const cx = 5*s, cy = 5*s, cw = s, ch = s;
    // 4 triangles colorés
    ctx.fillStyle = PAL.green.main;
    ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx+cw/2, cy+ch/2); ctx.lineTo(cx, cy+ch); ctx.closePath(); ctx.fill();
    ctx.fillStyle = PAL.red.main;
    ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx+cw/2, cy+ch/2); ctx.lineTo(cx+cw, cy); ctx.closePath(); ctx.fill();
    ctx.fillStyle = PAL.blue.main;
    ctx.beginPath(); ctx.moveTo(cx+cw, cy); ctx.lineTo(cx+cw/2, cy+ch/2); ctx.lineTo(cx+cw, cy+ch); ctx.closePath(); ctx.fill();
    ctx.fillStyle = PAL.yellow.main;
    ctx.beginPath(); ctx.moveTo(cx, cy+ch); ctx.lineTo(cx+cw/2, cy+ch/2); ctx.lineTo(cx+cw, cy+ch); ctx.closePath(); ctx.fill();
    // Étoile centrale
    ctx.font = `${s*0.7}px serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('⭐', cx+cw/2, cy+ch/2);

    // ── Highlight des pions jouables ──────────────────────────
    if (waitingForPawn && pendingMoves.length > 0) {
      const playableIds = pendingMoves.map(m => m.pawnId);
      state.pawns[myColor]?.forEach(pawn => {
        if (!playableIds.includes(pawn.id)) return;
        const pos = getPawnCanvasPos(pawn, myColor);
        if (!pos) return;
        ctx.beginPath();
        ctx.arc(pos.x, pos.y, SZ*0.44, 0, Math.PI*2);
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 3;
        ctx.setLineDash([4, 3]);
        ctx.stroke();
        ctx.setLineDash([]);
      });
    }
  }

  // ── Position canvas d'un pion ──────────────────────────────────
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
      // Offset si plusieurs pions sur la même case
      const off = getStackOffset(color, abs, pawn.id);
      return { x: c*s + s/2 + off.x, y: r*s + s/2 + off.y };
    }
    if (pawn.state === 'stairs') {
      if (pawn.stairsPos < 0 || pawn.stairsPos > 5) return { x: 5*s+s/2, y: 5*s+s/2 };
      const [c, r] = STAIRS_CELLS[color][Math.min(pawn.stairsPos, 4)];
      return { x: c*s + s/2, y: r*s + s/2 };
    }
    if (pawn.state === 'finished') {
      // Centre avec offset par couleur
      const offsets = { green:[-s*0.2,-s*0.2], red:[s*0.2,-s*0.2], blue:[s*0.2,s*0.2], yellow:[-s*0.2,s*0.2] };
      const [ox, oy] = offsets[color];
      return { x: 5*s+s/2+ox, y: 5*s+s/2+oy };
    }
    return null;
  }

  function getStackOffset(color, abs, pawnId) {
    const offsets = [{x:-5,y:-5},{x:5,y:-5},{x:-5,y:5},{x:5,y:5}];
    return offsets[pawnId % 4] || {x:0,y:0};
  }

  // ── Dessin de tous les pions ───────────────────────────────────
  function drawPawns(overridePawn) {
    if (!state) return;
    Object.entries(state.pawns).forEach(([color, pawns]) => {
      pawns.forEach(pawn => {
        // Ne pas dessiner le pion en cours d'animation
        if (overridePawn && overridePawn.color === color && overridePawn.id === pawn.id) return;
        const pos = getPawnCanvasPos(pawn, color);
        if (pos) drawPawn(pos.x, pos.y, color, pawn.id + 1, pawn.state === 'finished');
      });
    });
    // Dessiner le pion animé par-dessus
    if (overridePawn) {
      drawPawn(overridePawn.x, overridePawn.y, overridePawn.color, overridePawn.id + 1, false);
    }

    // Pulsation pour les pions jouables
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
    // Ombre
    ctx.beginPath(); ctx.arc(x+1.5, y+2, r, 0, Math.PI*2);
    ctx.fillStyle = 'rgba(0,0,0,0.22)'; ctx.fill();
    // Corps
    const grad = ctx.createRadialGradient(x-r*0.3, y-r*0.3, 1, x, y, r);
    grad.addColorStop(0, PAL[color].light);
    grad.addColorStop(1, PAL[color].dark);
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI*2);
    ctx.fillStyle = grad; ctx.fill();
    ctx.strokeStyle = isFinished ? '#ffd700' : 'rgba(255,255,255,0.9)';
    ctx.lineWidth = isFinished ? 2.5 : 1.8; ctx.stroke();
    // Numéro
    ctx.fillStyle = '#fff';
    ctx.font = `bold ${Math.max(8, s*0.26)}px Nunito,sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(num, x, y);
  }

  // ══════════════════════════════════════════════════════════════
  // ANIMATION case par case
  // ══════════════════════════════════════════════════════════════
  function animatePawnSteps(color, pawnId, steps, callback) {
    if (!steps || steps.length === 0 || !window.animEnabled) { callback(); return; }
    let stepIdx = 0;

    function doStep() {
      if (stepIdx >= steps.length) { callback(); return; }
      const step = steps[stepIdx];
      stepIdx++;

      // Position de la case intermédiaire
      const s = SZ;
      let targetPos;
      if (step.type === 'track') {
        const abs = (START_ABS[color] + step.rel) % 52;
        const [c, r] = TRACK[abs];
        targetPos = { x: c*s + s/2, y: r*s + s/2 };
      } else {
        targetPos = { x: 5*s + s/2, y: 5*s + s/2 };
      }

      // Source = position actuelle du pion dans l'état
      const pawn = state.pawns[color][pawnId];
      const startPos = getPawnCanvasPos(pawn, color) || targetPos;

      // Son à chaque pas
      Audio.playStep();

      // Animation glissé vers la case
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

  // ── Animation collision (rebond + son) ───────────────────────
  function animateCapture(x, y, color, callback) {
    Audio.playCapture();
    let frame = 0;
    const totalFrames = 18;
    function bounce() {
      frame++;
      const scale = 1 + Math.sin(frame / totalFrames * Math.PI) * 0.5;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      drawBoard(); drawPawns(null);
      // Pion capturé qui gonfle/disparaît
      ctx.save();
      ctx.translate(x, y);
      ctx.scale(scale, scale);
      ctx.globalAlpha = 1 - frame / totalFrames;
      drawPawn(0, 0, color, '✕', false);
      // Étoiles
      for (let i = 0; i < 6; i++) {
        const angle = (i / 6) * Math.PI * 2;
        const dist = (frame / totalFrames) * SZ * 0.8;
        ctx.globalAlpha = 1 - frame / totalFrames;
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

  // ── Gestion des clics ─────────────────────────────────────────
  function handleClick(e) {
    if (!waitingForPawn || animating) return;
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
        Audio.playClick();
        render();
        return;
      }
    }
  }

  // ── Mise à jour UI ────────────────────────────────────────────
  function updateUI() {
    if (!state) return;
    ['green','red','blue','yellow'].forEach(c => {
      const chip = $(`chip-${c}`);
      if (!chip) return;
      const p = state.players[c];
      if (!p || !state.activeColors.includes(c)) { chip.style.display = 'none'; return; }
      chip.style.display = 'flex';
      $(`name-${c}`).textContent = p.pseudo + (p.isBot ? ' 🤖' : '');
      chip.classList.toggle('active-turn', state.turn === c);
    });

    const banner = $('turn-banner');
    const isMyTurn = state.turn === myColor;
    const isBot = state.players[state.turn]?.isBot;
    if (isMyTurn) {
      banner.textContent = state.diceRolled ? '👆 Choisissez un cheval' : '🎲 À vous de lancer !';
      banner.className   = 'turn-banner my-turn';
    } else {
      const pseudo = state.players[state.turn]?.pseudo || '?';
      banner.textContent = `⏳ Tour de ${pseudo}${isBot ? ' 🤖' : ''}…`;
      banner.className   = isBot ? 'turn-banner bot-turn' : 'turn-banner';
    }

    // Dé
    const diceEl = $('dice');
    const faceEl = $('dice-face');
    const symbols = { 1:'⚀', 2:'⚁', 3:'⚂', 4:'⚃', 5:'⚄', 6:'⚅' };
    faceEl.textContent = state.dice ? symbols[state.dice] : '🎲';
    const canRoll = isMyTurn && !state.diceRolled && state.phase === 'playing' && !animating;
    diceEl.classList.toggle('disabled', !canRoll);
  }

  // ── Événements serveur ────────────────────────────────────────
  function onEvent(event, data) {
    switch (event) {

      case 'dice_rolled': {
        state = data.state;
        if (data.dice === 6) Audio.playSix();
        else Audio.playDiceRoll();
        $('dice').classList.remove('rolling');

        if (data.skipped) {
          updateUI(); render();
          showToast(`3 six de suite — tour perdu !`, 2200);
          break;
        }
        if (data.autoPass) {
          updateUI(); render();
          showToast(`${COLOR_NAMES[data.color]} ne peut pas jouer !`, 1600);
          break;
        }
        if (data.moves?.length > 0 && data.color === myColor) {
          pendingMoves   = data.moves;
          waitingForPawn = true;
        }
        updateUI(); render();
        break;
      }

      case 'move_made': {
        const prevState = state;
        state = data.state;
        const { color, pawnId, captures, steps } = data;
        animating = true;
        waitingForPawn = false;
        pendingMoves   = [];

        // Animation déplacement
        animatePawnSteps(color, pawnId, steps || [], () => {
          // Animations captures
          if (captures && captures.length > 0) {
            let captureIdx = 0;
            function doNextCapture() {
              if (captureIdx >= captures.length) { finishMove(); return; }
              const cap = captures[captureIdx++];
              // Position de la case de capture (case de départ de color)
              const abs = (({ green:0, red:13, blue:26, yellow:39 })[color]);
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

      case 'game_over': {
        state = data.state;
        animating = false;
        render(); updateUI();
        Audio.playVictory();
        setTimeout(() => showGameOver(data), 800);
        break;
      }

      case 'opponent_disconnected':
        $('modal-disconnect').style.display = 'flex'; break;
      case 'opponent_reconnected':
        $('modal-disconnect').style.display = 'none'; break;

      case 'rematch_requested':
        $('rematch-status').textContent = 'Un joueur veut rejouer !'; break;

      case 'game_start':
      case 'rematch_start':
        $('modal-gameover').style.display = 'none';
        $('rematch-status').textContent   = '';
        $('btn-rematch').textContent       = '🔄 Rejouer';
        $('btn-rematch').disabled          = false;
        state          = data.state;
        animating      = false;
        waitingForPawn = false;
        pendingMoves   = [];
        updateUI(); render();
        Audio.playStart();
        break;
    }
  }

  // ── Toast ──────────────────────────────────────────────────────
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

  // ── Fin de partie ─────────────────────────────────────────────
  const COLOR_NAMES = { green:'Vert', red:'Rouge', blue:'Bleu', yellow:'Jaune' };
  function showGameOver(data) {
    const medals = ['🥇','🥈','🥉','4️⃣'];
    const dotColor = { green:'#3cb043', red:'#e02020', blue:'#2060e0', yellow:'#e0b800' };
    $('gameover-trophies').textContent = data.winner === myColor ? '🏆🎉🏆' : '🎲';
    $('gameover-title').textContent    = data.winner === myColor ? 'VICTOIRE !' :
      `${state?.players[data.winner]?.pseudo || '?'} gagne !`;
    $('gameover-rankings').innerHTML = (data.rankings || []).map((c, i) =>
      `<div class="ranking-row">
        <span class="ranking-pos">${medals[i]||i+1}</span>
        <span class="ranking-color" style="background:${dotColor[c]}"></span>
        <span class="ranking-name">${state?.players[c]?.pseudo || c}</span>
      </div>`
    ).join('');
    $('modal-gameover').style.display = 'flex';
  }

  // ── Init ──────────────────────────────────────────────────────
  function init(sock, payload, isReconnect) {
    socket  = sock;
    state   = payload.state;
    myColor = isReconnect ? payload.color : (localStorage.getItem('ludo_color') || 'green');
    animating = false; waitingForPawn = false; pendingMoves = [];
    window.animEnabled = $('opt-anim')?.checked !== false;

    resize(); updateUI(); render();

    canvas.removeEventListener('click',    handleClick);
    canvas.removeEventListener('touchend', handleClick);
    canvas.addEventListener('click',    handleClick);
    canvas.addEventListener('touchend', handleClick, { passive: false });

    $('dice').onclick = () => {
      if (animating) return;
      Audio.init();
      if (!state || state.phase !== 'playing') return;
      if (state.turn !== myColor || state.diceRolled) return;
      $('dice').classList.add('rolling','disabled');
      Audio.playDiceRoll();
      socket.emit('roll_dice');
    };

    $('opt-anim')?.addEventListener('change', e => { window.animEnabled = e.target.checked; });
  }

  window.addEventListener('resize', () => { if (state) resize(); });

  return { init, onEvent };
})();
