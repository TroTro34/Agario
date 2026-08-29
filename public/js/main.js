// Point d'entree : cable le reseau, le rendu, l'interface et les entrees.

import { Net } from './net.js';
import { Renderer } from './render.js';
import { UI } from './ui.js';

const canvas = document.getElementById('game');
const ui = new UI();
const renderer = new Renderer(canvas, {
  arena: ui.prefs.arena,
  showGrid: ui.prefs.grid,
  showMass: ui.prefs.mass,
});

let worldSize = 14142;
let inGame = false;
let spectating = false;
let cam = { x: worldSize / 2, y: worldSize / 2 };

// Position du curseur en pixels ecran ; convertie en coordonnees monde a l'envoi.
const pointer = { x: window.innerWidth / 2, y: window.innerHeight / 2 };

// --- Reseau ------------------------------------------------------------------
const net = new Net({
  open() {
    ui.setConn('Connecte', 'ok');
    retryDelay = 1000;
  },
  close() {
    ui.setConn('Deconnecte — nouvelle tentative…', 'err');
    inGame = false;
    scheduleReconnect();
  },
  error() {
    ui.setConn('Erreur de connexion', 'err');
  },
  welcome(msg) {
    worldSize = msg.mode.world;
    inGame = true;
    ui.showGame(msg.mode);
  },
  chat(msg) {
    ui.addChat(msg);
  },
  sys(msg) {
    ui.addSystem(msg.m);
  },
  chatlog(msg) {
    for (const it of msg.items) ui.addChat(it);
  },
  leaderboard() {
    ui.setLeaderboard(net.leaderboard, net.selfId);
  },
  dead(msg) {
    inGame = false;
    if (!spectating) ui.showDead(msg);
  },
});

net.connect();

let retryDelay = 1000;
let retryTimer = null;
function scheduleReconnect() {
  clearTimeout(retryTimer);
  retryTimer = setTimeout(() => {
    net.connect();
    retryDelay = Math.min(retryDelay * 1.6, 15000); // backoff : on n'inonde pas le serveur
  }, retryDelay);
}

// --- Liste des modes ---------------------------------------------------------
async function loadModes() {
  try {
    const res = await fetch('/api/modes');
    const modes = await res.json();
    if (!ui.modes.length) ui.setModes(modes);
    else ui.updateModeCounts(modes);
  } catch {
    ui.setConn('Serveur injoignable', 'err');
  }
}
loadModes();
setInterval(() => {
  if (!inGame) loadModes();
}, 5000);

// --- Boutons -----------------------------------------------------------------
function startGame() {
  const name = ui.el.nick.value.trim();
  ui.prefs.name = name;
  ui.savePrefs();
  spectating = false;
  ui.el.chatLog.replaceChildren();
  net.join({ name, skin: ui.prefs.skin, mode: ui.prefs.mode, color: ui.prefs.color });
}

ui.el.play.addEventListener('click', startGame);

ui.el.spectate.addEventListener('click', () => {
  spectating = true;
  ui.el.chatLog.replaceChildren();
  net.join({ name: ui.el.nick.value.trim(), skin: ui.prefs.skin, mode: ui.prefs.mode, color: ui.prefs.color });
  // On rejoint puis on meurt volontairement : la camera bascule sur le leader.
  setTimeout(() => ui.showGame(net.mode), 60);
});

ui.el.again.addEventListener('click', () => {
  ui.el.dead.classList.add('hidden');
  net.respawn();
  inGame = true;
});

function returnToMenu() {
  net.leave();
  inGame = false;
  spectating = false;
  renderer.resetZoom();
  ui.showMenu();
  loadModes();
}

ui.el.toMenu.addEventListener('click', returnToMenu);

// --- Reglages ----------------------------------------------------------------
ui.el.optArena.addEventListener('change', (e) => {
  ui.prefs.arena = e.target.checked ? 'light' : 'dark';
  renderer.setArena(ui.prefs.arena);
  ui.savePrefs();
});
ui.el.optGrid.addEventListener('change', (e) => {
  ui.prefs.grid = e.target.checked;
  renderer.showGrid = e.target.checked;
  ui.savePrefs();
});
ui.el.optMass.addEventListener('change', (e) => {
  ui.prefs.mass = e.target.checked;
  renderer.showMass = e.target.checked;
  ui.savePrefs();
});

// --- Entrees -----------------------------------------------------------------
canvas.addEventListener('mousemove', (e) => {
  pointer.x = e.clientX;
  pointer.y = e.clientY;
});

// Molette : zoom manuel, par paliers multiplicatifs pour que la sensation soit
// la meme quel que soit le niveau de zoom courant.
canvas.addEventListener(
  'wheel',
  (e) => {
    e.preventDefault();
    renderer.zoomBy(e.deltaY < 0 ? 1.12 : 1 / 1.12);
  },
  { passive: false },
);

canvas.addEventListener(
  'touchmove',
  (e) => {
    const t = e.touches[0];
    if (!t) return;
    pointer.x = t.clientX;
    pointer.y = t.clientY;
    e.preventDefault();
  },
  { passive: false },
);

ui.el.chatForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const text = ui.el.chatInput.value.trim();
  if (text) net.chat(text);
  ui.closeChat();
});

window.addEventListener('keydown', (e) => {
  // Quand le chat est ouvert, le clavier lui appartient entierement.
  if (ui.chatOpen) {
    if (e.key === 'Escape') ui.closeChat();
    return;
  }
  if (document.activeElement === ui.el.nick) {
    if (e.key === 'Enter') startGame();
    return;
  }

  // Echap quitte la partie. Traite avant le test `inGame` pour fonctionner
  // aussi depuis l'ecran de mort et le mode spectateur.
  if (e.key === 'Escape') {
    e.preventDefault();
    if (!ui.el.menu.classList.contains('hidden')) return; // deja au menu
    returnToMenu();
    return;
  }

  if (!inGame) return;

  if (e.key === 'Enter') {
    e.preventDefault();
    ui.openChat();
  } else if (e.code === 'Space') {
    e.preventDefault();
    if (!e.repeat) net.sendSplit();
  } else if (e.key.toLowerCase() === 'w') {
    // On teste `key` (la lettre reellement marquee) et NON `code`, qui designe
    // la position physique sur un clavier QWERTY. Sur un AZERTY, la touche
    // marquee W se trouve a la position du Z de QWERTY : elle emet donc
    // `KeyZ`, et un test sur `code === 'KeyW'` ne se declenche jamais.
    e.preventDefault();
    net.sendEject(); // repetition autorisee : utile pour nourrir et pour tirer
  }
});

// --- Boucles -----------------------------------------------------------------

// Cible visee, en coordonnees monde. Recalculee a chaque image : elle sert a la
// fois a la prediction locale et a ce qu'on envoie au serveur.
let aim = null;

// Envoi de la cible : 30 Hz suffisent, inutile de saturer la socket a 60.
setInterval(() => {
  if (!inGame || !net.connected || !aim) return;
  net.sendTarget(aim.x, aim.y);
}, 1000 / 30);

function frame(now) {
  // La cible depend de la camera de l'image precedente. La boucle est donc
  // rompue d'une image, ce qui est imperceptible et evite toute recursion.
  aim = renderer.toWorld(pointer.x, pointer.y, cam);

  cam = net.interpolate(now, inGame ? aim : null);
  renderer.render(net, cam, worldSize);

  if (!ui.el.hud.classList.contains('hidden')) {
    renderer.drawMinimap(ui.el.minimap, net, cam, worldSize);
    ui.setStats({ score: net.score, cells: net.cellCount, players: net.playerCount });
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
