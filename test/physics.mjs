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

// --- 0. Coherence des reglages, tous modes -----------------------------------
section('Coherence des reglages');
for (const id of ['classique', 'hardcore', 'demolition']) {
  const m = getMode(id);
  // Un virus ne doit jamais naitre au-dessus de son seuil de dedoublement,
  // sinon le premier tir venu le duplique.
  check(
    `${id} : seuil de dedoublement au-dessus de la masse max d un virus`,
    m.virusSplitMass > (m.virusMassMax ?? m.virusMass),
    `${m.virusSplitMass} > ${m.virusMassMax ?? m.virusMass}`,
  );
  // Tirer ou ejecter au seuil ne doit pas faire passer sous le plancher : sinon
  // le code doit "rattraper" avec un Math.max(), qui REMONTE la masse au lieu
  // de la borner. C'est exactement ce qui faisait grossir en tirant.
  if (m.cannon) {
    check(
      `${id} : tirer au seuil ne descend pas sous le plancher`,
      m.cannon.minMass - m.cannon.cost >= m.minMass,
      `${m.cannon.minMass} - ${m.cannon.cost} >= ${m.minMass}`,
    );
  } else {
    check(
      `${id} : ejecter au seuil ne descend pas sous le plancher`,
      m.ejectMinMass - m.ejectCost >= m.minMass,
      `${m.ejectMinMass} - ${m.ejectCost} >= ${m.minMass}`,
    );
  }
}

// --- 0b. Aucune action ne doit pouvoir AUGMENTER la masse --------------------
section('Aucune creation de masse');
{
  const room = bareRoom('demolition');
  const p = placePlayer(room, 5000, 5000, 62, 'T'); // sous le plancher, cas reel
  const c = p.cells[0];

  room.setTarget(p, 20000, 5000);
  p.lastFireAt = 0;
  room.doFire(p);
  check('tirer ne fait jamais grossir', c.mass <= 62, `62 -> ${Math.round(c.mass)}`);

  c.mass = 62;
  c.r = massToRadius(62);
  room.setTarget(p, c.x, c.y);
  for (let i = 0; i < 25; i++) room.moveCells(room.dt);
  check('l attrition ne fait jamais grossir', c.mass <= 62, `62 -> ${Math.round(c.mass)}`);

  // Le cas complet : exploser sur un virus puis mitrailler doit faire FONDRE.
  const r2 = bareRoom('demolition');
  const q = placePlayer(r2, 5000, 5000, 1000, 'Q');
  r2.spawnVirus(5000, 5000);
  r2.rebuildHash();
  r2.resolveEating();
  const afterPop = q.score || q.cells.reduce((s, x) => s + x.mass, 0);
  for (let k = 0; k < 20; k++) {
    r2.setTarget(q, 20000, 5000);
    q.lastFireAt = 0;
    r2.doFire(q);
    for (let i = 0; i < 10; i++) r2.step();
  }
  check(
    'exploser puis mitrailler fait fondre',
    q.score < afterPop,
    `${Math.round(afterPop)} -> ${Math.round(q.score)}`,
  );
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
  // Lu dans la config : un nombre en dur ici resterait vert apres un changement
  // de maxCells tout en affichant une valeur fausse.
  check(
    `plafond a ${room.mode.maxCells} cellules`,
    r.cells.length <= room.mode.maxCells,
    `${r.cells.length}`,
  );
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
  const cn = room.mode.cannon;
  const shooter = placePlayer(room, 3000, 3000, 1000, 'Tireur');
  const victim = placePlayer(room, 3400, 3000, 1000, 'Cible');
  room.setTarget(shooter, 5000, 3000);

  const massBefore = shooter.cells[0].mass;
  room.doFire(shooter);
  check('un projectile par cellule', room.bullets.size === 1, `${room.bullets.size}`);
  // Le cout est lu dans la config : un chiffre en dur ici casse a chaque reglage.
  check(
    `cout de ${cn.cost} de masse`,
    Math.abs(massBefore - shooter.cells[0].mass - cn.cost) < 0.01,
  );
  // Invariant central de l'economie : un projectile doit rapporter MOINS qu'il
  // n'a coute. Sinon tirer cree de la masse, et le tireur qui ramasse ses
  // propres tirs grossit sans limite.
  check(
    'un projectile rapporte moins qu il ne coute',
    cn.eatMass < cn.cost,
    `${cn.eatMass} < ${cn.cost}`,
  );

  // Le projectile doit apparaitre dans le hash, sinon il est invisible du client.
  room.rebuildHash();
  const b0 = room.bullets.values().next().value;
  const found = room.hash.queryCircle(b0.x, b0.y, 5, []);
  check('projectile present dans le hash spatial', found.some((e) => e.kind === 4));

  const victimBefore = victim.cells[0].mass;
  for (let i = 0; i < 12; i++) room.step();
  check(
    'en vol, la cible perd de la masse',
    victim.cells[0].mass < victimBefore,
    `${victimBefore.toFixed(0)} -> ${victim.cells[0].mass.toFixed(0)}`,
  );
  check('un projectile ne tue pas', victim.cells.length === 1);
}

