'use strict';

const crypto = require('crypto');
const {
  createGameState, processDiceRoll, processMove, botChooseMove,
  serializeState, COLORS,
} = require('./ludoEngine');

const rooms  = new Map();
const tokens = new Map();

function generateCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code;
  do { code = Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join(''); }
  while (rooms.has(code));
  return code;
}
function generateToken() { return crypto.randomBytes(16).toString('hex'); }

function createRoom(code, hostPseudo, playerCount, withBots) {
  const assignedColors = ['red','blue','green','yellow'].slice(0, playerCount);
  const botColors = withBots
    ? assignedColors.slice(1)
    : [];

  const state = createGameState(playerCount, withBots, botColors);
  state.activeColors = assignedColors;

  const botNames = ['Bot Bleu 🤖','Bot Vert 🤖','Bot Jaune 🤖'];
  botColors.forEach((c, i) => {
    state.players[c] = { pseudo: botNames[i], isBot: true, connected: true };
  });

  return {
    code,
    hostColor: 'red',
    playerCount,
    withBots,
    assignedColors,
    botColors,
    slots: { red: null, blue: null, green: null, yellow: null },
    sockets: { red: null, blue: null, green: null, yellow: null },
    state,
    createdAt: Date.now(),
    started: false,
    botThinkTimeout: null,
  };
}

function createRoomHandler(pseudo, playerCount, withBots) {
  const code = generateCode();
  const room = createRoom(code, pseudo, playerCount, withBots);
  const token = generateToken();
  room.slots.red = token;
  room.state.players.red = { pseudo, isBot: false, connected: false };
  tokens.set(token, { roomCode: code, color: 'red' });
  rooms.set(code, room);
  return { code, color: 'red', token };
}

function joinRoom(code, pseudo) {
  const room = rooms.get(code);
  if (!room) return { ok: false, reason: 'Salon introuvable' };
  if (room.started) return { ok: false, reason: 'Partie déjà commencée' };

  const freeColor = room.assignedColors.find(c =>
    !room.botColors.includes(c) && !room.slots[c]
  );
  if (!freeColor) return { ok: false, reason: 'Salon complet' };

  const token = generateToken();
  room.slots[freeColor] = token;
  room.state.players[freeColor] = { pseudo, isBot: false, connected: false };
  tokens.set(token, { roomCode: code, color: freeColor });
  return { ok: true, code, color: freeColor, token };
}

function reconnectWithToken(token, socketId) {
  const info = tokens.get(token);
  if (!info) return null;
  const room = rooms.get(info.roomCode);
  if (!room) return null;
  room.sockets[info.color] = socketId;
  if (room.state.players[info.color])
    room.state.players[info.color].connected = true;
  return { room, color: info.color };
}

function setPlayerSocket(room, color, socketId) {
  room.sockets[color] = socketId;
  if (room.state.players[color]) room.state.players[color].connected = true;
}

function disconnectPlayer(socketId) {
  for (const [code, room] of rooms.entries()) {
    for (const color of COLORS) {
      if (room.sockets[color] === socketId) {
        room.sockets[color] = null;
        if (room.state.players[color]) room.state.players[color].connected = false;
        return { room, color };
      }
    }
  }
  return null;
}

function allHumansConnected(room) {
  const humanColors = room.assignedColors.filter(c => !room.botColors.includes(c));
  return humanColors.every(c => {
    const isSocketOk = room.sockets[c] !== null;
    const isPlayerOk = room.state.players[c] && room.state.players[c].connected;
    return isSocketOk || isPlayerOk;
  });
}

function getRoom(code) { return rooms.get(code); }

function scheduleBotTurn(room, io) {
  if (room.botThinkTimeout) clearTimeout(room.botThinkTimeout);
  const color = room.state.turn;
  if (!color || !room.botColors.includes(color)) return;
  if (room.state.phase !== 'playing') return;

  room.botThinkTimeout = setTimeout(() => {
    const rollResult = processDiceRoll(room.state, color);
    if (!rollResult.ok) return;

    io.to(room.code).emit('dice_rolled', {
      color, dice: rollResult.dice, moves: rollResult.moves || [],
      autoPass: rollResult.autoPass, skipped: rollResult.skipped,
      state: serializeState(room.state),
    });

    if (rollResult.skipped || rollResult.autoPass) {
      setTimeout(() => scheduleBotTurn(room, io), 800);
      return;
    }

    const move = rollResult.autoMove || botChooseMove(room.state, color, rollResult.dice);
    if (!move) return;

    setTimeout(() => {
      const moveResult = processMove(room.state, color, move.pawnId);
      if (!moveResult.ok) return;

      io.to(room.code).emit('move_made', {
        color, pawnId: move.pawnId,
        captures: moveResult.captures,
        replay: moveResult.replay,
        state: serializeState(room.state),
      });

      if (room.state.phase === 'finished') {
        io.to(room.code).emit('game_over', { winner: room.state.winner, rankings: room.state.rankings, state: serializeState(room.state) });
        return;
      }

      if (moveResult.replay && room.botColors.includes(room.state.turn)) {
        scheduleBotTurn(room, io);
      } else if (room.botColors.includes(room.state.turn)) {
        scheduleBotTurn(room, io);
      }
    }, 700);
  }, 900);
}

setInterval(() => {
  const now = Date.now();
  for (const [code, room] of rooms.entries()) {
    if (now - room.createdAt > 6 * 60 * 60 * 1000) {
      if (room.botThinkTimeout) clearTimeout(room.botThinkTimeout);
      rooms.delete(code);
    }
  }
}, 30 * 60 * 1000);

module.exports = {
  createRoomHandler, joinRoom, reconnectWithToken, setPlayerSocket,
  disconnectPlayer, getRoom, allHumansConnected, scheduleBotTurn,
};