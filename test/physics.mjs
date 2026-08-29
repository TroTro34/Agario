// Tests du moteur, sans reseau : on pilote une Room directement.
// Verifie les regles que l'integration ne peut pas atteindre depuis le spawn
// (split, ejection, explosion sur virus, fusion, degats du canon).
//
//   node test/physics.mjs

import { getMode } from '../server/modes.js';
import { Room, massToRadius } from '../server/room.js';

let failed = 0;
const results = [];

function check(label, cond, detail = '') {
  if (!cond) failed++;
  results.push(`  ${cond ? 'OK  ' : 'FAIL'} ${label}${detail ? ' : ' + detail : ''}`);
}

function section(name) {
  results.push(`--- ${name} ---`);
}

/** Cree un salon vide (sans bots) pour isoler ce qu'on teste. */
function bareRoom(modeId, overrides = {}) {
  const mode = { ...getMode(modeId), bots: 0, foodCount: 0, virusCount: 0, ...overrides };
  return new Room(mode, { tickRate: 25 });
}

/** Place un joueur a une position et une masse donnees. */
function placePlayer(room, x, y, mass, name = 'T') {
  const p = room.addPlayer({ name, skin: 'solid', colorIdx: 0 });
  room.spawnPlayer(p);
  const c = p.cells[0];
  c.x = x;
  c.y = y;
  c.mass = mass;
  c.r = massToRadius(mass);
  c.mergeAt = Date.now() + room.mergeDelay(mass) * 1000;
  return p;
}

// --- 1. Rayon / masse --------------------------------------------------------
section('Echelle rayon <-> masse');
check('masse 10 -> rayon 31.6', Math.abs(massToRadius(10) - 31.62) < 0.02, massToRadius(10).toFixed(2));
check('masse 100 (virus) -> rayon 100', massToRadius(100) === 100, String(massToRadius(100)));
check('masse 1000 -> rayon 316', Math.abs(massToRadius(1000) - 316.23) < 0.02, massToRadius(1000).toFixed(2));

// --- 2. Split ----------------------------------------------------------------
section('Split (Classique)');
{
  const room = bareRoom('classique');
  const p = placePlayer(room, 3000, 3000, 200);
  room.setTarget(p, 4000, 3000);

  room.doSplit(p);
  check('200 de masse -> 2 cellules', p.cells.length === 2, `${p.cells.length}`);
  check('masse conservee', Math.abs(p.cells.reduce((s, c) => s + c.mass, 0) - 200) < 0.01);

  // Sous le seuil, le split doit etre refuse.
  const q = placePlayer(room, 6000, 6000, 20);
  room.doSplit(q);
  check('20 de masse -> refuse (seuil 36)', q.cells.length === 1, `${q.cells.length}`);

  // Plafond de cellules.
  const r = placePlayer(room, 1500, 1500, 4000);
  for (let i = 0; i < 8; i++) room.doSplit(r);
  check('plafond a 16 cellules', r.cells.length <= 16, `${r.cells.length}`);
}

// --- 3. Ejection de masse ----------------------------------------------------
section('Ejection (W)');
{
  const room = bareRoom('classique');
  const p = placePlayer(room, 3000, 3000, 200);
  room.setTarget(p, 4000, 3000);
  const before = p.cells[0].mass;
  room.doEject(p);
  check('un projectile cree', room.ejected.size === 1, `${room.ejected.size}`);
  check('cout de 18 de masse', Math.abs(before - p.cells[0].mass - 18) < 0.01);

  const q = placePlayer(room, 8000, 8000, 20);
  room.doEject(q);
  check('sous le seuil -> refuse', room.ejected.size === 1, `${room.ejected.size}`);
}

// --- 4. Manger ---------------------------------------------------------------
section('Manger une cellule adverse');
{
  const room = bareRoom('classique');
  const big = placePlayer(room, 3000, 3000, 400, 'Gros');
  const small = placePlayer(room, 3000, 3000, 50, 'Petit');
  room.rebuildHash();
  room.resolveEating();
  check('la petite est mangee', small.cells.length === 0);
  check('la grosse a absorbe la masse', Math.abs(big.cells[0].mass - 450) < 0.01, big.cells[0]?.mass.toFixed(1));

  // Ratio insuffisant : 100 vs 90, il faut 1.25x.
  const a = placePlayer(room, 7000, 7000, 100, 'A');
  const b = placePlayer(room, 7000, 7000, 90, 'B');
  room.rebuildHash();
  room.resolveEating();
  check('ratio 1.11 -> personne ne mange', a.cells.length === 1 && b.cells.length === 1);
}

// --- 5. Virus ----------------------------------------------------------------
section('Virus');
{
  const room = bareRoom('classique');
  const p = placePlayer(room, 3000, 3000, 600);
  const v = room.spawnVirus(3000, 3000);
  room.rebuildHash();
  room.resolveEating();
  check('grosse cellule -> explosion', p.cells.length > 1, `${p.cells.length} cellules`);
  check('le virus est consomme', !room.viruses.has(v.id));

  // Trop petit pour exploser : on passe au travers.
  const room2 = bareRoom('classique');
  const q = placePlayer(room2, 3000, 3000, 120); // seuil = 133
  room2.spawnVirus(3000, 3000);
  room2.rebuildHash();
  room2.resolveEating();
  check('petite cellule -> pas d explosion', q.cells.length === 1, `${q.cells.length}`);
}

