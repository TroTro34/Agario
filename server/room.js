import { SpatialHash } from './spatial.js';
import { KIND, encodeSnapshot } from './protocol.js';
import { makeBotBrain } from './bots.js';
import { sanitizeName } from './sanitize.js';

// --- Constantes de physique --------------------------------------------------
// rayon = R_PER_MASS * sqrt(masse)  ->  masse 10 = r 31.6, virus 100 = r 100
const R_PER_MASS = 10;
// vitesse = 2.2 * masse^-0.439 * SPEED_SCALE  (px/s)
const SPEED_SCALE = 940;
const MIN_SPEED = 42; // plancher : une grosse cellule reste jouable
const TAU = Math.PI * 2;

export const PALETTE_SIZE = 16;

export const massToRadius = (m) => R_PER_MASS * Math.sqrt(m);
export const radiusToMass = (r) => (r / R_PER_MASS) ** 2;

function speedFor(mass, speedMul) {
  return Math.max(MIN_SPEED, 2.2 * Math.pow(mass, -0.439) * SPEED_SCALE * speedMul);
}

// Pool d'identifiants u16 recycles (voir protocol.js).
class IdPool {
  constructor() {
    this.next = 1;
    this.free = [];
  }
  take() {
    if (this.free.length) return this.free.pop();
    if (this.next >= 65535) this.next = 1;
    return this.next++;
  }
  give(id) {
    if (this.free.length < 4096) this.free.push(id);
  }
}

let PLAYER_SEQ = 1;

export class Room {
  constructor(mode, opts = {}) {
    this.mode = mode;
    this.tickRate = opts.tickRate ?? 25;
    this.dt = 1 / this.tickRate;
    this.world = mode.world;
    this.ids = new IdPool();
    this.tick = 0;

    this.players = new Map();
    this.food = new Map();
    this.viruses = new Map();
    this.ejected = new Map();
    this.bullets = new Map();
    this.cells = new Map();

    this.hash = new SpatialHash(this.world, 256);

    for (let i = 0; i < mode.foodCount; i++) this.spawnFood();
    for (let i = 0; i < mode.virusCount; i++) this.spawnVirus();
    for (let i = 0; i < mode.bots; i++) this.addBot();
  }

  // --- Helpers ---------------------------------------------------------------
  randPos() {
    const m = 100;
    return {
      x: m + Math.random() * (this.world - m * 2),
      y: m + Math.random() * (this.world - m * 2),
    };
  }

  clampWorld(e) {
    if (e.x < e.r) e.x = e.r;
    else if (e.x > this.world - e.r) e.x = this.world - e.r;
    if (e.y < e.r) e.y = e.r;
    else if (e.y > this.world - e.r) e.y = this.world - e.r;
  }

  // --- Spawns ----------------------------------------------------------------
  spawnFood() {
    const p = this.randPos();
    const f = {
      id: this.ids.take(),
      kind: KIND.FOOD,
      x: p.x,
      y: p.y,
      mass: this.mode.foodMass,
      r: massToRadius(this.mode.foodMass),
      color: (Math.random() * PALETTE_SIZE) | 0,
    };
    this.food.set(f.id, f);
    return f;
  }

  spawnVirus(x, y) {
    const p = x === undefined ? this.randPos() : { x, y };
    const v = {
      id: this.ids.take(),
      kind: KIND.VIRUS,
      x: p.x,
      y: p.y,
      mass: this.mode.virusMass,
      r: massToRadius(this.mode.virusMass),
      vx: 0,
      vy: 0,
      feedAngle: 0,
    };
    this.viruses.set(v.id, v);
    return v;
  }

  // --- Joueurs ---------------------------------------------------------------
  addPlayer({ name, skin, colorIdx, isBot = false, ws = null }) {
    const id = (PLAYER_SEQ++ & 0xffff) || 1;
    const p = {
      id,
      ws,
      isBot,
      name: sanitizeName(name),
      skin: typeof skin === 'string' ? skin.slice(0, 24) : 'solid',
      color: Number.isInteger(colorIdx)
        ? ((colorIdx % PALETTE_SIZE) + PALETTE_SIZE) % PALETTE_SIZE
        : (Math.random() * PALETTE_SIZE) | 0,
      cells: [],
      targetX: this.world / 2,
      targetY: this.world / 2,
      alive: false,
      score: 0,
      best: 0,
      xp: 0,
      lastChatAt: 0,
      lastFireAt: 0,
      joinedAt: Date.now(),
      brain: isBot ? makeBotBrain() : null,
    };
    this.players.set(id, p);
    return p;
  }

