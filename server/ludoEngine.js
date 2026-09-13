'use strict';

const COLORS = ['green', 'red', 'blue', 'yellow'];
const START_IDX = { green: 10, red: 20, blue: 30, yellow: 40 };
const SAFE_ABS = [0, 8, 13, 21, 26, 34, 39, 47];

function createPawn(color, id) {
  return {
    id,
    color,
    state: 'base',
    trackPos: -1,
    stairsPos: -1,
  };
}

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

function absPos(color, relPos) {
  return (START_IDX[color] + relPos) % 52;
}

function isSafe(abs) { return SAFE_ABS.includes(abs); }

function getPossibleMoves(state, color, dice) {
  const pawns = state.pawns[color];
  const moves = [];

  pawns.forEach(pawn => {
    if (pawn.state === 'finished') return;

    if (pawn.state === 'base' && dice === 6) {
      const landing = calcTrackLanding(state, color, -1, 0, dice);
      moves.push({ pawnId: pawn.id, type: 'exit_base', newRel: 0, landing });
      return;
    }

    if (pawn.state === 'track') {
      const STAIRS_ENTRY = 51;
      const newRel = pawn.trackPos + dice;

      if (newRel <= STAIRS_ENTRY) {
        const landing = calcTrackLanding(state, color, pawn.trackPos, pawn.trackPos, dice);
        moves.push({ pawnId: pawn.id, type: 'move_track', ...landing });
      } else {
        const stairsAdvance = newRel - STAIRS_ENTRY - 1;
        if (stairsAdvance <= 5) {
          moves.push({ pawnId: pawn.id, type: 'enter_stairs', stairsPos: stairsAdvance });
        } else if (stairsAdvance === 6) {
          moves.push({ pawnId: pawn.id, type: 'finish' });
        } else {
          const bounced = Math.max(0, 12 - stairsAdvance);
          if (bounced <= 5) moves.push({ pawnId: pawn.id, type: 'enter_stairs', stairsPos: bounced });
          else moves.push({ pawnId: pawn.id, type: 'move_track', newRel: STAIRS_ENTRY - (stairsAdvance - 6), bounce: true });
        }
      }
      return;
    }

    if (pawn.state === 'stairs') {
      const target = pawn.stairsPos + dice;
      if (target === 6) {
        moves.push({ pawnId: pawn.id, type: 'finish' });
      } else if (target < 6) {
        moves.push({ pawnId: pawn.id, type: 'move_stairs', stairsPos: target });
      } else {
        const over = target - 6;
        const bounced = 6 - over;
        if (bounced >= 0) moves.push({ pawnId: pawn.id, type: 'move_stairs', stairsPos: bounced, bounce: true });
      }
    }
  });

  return moves;
}

function calcTrackLanding(state, color, fromRel, startRel, dice) {
  let newRel = startRel + dice;
  if (fromRel === -1) newRel = 0;

  const abs = absPos(color, newRel);

  const ownOnCell = state.pawns[color].filter(p =>
    p.state === 'track' && p.trackPos === newRel
  ).length;

  const enemyOnCell = COLORS.filter(c => c !== color).flatMap(c =>
    state.pawns[c].filter(p => p.state === 'track' && absPos(c, p.trackPos) === abs)
  );

  return { newRel, abs, ownBlocked: ownOnCell > 0, capture: !isSafe(abs) && enemyOnCell.length > 0 };
}

function applyMove(state, color, pawnId, moveType, extra) {
  const pawn = state.pawns[color][pawnId];
  const captures = [];
  let bounced = false;
  let steps = [];

  if (moveType === 'exit_base') {
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
    const ownAt = state.pawns[color].filter(p =>
      p.id !== pawnId && p.state === 'track' && p.trackPos === target
    );
    if (ownAt.length > 0) {
      target = target - 1;
    } else {
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

function buildTrackSteps(color, fromRel, toRel) {
  const steps = [];
  if (fromRel === -1) { steps.push({ type: 'track', rel: 0 }); return steps; }
  const dir = toRel >= fromRel ? 1 : -1;
  for (let r = fromRel + dir; r !== toRel + dir; r += dir) {
    steps.push({ type: 'track', rel: r });
  }
  return steps;
}

function rollDice() { return Math.floor(Math.random() * 6) + 1; }

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
    if (dice !== 6) nextTurn(state);
    else state.diceRolled = false;
    return { ok: true, dice, moves: [], autoPass: dice !== 6 };
  }

  if (moves.length === 1) {
    return { ok: true, dice, moves, autoMove: moves[0] };
  }

  return { ok: true, dice, moves };
}

function processMove(state, color, pawnId) {
  if (state.turn !== color) return { ok: false, reason: 'Not your turn' };
  if (!state.diceRolled) return { ok: false, reason: 'Roll first' };

  const dice = state.dice;
  const moves = getPossibleMoves(state, color, dice);
  const move = moves.find(m => m.pawnId === pawnId);
  if (!move) return { ok: false, reason: 'Invalid move' };

  const result = applyMove(state, color, pawnId, move.type, move);

  if (move.type === 'finish' && !state.winner) {
    state.winner = color;
    state.phase = 'finished';
    if (!state.rankings.includes(color)) state.rankings.push(color);
    return { ok: true, move, ...result, gameOver: true };
  }

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

function nextTurn(state) {
  const active = state.activeColors;
  const idx = active.indexOf(state.turn);
  state.turn = active[(idx + 1) % active.length];
  state.diceRolled = false;
  state.dice = null;
  state.consecutive6 = 0;
}

function botChooseMove(state, color, dice) {
  const moves = getPossibleMoves(state, color, dice);
  if (!moves.length) return null;
  return moves.find(m => m.type === 'finish') ||
         moves.find(m => m.capture) ||
         moves.find(m => m.type === 'exit_base') ||
         moves[Math.floor(Math.random() * moves.length)];
}

function serializeState(state) {
  return JSON.parse(JSON.stringify(state));
}

module.exports = {
  COLORS, createGameState, processDiceRoll, processMove,
  botChooseMove, serializeState,
};