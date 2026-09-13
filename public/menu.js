'use me';
'use strict';
const Menu = (() => {
  let socket = null;
  let selectedCount = 4;
  let selectedMode  = 'human';

  function $(id) { return document.getElementById(id); }
  function show(id) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    $(id).classList.add('active');
  }

  function initSocket() {
    socket = io({ transports: ['websocket', 'polling'] });

    socket.on('connect', () => {
      const token = localStorage.getItem('ludo_token');
      if (token) socket.emit('reconnect_token', { token });
    });

    socket.on('error', ({ message }) => {
      if ($('join-error')) $('join-error').textContent = message || 'Erreur serveur';
    });
    socket.on('error_msg', (msg) => {
      if ($('join-error')) $('join-error').textContent = typeof msg === 'string' ? msg : (msg?.message || 'Erreur serveur');
    });

    socket.on('room_created', (data) => {
      const code = data.code || data.roomCode;
      const color = data.color || 'red';
      const token = data.token || '';
      const pseudo = data.pseudo || data.nickname || 'Joueur1';

      if (token) localStorage.setItem('ludo_token', token);
      localStorage.setItem('ludo_color', color);
      localStorage.setItem('ludo_pseudo', pseudo);

      if ($('room-code-display')) $('room-code-display').textContent = code;
      if ($('create-waiting')) $('create-waiting').style.display = 'flex';
      if ($('btn-do-create')) $('btn-do-create').style.display = 'none';
      
      updateWaitingList({ [color]: { pseudo, isBot: false } });
    });

    socket.on('player_joined', (data) => {
      if (data.players) {
        updateWaitingList(data.players);
      } else if (data.color) {
        const currentList = {};
        currentList[data.color] = { pseudo: data.pseudo || 'Joueur', isBot: false };
        updateWaitingList(currentList);
      }
    });

    socket.on('room_joined', (data) => {
      const code = data.code || data.roomCode;
      const color = data.color || 'blue';
      const token = data.token || '';
      const pseudo = data.pseudo || data.nickname || 'Joueur';

      if (token) localStorage.setItem('ludo_token', token);
      localStorage.setItem('ludo_color', color);
      localStorage.setItem('ludo_pseudo', pseudo);
    });

    const handleGameStart = (payload) => {
      if (typeof Audio !== 'undefined' && Audio.playStart) Audio.playStart();
      const waitingBox = $('create-waiting');
      if (waitingBox) waitingBox.style.display = 'none';
      if (typeof Game !== 'undefined' && Game.init) Game.init(socket, payload);
      show('screen-game');
    };

    socket.on('game_start', handleGameStart);
    socket.on('game_started', handleGameStart);

    socket.on('reconnected', (payload) => {
      if (typeof Game !== 'undefined' && Game.init) Game.init(socket, payload, true);
      show('screen-game');
    });

    const gameEvents = ['dice_rolled','move_made','pawn_moved','turn_changed','game_over','opponent_disconnected','opponent_reconnected','rematch_requested','rematch_start'];
    gameEvents.forEach(ev => socket.on(ev, data => {
      if (typeof Game !== 'undefined' && Game.onEvent) Game.onEvent(ev, data);
    }));
  }

  function updateWaitingList(players) {
    const el = $('players-waiting-list');
    if (!el || !players) return;
    const colorNames = { red:'Rouge 🔴', blue:'Bleu 🔵', green:'Vert 🟢', yellow:'Jaune 🟡' };
    const bgColors   = { red:'rgba(231,76,60,.25)', blue:'rgba(52,152,219,.25)', green:'rgba(46,204,113,.25)', yellow:'rgba(241,196,15,.25)' };
    
    el.innerHTML = Object.entries(players).map(([c, p]) => {
      const name = p.pseudo || p.nickname || 'Joueur';
      return `<div class="player-waiting-chip" style="background:${bgColors[c] || 'rgba(255,255,255,.1)'}">${colorNames[c] || c} : ${name}${p.isBot ? ' 🤖' : ''}</div>`;
    }).join('');
  }

  function bindNav() {
    $('btn-create')?.addEventListener('click', () => { if (typeof Audio !== 'undefined') Audio.playClick(); show('screen-create'); });
    $('btn-join')?.addEventListener('click',   () => { if (typeof Audio !== 'undefined') Audio.playClick(); show('screen-join'); });
    $('btn-rules')?.addEventListener('click',  () => { if (typeof Audio !== 'undefined') Audio.playClick(); show('screen-rules'); });
    $('btn-options')?.addEventListener('click',() => { if (typeof Audio !== 'undefined') Audio.playClick(); show('screen-options'); });

    ['create','join','rules','options'].forEach(name => {
      $(`back-${name}`)?.addEventListener('click', () => { if (typeof Audio !== 'undefined') Audio.playClick(); show('screen-menu'); });
    });

    document.querySelectorAll('.count-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.count-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        selectedCount = parseInt(btn.dataset.count, 10);
        if (typeof Audio !== 'undefined') Audio.playClick();
      });
    });

    document.querySelectorAll('.mode-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        selectedMode = btn.dataset.mode;
        if (typeof Audio !== 'undefined') Audio.playClick();
      });
    });

    $('btn-do-create')?.addEventListener('click', () => {
      const pseudo = $('create-pseudo').value.trim() || 'Joueur1';
      if (typeof Audio !== 'undefined') Audio.playClick();
      socket.emit('create_room', {
        pseudo,
        nickname: pseudo,
        playerCount: selectedCount,
        withBots: selectedMode === 'bot',
      });
    });

    $('btn-copy-code')?.addEventListener('click', () => {
      const code = $('room-code-display').textContent;
      navigator.clipboard?.writeText(code).catch(() => {});
      $('btn-copy-code').textContent = '✓ Copié !';
      setTimeout(() => { $('btn-copy-code').textContent = '📋 Copier'; }, 2000);
    });

    $('btn-do-join')?.addEventListener('click', doJoin);
    $('join-code')?.addEventListener('keydown', e => { if (e.key === 'Enter') doJoin(); });
    $('join-code')?.addEventListener('input', e => {
      e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,6);
    });

    $('opt-sound')?.addEventListener('change', e => { if (typeof Audio !== 'undefined') { Audio.setSfx(e.target.checked); Audio.playClick(); } });
    $('opt-music')?.addEventListener('change', e => { if (typeof Audio !== 'undefined') { Audio.init(); Audio.setMusic(e.target.checked); } });

    $('btn-rematch')?.addEventListener('click', () => {
      socket.emit('request_rematch');
      $('btn-rematch').textContent = '⏳ En attente…';
      $('btn-rematch').disabled = true;
    });
    $('btn-menu-from-game')?.addEventListener('click', () => { if (typeof Audio !== 'undefined') Audio.playClick(); resetLobby(); show('screen-menu'); });
    $('btn-disconnect-menu')?.addEventListener('click', () => { if (typeof Audio !== 'undefined') Audio.playClick(); resetLobby(); show('screen-menu'); });
  }

  function doJoin() {
    const pseudo = $('join-pseudo').value.trim() || 'Joueur2';
    const code   = $('join-code').value.toUpperCase().trim();
    if ($('join-error')) $('join-error').textContent = '';
    if (code.length < 4 || code.length > 6) { 
      if ($('join-error')) $('join-error').textContent = 'Le code doit contenir entre 4 et 6 caractères'; 
      return; 
    }
    if (typeof Audio !== 'undefined') Audio.playClick();
    socket.emit('join_room', { code, roomCode: code, pseudo, nickname: pseudo });
  }

  function resetLobby() {
    localStorage.removeItem('ludo_token');
    localStorage.removeItem('ludo_color');
    localStorage.removeItem('ludo_pseudo');
    if ($('modal-gameover')) $('modal-gameover').style.display   = 'none';
    if ($('modal-disconnect')) $('modal-disconnect').style.display = 'none';
    if ($('create-waiting')) $('create-waiting').style.display   = 'none';
    if ($('btn-do-create')) $('btn-do-create').style.display    = '';
    if ($('btn-rematch')) {
      $('btn-rematch').textContent = '🔄 Rejouer';
      $('btn-rematch').disabled    = false;
    }
    if ($('join-error')) $('join-error').textContent          = '';
    if ($('join-code')) $('join-code').value                 = '';
    if ($('rematch-status')) $('rematch-status').textContent      = '';
    if ($('players-waiting-list')) $('players-waiting-list').innerHTML  = '';
  }

  function init() {
    initSocket();
    bindNav();
    setTimeout(() => show('screen-menu'), 1900);
  }

  document.addEventListener('DOMContentLoaded', init);
  return { show, resetLobby, getSocket: () => socket };
})();