  removePlayer(id) {
    const p = this.players.get(id);
    if (!p) return;
    for (const c of p.cells) {
      this.cells.delete(c.id);
      this.ids.give(c.id);
    }
    this.players.delete(id);
  }

  addBot() {
    const p = this.addPlayer({ name: randomBotName(), skin: 'solid', isBot: true });
    this.spawnPlayer(p);
    return p;
  }

  spawnPlayer(p) {
    const mass = this.mode.startMass;
    const pos = this.findSafeSpawn(massToRadius(mass));
    const c = this.makeCell(p, pos.x, pos.y, mass);
    p.cells = [c];
    p.alive = true;
    p.score = mass;
    p.best = mass;
    p.joinedAt = Date.now();
    p.targetX = pos.x;
    p.targetY = pos.y;
    return p;
  }

  // Evite de faire apparaitre un joueur dans la gueule d'une grosse cellule.
  findSafeSpawn(r) {
    const threshold = this.mode.startMass * this.mode.eatRatio;
    for (let attempt = 0; attempt < 20; attempt++) {
      const p = this.randPos();
      let ok = true;
      for (const c of this.cells.values()) {
        if (c.mass < threshold) continue;
        if (Math.hypot(c.x - p.x, c.y - p.y) < c.r + r + 260) {
          ok = false;
          break;
        }
      }
      if (ok) return p;
    }
    return this.randPos();
  }

  makeCell(owner, x, y, mass) {
    const c = {
      id: this.ids.take(),
      kind: KIND.CELL,
      ownerId: owner.id,
      x,
      y,
      mass,
      r: massToRadius(mass),
      vx: 0,
      vy: 0,
      mergeAt: Date.now() + this.mergeDelay(mass) * 1000,
    };
    this.cells.set(c.id, c);
    return c;
  }

  mergeDelay(mass) {
    return this.mode.mergeBase + this.mode.mergeMassFactor * mass;
  }

  killCell(c) {
    this.cells.delete(c.id);
    this.ids.give(c.id);
    const p = this.players.get(c.ownerId);
    if (!p) return;
    const i = p.cells.indexOf(c);
    if (i >= 0) p.cells.splice(i, 1);
    if (p.cells.length === 0) this.onPlayerDeath(p);
  }

  onPlayerDeath(p) {
    p.alive = false;
    if (p.isBot) {
      setTimeout(
        () => {
          if (this.players.has(p.id)) this.spawnPlayer(p);
        },
        2000 + Math.random() * 4000,
      );
    } else if (p.ws && p.ws.readyState === 1) {
      p.ws.send(
        JSON.stringify({
          t: 'dead',
          score: Math.floor(p.best),
          xp: Math.floor(p.best * this.mode.xpMul),
          time: Math.floor((Date.now() - p.joinedAt) / 1000),
        }),
      );
    }
  }

