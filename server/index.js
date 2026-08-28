import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { WebSocketServer } from 'ws';

import { MODES, MODE_IDS, getMode } from './modes.js';
import { Room } from './room.js';
import { CMD, decodeCommand } from './protocol.js';
import { sanitizeName, sanitizeChat, sanitizeSkin } from './sanitize.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PORT = process.env.PORT || 3000;
const TICK_RATE = Number(process.env.TICK_RATE || 25); // pas de simulation / s
// 20 snapshots/s. Le client rend legerement dans le passe pour absorber la
// gigue (cf. net.js), et ce retard vaut ~1,5 intervalle : baisser cette valeur
// economise de la bande passante mais allonge d'autant la latence percue.
// 15 reste jouable si le reseau est la contrainte principale.
const NET_RATE = Number(process.env.NET_RATE || 20); // snapshots / s
const LB_RATE = 2; // leaderboard + roster / s

export const SKINS = [
  'solid', 'ring', 'stripes', 'dots', 'star', 'eye', 'slice', 'target',
];

// --- Salons ------------------------------------------------------------------
/** @type {Map<string, Room>} */
const rooms = new Map();
for (const id of MODE_IDS) {
  rooms.set(id, new Room(getMode(id), { tickRate: TICK_RATE }));
}

// Historique de chat par salon (rejoue a l'arrivee).
const chatLogs = new Map(MODE_IDS.map((id) => [id, []]));
const CHAT_HISTORY = 30;
const CHAT_COOLDOWN_MS = 1200;

// --- HTTP --------------------------------------------------------------------
const app = express();
app.disable('x-powered-by');

app.use(
  express.static(path.join(__dirname, '..', 'public'), {
    maxAge: process.env.NODE_ENV === 'production' ? '1h' : 0,
    setHeaders(res, filePath) {
      // index.html doit toujours etre revalide, sinon un deploiement ne se voit pas.
      if (filePath.endsWith('index.html')) res.setHeader('Cache-Control', 'no-cache');
    },
  }),
);

app.get('/healthz', (_req, res) => res.type('text').send('ok'));

app.get('/api/modes', (_req, res) => {
  res.json(
    MODE_IDS.map((id) => {
      const m = MODES[id];
      const room = rooms.get(id);
      const s = room.stats();
      return {
        id,
        label: m.label,
        desc: m.desc,
        color: m.color,
        icon: m.icon,
        maxPlayers: m.maxPlayers,
        players: s.players,
        humans: s.humans,
        world: m.world,
        startMass: m.startMass,
        cannon: Boolean(m.cannon),
        xpMul: m.xpMul,
      };
    }),
  );
});

const server = http.createServer(app);

// --- WebSocket ---------------------------------------------------------------
const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 4096 });

/** @type {Map<import('ws').WebSocket, {roomId: string, playerId: number}>} */
const sockets = new Map();

wss.on('connection', (ws) => {
  ws.isAlive = true;
  ws.binaryType = 'arraybuffer';
  ws.on('pong', () => {
    ws.isAlive = true;
  });

  let bound = null; // { roomId, playerId }

  const send = (obj) => {
    if (ws.readyState === 1) ws.send(JSON.stringify(obj));
  };

  send({ t: 'hello', modes: MODE_IDS, skins: SKINS, tickRate: TICK_RATE, netRate: NET_RATE });

  ws.on('message', (data, isBinary) => {
    try {
      if (isBinary) return handleBinary(data);
      handleJson(JSON.parse(data.toString()));
    } catch {
      /* paquet malforme : on ignore, pas de raison de tuer la connexion */
    }
  });

  function handleBinary(data) {
    if (!bound) return;
    const room = rooms.get(bound.roomId);
    const p = room?.players.get(bound.playerId);
    if (!p) return;
    const cmd = decodeCommand(new Uint8Array(data));
    if (!cmd) return;
    if (cmd.op === CMD.TARGET) room.setTarget(p, cmd.x, cmd.y);
    else if (cmd.op === CMD.SPLIT) room.doSplit(p);
    else if (cmd.op === CMD.EJECT) room.doEject(p);
  }

  function handleJson(msg) {
    if (!msg || typeof msg.t !== 'string') return;

    if (msg.t === 'join') {
      leave();
      const modeId = MODE_IDS.includes(msg.mode) ? msg.mode : 'classique';
      const room = rooms.get(modeId);
      const mode = getMode(modeId);
      const p = room.addPlayer({
        name: sanitizeName(msg.name),
        skin: sanitizeSkin(msg.skin, SKINS),
        colorIdx: Number.isInteger(msg.color) ? msg.color : undefined,
        ws,
      });
      room.ensureBots(); // le salon dormait : on le repeuple a l'arrivee du 1er joueur
      room.spawnPlayer(p);
      bound = { roomId: modeId, playerId: p.id };
      sockets.set(ws, bound);

      send({
        t: 'welcome',
        id: p.id,
        mode: {
          id: modeId,
          label: mode.label,
          desc: mode.desc,
          color: mode.color,
          world: mode.world,
          maxCells: mode.maxCells,
          cannon: mode.cannon ? { minMass: mode.cannon.minMass, cost: mode.cannon.cost } : null,
          startMass: mode.startMass,
          virusEatMinMass: mode.virusEatMinMass,
          splitMinMass: mode.splitMinMass,
          ejectMinMass: mode.ejectMinMass,
        },
        name: p.name,
        color: p.color,
        skin: p.skin,
      });
      send({ t: 'chatlog', items: chatLogs.get(modeId).slice(-CHAT_HISTORY) });
      broadcastSystem(modeId, `${p.name} a rejoint la partie`);
      return;
    }

    if (!bound) return;
    const room = rooms.get(bound.roomId);
    const p = room?.players.get(bound.playerId);
    if (!p) return;

    if (msg.t === 'respawn') {
      if (!p.alive) room.spawnPlayer(p);
      return;
    }

    if (msg.t === 'chat') {
      const text = sanitizeChat(msg.m);
      if (!text) return;
      const now = Date.now();
      if (now - p.lastChatAt < CHAT_COOLDOWN_MS) return; // anti-spam
      p.lastChatAt = now;
      pushChat(bound.roomId, { n: p.name, c: p.color, m: text, at: now });
      return;
    }

    if (msg.t === 'leave') {
      leave();
      return;
    }
  }

  function leave() {
    if (!bound) return;
    const room = rooms.get(bound.roomId);
    const p = room?.players.get(bound.playerId);
    if (p) {
      broadcastSystem(bound.roomId, `${p.name} a quitte la partie`);
      room.removePlayer(bound.playerId);
      // Dernier humain parti : on rend le salon au repos, bots compris.
      if (room.humans === 0) room.clearBots();
    }
    sockets.delete(ws);
    bound = null;
  }

  ws.on('close', leave);
  ws.on('error', leave);
});

