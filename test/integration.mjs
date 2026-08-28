// Test d'integration : parle au serveur en WebSocket comme le ferait le navigateur.
// Verifie join / snapshots / split / eject-tir / chat, pour les trois modes.
//
//   node test/integration.mjs            (le serveur doit tourner sur :3000)
//   PORT=4000 node test/integration.mjs

import WebSocket from 'ws';

const PORT = process.env.PORT || 3000;
const URL = `ws://localhost:${PORT}/ws`;
const KIND = { FOOD: 0, CELL: 1, VIRUS: 2, EJECTED: 3, BULLET: 4 };
const CMD = { TARGET: 0, SPLIT: 1, EJECT: 2 };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function decode(buf) {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let o = 0;
  if (dv.getUint8(o) !== 1) return null;
  o += 3;
  const n = dv.getUint16(o, true);
  o += 2;
  const counts = { food: 0, cell: 0, virus: 0, ejected: 0, bullet: 0 };
  const mine = [];
  for (let i = 0; i < n; i++) {
    const kind = dv.getUint8(o);
    o += 1;
    const id = dv.getUint16(o, true);
    o += 2;
    const x = dv.getUint16(o, true);
    o += 2;
    const y = dv.getUint16(o, true);
    o += 2;
    if (kind === KIND.CELL) {
      const r = dv.getUint16(o, true);
      o += 2;
      const owner = dv.getUint16(o, true);
      o += 2;
      counts.cell++;
      mine.push({ id, x, y, r, owner });
    } else if (kind === KIND.VIRUS) {
      o += 2;
      counts.virus++;
    } else {
      o += 1;
      if (kind === KIND.FOOD) counts.food++;
      else if (kind === KIND.EJECTED) counts.ejected++;
      else counts.bullet++;
    }
  }
  return { counts, mine, total: n };
}

function target(x, y) {
  const b = Buffer.alloc(9);
  b.writeUInt8(CMD.TARGET, 0);
  b.writeFloatLE(x, 1);
  b.writeFloatLE(y, 5);
  return b;
}

async function testMode(mode) {
  const ws = new WebSocket(URL);
  const state = {
    welcome: null,
    snapshots: 0,
    last: null,
    chat: [],
    cam: null,
    maxCells: 0,
    sawEjected: false,
    sawBullet: false,
    bytes: 0,
  };

  await new Promise((res, rej) => {
    ws.on('open', res);
    ws.on('error', rej);
  });

  ws.on('message', (data, isBinary) => {
    if (isBinary) {
      state.bytes += data.length;
      const d = decode(data);
      if (!d) return;
      state.snapshots++;
      state.last = d;
      if (d.counts.ejected) state.sawEjected = true;
      if (d.counts.bullet) state.sawBullet = true;
      const mineCells = d.mine.filter((c) => c.owner === state.welcome?.id).length;
      if (mineCells > state.maxCells) state.maxCells = mineCells;
    } else {
      const m = JSON.parse(data.toString());
      if (m.t === 'welcome') state.welcome = m;
      else if (m.t === 'cam') state.cam = m;
      else if (m.t === 'chat') state.chat.push(m);
    }
  });

  ws.send(JSON.stringify({ t: 'join', name: `Test_${mode}`, skin: 'star', mode, color: 3 }));
  await sleep(500);

  if (!state.welcome) throw new Error(`${mode}: pas de welcome`);

  // On vise loin pour bouger, puis on split, puis on ejecte / tire.
  const w = state.welcome.mode.world;
  ws.send(target(w / 2 + 800, w / 2));
  await sleep(400);
  const camBefore = state.cam ? { ...state.cam } : null;

  ws.send(Buffer.from([CMD.SPLIT]));
  await sleep(500);

  // L'espacement doit depasser le cooldown du canon (0,18 s en Demolition),
  // sinon un tir sur deux est avale et on teste le cooldown, pas le canon.
  for (let i = 0; i < 6; i++) {
    ws.send(Buffer.from([CMD.EJECT]));
    await sleep(220);
  }
  await sleep(400);

  ws.send(JSON.stringify({ t: 'chat', m: `bonjour depuis ${mode}` }));
  await sleep(300);
  // Deuxieme message immediat : doit etre avale par l'anti-spam.
  ws.send(JSON.stringify({ t: 'chat', m: 'spam immediat' }));
  await sleep(400);

  const camAfter = state.cam;
  const moved = camBefore && camAfter && (camAfter.x !== camBefore.x || camAfter.y !== camBefore.y);

  ws.close();

  const md = state.welcome.mode;
  return {
    mode,
    world: md.world,
    startMass: md.startMass,
    cannon: Boolean(md.cannon),
    // Les seuils decident du comportement attendu : a la masse de depart on ne
    // peut ni se diviser ni ejecter dans les modes classiques, et c'est voulu.
    canSplitAtSpawn: md.startMass >= md.splitMinMass,
    canEjectAtSpawn: md.cannon
      ? md.startMass >= md.cannon.minMass
      : md.startMass >= md.ejectMinMass,
    snapshots: state.snapshots,
    entities: state.last?.total ?? 0,
    kbPerSec: (state.bytes / 1024 / 2.6).toFixed(1),
    moved,
    maxCells: state.maxCells,
    sawProjectile: md.cannon ? state.sawBullet : state.sawEjected,
    chatReceived: state.chat.length,
  };
}

const results = [];
for (const mode of ['classique', 'hardcore', 'demolition']) {
  results.push(await testMode(mode));
}

let failed = 0;
const check = (cond, label) => {
  if (!cond) failed++;
  return cond ? 'OK  ' : 'FAIL';
};

console.log('');
for (const r of results) {
  console.log(`--- ${r.mode} ---`);
  console.log(`  monde ${r.world} | masse depart ${r.startMass} | canon ${r.cannon}`);
  console.log(`  ${check(r.snapshots > 20)} snapshots recus     : ${r.snapshots}`);
  console.log(`  ${check(r.entities > 80)} entites dans la vue : ${r.entities}`);
  console.log(`  ${check(r.moved)} la camera a bouge   : ${r.moved}`);

  // A la masse de depart, split et ejection ne sont autorises que si le mode
  // le permet. On verifie la regle, pas un comportement fixe.
  const splitOk = r.canSplitAtSpawn ? r.maxCells >= 2 : r.maxCells === 1;
  console.log(
    `  ${check(splitOk)} split au spawn      : ${r.maxCells} cellule(s)` +
      ` (autorise: ${r.canSplitAtSpawn})`,
  );

  const projOk = r.canEjectAtSpawn ? r.sawProjectile : !r.sawProjectile;
  const projLabel = r.cannon ? 'obus (W = tir)' : 'masse ejectee ';
  console.log(
    `  ${check(projOk)} ${projLabel}      : ${r.sawProjectile}` +
      ` (autorise: ${r.canEjectAtSpawn})`,
  );

  console.log(`  ${check(r.chatReceived === 1)} chat + anti-spam    : ${r.chatReceived}/2 recu`);
  console.log(`  bande passante approx : ${r.kbPerSec} ko/s`);
  console.log('');
}

console.log(failed === 0 ? 'TOUS LES TESTS PASSENT' : `${failed} VERIFICATION(S) EN ECHEC`);
process.exit(failed === 0 ? 0 : 1);
