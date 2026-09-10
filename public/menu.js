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
      $('join-error').textContent = message || 'Erreur serveur';
    });

    socket.on('room_created', ({ code, color, token, pseudo, withBots }) => {
      localStorage.setItem('ludo_token', token);
      localStorage.setItem('ludo_color', color);
      localStorage.setItem('ludo_pseudo', pseudo);
      $('room-code-display').textContent = code;
      $('create-waiting').style.display = 'flex';
      $('btn-do-create').style.display = 'none';
      updateWaitingList({ [color]: { pseudo, isBot: false } });
    });

    socket.on('player_joined', ({ color, pseudo, players }) => {
      updateWaitingList(players);
    });

    socket.on('room_joined', ({ code, color, token, pseudo }) => {
      localStorage.setItem('ludo_token', token);
      localStorage.setItem('ludo_color', color);
      localStorage.setItem('ludo_pseudo', pseudo);
    });

    socket.on('game_start', (payload) => {
      Audio.playStart();
      const waitingBox = $('create-waiting');
      if (waitingBox) waitingBox.style.display = 'none';
      Game.init(socket, payload);
      show('screen-game');
    });

    socket.on('reconnected', (payload) => {
      Game.init(socket, payload, true);
      show('screen-game');
    });

    const gameEvents = ['dice_rolled','move_made','game_over','opponent_disconnected','opponent_reconnected','rematch_requested','rematch_start'];
    gameEvents.forEach(ev => socket.on(ev, data => Game.onEvent(ev, data)));
  }

  function updateWaitingList(players) {
    const el = $('players-waiting-list');
    if (!el) return;
    const colorNames = { red:'Rouge 🔴', blue:'Bleu 🔵', green:'Vert 🟢', yellow:'Jaune 🟡' };
    const bgColors   = { red:'rgba(231,76,60,.25)', blue:'rgba(52,152,219,.25)', green:'rgba(46,204,113,.25)', yellow:'rgba(241,196,15,.25)' };
    el.innerHTML = Object.entries(players).map(([c, p]) =>
      `<div class="player-waiting-chip" style="background:${bgColors[c]}">${colorNames[c]} : ${p.pseudo}${p.isBot ? ' 🤖' : ''}</div>`
    ).join('');
  }

  function bindNav() {
    $('btn-create').addEventListener('click', () => { Audio.playClick(); show('screen-create'); });
    $('btn-join').addEventListener('click',   () => { Audio.playClick(); show('screen-join'); });
    $('btn-rules').addEventListener('click',  () => { Audio.playClick(); show('screen-rules'); });
    $('btn-options').addEventListener('click',() => { Audio.playClick(); show('screen-options'); });

    ['create','join','rules','options'].forEach(name => {
      $(`back-${name}`)?.addEventListener('click', () => { Audio.playClick(); show('screen-menu'); });
    });

    document.querySelectorAll('.count-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.count-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        selectedCount = parseInt(btn.dataset.count, 10);
        Audio.playClick();
      });
    });

    document.querySelectorAll('.mode-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        selectedMode = btn.dataset.mode;
        Audio.playClick();
      });
    });

    $('btn-do-create').addEventListener('click', () => {
      const pseudo = $('create-pseudo').value.trim() || 'Joueur1';
      Audio.playClick();
      socket.emit('create_room', {
        pseudo,
        playerCount: selectedCount,
        withBots: selectedMode === 'bot',
      });
    });

    $('btn-copy-code').addEventListener('click', () => {
      const code = $('room-code-display').textContent;
      navigator.clipboard?.writeText(code).catch(() => {});
      $('btn-copy-code').textContent = '✓ Copié !';
      setTimeout(() => { $('btn-copy-code').textContent = '📋 Copier'; }, 2000);
    });

    $('btn-do-join').addEventListener('click', doJoin);
    $('join-code').addEventListener('keydown', e => { if (e.key === 'Enter') doJoin(); });
    $('join-code').addEventListener('input', e => {
      e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,6);
    });

    $('opt-sound').addEventListener('change', e => { Audio.setSfx(e.target.checked); Audio.playClick(); });
    $('opt-music').addEventListener('change', e => { Audio.init(); Audio.setMusic(e.target.checked); });

    $('btn-rematch').addEventListener('click', () => {
      socket.emit('request_rematch');
      $('btn-rematch').textContent = '⏳ En attente…';
      $('btn-rematch').disabled = true;
    });
    $('btn-menu-from-game').addEventListener('click', () => { Audio.playClick(); resetLobby(); show('screen-menu'); });
    $('btn-disconnect-menu').addEventListener('click', () => { Audio.playClick(); resetLobby(); show('screen-menu'); });
  }

  function doJoin() {
    const pseudo = $('join-pseudo').value.trim() || 'Joueur2';
    const code   = $('join-code').value.toUpperCase().trim();
    $('join-error').textContent = '';
    if (code.length !== 6) { $('join-error').textContent = 'Le code doit faire 6 caractères'; return; }
    Audio.playClick();
    socket.emit('join_room', { code, pseudo });
  }

  function resetLobby() {
    localStorage.removeItem('ludo_token');
    localStorage.removeItem('ludo_color');
    localStorage.removeItem('ludo_pseudo');
    $('modal-gameover').style.display   = 'none';
    $('modal-disconnect').style.display = 'none';
    $('create-waiting').style.display   = 'none';
    $('btn-do-create').style.display    = '';
    $('btn-rematch').textContent         = '🔄 Rejouer';
    $('btn-rematch').disabled            = false;
    $('join-error').textContent          = '';
    $('join-code').value                 = '';
    $('rematch-status').textContent      = '';
    $('players-waiting-list').innerHTML  = '';
  }

  function init() {
    initSocket();
    bindNav();
    setTimeout(() => show('screen-menu'), 1900);
  }

  document.addEventListener('DOMContentLoaded', init);
  return { show, resetLobby, getSocket: () => socket };
})();