function pushChat(roomId, entry) {
  const log = chatLogs.get(roomId);
  log.push(entry);
  if (log.length > CHAT_HISTORY) log.shift();
  const payload = JSON.stringify({ t: 'chat', ...entry });
  for (const [ws, b] of sockets) {
    if (b.roomId === roomId && ws.readyState === 1) ws.send(payload);
  }
}

function broadcastSystem(roomId, text) {
  const payload = JSON.stringify({ t: 'sys', m: text, at: Date.now() });
  for (const [ws, b] of sockets) {
    if (b.roomId === roomId && ws.readyState === 1) ws.send(payload);
  }
}

// --- Boucles -----------------------------------------------------------------
// Simulation : pas fixe, rattrapage borne pour ne pas spirale-of-death.
let last = Date.now();
let acc = 0;
const STEP_MS = 1000 / TICK_RATE;

setInterval(() => {
  const now = Date.now();
  acc += now - last;
  last = now;
  if (acc > STEP_MS * 5) acc = STEP_MS * 5; // on abandonne le retard au-dela de 5 pas
  while (acc >= STEP_MS) {
    for (const room of rooms.values()) {
      // Un salon vide n'est pas simule : sans ca, trois arenes et une centaine
      // de bots tournent en permanence pour personne. Sur un petit hebergement
      // (0.1 CPU) c'est la moitie du quota brulee au repos.
      if (room.humans === 0) continue;
      room.step();
    }
    acc -= STEP_MS;
  }
}, STEP_MS);

// Snapshots binaires
setInterval(() => {
  for (const [ws, b] of sockets) {
    if (ws.readyState !== 1 || ws.bufferedAmount > 512 * 1024) continue;
    const room = rooms.get(b.roomId);
    const p = room?.players.get(b.playerId);
    if (!p) continue;
    const { buf, cam } = room.snapshotFor(p);
    ws.send(buf, { binary: true });
    // La camera part en JSON : c'est 1 petit message, pas la peine de le binariser.
    ws.send(
      JSON.stringify({
        t: 'cam',
        x: Math.round(cam.x),
        y: Math.round(cam.y),
        s: Math.round(p.score),
        n: p.cells.length,
      }),
    );
  }
}, 1000 / NET_RATE);

// Leaderboard + roster
setInterval(() => {
  const lbCache = new Map();
  for (const [ws, b] of sockets) {
    if (ws.readyState !== 1) continue;
    const room = rooms.get(b.roomId);
    const p = room?.players.get(b.playerId);
    if (!p) continue;
    if (!lbCache.has(b.roomId)) lbCache.set(b.roomId, room.leaderboard(10));
    ws.send(
      JSON.stringify({
        t: 'lb',
        items: lbCache.get(b.roomId),
        roster: room.rosterFor(p),
        players: room.stats().players,
      }),
    );
  }
}, 1000 / LB_RATE);

// Keepalive : Render coupe les connexions inactives.
setInterval(() => {
  for (const ws of wss.clients) {
    if (ws.isAlive === false) {
      ws.terminate();
      continue;
    }
    ws.isAlive = false;
    ws.ping();
  }
}, 30000);

server.listen(PORT, () => {
  console.log(`[agarium] http://localhost:${PORT}  (ws sur /ws)`);
  console.log(`[agarium] modes: ${MODE_IDS.join(', ')} | tick ${TICK_RATE}Hz | net ${NET_RATE}Hz`);
});

for (const sig of ['SIGTERM', 'SIGINT']) {
  process.on(sig, () => {
    console.log(`[agarium] ${sig} recu, arret.`);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 3000).unref();
  });
}
