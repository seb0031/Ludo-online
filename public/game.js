'use strict';
const Game = (() => {
  const canvas = document.getElementById('ludo-board');
  const ctx    = canvas.getContext('2d');
  function $(id) { return document.getElementById(id); }

  // ── État ────────────────────────────────────────────────────────────
  let socket = null, myColor = 'red', state = null;
  let pendingMoves = [], diceValue = null, waitingForPawn = false;
  let animEnabled = true;

  // ── Couleurs ─────────────────────────────────────────────────────────
  const PALETTE = {
    red:    { main:'#e74c3c', light:'#ff6b5b', dark:'#c0392b', bg:'#fdedec' },
    blue:   { main:'#3498db', light:'#5dade2', dark:'#2980b9', bg:'#ebf5fb' },
    green:  { main:'#2ecc71', light:'#58d68d', dark:'#27ae60', bg:'#eafaf1' },
    yellow: { main:'#f1c40f', light:'#f7dc6f', dark:'#d4ac0d', bg:'#fefde7' },
  };
  const COLOR_NAMES = { red:'Rouge', blue:'Bleu', green:'Vert', yellow:'Jaune' };

  // ── Plateau 15x15 ─────────────────────────────────────────────────────
  // Le plateau des petits chevaux est une grille 15×15
  // Cases importantes (coordonnées col, row) :
  const BOARD_SIZE = 15;
  let CELL = 30; // taille d'une cellule en px

  // ─── Définition de la piste (cases communes, sens horaire depuis rouge) ────
  // 52 cases numérotées 0-51, positions sur la grille 15x15
  const TRACK = [
    // Côté rouge (bas-gauche) → vers bas
    [6,13],[6,12],[6,11],[6,10],[6,9],
    // Virage bas-gauche
    [6,8],[5,8],[4,8],[3,8],[2,8],[1,8],
    // Côté bleu (gauche) → vers haut ... mais on simplifie avec un tableau plat
    [0,8],[0,7],[0,6],
    // Haut-gauche
    [1,6],[2,6],[3,6],[4,6],[5,6],
    [6,6],[6,5],[6,4],[6,3],[6,2],[6,1],[6,0],
    // Côté vert (haut) → vers droite
    [7,0],[8,0],
    [8,1],[8,2],[8,3],[8,4],[8,5],
    [8,6],[9,6],[10,6],[11,6],[12,6],[13,6],[14,6],
    // Côté jaune (droite) → vers bas
    [14,7],[14,8],
    [13,8],[12,8],[11,8],[10,8],[9,8],
    [8,8],[8,9],[8,10],[8,11],[8,12],[8,13],[8,14],
    // Bas → vers gauche
    [7,14],
  ];

  // Couloirs finaux (6 cases chacun, vers le centre)
  const HOME_TRACKS = {
    red:    [[7,13],[7,12],[7,11],[7,10],[7,9],[7,8]],
    blue:   [[1,7],[2,7],[3,7],[4,7],[5,7],[6,7]],
    green:  [[7,1],[7,2],[7,3],[7,4],[7,5],[7,6]],
    yellow: [[13,7],[12,7],[11,7],[10,7],[9,7],[8,7]],
  };

  // Bases (4 pions par couleur, positions fixes)
  const BASES = {
    red:    [[1,10],[2,10],[1,11],[2,11]],
    blue:   [[1,1],[2,1],[1,2],[2,2]],
    green:  [[10,1],[11,1],[10,2],[11,2]],
    yellow: [[10,10],[11,10],[10,11],[11,11]],
  };

  // Cases safe (étoilées)
  const SAFE_TRACK_IDX = [0,8,13,21,26,34,39,47];

  // ── Calcul taille canvas ───────────────────────────────────────────────
  function resize() {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const barH = 58;
    const bannerH = 36;
    const available = Math.min(vw - 8, vh - barH * 2 - bannerH - 16);
    CELL = Math.floor(available / BOARD_SIZE);
    const size = CELL * BOARD_SIZE;
    canvas.width  = size;
    canvas.height = size;
    if (state) render();
  }

  // ── Rendu complet ──────────────────────────────────────────────────────
  function render() {
    if (!state) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    drawBoard();
    drawPawns();
  }

  // ── Dessin du plateau ──────────────────────────────────────────────────
  function drawBoard() {
    const c = CELL;

    // Fond général blanc
    ctx.fillStyle = '#f8f9fa';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Grille légère
    ctx.strokeStyle = 'rgba(0,0,0,.08)';
    ctx.lineWidth = .5;
    for (let i = 0; i <= BOARD_SIZE; i++) {
      ctx.beginPath(); ctx.moveTo(i*c, 0); ctx.lineTo(i*c, canvas.height); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, i*c); ctx.lineTo(canvas.width, i*c); ctx.stroke();
    }

    // Zones de base (coins colorés)
    const baseZones = {
      red:    {x:0,   y:9*c,  w:6*c, h:6*c},
      blue:   {x:0,   y:0,    w:6*c, h:6*c},
      green:  {x:9*c, y:0,    w:6*c, h:6*c},
      yellow: {x:9*c, y:9*c,  w:6*c, h:6*c},
    };
    Object.entries(baseZones).forEach(([color, z]) => {
      // Zone de base
      ctx.fillStyle = PALETTE[color].bg;
      ctx.fillRect(z.x, z.y, z.w, z.h);
      ctx.strokeStyle = PALETTE[color].dark;
      ctx.lineWidth = 2;
      ctx.strokeRect(z.x+1, z.y+1, z.w-2, z.h-2);

      // Cercle de base
      ctx.fillStyle = PALETTE[color].main;
      ctx.beginPath();
      ctx.arc(z.x + z.w/2, z.y + z.h/2, z.w/2 - c*0.7, 0, Math.PI*2);
      ctx.fill();
      ctx.strokeStyle = PALETTE[color].dark;
      ctx.lineWidth = 2;
      ctx.stroke();

      // Trous de base (4 slots)
      BASES[color].forEach(([bc, br]) => {
        const cx2 = bc*c + c/2, cy2 = br*c + c/2;
        ctx.fillStyle = 'rgba(255,255,255,.4)';
        ctx.beginPath(); ctx.arc(cx2, cy2, c*0.36, 0, Math.PI*2); ctx.fill();
      });
    });

    // Centre (arrivée)
    const center = 6*c;
    const centerSize = 3*c;
    // Triangle rouge (bas-gauche → centre)
    ctx.fillStyle = PALETTE.red.main;
    ctx.beginPath();
    ctx.moveTo(center, center + centerSize/2);
    ctx.lineTo(center, center + centerSize);
    ctx.lineTo(center + centerSize/2, center + centerSize/2);
    ctx.closePath(); ctx.fill();
    // Triangle bleu (haut-gauche)
    ctx.fillStyle = PALETTE.blue.main;
    ctx.beginPath();
    ctx.moveTo(center, center);
    ctx.lineTo(center, center + centerSize/2);
    ctx.lineTo(center + centerSize/2, center + centerSize/2);
    ctx.closePath(); ctx.fill();
    // Triangle vert (haut-droite)
    ctx.fillStyle = PALETTE.green.main;
    ctx.beginPath();
    ctx.moveTo(center + centerSize, center);
    ctx.lineTo(center + centerSize/2, center + centerSize/2);
    ctx.lineTo(center + centerSize, center + centerSize/2);
    ctx.closePath(); ctx.fill();
    // Triangle jaune (bas-droite)
    ctx.fillStyle = PALETTE.yellow.main;
    ctx.beginPath();
    ctx.moveTo(center + centerSize, center + centerSize/2);
    ctx.lineTo(center + centerSize/2, center + centerSize/2);
    ctx.lineTo(center + centerSize, center + centerSize);
    ctx.closePath(); ctx.fill();
    // Étoile centrale
    ctx.fillStyle = 'rgba(255,255,255,.9)';
    ctx.font = `${c*1.5}px serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('⭐', center + centerSize/2, center + centerSize/2);

    // Couloirs finaux (colorés)
    Object.entries(HOME_TRACKS).forEach(([color, cells]) => {
      cells.forEach(([cc, cr], i) => {
        if (i < 5) { // pas la dernière case (centre)
          ctx.fillStyle = `${PALETTE[color].main}44`;
          ctx.fillRect(cc*c+1, cr*c+1, c-2, c-2);
        }
      });
    });

    // Cases de la piste commune
    TRACK.forEach(([cc, cr], idx) => {
      const x = cc*c, y = cr*c;
      // Couleur de départ
      let bg = '#ffffff';
      if (idx === 0)  bg = PALETTE.red.bg;
      if (idx === 13) bg = PALETTE.blue.bg;
      if (idx === 26) bg = PALETTE.green.bg;
      if (idx === 39) bg = PALETTE.yellow.bg;

      ctx.fillStyle = bg;
      ctx.fillRect(x+1, y+1, c-2, c-2);

      // Cases safe : étoile
      if (SAFE_TRACK_IDX.includes(idx)) {
        ctx.font = `${c*0.55}px serif`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText('⭐', x+c/2, y+c/2);
      }

      // Highlight coups possibles
      if (waitingForPawn && pendingMoves.length > 0) {
        // on met en valeur plus bas dans drawPawns
      }
    });

    // Flèches directionnelles (indication de sens)
    ctx.fillStyle = 'rgba(0,0,0,.12)';
    ctx.font = `${c*0.5}px sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    // On dessine juste une flèche sur quelques cases clés
    [[7,14,'↑'],[7,0,'↓'],[0,7,'→'],[14,7,'←']].forEach(([cc,cr,arrow]) => {
      ctx.fillText(arrow, cc*c+c/2, cr*c+c/2);
    });
  }

  // ── Dessin des pions ──────────────────────────────────────────────────
  function drawPawns() {
    if (!state) return;
    const c = CELL;

    // Highlight des pions jouables
    const playablePawnIds = waitingForPawn ? pendingMoves.map(m => m.pawnId) : [];

    Object.entries(state.pawns).forEach(([color, pawns]) => {
      const pal = PALETTE[color];
      pawns.forEach((pawn, idx) => {
        let px, py;
        const isPlayable = color === state.turn && playablePawnIds.includes(pawn.id) && color === myColor;

        if (pawn.state === 'base') {
          const [bc, br] = BASES[color][idx];
          px = bc*c + c/2; py = br*c + c/2;
        } else if (pawn.state === 'track') {
          // Position absolue sur la piste
          const startIdx = { red:0, blue:13, green:26, yellow:39 }[color];
          const absIdx = (startIdx + pawn.trackPos) % 52;
          const [tc, tr] = TRACK[absIdx];
          // Décalage si plusieurs pions sur la même case
          const offset = getPawnOffset(color, absIdx, pawn.id);
          px = tc*c + c/2 + offset.x; py = tr*c + c/2 + offset.y;
        } else if (pawn.state === 'home') {
          const [hc, hr] = HOME_TRACKS[color][pawn.homePos];
          px = hc*c + c/2; py = hr*c + c/2;
        } else { // finished
          const center = 6*c + 1.5*c;
          const offsets = [[-c*0.25,-c*0.25],[c*0.25,-c*0.25],[-c*0.25,c*0.25],[c*0.25,c*0.25]];
          px = center + offsets[idx][0]; py = center + offsets[idx][1];
        }

        // Halo si jouable
        if (isPlayable) {
          ctx.beginPath();
          ctx.arc(px, py, c*0.42, 0, Math.PI*2);
          ctx.fillStyle = 'rgba(255,255,255,0.35)';
          ctx.fill();
          ctx.strokeStyle = '#fff';
          ctx.lineWidth = 2;
          ctx.stroke();
        }

        // Corps du pion (cercle)
        const r = c * 0.33;
        ctx.beginPath();
        ctx.arc(px, py, r, 0, Math.PI*2);
        // Dégradé
        const grad = ctx.createRadialGradient(px-r*0.3, py-r*0.3, 1, px, py, r);
        grad.addColorStop(0, pal.light);
        grad.addColorStop(1, pal.dark);
        ctx.fillStyle = grad;
        ctx.fill();
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 1.5;
        ctx.stroke();

        // Ombre portée
        ctx.beginPath();
        ctx.arc(px+1, py+2, r, 0, Math.PI*2);
        ctx.fillStyle = 'rgba(0,0,0,.18)';
        ctx.fill();

        // Re-dessiner dessus
        ctx.beginPath();
        ctx.arc(px, py, r, 0, Math.PI*2);
        ctx.fillStyle = grad;
        ctx.fill();
        ctx.strokeStyle = pawn.state === 'finished' ? '#ffd700' : '#fff';
        ctx.lineWidth = pawn.state === 'finished' ? 2.5 : 1.5;
        ctx.stroke();

        // Numéro du pion
        ctx.fillStyle = '#fff';
        ctx.font = `bold ${Math.max(9, c*0.28)}px sans-serif`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(idx + 1, px, py);

        // Animation pulsation si jouable
        if (isPlayable) {
          ctx.beginPath();
          ctx.arc(px, py, r + 3 + Math.sin(Date.now() / 200) * 2, 0, Math.PI*2);
          ctx.strokeStyle = pal.light;
          ctx.lineWidth = 2;
          ctx.stroke();
        }
      });
    });

    if (waitingForPawn) requestAnimationFrame(render);
  }

  // Offset pour éviter la superposition de pions sur la même case
  function getPawnOffset(color, absIdx, pawnId) {
    const offsets = [{x:-4,y:-4},{x:4,y:-4},{x:-4,y:4},{x:4,y:4}];
    return offsets[pawnId] || {x:0,y:0};
  }

  // ── Interaction canvas (clic sur pion) ───────────────────────────────
  function handleCanvasClick(e) {
    if (!waitingForPawn || !state) return;
    const rect = canvas.getBoundingClientRect();
    const touch = e.touches ? e.touches[0] : e;
    const mx = touch.clientX - rect.left;
    const my = touch.clientY - rect.top;
    const c  = CELL;

    // Chercher quel pion a été cliqué
    const pawns = state.pawns[myColor];
    if (!pawns) return;
    const playableIds = pendingMoves.map(m => m.pawnId);

    for (const pawn of pawns) {
      if (!playableIds.includes(pawn.id)) continue;
      let px, py;

      if (pawn.state === 'base') {
        const [bc,br] = BASES[myColor][pawn.id];
        px = bc*c + c/2; py = br*c + c/2;
      } else if (pawn.state === 'track') {
        const startIdx = { red:0, blue:13, green:26, yellow:39 }[myColor];
        const absIdx = (startIdx + pawn.trackPos) % 52;
        const [tc,tr] = TRACK[absIdx];
        const off = getPawnOffset(myColor, absIdx, pawn.id);
        px = tc*c + c/2 + off.x; py = tr*c + c/2 + off.y;
      } else if (pawn.state === 'home') {
        const [hc,hr] = HOME_TRACKS[myColor][pawn.homePos];
        px = hc*c + c/2; py = hr*c + c/2;
      } else continue;

      const dist = Math.sqrt((mx-px)**2 + (my-py)**2);
      if (dist <= c * 0.5) {
        waitingForPawn = false;
        pendingMoves   = [];
        socket.emit('move_pawn', { pawnId: pawn.id });
        Audio.playMove();
        render();
        return;
      }
    }
  }

  // ── Dé ────────────────────────────────────────────────────────────────
  function handleDiceClick() {
    if (!state || state.phase !== 'playing') return;
    if (state.turn !== myColor) return;
    if (state.diceRolled) return;
    Audio.playDiceRoll();
    const dice = $('dice');
    dice.classList.add('rolling', 'disabled');
    setTimeout(() => dice.classList.remove('rolling'), 500);
    socket.emit('roll_dice');
  }

  // ── Mise à jour UI ─────────────────────────────────────────────────────
  function updateUI() {
    if (!state) return;
    const colors = ['red','blue','green','yellow'];
    colors.forEach(c => {
      const chip = $(`chip-${c}`);
      if (!chip) return;
      const p = state.players[c];
      if (!p || !state.activeColors.includes(c)) {
        chip.style.display = 'none';
        return;
      }
      chip.style.display = 'flex';
      $(`name-${c}`).textContent = p.pseudo + (p.isBot ? ' 🤖' : '');
      chip.classList.toggle('active-turn', state.turn === c);
    });

    // Bandeau de tour
    const banner = $('turn-banner');
    const isBot  = state.players[state.turn]?.isBot;
    if (state.turn === myColor) {
      banner.textContent = state.diceRolled ? '👆 Choisissez un pion' : '🎲 À vous de lancer !';
      banner.className   = 'turn-banner my-turn';
    } else {
      const pseudo = state.players[state.turn]?.pseudo || '?';
      banner.textContent = `⏳ Tour de ${pseudo}${isBot ? ' 🤖' : ''}…`;
      banner.className   = isBot ? 'turn-banner bot-turn' : 'turn-banner';
    }

    // Dé
    const dice = $('dice');
    const face = $('dice-face');
    const diceSymbols = ['🎲','⚀','⚁','⚂','⚃','⚄','⚅'];
    face.textContent = diceValue ? diceSymbols[diceValue] : '🎲';
    const canRoll = state.turn === myColor && !state.diceRolled && state.phase === 'playing';
    dice.classList.toggle('disabled', !canRoll);
  }

  // ── Événements serveur ─────────────────────────────────────────────────
  function onEvent(event, data) {
    switch (event) {
      case 'dice_rolled': {
        diceValue = data.dice;
        state     = data.state;
        if (data.dice === 6) Audio.playSix();
        else Audio.playDiceRoll();

        if (data.skipped) {
          updateUI(); render();
          showToast(`3 six de suite pour ${COLOR_NAMES[data.color]} — tour perdu !`, 2000);
          break;
        }
        if (data.autoPass) {
          updateUI(); render();
          showToast(`${COLOR_NAMES[data.color]} ne peut pas jouer !`, 1500);
          break;
        }
        if (data.moves && data.moves.length > 0 && data.color === myColor) {
          pendingMoves   = data.moves;
          waitingForPawn = true;
        }
        updateUI(); render();
        break;
      }

      case 'move_made': {
        state = data.state;
        diceValue = null;
        waitingForPawn = false;
        pendingMoves   = [];

        if (data.captures && data.captures.length > 0) {
          Audio.playCapture();
          data.captures.forEach(cap => showToast(`💥 ${COLOR_NAMES[cap.color]} rentre à la maison !`, 2000));
        }
        if (data.replay) showToast(`${COLOR_NAMES[data.color]} rejoue !`, 1200);

        updateUI(); render();

        // Préparer pour le prochain coup si c'est mon tour
        if (state.turn === myColor && !state.diceRolled) {
          // Rien, le joueur doit cliquer sur le dé
        }
        break;
      }

      case 'game_over': {
        state = data.state;
        updateUI(); render();
        setTimeout(() => showGameOver(data), 800);
        Audio.playVictory();
        break;
      }

      case 'opponent_disconnected':
        $('modal-disconnect').style.display = 'flex';
        break;

      case 'opponent_reconnected':
        $('modal-disconnect').style.display = 'none';
        break;

      case 'rematch_requested':
        $('rematch-status').textContent = 'Un joueur veut rejouer !';
        break;

      case 'rematch_start':
      case 'game_start':
        $('modal-gameover').style.display = 'none';
        $('rematch-status').textContent   = '';
        $('btn-rematch').textContent       = '🔄 Rejouer';
        $('btn-rematch').disabled          = false;
        state          = data.state;
        diceValue      = null;
        waitingForPawn = false;
        pendingMoves   = [];
        updateUI(); render();
        Audio.playStart();
        break;
    }
  }

  // ── Toast ──────────────────────────────────────────────────────────────
  function showToast(msg, duration) {
    let t = document.getElementById('toast');
    if (!t) {
      t = document.createElement('div');
      t.id = 'toast';
      Object.assign(t.style, {
        position:'fixed', bottom:'80px', left:'50%', transform:'translateX(-50%)',
        background:'rgba(0,0,0,.8)', color:'#fff', padding:'10px 20px',
        borderRadius:'20px', zIndex:'999', fontSize:'.9rem', fontFamily:'Nunito,sans-serif',
        fontWeight:'700', pointerEvents:'none', transition:'opacity .3s',
      });
      document.body.appendChild(t);
    }
    t.textContent = msg;
    t.style.opacity = '1';
    clearTimeout(t._hide);
    t._hide = setTimeout(() => { t.style.opacity = '0'; }, duration || 2000);
  }

  // ── Fin de partie ──────────────────────────────────────────────────────
  function showGameOver(data) {
    const modal      = $('modal-gameover');
    const rankingsEl = $('gameover-rankings');
    const title      = $('gameover-title');
    const trophies   = $('gameover-trophies');
    const medals     = ['🥇','🥈','🥉','4️⃣'];
    const colorBg    = { red:'rgba(231,76,60,.25)', blue:'rgba(52,152,219,.25)', green:'rgba(46,204,113,.25)', yellow:'rgba(241,196,15,.25)' };
    const colorDot   = { red:'#e74c3c', blue:'#3498db', green:'#2ecc71', yellow:'#f1c40f' };

    trophies.textContent = data.winner === myColor ? '🏆🎉🏆' : '🎲';
    title.textContent    = data.winner === myColor ? 'VICTOIRE !' : (data.rankings[0] && state?.players[data.rankings[0]]?.pseudo) ? `${state.players[data.rankings[0]].pseudo} gagne !` : 'Fin de partie !';

    rankingsEl.innerHTML = (data.rankings || []).map((color, i) => {
      const pseudo = state?.players[color]?.pseudo || color;
      return `<div class="ranking-row">
        <span class="ranking-pos">${medals[i] || (i+1)}</span>
        <span class="ranking-color" style="background:${colorDot[color]}"></span>
        <span class="ranking-name">${pseudo}</span>
      </div>`;
    }).join('');

    modal.style.display = 'flex';
  }

  // ── Init ────────────────────────────────────────────────────────────────
  function init(sock, payload, isReconnect = false) {
    socket  = sock;
    state   = payload.state;
    myColor = isReconnect ? payload.color : (localStorage.getItem('ludo_color') || 'red');
    diceValue      = null;
    waitingForPawn = false;
    pendingMoves   = [];
    animEnabled    = $('opt-anim')?.checked !== false;

    resize();
    updateUI();
    render();

    // Événements canvas
    canvas.removeEventListener('click',     handleCanvasClick);
    canvas.removeEventListener('touchend',  handleCanvasClick);
    canvas.addEventListener('click',     handleCanvasClick);
    canvas.addEventListener('touchend',  handleCanvasClick, { passive: false });

    // Dé
    const dice = $('dice');
    dice.onclick = () => { Audio.init(); handleDiceClick(); };

    // Tour bot immédiat ?
    if (state.turn && state.players[state.turn]?.isBot) {
      // le serveur gère le bot, on attend
    }
  }

  window.addEventListener('resize', () => { if (state) { resize(); } });

  return { init, onEvent };
})();
