const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const {
  COLORS, createGameState, processDiceRoll, processMove,
  botChooseMove, serializeState,
} = require('./ludoEngine');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

// 1. Accès au dossier public situé un dossier plus haut (..)
app.use(express.static(path.join(__dirname, '..', 'public')));

// 2. Redirection de la racine sur index.html (ou indexe.html selon le nom exact de votre fichier)
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

const rooms = {};

function generateRoomCode() {
  let code;
  do {
    code = Math.floor(1000 + Math.random() * 9000).toString();
  } while (rooms[code]);
  return code;
}

function getRoom(code) { return rooms[code] || null; }

function startGame(room, roomCode) {
  room.started = true;
  const colors = COLORS.slice(0, room.playerCount);
  room.assignedColors = colors;

  const humanSockets = Object.keys(room.sockets);
  const botColors = [];

  colors.forEach((col, i) => {
    if (i < humanSockets.length) {
      const socketId = humanSockets[i];
      const s = room.sockets[socketId];
      s.data.color = col;
      room.state.players[col] = { nickname: s.data.nickname, isBot: false };
    } else {
      botColors.push(col);
      room.state.players[col] = { nickname: `Bot ${col.toUpperCase()}`, isBot: true };
    }
  });

  room.botColors = botColors;
  room.state.activeColors = colors;
  room.state.turn = colors[0];
  room.state.phase = 'playing';

  io.to(roomCode).emit('game_started', {
    gameState: serializeState(room.state),
    colors,
    players: room.state.players,
  });

  checkBotTurn(room, roomCode);
}

function checkBotTurn(room, roomCode) {
  if (room.state.phase !== 'playing') return;
  const turn = room.state.turn;
  if (!room.botColors.includes(turn)) return;

  setTimeout(() => {
    if (room.state.turn !== turn || room.state.phase !== 'playing') return;

    const rollRes = processDiceRoll(room.state, turn);
    if (!rollRes.ok) return;

    io.to(roomCode).emit('dice_rolled', { color: turn, dice: rollRes.dice, gameState: serializeState(room.state) });

    if (rollRes.skipped || rollRes.autoPass) {
      io.to(roomCode).emit('turn_changed', { turn: room.state.turn, gameState: serializeState(room.state) });
      checkBotTurn(room, roomCode);
      return;
    }

    setTimeout(() => {
      const chosen = botChooseMove(room.state, turn, rollRes.dice);
      if (!chosen) return;

      const moveRes = processMove(room.state, turn, chosen.pawnId);
      if (moveRes.ok) {
        io.to(roomCode).emit('pawn_moved', {
          color: turn,
          pawnId: chosen.pawnId,
          move: moveRes.move,
          captures: moveRes.captures,
          gameState: serializeState(room.state),
        });

        if (moveRes.gameOver) {
          io.to(roomCode).emit('game_over', { winner: turn, rankings: room.state.rankings });
        } else {
          checkBotTurn(room, roomCode);
        }
      }
    }, 800);
  }, 1000);
}

io.on('connection', (socket) => {

  socket.on('create_room', ({ nickname, playerCount, withBots }) => {
    const code = generateRoomCode();
    socket.data = { nickname, roomCode: code, color: null };

    rooms[code] = {
      code,
      playerCount: parseInt(playerCount) || 4,
      withBots: !!withBots,
      started: false,
      sockets: { [socket.id]: socket },
      botColors: [],
      assignedColors: [],
      state: createGameState(parseInt(playerCount) || 4, !!withBots),
      rematchVotes: new Set(),
    };

    socket.join(code);
    socket.emit('room_created', { roomCode: code, playerCount: rooms[code].playerCount });

    if (withBots) {
      startGame(rooms[code], code);
    }
  });

  socket.on('join_room', ({ nickname, roomCode }) => {
    const room = getRoom(roomCode);
    if (!room) return socket.emit('error_msg', 'Salon introuvable.');
    if (room.started) return socket.emit('error_msg', 'Partie déjà en cours.');
    if (Object.keys(room.sockets).length >= room.playerCount) return socket.emit('error_msg', 'Salon complet.');

    socket.data = { nickname, roomCode, color: null };
    room.sockets[socket.id] = socket;
    socket.join(roomCode);

    io.to(roomCode).emit('player_joined', {
      playersCount: Object.keys(room.sockets).length,
      maxPlayers: room.playerCount,
    });

    if (Object.keys(room.sockets).length === room.playerCount) {
      startGame(room, roomCode);
    }
  });

  socket.on('roll_dice', () => {
    const room = getRoom(socket.data.roomCode);
    if (!room || !room.started) return;
    const color = socket.data.color;

    const res = processDiceRoll(room.state, color);
    if (!res.ok) return socket.emit('error_msg', res.reason);

    io.to(room.code).emit('dice_rolled', { color, dice: res.dice, gameState: serializeState(room.state) });

    if (res.skipped || res.autoPass) {
      io.to(room.code).emit('turn_changed', { turn: room.state.turn, gameState: serializeState(room.state) });
      checkBotTurn(room, room.code);
    } else if (res.autoMove) {
      setTimeout(() => {
        const moveRes = processMove(room.state, color, res.autoMove.pawnId);
        if (moveRes.ok) {
          io.to(room.code).emit('pawn_moved', {
            color,
            pawnId: res.autoMove.pawnId,
            move: moveRes.move,
            captures: moveRes.captures,
            gameState: serializeState(room.state),
          });
          if (moveRes.gameOver) {
            io.to(room.code).emit('game_over', { winner: color, rankings: room.state.rankings });
          } else {
            checkBotTurn(room, room.code);
          }
        }
      }, 500);
    }
  });

  socket.on('move_pawn', ({ pawnId }) => {
    const room = getRoom(socket.data.roomCode);
    if (!room || !room.started) return;
    const color = socket.data.color;

    const res = processMove(room.state, color, pawnId);
    if (!res.ok) return socket.emit('error_msg', res.reason);

    io.to(room.code).emit('pawn_moved', {
      color,
      pawnId,
      move: res.move,
      captures: res.captures,
      gameState: serializeState(room.state),
    });

    if (res.gameOver) {
      io.to(room.code).emit('game_over', { winner: color, rankings: room.state.rankings });
    } else {
      checkBotTurn(room, room.code);
    }
  });

  socket.on('request_rematch', () => {
    const room = getRoom(socket.data.roomCode);
    if (!room) return;
    if (!room.rematchVotes) room.rematchVotes = new Set();
    room.rematchVotes.add(socket.data.color);

    const humanColors = room.assignedColors.filter(c => !room.botColors.includes(c));
    if (room.rematchVotes.size >= humanColors.length) {
      const oldPlayers = room.state.players;

      room.state = createGameState(room.playerCount, room.withBots, room.botColors);
      room.state.activeColors = room.assignedColors;
      room.state.players = oldPlayers;

      room.started = false;
      room.rematchVotes = new Set();
      startGame(room, room.code);
    } else {
      socket.to(room.code).emit('rematch_requested', { by: socket.data.color });
    }
  });

  socket.on('disconnect', () => {
    const room = getRoom(socket.data.roomCode);
    if (!room) return;
    delete room.sockets[socket.id];
    if (Object.keys(room.sockets).length === 0) {
      delete rooms[room.code];
    } else if (room.started) {
      io.to(room.code).emit('player_left', { color: socket.data.color });
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Serveur Ludo en écoute sur le port ${PORT}`);
});