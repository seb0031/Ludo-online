'use strict';

// ─── Constantes ────────────────────────────────────────────────────────────
const COLORS = ['red', 'blue', 'green', 'yellow'];

// Parcours complet pour chaque couleur (cases 0-51 = piste commune, 52-57 = couloir final)
// Chaque couleur a un point de départ différent sur la piste commune
const START_CELLS = { red: 0, blue: 13, green: 26, yellow: 39 };
const HOME_ENTRY  = { red: 50, blue: 11, green: 24, yellow: 37 }; // dernière case avant couloir
const SAFE_CELLS  = [0, 8, 13, 21, 26, 34, 39, 47]; // cases étoilées (safe)

// Base (avant départ) : positions visuelles fixes par couleur
const BASE_POSITIONS = {
  red:    [0,1,2,3],
  blue:   [4,5,6,7],
  green:  [8,9,10,11],
  yellow: [12,13,14,15],
};

// ─── Création d'un pion ─────────────────────────────────────────────────────
function createPawn(color, id) {
  return {
    id,           // 0-3
    color,
    state: 'base',     // 'base' | 'track' | 'home' | 'finished'
    trackPos: -1,      // position sur la piste commune (0-51), relative à la couleur
    homePos: -1,       // position dans le couloir final (0-5, 5 = arrivée)
  };
}

// ─── Création de l'état initial ─────────────────────────────────────────────
function createGameState(playerCount, withBots, botColors) {
  const pawns = {};
  COLORS.forEach(c => {
    pawns[c] = [0,1,2,3].map(i => createPawn(c, i));
  });
  return {
    pawns,
    players: {},       // color -> { pseudo, isBot, connected }
    activeColors: [],  // couleurs actives dans la partie
    turn: null,        // couleur dont c'est le tour
    phase: 'waiting',  // 'waiting' | 'playing' | 'finished'
    dice: null,        // valeur du dernier dé
    diceRolled: false, // le dé a-t-il été lancé ce tour ?
    mustMove: null,    // pion obligatoire à bouger (si un seul coup possible)
    winner: null,
    rankings: [],      // ordre d'arrivée
    consecutive6: 0,   // nombre de 6 consécutifs
    moveHistory: [],
    botColors: botColors || [],
  };
}

// ─── Position absolue sur la piste (0-51) ──────────────────────────────────
function absolutePos(color, relPos) {
  return (START_CELLS[color] + relPos) % 52;
}

// ─── Est-ce que la case est safe ? ─────────────────────────────────────────
function isSafe(absPos) {
  return SAFE_CELLS.includes(absPos);
}

// ─── Calcule les mouvements possibles pour une couleur ──────────────────────
function getPossibleMoves(state, color, dice) {
  const pawns = state.pawns[color];
  const moves = [];

  pawns.forEach(pawn => {
    if (pawn.state === 'finished') return;

    if (pawn.state === 'base') {
      // Peut sortir seulement avec un 6
      if (dice === 6) {
        // Vérifier si la case de départ est occupée par un pion allié
        const startAbs = START_CELLS[color];
        const ownOnStart = pawns.filter(p =>
          p.state === 'track' && p.trackPos === 0
        ).length;
        // On peut toujours sortir (on empile ou on sort normalement)
        moves.push({ pawnId: pawn.id, type: 'exit_base' });
      }
      return;
    }

    if (pawn.state === 'track') {
      const newRel = pawn.trackPos + dice;
      // Entrée dans le couloir final
      const homeEntryRel = (HOME_ENTRY[color] - START_CELLS[color] + 52) % 52;
      if (newRel > homeEntryRel && newRel <= homeEntryRel + 6) {
        const homePos = newRel - homeEntryRel - 1;
        if (homePos <= 5) {
          moves.push({ pawnId: pawn.id, type: 'enter_home', homePos });
        }
      } else if (newRel <= homeEntryRel) {
        // Déplacement normal sur la piste
        moves.push({ pawnId: pawn.id, type: 'move_track', newRel });
      }
      return;
    }

    if (pawn.state === 'home') {
      const newHomePos = pawn.homePos + dice;
      if (newHomePos === 5) {
        moves.push({ pawnId: pawn.id, type: 'finish', homePos: 5 });
      } else if (newHomePos < 5) {
        moves.push({ pawnId: pawn.id, type: 'move_home', homePos: newHomePos });
      }
    }
  });

  return moves;
}

// ─── Applique un mouvement ──────────────────────────────────────────────────
function applyMove(state, color, pawnId, move) {
  const pawn = state.pawns[color][pawnId];
  const captures = [];

  if (move.type === 'exit_base') {
    pawn.state = 'track';
    pawn.trackPos = 0;
    // Capturer les pions adverses sur la case de départ
    const absStart = START_CELLS[color];
    COLORS.forEach(c => {
      if (c === color) return;
      state.pawns[c].forEach(p => {
        if (p.state === 'track') {
          const absP = absolutePos(c, p.trackPos);
          if (absP === absStart && !isSafe(absStart)) {
            p.state = 'base';
            p.trackPos = -1;
            captures.push({ color: c, pawnId: p.id });
          }
        }
      });
    });
  } else if (move.type === 'move_track') {
    pawn.trackPos = move.newRel;
    const absNew = absolutePos(color, move.newRel);
    // Capture
    if (!isSafe(absNew)) {
      COLORS.forEach(c => {
        if (c === color) return;
        state.pawns[c].forEach(p => {
          if (p.state === 'track') {
            const absP = absolutePos(c, p.trackPos);
            if (absP === absNew) {
              p.state = 'base';
              p.trackPos = -1;
              captures.push({ color: c, pawnId: p.id });
            }
          }
        });
      });
    }
  } else if (move.type === 'enter_home') {
    pawn.state = 'home';
    pawn.trackPos = -1;
    pawn.homePos = move.homePos;
  } else if (move.type === 'move_home') {
    pawn.homePos = move.homePos;
  } else if (move.type === 'finish') {
    pawn.state = 'finished';
    pawn.homePos = 5;
  }

  return captures;
}