// --- 7b. Toutes les cellules tirent, et le projectile s'immobilise -----------
section('Salve et projectiles immobilises');
{
  const room = bareRoom('demolition');
  const p = placePlayer(room, 4000, 4000, 800, 'Tireur');
  room.setTarget(p, 9000, 4000);
  room.doSplit(p);
  room.doSplit(p);
  p.lastFireAt = 0;
  room.doFire(p);
  check('une salve = un projectile par cellule', room.bullets.size === p.cells.length, `${room.bullets.size} pour ${p.cells.length} cellules`);

  // Le projectile ralentit jusqu'a l'arret, il ne disparait jamais.
  // On boucle jusqu'a l'arret plutot que sur un nombre de pas fixe : la duree
  // depend de speed et friction, un nombre en dur casse a chaque reglage.
  const b = room.bullets.values().next().value;
  let ticks = 0;
  while (!b.stopped && ticks < 400) {
    room.moveProjectiles(room.dt);
    ticks++;
  }
  check('le projectile finit par s immobiliser', b.stopped === true, `${(ticks * room.dt).toFixed(1)} s`);
  check('il reste sur le terrain', room.bullets.has(b.id));

  // Une fois arrete, il se ramasse et rapporte sa masse.
  const eater = placePlayer(room, b.x, b.y, 400, 'Mangeur');
  const before = eater.cells[0].mass;
  room.rebuildHash();
  room.resolveEating();
  check(
    'un projectile arrete se mange',
    eater.cells[0].mass > before,
    `${before.toFixed(0)} -> ${eater.cells[0].mass.toFixed(0)}`,
  );
}

// --- 7bis. Tirer sur un virus le duplique ------------------------------------
section('Projectiles et virus');
{
  // virusCount explicite : bareRoom le met a 0 par defaut, ce qui donnerait un
  // plafond nul et ferait resorber le virus par replenish() pendant le test.
  const room = bareRoom('demolition', { virusCount: 1 });
  const cn = room.mode.cannon;
  const p = placePlayer(room, 3000, 3000, 900, 'Tireur');
  const v = room.viruses.values().next().value;
  v.x = 4200;
  v.y = 3000;
  room.setTarget(p, 20000, 3000);

  const needed = Math.ceil((room.mode.virusSplitMass - room.mode.virusMass) / cn.eatMass);
  check('le virus grossit sous les tirs', true, `${needed} projectiles attendus`);

  // Le tireur doit rester sur place. Viser un point lointain pour orienter les
  // tirs le fait AUSSI avancer : il finissait par percuter le virus, explosait
  // en 16 morceaux, et le "virus disparu" etait en fait un virus mange.
  const pin = () => {
    p.cells[0].x = 3000;
    p.cells[0].y = 3000;
  };
  const salve = () => {
    pin();
    p.lastFireAt = 0;
    room.doFire(p);
    for (let i = 0; i < 40; i++) {
      room.step();
      pin();
    }
  };

  let before = v.mass;
  salve();
  check('un projectile nourrit le virus', v.mass > before, `${before} -> ${Math.round(v.mass)}`);

  // On tire jusqu'au seuil : un nouveau virus doit apparaitre.
  const virusesBefore = room.viruses.size;
  for (let shot = 0; shot < needed; shot++) salve();
  check(
    'au seuil, le virus se duplique',
    room.viruses.size > virusesBefore,
    `${virusesBefore} -> ${room.viruses.size} virus`,
  );
}

