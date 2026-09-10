'use strict';

const express = require('express');
const http    = require('http');
const { Server } = require('socket.io');
const path    = require('path');

const {
  createRoomHandler, joinRoom, reconnectWithToken, setPlayerSocket,
  disconnectPlayer, getRoom, allHumansConnected, scheduleBotTurn, serializeState,
} = require('./rooms');
const { processDiceRoll, processMove } = require('./ludoEngine');

const app    = express();
const server = http.createServer(app);
const io     = new Server(server, { cors: { origin: '*' } });
const PORT   = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, '..', 'public')));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'index.html')));

io.on('connection', (socket) => {
  console.log(`[+] ${socket.id}`);

  // ── Créer une partie ─────────────────────────────────────────────────
  socket.on('create_room', ({ pseudo, playerCount, withBots }) => {
    const p = (pseudo || 'Joueur').slice(0, 20);
    const pc = Math.min(Math.max(parseInt(playerCount) || 4, 2), 4);
    const result = createRoomHandler(p, pc, !!withBots);
    const room = getRoom(result.code);
    setPlayerSocket(room, result.color, socket.id);
    socket.join(result.code);
    socket.data.roomCode = result.code;
    socket.data.color    = result.color;
    socket.emit('room_created', {
      code: result.code, color: result.color, token: result.token,
      pseudo: p, playerCount: pc, withBots: !!withBots,
    });
    console.log(`Salon ${result.code} créé par ${p} (${pc}j, bots:${withBots})`);

    // Si mode solo avec bots, démarrer directement
    if (withBots) startGame(room, result.code);
  });

  // ── Rejoindre ────────────────────────────────────────────────────────
  socket.on('join_room', ({ code, pseudo }) => {
    const code_ = (code || '').toUpperCase().trim();
    const p     = (pseudo || 'Joueur').slice(0, 20);
    const result = joinRoom(code_, p);
    if (!result.ok) { socket.emit('error', { message: result.reason }); return; }

    const room = getRoom(code_);
    setPlayerSocket(room, result.color, socket.id);
    socket.join(code_);
    socket.data.roomCode = code_;
    socket.data.color    = result.color;
    socket.emit('room_joined', { code: code_, color: result.color, token: result.token, pseudo: p });

    // Notifier les autres
    io.to(code_).emit('player_joined', {
      color: result.color, pseudo: p,
      players: room.state.players,
    });

    // Démarrer si tous les humains sont là
    if (allHumansConnected(room) && !room.started) {
      startGame(room, code_);
    }
  });

  // ── Reconnexion ──────────────────────────────────────────────────────
  socket.on('reconnect_token', ({ token }) => {
    const result = reconnectWithToken(token, socket.id);
    if (!result) { socket.emit('error', { message: 'Token invalide' }); return; }
    const { room, color } = result;
    socket.join(room.code);
    socket.data.roomCode = room.code;
    socket.data.color    = color;
    socket.emit('reconnected', {
      code: room.code, color,
      state: serializeState(room.state),
    });
    socket.to(room.code).emit('opponent_reconnected', { color });
  });

  // ── Lancer le dé ────────────────────────────────────────────────────
  socket.on('roll_dice', () => {
    const room  = getRoom(socket.data.roomCode);
    const color = socket.data.color;
    if (!room || room.state.phase !== 'playing') return;
    if (room.state.turn !== color) return;

    const result = processDiceRoll(room.state, color);
    if (!result.ok) { socket.emit('error', { message: result.reason }); return; }

    io.to(room.code).emit('dice_rolled', {
      color, dice: result.dice, moves: result.moves || [],
      autoPass: result.autoPass, skipped: result.skipped,
      state: serializeState(room.state),
    });

    // Auto-pass ou skipped
    if (result.skipped || result.autoPass) {
      setTimeout(() => triggerBotIfNeeded(room), 600);
      return;
    }

    // Auto-move si un seul coup
    if (result.autoMove) {
      setTimeout(() => {
        doMove(room, color, result.autoMove.pawnId);
      }, 400);
    }
  });

  // ── Jouer un pion ────────────────────────────────────────────────────
  socket.on('move_pawn', ({ pawnId }) => {
    const room  = getRoom(socket.data.roomCode);
    const color = socket.data.color;
    if (!room || room.state.phase !== 'playing') return;
    if (room.state.turn !== color) return;
    doMove(room, color, pawnId);
  });

  // ── Déconnexion ──────────────────────────────────────────────────────
  socket.on('disconnect', () => {
    const result = disconnectPlayer(socket.id);
    if (result) {
      socket.to(result.room.code).emit('opponent_disconnected', { color: result.color });
    }
  });

  // ── Nouvelle partie ──────────────────────────────────────────────────
  socket.on('request_rematch', () => {
    const room = getRoom(socket.data.roomCode);
    if (!room) return;
    if (!room.rematchVotes) room.rematchVotes = new Set();
    room.rematchVotes.add(socket.data.color);
    const humanColors = room.assignedColors.filter(c => !room.botColors.includes(c));
    if (room.rematchVotes.size >= humanColors.length) {
      // Reset
      const { createGameState } = require('./ludoEngine');
      room.state = createGameState(room.playerCount, room.withBots, room.botColors);
      room.state.activeColors = room.assignedColors;
      room.state.players = {};
      room.assignedColors.forEach(c => {
        const isBot = room.botColors.includes(c);
        const pseudo = isBot
          ? (['Bot Bleu 🤖','Bot Vert 🤖','Bot Jaune 🤖'])[room.botColors.indexOf(c)]
          : Object.values(room.state.players).find(p => !p.isBot)?.pseudo || 'Joueur';
        room.state.players[c] = { pseudo: room.state.players[c]?.pseudo || pseudo, isBot, connected: !isBot };
      });
      // Remettre les pseudos humains
      humanColors.forEach(c => {
        if (room.state.players[c]) room.state.players[c].connected = true;
      });
      room.started = false;
      room.rematchVotes = new Set();
      startGame(room, room.code);
    } else {
      socket.to(room.code).emit('rematch_requested', { by: socket.data.color });
    }
  });
});

// ─── Démarrage de la partie ───────────────────────────────────────────────────
function startGame(room, code) {
  room.started = true;
  room.state.phase = 'playing';
  room.state.turn  = room.assignedColors[0]; // rouge commence
  room.state.diceRolled = false;

  io.to(code).emit('game_start', { state: serializeState(room.state) });
  console.log(`Partie ${code} démarrée`);

  // Si le premier joueur est un bot
  triggerBotIfNeeded(room);
}

function doMove(room, color, pawnId) {
  const result = processMove(room.state, color, pawnId);
  if (!result.ok) return;

  io.to(room.code).emit('move_made', {
    color, pawnId,
    captures: result.captures,
    replay: result.replay,
    steps: result.steps || [],
    state: serializeState(room.state),
  });

  if (room.state.phase === 'finished') {
    io.to(room.code).emit('game_over', {
      winner: room.state.winner,
      rankings: room.state.rankings,
      state: serializeState(room.state),
    });
    return;
  }

  triggerBotIfNeeded(room);
}

function triggerBotIfNeeded(room) {
  const turn = room.state.turn;
  if (turn && room.botColors.includes(turn) && room.state.phase === 'playing') {
    scheduleBotTurn(room, io);
  }
}

server.listen(PORT, () => console.log(`🎲 Ludo Online sur le port ${PORT}`));