// --- 6. Fusion ---------------------------------------------------------------
section('Fusion des cellules');
{
  const room = bareRoom('classique');
  const p = placePlayer(room, 3000, 3000, 200);
  room.setTarget(p, 4000, 3000);
  room.doSplit(p);
  check('deux cellules apres split', p.cells.length === 2);

  // Timer non ecoule : elles ne doivent pas fusionner.
  for (const c of p.cells) {
    c.x = 3000;
    c.y = 3000;
  }
  room.resolveOwnCells();
  check('timer actif -> pas de fusion', p.cells.length === 2, `${p.cells.length}`);

  // On force l'echeance : la fusion doit se faire.
  for (const c of p.cells) {
    c.mergeAt = Date.now() - 1;
    c.x = 3000;
    c.y = 3000;
  }
  room.resolveOwnCells();
  check('timer ecoule -> fusion', p.cells.length === 1, `${p.cells.length}`);
  check('masse conservee apres fusion', Math.abs(p.cells[0].mass - 200) < 0.01, p.cells[0].mass.toFixed(1));
}

// --- 7. Canon (Demolition) ---------------------------------------------------
section('Canon (Demolition)');
{
  const room = bareRoom('demolition');
  const shooter = placePlayer(room, 3000, 3000, 1000, 'Tireur');
  const victim = placePlayer(room, 3400, 3000, 1000, 'Cible');
  room.setTarget(shooter, 5000, 3000);

  const massBefore = shooter.cells[0].mass;
  room.doFire(shooter);
  check('un obus est cree', room.bullets.size === 1, `${room.bullets.size}`);
  check('cout de 30 de masse', Math.abs(massBefore - shooter.cells[0].mass - 30) < 0.01);

  // L'obus doit apparaitre dans le hash, sinon il est invisible pour le client.
  room.rebuildHash();
  const found = room.hash.queryCircle(room.bullets.values().next().value.x, room.bullets.values().next().value.y, 5, []);
  check('obus present dans le hash spatial', found.some((e) => e.kind === 4));

  const victimBefore = victim.cells[0].mass;
  for (let i = 0; i < 12; i++) room.step();
  check(
    'la cible perd de la masse',
    victim.cells[0].mass < victimBefore,
    `${victimBefore.toFixed(0)} -> ${victim.cells[0].mass.toFixed(0)}`,
  );
  check('la cible n est pas tuee par un obus', victim.cells.length === 1);
}

// --- 8. Attrition ------------------------------------------------------------
section('Attrition');
{
  const room = bareRoom('classique');
  const p = placePlayer(room, 3000, 3000, 1000);
  room.setTarget(p, 3000, 3000);
  for (let i = 0; i < 25; i++) room.step(); // 1 seconde
  const m = p.cells[0].mass;
  check('1000 perd ~0.2% en 1 s', m < 1000 && m > 995, m.toFixed(2));

  const q = placePlayer(room, 8000, 8000, 50); // sous decayMin = 100
  const q0 = q.cells[0].mass;
  for (let i = 0; i < 25; i++) room.step();
  check('petite cellule non erodee', Math.abs(q.cells[0].mass - q0) < 0.001);
}

// --- 9. Identifiants ---------------------------------------------------------
section('Identifiants (le client interpole par id)');
{
  const room = bareRoom('classique', { foodCount: 40 });
  for (let i = 0; i < 40; i++) room.spawnFood();

  // On mange une pastille, puis on en fait reapparaitre : l'id libere ne doit
  // PAS etre redonne aussitot, sinon le client interpole entre deux endroits
  // sans rapport et la pastille traverse l'ecran.
  const victim = room.food.values().next().value;
  const freed = victim.id;
  room.food.delete(freed);
  room.ids.give(freed);

  const reused = [];
  for (let i = 0; i < 30; i++) reused.push(room.spawnFood().id);
  check(
    'un id libere n est pas reattribue aussitot',
    !reused.includes(freed),
    `id ${freed} vs 30 nouveaux`,
  );

  // Aucun doublon parmi toutes les entites vivantes.
  const all = [
    ...room.food.keys(),
    ...room.cells.keys(),
    ...room.viruses.keys(),
    ...room.ejected.keys(),
    ...room.bullets.keys(),
  ];
  check('aucun identifiant en double', new Set(all).size === all.length, `${all.length} entites`);

  // Sous forte rotation (le cas reel : les bots mangent en continu), les ids
  // distribues doivent rester tous distincts.
  const room2 = bareRoom('classique', { foodCount: 60 });
  for (let i = 0; i < 60; i++) room2.spawnFood();
  const seen = new Set();
  let collisions = 0;
  for (let cycle = 0; cycle < 200; cycle++) {
    const f = room2.food.values().next().value;
    room2.food.delete(f.id);
    room2.ids.give(f.id);
    const nf = room2.spawnFood();
    if (seen.has(nf.id) && room2.food.has(nf.id)) collisions++;
    seen.add(nf.id);
  }
  check('200 cycles manger/reapparaitre sans collision', collisions === 0, `${collisions}`);
}

console.log('\n' + results.join('\n'));
console.log(failed === 0 ? '\nTOUS LES TESTS PASSENT' : `\n${failed} VERIFICATION(S) EN ECHEC`);
process.exit(failed === 0 ? 0 : 1);
