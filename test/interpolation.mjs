// Mesure la fluidite du rendu client, sans navigateur.
//
// On fabrique des snapshots d'une cellule en mouvement RECTILIGNE UNIFORME,
// espaces comme sur le reseau (avec de la gigue), on appelle interpolate() a
// 60 fps et on regarde le deplacement image par image.
//
// Sur un mouvement parfaitement regulier, chaque image devrait avancer d'a peu
// pres la meme distance. Les images figees (deplacement nul) sont exactement ce
// que le joueur percoit comme un saccadement.
//
//   node test/interpolation.mjs

import { Net, KIND } from '../public/js/net.js';
import { encodeSnapshot } from '../server/protocol.js';

const SELF = 7;
const SPEED = 600; // px/s, vitesse constante
const NET_HZ = 20;
const FPS = 60;
const DURATION = 6; // secondes simulees

function snapshotAt(timeSec) {
  // Une cellule a nous, plus quelques pastilles fixes.
  const ents = [
    { kind: KIND.CELL, id: 1, x: 1000 + SPEED * timeSec, y: 3000, r: 100, ownerId: SELF },
    { kind: KIND.FOOD, id: 2, x: 1500, y: 3100, color: 3 },
    { kind: KIND.FOOD, id: 3, x: 1800, y: 2900, color: 5 },
  ];
  return encodeSnapshot(ents, 0);
}

function run({ jitterMs, lossRate, label }) {
  const net = new Net();
  net.selfId = SELF;

  let clock = 0; // ms
  const nowStub = () => clock;
  const realNow = performance.now.bind(performance);
  performance.now = nowStub;

  const netInterval = 1000 / NET_HZ;
  const frameInterval = 1000 / FPS;

  // File des paquets : chacun porte son instant de jeu et son heure d'arrivee.
  // La gigue DECALE l'arrivee, elle ne supprime pas le paquet (seule lossRate
  // le fait) - c'est toute la difference entre simuler du retard et de la perte.
  const queue = [];
  for (let k = 0; k * netInterval < DURATION * 1000 + 500; k++) {
    if (Math.random() < lossRate) continue;
    const sent = k * netInterval;
    const jitter = Math.random() * jitterMs;
    queue.push({ gameTime: sent, arrival: sent + jitter });
  }
  queue.sort((a, b) => a.arrival - b.arrival);
  let head = 0;

  const deltas = [];
  let prevX = null;

  for (let f = 0; f < DURATION * FPS; f++) {
    clock = f * frameInterval;

    while (head < queue.length && queue[head].arrival <= clock) {
      const pkt = queue[head++];
      const saved = clock;
      clock = pkt.arrival; // le client horodate a la reception
      net._snapshot(snapshotAt(pkt.gameTime / 1000));
      clock = saved;
    }

    const cam = net.interpolate(clock);
    if (net.entities.size && cam.x > 0) {
      if (prevX !== null) deltas.push(cam.x - prevX);
      prevX = cam.x;
    }
  }

  performance.now = realNow;

  // On ignore la phase d'amorcage (le buffer doit se remplir).
  const d = deltas.slice(20);
  if (!d.length) return { label, frozen: 100, cv: 99, n: 0 };

  const mean = d.reduce((a, b) => a + b, 0) / d.length;
  const frozen = (d.filter((v) => Math.abs(v) < mean * 0.05).length / d.length) * 100;
  const variance = d.reduce((a, b) => a + (b - mean) ** 2, 0) / d.length;
  const cv = (Math.sqrt(variance) / Math.abs(mean)) * 100; // regularite, en %

  return { label, frozen, cv, mean, n: d.length };
}

// -----------------------------------------------------------------------------
// Prediction locale de nos propres cellules.
//
// Ici le serveur ET le client rejouent la meme physique. On verifie que notre
// cellule avance de facon continue image par image, y compris quand les paquets
// s'arretent un instant : c'est tout l'interet de la prediction. Sans elle, la
// cellule se fige des que le flux s'interrompt.
// -----------------------------------------------------------------------------

const R = 100; // rayon de notre cellule
const MOUSE = { x: 30000, y: 3000 }; // curseur loin a droite -> plein regime