// --- 7ter. Un virus se dedouble sans limite propre ---------------------------
section('Dedoublement des virus');
{
  // virusCount assez grand pour que le plafond (x3) ne soit pas atteint avant
  // d'avoir teste le dedoublement d'un descendant.
  const room = bareRoom('demolition', { virusCount: 10 });
  const m = room.mode;
  const v = room.viruses.values().next().value;

  // Le MEME virus doit pouvoir etre dedouble bien plus de deux fois : une
  // limite par virus bloquait la multiplication a 3, ce qui ne correspond pas
  // au comportement attendu.
  let created = 0;
  for (let i = 0; i < 8; i++) {
    if (room.feedVirus(v, m.virusSplitMass, 0)) created++;
  }
  check(
    'un meme virus se dedouble plus de deux fois',
    created > 2,
    `${created} dedoublements depuis un seul virus`,
  );

  // Les descendants se dedoublent aussi : la chaine n'est pas sterile.
  const child = [...room.viruses.values()].pop();
  let fromChild = 0;
  for (let i = 0; i < 4; i++) {
    if (room.feedVirus(child, m.virusSplitMass, 0)) fromChild++;
  }
  check('un descendant se dedouble aussi', fromChild > 0, `${fromChild} depuis un descendant`);

  // Seul un plafond global finit par arreter la croissance.
  for (let i = 0; i < 400; i++) {
    for (const x of [...room.viruses.values()]) room.feedVirus(x, m.virusSplitMass, 0);
    if (room.viruses.size >= room.virusCap) break;
  }
  check(
    'la croissance s arrete au plafond global',
    room.viruses.size === room.virusCap,
    `${room.viruses.size} virus pour un plafond de ${room.virusCap}`,
  );
}

// --- 7quater. Le tir ne doit pas etre rentable en soi ------------------------
section('Equilibre du tir');
{
  const room = bareRoom('demolition');
  const cn = room.mode.cannon;
  // Si les degats depassent le cout, chaque projectile est gagnant isolement,
  // et etre divise en 16 multiplie par 16 une action deja rentable.
  check('les degats restent sous le cout du tir', cn.damage < cn.cost, `${cn.damage} < ${cn.cost}`);

  // Une salve depuis 16 cellules doit couter plus qu'elle n'inflige.
  const cells = 16;
  check(
    'une salve de 16 coute plus qu elle n inflige',
    cells * cn.cost > cells * cn.damage,
    `${cells * cn.cost} depenses pour ${cells * cn.damage} infliges`,
  );
}

// --- 7c. Les virus explosent a nouveau en Demolition -------------------------
section('Virus en Demolition');
{
  const room = bareRoom('demolition');
  const p = placePlayer(room, 4000, 4000, 1000, 'T');
  room.spawnVirus(4000, 4000);
  room.rebuildHash();
  room.resolveEating();
  check('a 1000 de masse, le virus fait exploser', p.cells.length > 1, `${p.cells.length} morceaux`);

  // Et les morceaux restent au-dessus du seuil de tir : exploser ne desarme pas.
  const biggest = Math.max(...p.cells.map((c) => c.mass));
  check(
    'les morceaux peuvent encore tirer',
    biggest >= room.mode.cannon.minMass,
    `plus gros morceau ${biggest.toFixed(0)} >= ${room.mode.cannon.minMass}`,
  );
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