  // --- Actions joueur --------------------------------------------------------
  setTarget(p, x, y) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    p.targetX = Math.max(0, Math.min(this.world, x));
    p.targetY = Math.max(0, Math.min(this.world, y));
  }

  doSplit(p) {
    if (!p.alive) return;
    const m = this.mode;
    let budget = m.maxCells - p.cells.length;
    if (budget <= 0) return;
    // On fige la liste : on divise l'etat d'avant, pas les morceaux crees ici.
    const list = [...p.cells].sort((a, b) => b.mass - a.mass);
    for (const c of list) {
      if (budget <= 0) break;
      if (c.mass < m.splitMinMass) continue;
      const half = c.mass / 2;
      const ang = Math.atan2(p.targetY - c.y, p.targetX - c.x);
      c.mass = half;
      c.r = massToRadius(half);
      c.mergeAt = Date.now() + this.mergeDelay(half) * 1000;
      const nc = this.makeCell(p, c.x + Math.cos(ang) * c.r, c.y + Math.sin(ang) * c.r, half);
      nc.vx = Math.cos(ang) * m.splitSpeed;
      nc.vy = Math.sin(ang) * m.splitSpeed;
      p.cells.push(nc);
      budget--;
    }
  }

  doEject(p) {
    if (!p.alive) return;
    const m = this.mode;
    if (m.cannon) return this.doFire(p);
    for (const c of p.cells) {
      if (c.mass < m.ejectMinMass) continue;
      const ang = Math.atan2(p.targetY - c.y, p.targetX - c.x);
      c.mass -= m.ejectCost;
      c.r = massToRadius(c.mass);
      const e = {
        id: this.ids.take(),
        kind: KIND.EJECTED,
        x: c.x + Math.cos(ang) * (c.r + 4),
        y: c.y + Math.sin(ang) * (c.r + 4),
        vx: Math.cos(ang) * m.ejectSpeed,
        vy: Math.sin(ang) * m.ejectSpeed,
        mass: m.ejectMass,
        r: massToRadius(m.ejectMass),
        color: p.color,
        ownerId: p.id,
        angle: ang,
      };
      this.ejected.set(e.id, e);
    }
  }

  // Mode Demolition : W tire un obus qui arrache de la masse a la cible.
  doFire(p) {
    const cn = this.mode.cannon;
    const now = Date.now();
    if (now - p.lastFireAt < cn.cooldown * 1000) return;
    let c = null;
    for (const cell of p.cells) if (!c || cell.mass > c.mass) c = cell;
    if (!c || c.mass < cn.minMass) return;
    p.lastFireAt = now;
    const ang = Math.atan2(p.targetY - c.y, p.targetX - c.x);
    c.mass = Math.max(this.mode.minMass, c.mass - cn.cost);
    c.r = massToRadius(c.mass);
    const b = {
      id: this.ids.take(),
      kind: KIND.BULLET,
      x: c.x + Math.cos(ang) * (c.r + 6),
      y: c.y + Math.sin(ang) * (c.r + 6),
      vx: Math.cos(ang) * cn.speed,
      vy: Math.sin(ang) * cn.speed,
      r: cn.radius,
      color: p.color,
      ownerId: p.id,
      life: cn.life,
    };
    this.bullets.set(b.id, b);
  }

  // --- Boucle de simulation --------------------------------------------------
  step() {
    this.tick++;
    for (const p of this.players.values()) if (p.isBot && p.alive) p.brain(this, p);
    this.moveCells(this.dt);
    this.moveProjectiles(this.dt);
    this.rebuildHash();
    this.resolveEating();
    this.resolveOwnCells();
    this.replenish();
  }

  moveCells(dt) {
    const m = this.mode;
    for (const p of this.players.values()) {
      if (!p.alive) continue;
      let score = 0;
      for (const c of p.cells) {
        if (c.mass > m.decayMin) {
          c.mass = Math.max(m.minMass, c.mass * (1 - m.decayRate * dt));
          c.r = massToRadius(c.mass);
        }
        const dx = p.targetX - c.x;
        const dy = p.targetY - c.y;
        const d = Math.hypot(dx, dy);
        if (d > 1) {
          const sp = speedFor(c.mass, m.speedMul);
          // Zone morte : plus le curseur est proche du centre, plus on ralentit.
          const throttle = Math.min(1, d / (c.r + 12));
          c.x += (dx / d) * sp * throttle * dt;
          c.y += (dy / d) * sp * throttle * dt;
        }
        if (c.vx || c.vy) {
          c.x += c.vx * dt;
          c.y += c.vy * dt;
          const decay = Math.pow(m.splitDecay, dt * this.tickRate);
          c.vx *= decay;
          c.vy *= decay;
          if (Math.abs(c.vx) < 3 && Math.abs(c.vy) < 3) {
            c.vx = 0;
            c.vy = 0;
          }
        }
        this.clampWorld(c);
        score += c.mass;
      }
      p.score = score;
      if (score > p.best) p.best = score;
    }
  }

  moveProjectiles(dt) {
    for (const e of this.ejected.values()) {
      e.x += e.vx * dt;
      e.y += e.vy * dt;
      const decay = Math.pow(0.86, dt * this.tickRate);
      e.vx *= decay;
      e.vy *= decay;
      if (Math.abs(e.vx) < 5) e.vx = 0;
      if (Math.abs(e.vy) < 5) e.vy = 0;
      this.clampWorld(e);
    }
    for (const b of [...this.bullets.values()]) {
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.life -= dt;
      const out =
        b.x <= b.r || b.y <= b.r || b.x >= this.world - b.r || b.y >= this.world - b.r;
      if (b.life <= 0 || out) {
        this.bullets.delete(b.id);
        this.ids.give(b.id);
      }
    }
    for (const v of this.viruses.values()) {
      if (!v.vx && !v.vy) continue;
      v.x += v.vx * dt;
      v.y += v.vy * dt;
      const decay = Math.pow(0.9, dt * this.tickRate);
      v.vx *= decay;
      v.vy *= decay;
      if (Math.abs(v.vx) < 4 && Math.abs(v.vy) < 4) {
        v.vx = 0;
        v.vy = 0;
      }
      this.clampWorld(v);
    }
  }

  rebuildHash() {
    this.hash.clear();
    for (const f of this.food.values()) this.hash.insert(f);
    for (const v of this.viruses.values()) this.hash.insert(v);
    for (const e of this.ejected.values()) this.hash.insert(e);
    for (const b of this.bullets.values()) this.hash.insert(b);
    for (const c of this.cells.values()) this.hash.insert(c);
  }

  resolveEating() {
    const m = this.mode;
    const scratch = [];

    // Obus (Demolition) : ils arrachent de la masse, ils ne mangent pas.
    if (m.cannon) {
      for (const b of [...this.bullets.values()]) {
        this.hash.queryCircle(b.x, b.y, b.r + 200, scratch);
        for (const o of scratch) {
          if (o.kind !== KIND.CELL || o.ownerId === b.ownerId) continue;
          if (Math.hypot(o.x - b.x, o.y - b.y) > o.r + b.r) continue;
          const dmg = Math.min(m.cannon.damage, o.mass - m.minMass);
          if (dmg > 0) {
            o.mass -= dmg;
            o.r = massToRadius(o.mass);
          }
          const shooter = this.players.get(b.ownerId);
          if (shooter) shooter.xp += 5;
          this.bullets.delete(b.id);
          this.ids.give(b.id);
          break;
        }
      }
    }

    // Cellules : nourriture, masse ejectee, virus, cellules adverses.
    for (const c of [...this.cells.values()]) {
      if (!this.cells.has(c.id)) continue;
      this.hash.queryCircle(c.x, c.y, c.r + 40, scratch);
      for (const o of scratch) {
        if (o === c) continue;
        if (!this.cells.has(c.id)) break; // c a ete mangee pendant cette passe
        const d = Math.hypot(o.x - c.x, o.y - c.y);

        if (o.kind === KIND.FOOD) {
          if (d < c.r && this.food.has(o.id)) {
            this.food.delete(o.id);
            this.ids.give(o.id);
            this.growCell(c, o.mass);
          }
        } else if (o.kind === KIND.EJECTED) {
          if (d < c.r && this.ejected.has(o.id)) {
            this.ejected.delete(o.id);
            this.ids.give(o.id);
            this.growCell(c, o.mass);
          }
        } else if (o.kind === KIND.VIRUS) {
          if (c.mass >= m.virusEatMinMass && d < c.r - o.r * 0.5 && this.viruses.has(o.id)) {
            this.viruses.delete(o.id);
            this.ids.give(o.id);
            this.popCell(c, o.mass);
            this.spawnVirus();
          }
        } else if (o.kind === KIND.CELL) {
          if (o.ownerId === c.ownerId) continue;
          if (!this.cells.has(o.id)) continue;
          if (c.mass < o.mass * m.eatRatio) continue;
          if (d >= c.r - o.r * m.eatOverlap) continue;
          const eater = this.players.get(c.ownerId);
          const gained = o.mass;
          this.killCell(o);
          this.growCell(c, gained);
          if (eater) eater.xp += Math.floor(gained * m.xpMul);
        }
      }
    }

    // La masse ejectee nourrit les virus ; au-dela d'un seuil le virus en tire un nouveau.
    for (const e of [...this.ejected.values()]) {
      this.hash.queryCircle(e.x, e.y, e.r + 120, scratch);
      for (const o of scratch) {
        if (o.kind !== KIND.VIRUS || !this.viruses.has(o.id)) continue;
        if (Math.hypot(o.x - e.x, o.y - e.y) > o.r) continue;
        this.ejected.delete(e.id);
        this.ids.give(e.id);
        o.mass += e.mass;
        o.feedAngle = e.angle;
        if (o.mass >= m.virusSplitMass) {
          o.mass = m.virusMass;
          o.r = massToRadius(o.mass);
          const nv = this.spawnVirus(o.x, o.y);
          nv.vx = Math.cos(o.feedAngle) * m.virusFeedSpeed;
          nv.vy = Math.sin(o.feedAngle) * m.virusFeedSpeed;
        } else {
          o.r = massToRadius(o.mass);
        }
        break;
      }
    }
  }

  growCell(c, mass) {
    c.mass += mass;
    c.r = massToRadius(c.mass);
  }

  // Explosion sur virus : on eclate en autant de morceaux que le budget le permet.
  popCell(c, virusMass) {
    const m = this.mode;
    const p = this.players.get(c.ownerId);
    c.mass += virusMass;
    if (!p) {
      c.r = massToRadius(c.mass);
      return;
    }
    const room = m.maxCells - p.cells.length;
    const pieces = Math.min(room, Math.max(0, Math.floor(c.mass / 24)));
    if (pieces < 1) {
      c.r = massToRadius(c.mass);
      return;
    }
    const each = c.mass / (pieces + 1);
    c.mass = each;
    c.r = massToRadius(each);
    c.mergeAt = Date.now() + this.mergeDelay(each) * 1000;
    for (let i = 0; i < pieces; i++) {
      const ang = (i / pieces) * TAU + Math.random() * 0.4;
      const nc = this.makeCell(p, c.x, c.y, each);
      nc.vx = Math.cos(ang) * m.splitSpeed * 0.9;
      nc.vy = Math.sin(ang) * m.splitSpeed * 0.9;
      p.cells.push(nc);
    }
  }

  // Cellules d'un meme joueur : fusion si le timer est ecoule, sinon repulsion douce.
  resolveOwnCells() {
    const now = Date.now();
    for (const p of this.players.values()) {
      if (!p.alive || p.cells.length < 2) continue;
      for (let i = 0; i < p.cells.length; i++) {
        for (let j = i + 1; j < p.cells.length; j++) {
          const a = p.cells[i];
          const b = p.cells[j];
          if (!a || !b) continue;
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          let d = Math.hypot(dx, dy);
          if (d > a.r + b.r) continue;
          const canMerge = now >= a.mergeAt && now >= b.mergeAt;
          if (canMerge) {
            if (d < Math.max(a.r, b.r)) {
              const big = a.mass >= b.mass ? a : b;
              const small = big === a ? b : a;
              this.growCell(big, small.mass);
              big.mergeAt = now + this.mergeDelay(big.mass) * 1000;
              this.killCell(small);
              j--;
            }
            continue; // on se chevauche mais on va fusionner : pas de poussee
          }
          if (d === 0) d = 0.01;
          const overlap = (a.r + b.r - d) * 0.5;
          const nx = dx / d;
          const ny = dy / d;
          a.x -= nx * overlap * 0.5;
          a.y -= ny * overlap * 0.5;
          b.x += nx * overlap * 0.5;
          b.y += ny * overlap * 0.5;
          this.clampWorld(a);
          this.clampWorld(b);
        }
      }
    }
  }

  replenish() {
    const m = this.mode;
    const need = m.foodCount - this.food.size;
    // Regeneration progressive : evite un pic CPU quand un gros joueur nettoie la carte.
    if (need > 0) {
      const n = Math.min(need, 24);
      for (let i = 0; i < n; i++) this.spawnFood();
    }
    while (this.viruses.size < m.virusCount) this.spawnVirus();
  }

  // --- Vue joueur ------------------------------------------------------------
  viewRadiusFor(p) {
    let totalR = 0;
    for (const c of p.cells) totalR += c.r;
    if (!totalR) totalR = massToRadius(this.mode.startMass);
    const scale = Math.pow(Math.min(64 / totalR, 1), 0.4);
    // 1.12 = petite marge pour que les entites entrent dans la vue deja connues.
    // La marge coute cher : elle grandit au carre dans le volume de donnees.
    return Math.min(this.world, (1100 / scale) * 1.12);
  }

  cameraFor(p) {
    if (!p.cells.length) return this.spectateCam();
    let x = 0;
    let y = 0;
    let w = 0;
    for (const c of p.cells) {
      x += c.x * c.mass;
      y += c.y * c.mass;
      w += c.mass;
    }
    return { x: x / w, y: y / w };
  }

  spectateCam() {
    let best = null;
    for (const pl of this.players.values()) {
      if (pl.alive && (!best || pl.score > best.score)) best = pl;
    }
    const mid = { x: this.world / 2, y: this.world / 2 };
    if (!best) return mid;
    let x = 0;
    let y = 0;
    let w = 0;
    for (const c of best.cells) {
      x += c.x * c.mass;
      y += c.y * c.mass;
      w += c.mass;
    }
    return w ? { x: x / w, y: y / w } : mid;
  }

  snapshotFor(p) {
    const spec = p.cells.length === 0;
    const cam = this.cameraFor(p);
    const vr = spec ? 2600 : this.viewRadiusFor(p);
    const out = [];
    this.hash.queryBox(cam.x - vr, cam.y - vr, cam.x + vr, cam.y + vr, out);
    return { buf: encodeSnapshot(out, this.tick), cam, vr };
  }

  leaderboard(limit = 10) {
    const arr = [];
    for (const p of this.players.values()) if (p.alive) arr.push(p);
    arr.sort((a, b) => b.score - a.score);
    return arr.slice(0, limit).map((p, i) => ({
      rank: i + 1,
      id: p.id,
      name: p.name,
      score: Math.floor(p.score),
    }));
  }

  // Roster : noms/couleurs/skins des joueurs visibles (JSON, basse frequence).
  rosterFor(p) {
    const cam = this.cameraFor(p);
    const vr = p.cells.length ? this.viewRadiusFor(p) : 2600;
    const seen = new Set();
    const out = [];
    for (const c of this.cells.values()) {
      if (seen.has(c.ownerId)) continue;
      if (Math.abs(c.x - cam.x) > vr || Math.abs(c.y - cam.y) > vr) continue;
      seen.add(c.ownerId);
      const o = this.players.get(c.ownerId);
      if (o) out.push({ id: o.id, n: o.name, c: o.color, s: o.skin });
    }
    return out;
  }

  stats() {
    let humans = 0;
    for (const p of this.players.values()) if (!p.isBot) humans++;
    return {
      players: this.players.size,
      humans,
      food: this.food.size,
      viruses: this.viruses.size,
    };
  }
}

const BOT_NAMES = [
  'Nova', 'Blob', 'Zeta', 'Orbit', 'Pixel', 'Kiwi', 'Turbo', 'Momo', 'Vortex', 'Echo',
  'Lynx', 'Comete', 'Quark', 'Sable', 'Nimbus', 'Dodo', 'Ferro', 'Onyx', 'Prisme', 'Tango',
  'Ursa', 'Vega', 'Wasabi', 'Xeno', 'Yuzu', 'Zephyr', 'Aster', 'Bloop', 'Cosmo', 'Dune',
];

function randomBotName() {
  const n = BOT_NAMES[(Math.random() * BOT_NAMES.length) | 0];
  return Math.random() < 0.35 ? n + (((Math.random() * 90) | 0) + 10) : n;
}