function serverSpeed() {
  const mass = (R / 10) ** 2;
  return Math.max(42, 2.2 * Math.pow(mass, -0.439) * 940);
}

function runPredicted({ stallAt, stallMs, label }) {
  const net = new Net();
  net.selfId = SELF;
  net.speedMul = 1;
  net.worldSize = 40000;

  let clock = 0;
  const realNow = performance.now.bind(performance);
  performance.now = () => clock;

  // Position faisant autorite, integree comme le ferait le serveur (25 Hz).
  let sx = 1000;
  const sy = 3000;
  const sp = serverSpeed();
  let serverClock = 0;

  const frameInterval = 1000 / FPS;
  const netInterval = 1000 / NET_HZ;
  let nextPacket = 0;

  const deltas = [];
  let prevX = null;

  for (let f = 0; f < DURATION * FPS; f++) {
    clock = f * frameInterval;

    // Le serveur avance a pas fixes.
    while (serverClock + 40 <= clock) {
      serverClock += 40;
      const d = MOUSE.x - sx;
      if (d > 1) sx += Math.min(1, d / (R + 12)) * sp * 0.04;
    }

    // Emission des snapshots, avec eventuellement une coupure.
    while (nextPacket <= clock) {
      const inStall = stallMs > 0 && nextPacket >= stallAt && nextPacket < stallAt + stallMs;
      if (!inStall) {
        net._snapshot(
          encodeSnapshot(
            [{ kind: KIND.CELL, id: 1, x: Math.round(sx), y: sy, r: R, ownerId: SELF }],
            0,
          ),
        );
      }
      nextPacket += netInterval;
    }

    const cam = net.interpolate(clock, MOUSE);
    if (net.entities.size && cam.x > 0) {
      if (prevX !== null) deltas.push(cam.x - prevX);
      prevX = cam.x;
    }
  }

  performance.now = realNow;

  const d = deltas.slice(30);
  if (!d.length) return { label, frozen: 100, cv: 99 };
  const mean = d.reduce((a, b) => a + b, 0) / d.length;
  const frozen = (d.filter((v) => Math.abs(v) < mean * 0.05).length / d.length) * 100;
  const variance = d.reduce((a, b) => a + (b - mean) ** 2, 0) / d.length;
  return { label, frozen, cv: (Math.sqrt(variance) / Math.abs(mean)) * 100 };
}

const scenarios = [
  { label: 'reseau parfait      ', jitterMs: 0, lossRate: 0 },
  { label: 'gigue legere  +-8ms ', jitterMs: 8, lossRate: 0 },
  { label: 'gigue forte   +-25ms', jitterMs: 25, lossRate: 0 },
  { label: 'gigue + 5% de pertes', jitterMs: 25, lossRate: 0.05 },
];

console.log('');
console.log('Mouvement rectiligne uniforme, rendu a 60 fps, snapshots a ' + NET_HZ + ' Hz.');
console.log('  images figees = deplacement quasi nul -> percu comme un a-coup');
console.log('  irregularite  = ecart-type du deplacement par image (plus bas = plus fluide)');
console.log('');
console.log('  scenario               | images figees | irregularite');
console.log('  -----------------------|---------------|-------------');

let failed = 0;
const report = (r, limitCv) => {
  const ok = r.frozen < 1 && r.cv < limitCv;
  if (!ok) failed++;
  console.log(
    `  ${r.label} | ${r.frozen.toFixed(1).padStart(11)}% | ${r.cv.toFixed(1).padStart(10)}%  ${ok ? 'OK' : 'FAIL'}`,
  );
};

console.log('  -- autres joueurs : interpolation depuis le buffer --');
for (const s of scenarios) report(run(s), 25);

console.log('');
console.log('  -- notre cellule : prediction locale --');
report(runPredicted({ label: 'flux regulier       ', stallAt: 0, stallMs: 0 }), 25);
report(runPredicted({ label: 'coupure de 150 ms   ', stallAt: 2000, stallMs: 150 }), 25);
report(runPredicted({ label: 'coupure de 300 ms   ', stallAt: 2000, stallMs: 300 }), 40);

console.log('');
console.log(failed === 0 ? 'RENDU FLUIDE' : `${failed} SCENARIO(S) SACCADE(S)`);
process.exit(failed === 0 ? 0 : 1);