// ─── Vérifie si un joueur a terminé ─────────────────────────────────────────
function hasFinished(state, color) {
  return state.pawns[color].every(p => p.state === 'finished');
}

// ─── Prochain joueur ─────────────────────────────────────────────────────────
function nextTurn(state) {
  const active = state.activeColors.filter(c => !hasFinished(state, c));
  if (active.length <= 1) {
    // Fin de partie
    if (active.length === 1 && !state.rankings.includes(active[0])) {
      state.rankings.push(active[0]);
    }
    state.phase = 'finished';
    state.winner = state.rankings[0];
    return;
  }
  const idx = active.indexOf(state.turn);
  state.turn = active[(idx + 1) % active.length];
  state.diceRolled = false;
  state.dice = null;
  state.consecutive6 = 0;
}

// ─── Lance le dé ────────────────────────────────────────────────────────────
function rollDice() {
  return Math.floor(Math.random() * 6) + 1;
}

// ─── Logique complète d'un tour : lance le dé ───────────────────────────────
function processDiceRoll(state, color) {
  if (state.turn !== color) return { ok: false, reason: 'Not your turn' };
  if (state.diceRolled) return { ok: false, reason: 'Already rolled' };

  const dice = rollDice();
  state.dice = dice;
  state.diceRolled = true;

  // 3 six consécutifs = passer le tour
  if (dice === 6) {
    state.consecutive6 = (state.consecutive6 || 0) + 1;
    if (state.consecutive6 >= 3) {
      state.consecutive6 = 0;
      nextTurn(state);
      return { ok: true, dice, skipped: true, reason: 'three_sixes' };
    }
  }

  const moves = getPossibleMoves(state, color, dice);

  if (moves.length === 0) {
    // Aucun mouvement possible → passer
    if (dice !== 6) nextTurn(state);
    else state.diceRolled = false; // rejouer si 6 sans mouvement possible... non, on passe quand même
    return { ok: true, dice, moves: [], autoPass: true };
  }

  if (moves.length === 1) {
    return { ok: true, dice, moves, autoMove: moves[0] };
  }

  return { ok: true, dice, moves };
}

// ─── Applique le choix du joueur ─────────────────────────────────────────────
function processMove(state, color, pawnId) {
  if (state.turn !== color) return { ok: false, reason: 'Not your turn' };
  if (!state.diceRolled) return { ok: false, reason: 'Roll first' };

  const dice = state.dice;
  const moves = getPossibleMoves(state, color, dice);
  const move = moves.find(m => m.pawnId === pawnId);
  if (!move) return { ok: false, reason: 'Invalid move' };

  const captures = applyMove(state, color, pawnId, move);

  // Vérifier fin de partie
  if (hasFinished(state, color)) {
    if (!state.rankings.includes(color)) state.rankings.push(color);
  }

  // Rejouer si 6 ou capture (règle classique)
  const replay = dice === 6 || captures.length > 0;

  if (!replay) {
    nextTurn(state);
  } else {
    state.diceRolled = false;
    state.dice = null;
    // Garder consecutive6 si replay sur 6
    if (dice !== 6) state.consecutive6 = 0;
  }

  // Vérifier fin globale
  const remaining = state.activeColors.filter(c => !hasFinished(state, c));
  if (remaining.length <= 1) {
    if (remaining.length === 1 && !state.rankings.includes(remaining[0])) {
      state.rankings.push(remaining[0]);
    }
    state.phase = 'finished';
    state.winner = state.rankings[0];
  }

  return { ok: true, move, captures, replay, finished: hasFinished(state, color) };
}

// ─── IA : choisit le meilleur pion à jouer ──────────────────────────────────
function botChooseMove(state, color, dice) {
  const moves = getPossibleMoves(state, color, dice);
  if (moves.length === 0) return null;

  // Priorité : capturer > avancer vers la fin > sortir de base > avancer
  // Chercher captures
  for (const move of moves) {
    if (move.type === 'move_track') {
      const absNew = absolutePos(color, move.newRel);
      const hasEnemy = COLORS.some(c => {
        if (c === color) return false;
        return state.pawns[c].some(p =>
          p.state === 'track' && absolutePos(c, p.trackPos) === absNew
        );
      });
      if (hasEnemy && !isSafe(absNew)) return move;
    }
  }
  // Priorité finish
  const finish = moves.find(m => m.type === 'finish');
  if (finish) return finish;
  // Priorité enter_home
  const enterHome = moves.find(m => m.type === 'enter_home');
  if (enterHome) return enterHome;
  // Priorité exit_base
  const exit = moves.find(m => m.type === 'exit_base');
  if (exit) return exit;
  // Avancer le pion le plus avancé
  const trackMoves = moves.filter(m => m.type === 'move_track' || m.type === 'move_home');
  if (trackMoves.length > 0) {
    return trackMoves.reduce((best, m) => {
      const bPos = best.newRel ?? best.homePos ?? 0;
      const mPos = m.newRel ?? m.homePos ?? 0;
      return mPos > bPos ? m : best;
    });
  }
  return moves[0];
}

// ─── Sérialisation de l'état ─────────────────────────────────────────────────
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

module.exports = {
  createGameState, processDiceRoll, processMove, botChooseMove,
  getPossibleMoves, serializeState, COLORS, START_CELLS, SAFE_CELLS,
  absolutePos, hasFinished, nextTurn,
};
