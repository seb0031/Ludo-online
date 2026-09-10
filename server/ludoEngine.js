'use strict';

// ═══════════════════════════════════════════════════════════════════════════
// MOTEUR PETITS CHEVAUX — Règles complètes version française
// ═══════════════════════════════════════════════════════════════════════════

const COLORS = ['green', 'red', 'blue', 'yellow']; // ordre horaire: vert(haut-gauche), rouge(haut-droite), bleu(bas-droite), jaune(bas-gauche)

// La piste commune a 52 cases (0-51)
// Chaque couleur démarre à sa case colorée
// green=0, red=13, blue=26, yellow=39
const START_IDX = { green: 0, red: 13, blue: 26, yellow: 39 };

// Cases safe (étoilées) — indices absolus sur la piste
const SAFE_ABS = [0, 8, 13, 21, 26, 34, 39, 47];

// ── Pion ────────────────────────────────────────────────────────────────────
function createPawn(color, id) {
  return {
    id,
    color,
    state: 'base',      // 'base' | 'track' | 'stairs' | 'finished'
    trackPos: -1,       // position relative sur piste (0-51), -1 si pas sur piste
    stairsPos: -1,      // position dans l'escalier (0=entrée, 5=centre)
    // Pour l'animation client
    animFrom: null,
    animTo: null,
  };
}

// ── État du jeu ─────────────────────────────────────────────────────────────
function createGameState(playerCount, withBots, botColors) {
  const pawns = {};
  COLORS.forEach(c => { pawns[c] = [0,1,2,3].map(i => createPawn(c, i)); });
  return {
    pawns,
    players: {},
    activeColors: [],
    turn: null,
    phase: 'waiting',
    dice: null,
    diceRolled: false,
    consecutive6: 0,
    winner: null,
    rankings: [],
    botColors: botColors || [],
    moveHistory: [],
  };
}

// ── Position absolue sur la piste ───────────────────────────────────────────
function absPos(color, relPos) {
  return (START_IDX[color] + relPos) % 52;
}

// ── Case safe ? ─────────────────────────────────────────────────────────────
function isSafe(abs) { return SAFE_ABS.includes(abs); }

// ── Calcule les mouvements possibles ────────────────────────────────────────
// Règles :
//  - Sortie de base : uniquement sur un 6
//  - Sur un 6 : choix entre sortir un cheval OU avancer un cheval de 6 cases
//  - Piste : 52 cases. Entrée escalier = case 50 (relative). Escalier = 6 cases (1-6)
//  - Escalier : faut 1,2,3,4,5,6 puis encore 6 pour le centre
//              => stairsPos 0=devant, 1-5=cases escalier, 6=centre(fini)
//  - Trop de cases : recule d'autant (bounce back)
//  - Occupation : si propre cheval, s'arrête juste derrière
function getPossibleMoves(state, color, dice) {
  const pawns = state.pawns[color];
  const moves = [];

  pawns.forEach(pawn => {
    if (pawn.state === 'finished') return;

    // ── SORTIE DE BASE ──────────────────────────────────────────────────
    if (pawn.state === 'base' && dice === 6) {
      // Vérifier la case de départ
      const startAbs = START_IDX[color];
      const landing = calcTrackLanding(state, color, -1, 0, dice); // sortie = position 0
      moves.push({ pawnId: pawn.id, type: 'exit_base', newRel: 0, landing });
      return;
    }

    // ── SUR LA PISTE ────────────────────────────────────────────────────
    if (pawn.state === 'track') {
      const STAIRS_ENTRY = 51; // position relative juste avant l'escalier
      const newRel = pawn.trackPos + dice;

      if (newRel <= STAIRS_ENTRY) {
        // Déplacement sur piste avec rebond
        const landing = calcTrackLanding(state, color, pawn.trackPos, pawn.trackPos, dice);
        moves.push({ pawnId: pawn.id, type: 'move_track', ...landing });
      } else {
        // Entrée dans l'escalier
        const stairsAdvance = newRel - STAIRS_ENTRY - 1; // 0=devant, 1-5=cases
        if (stairsAdvance <= 5) {
          moves.push({ pawnId: pawn.id, type: 'enter_stairs', stairsPos: stairsAdvance });
        } else if (stairsAdvance === 6) {
          moves.push({ pawnId: pawn.id, type: 'finish' });
        } else {
          // Trop grand → rebond dans l'escalier
          const bounce = stairsAdvance - (12 - stairsAdvance); // miroir
          const bounced = Math.max(0, 12 - stairsAdvance);
          if (bounced <= 5) moves.push({ pawnId: pawn.id, type: 'enter_stairs', stairsPos: bounced });
          else moves.push({ pawnId: pawn.id, type: 'move_track', newRel: STAIRS_ENTRY - (stairsAdvance - 6), bounce: true });
        }
      }
      return;
    }

    // ── DANS L'ESCALIER ─────────────────────────────────────────────────
    if (pawn.state === 'stairs') {
      // stairsPos 0=devant escalier, 1-5=cases, 6=centre
      // Pour monter: faut 1,2,3,4,5,6 → stairsPos devient 1,2,3,4,5,puis 6 pour finir
      // Si déjà à stairsPos k, pour monter il faut lancer exactement (k+1) sauf la fin qui demande 6
      const target = pawn.stairsPos + dice;
      if (target === 6) {
        moves.push({ pawnId: pawn.id, type: 'finish' });
      } else if (target < 6) {
        moves.push({ pawnId: pawn.id, type: 'move_stairs', stairsPos: target });
      } else {
        // Rebond dans l'escalier : recule d'autant de cases en trop
        const over = target - 6;
        const bounced = 6 - over;
        if (bounced >= 0) moves.push({ pawnId: pawn.id, type: 'move_stairs', stairsPos: bounced, bounce: true });
      }
    }
  });

  return moves;
}

