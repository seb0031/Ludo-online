# 🐴 Petits Chevaux Online

Jeu des petits chevaux multijoueur en ligne, jouable de 2 à 4 joueurs sur téléphone, tablette ou PC.

## Stack technique
- Frontend : HTML5 Canvas + CSS3 + JavaScript Vanilla
- Backend : Node.js + Express
- Temps réel : Socket.IO
- Audio : Web Audio API (aucun asset externe)

## Fonctionnalités
- ✅ 2 à 4 joueurs en ligne
- ✅ Mode bots (IA) pour jouer seul ou compléter les places
- ✅ Reconnexion automatique par token
- ✅ Règles complètes (captures, safe, couloir final, 3 six = tour perdu)
- ✅ Design coloré et fun, mobile-first
- ✅ Sons synthétiques + musique générative

## Installation locale

```bash
npm install
npm start
# → http://localhost:3000
```

## Déploiement sur Render

1. Pusher sur GitHub (fichiers à la racine, pas dans un sous-dossier)
2. Créer un Web Service sur render.com
3. Build command : `npm install`
4. Start command : `npm start`
5. Render injecte `PORT` automatiquement

## Structure
```
ludo-online/
├── server/
│   ├── server.js       — Express + Socket.IO
│   ├── rooms.js        — Salons, bots, reconnexion
│   └── ludoEngine.js   — Logique complète du jeu
├── public/
│   ├── index.html
│   ├── style.css
│   ├── audio.js
│   ├── menu.js
│   └── game.js
├── package.json
└── README.md
```
