'use strict';

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] }
});

app.use(express.static(path.join(__dirname, '..', 'public')));

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

const COLORS = ['green', 'red', 'blue', 'yellow'];
const START_POSITIONS = { red: 10, blue: 20, yellow: 30, green: 40 };

const rooms = new Map();

function createInitialState(activeColors = ['green', 'red']) {
  const pawns = {};
  activeColors.forEach(color => {
    pawns[color] = [
      { id: 0, state: 'base', trackPos: -1, stairsPos: 0 },
      { id: 1, state: 'base', trackPos: -1, stairsPos: 0 },
      { id: 2, state: 'base', trackPos: -1, stairsPos: 0 },
      { id: 3, state: 'base', trackPos: -1, stairsPos: 0 }
    ];
  });

  return {
    phase: 'playing',
    turn: activeColors[0],
    activeColors: activeColors,
    dice: null,
    diceRolled: false,
    pawns: pawns,
    rankings: []
  };
}

function getPlayableMoves(state, color, diceValue) {
  const moves = [];
  const playerPawns = state.pawns[color];
  if (!playerPawns) return moves;

  playerPawns.forEach(pawn => {
    if (pawn.state === 'base') {
      if (diceValue === 6) moves.push({ pawnId: pawn.id, type: 'spawn' });
    } else if (pawn.state === 'track') {
      const newPos = pawn.trackPos + diceValue;
      if (newPos < 40) {
        moves.push({ pawnId: pawn.id, type: 'track', newPos });
      } else if (newPos === 40) {
        moves.push({ pawnId: pawn.id, type: 'stairs_enter', step: 1 });
      } else {
        const step = newPos - 39;
        if (step <= 6) moves.push({ pawnId: pawn.id, type: 'stairs', step });
      }
    } else if (pawn.state === 'stairs') {
      if (diceValue === pawn.stairsPos) {
        if (pawn.stairsPos === 6) {
          moves.push({ pawnId: pawn.id, type: 'finish' });
        } else {
          moves.push({ pawnId: pawn.id, type: 'stairs_up', step: pawn.stairsPos + 1 });
        }
      }
    }
  });

  return moves;
}

function applyPawnMove(state, color, pawnId) {
  const pawn = state.pawns[color].find(p => p.id === pawnId);
  const diceValue = state.dice;
  const steps = [];
  const captures = [];

  if (!pawn || !diceValue) return { steps, captures };

  if (pawn.state === 'base' && diceValue === 6) {
    pawn.state = 'track';
    pawn.trackPos = 0;
    steps.push({ type: 'track', rel: 0 });
  } else if (pawn.state === 'track') {
    const start = pawn.trackPos;
    const target = start + diceValue;

    for (let pos = start + 1; pos <= Math.min(target, 39); pos++) {
      steps.push({ type: 'track', rel: pos });
    }

    if (target <= 39) {
      pawn.trackPos = target;
    } else {
      pawn.state = 'stairs';
      pawn.stairsPos = 1;
      steps.push({ type: 'stairs', pos: 1 });
    }
  } else if (pawn.state === 'stairs') {
    if (diceValue === pawn.stairsPos) {
      if (pawn.stairsPos === 6) {
        pawn.state = 'finished';
        steps.push({ type: 'finished' });
      } else {
        pawn.stairsPos += 1;
        steps.push({ type: 'stairs', pos: pawn.stairsPos });
      }
    }
  }

  if (pawn.state === 'track') {
    const myAbsPos = (START_POSITIONS[color] + pawn.trackPos) % 52;
    Object.entries(state.pawns).forEach(([otherColor, pawns]) => {
      if (otherColor === color) return;
      pawns.forEach(otherPawn => {
        if (otherPawn.state === 'track') {
          const otherAbsPos = (START_POSITIONS[otherColor] + otherPawn.trackPos) % 52;
          if (myAbsPos === otherAbsPos) {
            otherPawn.state = 'base';
            otherPawn.trackPos = -1;
            captures.push({ color: otherColor, pawnId: otherPawn.id });
          }
        }
      });
    });
  }

  return { steps, captures };
}

function nextTurn(state) {
  const currentIndex = state.activeColors.indexOf(state.turn);
  const nextIndex = (currentIndex + 1) % state.activeColors.length;
  state.turn = state.activeColors[nextIndex];
  state.dice = null;
  state.diceRolled = false;
}

function checkBotTurn(roomCode) {
  const room = rooms.get(roomCode);
  if (!room || room.state.phase !== 'playing') return;

  const currentTurn = room.state.turn;
  const player = room.players[currentTurn];

  if (player && player.isBot) {
    setTimeout(() => {
      handleBotPlay(roomCode, currentTurn);
    }, 1000);
  }
}