// ── Calcule le landing sur la piste (rebond + occupation) ───────────────────
function calcTrackLanding(state, color, fromRel, startRel, dice) {
  let newRel = startRel + dice;
  if (fromRel === -1) newRel = 0; // sortie de base

  const abs = absPos(color, newRel);

  // Vérifier occupation par propre pion
  const ownOnCell = state.pawns[color].filter(p =>
    p.state === 'track' && p.trackPos === newRel
  ).length;

  // Vérifier occupation par ennemi
  const enemyOnCell = COLORS.filter(c => c !== color).flatMap(c =>
    state.pawns[c].filter(p => p.state === 'track' && absPos(c, p.trackPos) === abs)
  );

  return { newRel, abs, ownBlocked: ownOnCell > 0, capture: !isSafe(abs) && enemyOnCell.length > 0 };
}

// ── Applique un mouvement ────────────────────────────────────────────────────
function applyMove(state, color, pawnId, moveType, extra) {
  const pawn = state.pawns[color][pawnId];
  const captures = [];
  let bounced = false;
  let steps = []; // pour animation case par case

  if (moveType === 'exit_base') {
    // Capturer ennemi sur la case de départ ?
    const startAbs = START_IDX[color];
    COLORS.forEach(c => {
      if (c === color) return;
      state.pawns[c].forEach(p => {
        if (p.state === 'track' && absPos(c, p.trackPos) === startAbs && !isSafe(startAbs)) {
          p.state = 'base'; p.trackPos = -1;
          captures.push({ color: c, pawnId: p.id });
        }
      });
    });
    pawn.state = 'track';
    pawn.trackPos = 0;
    steps = buildTrackSteps(color, -1, 0);

  } else if (moveType === 'move_track') {
    const from = pawn.trackPos;
    let target = extra.newRel;
    // Vérif occupation propre
    const ownAt = state.pawns[color].filter(p =>
      p.id !== pawnId && p.state === 'track' && p.trackPos === target
    );
    if (ownAt.length > 0) {
      target = target - 1; // s'arrête juste derrière
    } else {
      // Capture ennemi
      const abs = absPos(color, target);
      if (!isSafe(abs)) {
        COLORS.forEach(c => {
          if (c === color) return;
          state.pawns[c].forEach(p => {
            if (p.state === 'track' && absPos(c, p.trackPos) === abs) {
              p.state = 'base'; p.trackPos = -1;
              captures.push({ color: c, pawnId: p.id });
            }
          });
        });
      }
    }
    steps = buildTrackSteps(color, from, target);
    pawn.trackPos = target;

  } else if (moveType === 'enter_stairs') {
    steps = buildTrackSteps(color, pawn.trackPos, 51);
    pawn.state = 'stairs';
    pawn.trackPos = -1;
    pawn.stairsPos = extra.stairsPos;

  } else if (moveType === 'move_stairs') {
    pawn.stairsPos = extra.stairsPos;

  } else if (moveType === 'finish') {
    pawn.state = 'finished';
    pawn.stairsPos = 6;
  }

  return { captures, bounced, steps };
}

// ── Construit la liste des cases intermédiaires pour l'animation ─────────────
function buildTrackSteps(color, fromRel, toRel) {
  const steps = [];
  if (fromRel === -1) { steps.push({ type: 'track', rel: 0 }); return steps; }
  const dir = toRel >= fromRel ? 1 : -1;
  for (let r = fromRel + dir; r !== toRel + dir; r += dir) {
    steps.push({ type: 'track', rel: r });
  }
  return steps;
}

// ── Lance le dé ─────────────────────────────────────────────────────────────
function rollDice() { return Math.floor(Math.random() * 6) + 1; }

// ── Traite le lancer de dé ───────────────────────────────────────────────────
function processDiceRoll(state, color) {
  if (state.turn !== color) return { ok: false, reason: 'Not your turn' };
  if (state.diceRolled) return { ok: false, reason: 'Already rolled' };

  const dice = rollDice();
  state.dice = dice;
  state.diceRolled = true;

  if (dice === 6) {
    state.consecutive6 = (state.consecutive6 || 0) + 1;
    if (state.consecutive6 >= 3) {
      state.consecutive6 = 0;
      nextTurn(state);
      return { ok: true, dice, skipped: true, reason: 'three_sixes', moves: [] };
    }
  } else {
    state.consecutive6 = 0;
  }

  const moves = getPossibleMoves(state, color, dice);

  if (moves.length === 0) {
    // Aucun coup → passer le tour (sauf si 6)
    if (dice !== 6) nextTurn(state);
    else state.diceRolled = false;
    return { ok: true, dice, moves: [], autoPass: dice !== 6 };
  }

  if (moves.length === 1) {
    return { ok: true, dice, moves, autoMove: moves[0] };
  }

  return { ok: true, dice, moves };
}

// ── Traite le choix du joueur ────────────────────────────────────────────────
function processMove(state, color, pawnId) {
  if (state.turn !== color) return { ok: false, reason: 'Not your turn' };
  if (!state.diceRolled) return { ok: false, reason: 'Roll first' };

  const dice = state.dice;
  const moves = getPossibleMoves(state, color, dice);
  const move = moves.find(m => m.pawnId === pawnId);
  if (!move) return { ok: false, reason: 'Invalid move' };

  const result = applyMove(state, color, pawnId, move.type, move);

  // Victoire : 1er cheval qui atteint le centre
  if (move.type === 'finish' && !state.winner) {
    state.winner = color;
    state.phase = 'finished';
    if (!state.rankings.includes(color)) state.rankings.push(color);
    return { ok: true, move, ...result, gameOver: true };
  }

  // Rejouer si 6 ou capture
  const replay = dice === 6 || result.captures.length > 0;
  if (!replay) {
    nextTurn(state);
  } else {
    state.diceRolled = false;
    state.dice = null;
    if (result.captures.length > 0) state.consecutive6 = 0;
  }

  return { ok: true, move, ...result, replay };
}

// ── Passe au joueur suivant ──────────────────────────────────────────────────
function nextTurn(state) {
  const active = state.activeColors;
  const idx = active.indexOf(state.turn);
  state.turn = active[(idx + 1) % active.length];
  state.diceRolled = false;
  state.dice = null;
  state.consecutive6 = 0;
}

// ── Choix IA ─────────────────────────────────────────────────────────────────
function botChooseMove(state, color, dice) {
  const moves = getPossibleMoves(state, color, dice);
  if (!moves.length) return null;
  // Priorité: finir > escalier > capturer > avancer le plus avancé > sortir base
  const finish = moves.find(m => m.type === 'finish');
  if (finish) return finish;
  const stairs = moves.find(m => m.type === 'enter_stairs' || m.type === 'move_stairs');
  if (stairs) return stairs;
  const capture = moves.find(m => m.capture);
  if (capture) return capture;
  const tracks = moves.filter(m => m.type === 'move_track');
  if (tracks.length) return tracks.reduce((b, m) => (m.newRel > b.newRel ? m : b));
  return moves[0];
}

// ── Sérialisation ─────────────────────────────────────────────────────────────
function serializeState(state) {
  return {
    pawns: state.pawns,
    turn: state.turn,
    phase: state.phase,
    dice: state.dice,
    diceRolled: state.diceRolled,
    winner: state.winner,
    rankings: state.rankings,
    activeColors: state.activeColors,
    players: state.players,
    botColors: state.botColors,
  };
}

function hasFinished(state, color) {
  return state.winner === color;
}

module.exports = {
  createGameState, processDiceRoll, processMove, botChooseMove,
  getPossibleMoves, serializeState, COLORS, START_IDX, SAFE_ABS,
  absPos, hasFinished, nextTurn, rollDice,
};