function handleBotPlay(roomCode, botColor) {
  const room = rooms.get(roomCode);
  if (!room || room.state.turn !== botColor) return;

  const state = room.state;
  if (state.diceRolled) return;

  const diceValue = Math.floor(Math.random() * 6) + 1;
  state.dice = diceValue;
  state.diceRolled = true;

  const moves = getPlayableMoves(state, botColor, diceValue);

  if (moves.length === 0) {
    io.to(roomCode).emit('dice_rolled', {
      color: botColor,
      dice: diceValue,
      gameState: state,
      moves: [],
      skipped: true
    });

    setTimeout(() => {
      if (diceValue !== 6) nextTurn(state);
      else state.diceRolled = false;
      
      io.to(roomCode).emit('turn_changed', { gameState: state });
      checkBotTurn(roomCode);
    }, 1200);
  } else {
    io.to(roomCode).emit('dice_rolled', {
      color: botColor,
      dice: diceValue,
      gameState: state,
      moves: moves,
      skipped: false
    });

    setTimeout(() => {
      const chosenMove = moves.find(m => m.type === 'spawn') || moves[0];
      const lastDice = state.dice;
      const { steps, captures } = applyPawnMove(state, botColor, chosenMove.pawnId);

      io.to(roomCode).emit('pawn_moved', {
        color: botColor,
        pawnId: chosenMove.pawnId,
        steps: steps,
        captures: captures,
        gameState: state
      });

      setTimeout(() => {
        if (lastDice === 6) {
          state.diceRolled = false;
          state.dice = null;
        } else {
          nextTurn(state);
        }
        io.to(roomCode).emit('turn_changed', { gameState: state });
        checkBotTurn(roomCode);
      }, 800);
    }, 1000);
  }
}

io.on('connection', (socket) => {
  let currentRoom = null;
  let playerColor = null;

  socket.on('create_room', ({ pseudo, activeColors }) => {
    const roomCode = Math.random().toString(36).substring(2, 8).toUpperCase();
    const colors = activeColors || ['green', 'red'];
    
    const room = {
      code: roomCode,
      players: {
        [colors[0]]: { id: socket.id, pseudo: pseudo || 'Joueur 1', isBot: false }
      },
      activeColors: colors,
      state: createInitialState(colors)
    };

    colors.slice(1).forEach((col, idx) => {
      room.players[col] = { id: `bot_${idx}`, pseudo: `Bot ${col}`, isBot: true };
    });

    rooms.set(roomCode, room);
    currentRoom = roomCode;
    playerColor = colors[0];

    socket.join(roomCode);
    socket.emit('room_created', { roomCode, color: playerColor, gameState: room.state });
    checkBotTurn(roomCode);
  });

  socket.on('join_room', ({ roomCode, pseudo }) => {
    const room = rooms.get(roomCode?.toUpperCase());
    if (!room) {
      socket.emit('error_msg', 'Partie introuvable.');
      return;
    }

    const availableColor = room.activeColors.find(c => room.players[c]?.isBot);
    if (!availableColor) {
      socket.emit('error_msg', 'La partie est déjà complète.');
      return;
    }

    room.players[availableColor] = { id: socket.id, pseudo: pseudo || 'Joueur 2', isBot: false };
    currentRoom = room.code;
    playerColor = availableColor;

    socket.join(room.code);
    io.to(room.code).emit('game_started', { gameState: room.state, players: room.players });
    checkBotTurn(room.code);
  });

  socket.on('roll_dice', () => {
    if (!currentRoom) return;
    const room = rooms.get(currentRoom);
    if (!room) return;

    const state = room.state;
    if (state.turn !== playerColor || state.diceRolled) return;

    const diceValue = Math.floor(Math.random() * 6) + 1;
    state.dice = diceValue;
    state.diceRolled = true;

    const moves = getPlayableMoves(state, playerColor, diceValue);

    if (moves.length === 0) {
      io.to(currentRoom).emit('dice_rolled', {
        color: playerColor,
        dice: diceValue,
        gameState: state,
        moves: [],
        skipped: true
      });

      setTimeout(() => {
        if (diceValue !== 6) nextTurn(state);
        else state.diceRolled = false;
        
        io.to(currentRoom).emit('turn_changed', { gameState: state });
        checkBotTurn(currentRoom);
      }, 1200);
    } else {
      io.to(currentRoom).emit('dice_rolled', {
        color: playerColor,
        dice: diceValue,
        gameState: state,
        moves: moves,
        skipped: false
      });
    }
  });

  socket.on('move_pawn', ({ pawnId }) => {
    if (!currentRoom) return;
    const room = rooms.get(currentRoom);
    if (!room) return;

    const state = room.state;
    if (state.turn !== playerColor || !state.diceRolled) return;

    const lastDice = state.dice;
    const { steps, captures } = applyPawnMove(state, playerColor, pawnId);

    io.to(currentRoom).emit('pawn_moved', {
      color: playerColor,
      pawnId: pawnId,
      steps: steps,
      captures: captures,
      gameState: state
    });

    if (lastDice === 6) {
      state.diceRolled = false;
      state.dice = null;
    } else {
      nextTurn(state);
    }
    
    io.to(currentRoom).emit('turn_changed', { gameState: state });
    checkBotTurn(currentRoom);
  });

  socket.on('disconnect', () => {
    if (currentRoom) {
      const room = rooms.get(currentRoom);
      if (room && room.players[playerColor]) {
        room.players[playerColor].isBot = true;
      }
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Serveur démarré sur le port ${PORT}`));