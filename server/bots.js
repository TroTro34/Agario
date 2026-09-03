import { KIND } from './protocol.js';

// IA volontairement simple : elle doit surtout peupler l'arene et rester lisible.
// Chaque bot a un temperament tire au sort, ce qui evite un troupeau uniforme.
//
// Le bot choisit d'abord OU il veut aller (fuir, chasser, manger, errer), puis
// devie sa trajectoire pour contourner les virus dangereux. Faire l'inverse -
// un ecart brutal declenche au dernier moment - le faisait souvent percuter le
// virus qu'il tentait d'eviter.

const TAU = Math.PI * 2;

// Marge de securite autour d'un virus, en plus des deux rayons.
const VIRUS_CLEARANCE = 70;
// Distance a laquelle on commence a prendre un virus en compte. Une part fixe,
// plus une part proportionnelle au rayon : une grosse cellule est lente a
// tourner et doit s'ecarter bien plus tot. Avec une valeur fixe, les gros bots
// engageaient le virus avant meme de l'avoir pris en compte.
const VIRUS_LOOKAHEAD = 500;
const virusLookahead = (self, virus) => self.r + virus.r + VIRUS_LOOKAHEAD + self.r * 2;

export function makeBotBrain() {
  const trait = {
    aggression: 0.35 + Math.random() * 0.5, // gout du risque
    fear: 700 + Math.random() * 500, // distance a laquelle on commence a fuir
    reaction: 3 + ((Math.random() * 4) | 0), // on ne repense pas a chaque tick
    splitChance: Math.random() * 0.35,
    wanderAngle: Math.random() * TAU,
  };
  let cooldown = (Math.random() * trait.reaction) | 0;

  return function think(room, p) {
    if (cooldown-- > 0) return;
    cooldown = trait.reaction;

    // Cellule de reference : la plus grosse du joueur.
    let self = null;
    for (const c of p.cells) if (!self || c.mass > self.mass) self = c;
    if (!self) return;

    const scan = Math.max(900, self.r * 9);
    const near = room.hash.queryCircle(self.x, self.y, scan, []);
    const eat = room.mode.eatRatio;
    // Un virus n'est dangereux que si on est assez gros pour exploser dessus.
    const virusHurts = self.mass >= room.mode.virusEatMinMass;

    let threat = null;
    let threatD = Infinity;
    let prey = null;
    let preyD = Infinity;
    let food = null;
    let foodD = Infinity;
    let virus = null;
    let virusD = Infinity;

    for (const o of near) {
      if (o === self) continue;
      const d = Math.hypot(o.x - self.x, o.y - self.y);

      if (o.kind === KIND.CELL) {
        if (o.ownerId === p.id) continue;
        if (o.mass > self.mass * eat) {
          if (d < threatD) {
            threat = o;
            threatD = d;
          }
        } else if (self.mass > o.mass * eat) {
          if (d < preyD) {
            prey = o;
            preyD = d;
          }
        }
      } else if (o.kind === KIND.VIRUS) {
        if (virusHurts && d < virusD) {
          virus = o;
          virusD = d;
        }
      } else if (o.kind === KIND.FOOD || o.kind === KIND.EJECTED) {
        if (d < foodD) {
          food = o;
          foodD = d;
        }
      }
    }

    // --- 1. Ou veut-on aller ? ----------------------------------------------
    let ang;
    let dist = 900;
    let wantSplit = false;

    if (threat && threatD < trait.fear + self.r) {
      // Fuir, en priorite sur tout le reste.
      ang = Math.atan2(self.y - threat.y, self.x - threat.x);
      dist = 1200;
    } else if (prey && preyD < scan * trait.aggression + self.r) {
      ang = Math.atan2(prey.y - self.y, prey.x - self.x);
      dist = preyD;
      wantSplit =
        p.cells.length < room.mode.maxCells &&
        self.mass >= room.mode.splitMinMass &&
        self.mass / 2 > prey.mass * eat &&
        preyD < self.r * 3.2 &&
        Math.random() < trait.splitChance;
    } else if (food) {
      ang = Math.atan2(food.y - self.y, food.x - self.x);
      dist = Math.max(foodD, 120);
    } else {
      trait.wanderAngle += (Math.random() - 0.5) * 0.6;
      ang = trait.wanderAngle;
    }

    // --- 2. Contourner le virus s'il barre la route -------------------------
    if (virus && virusD < virusLookahead(self, virus)) {
      const deflected = deflect(self, virus, ang, virusD);
      if (deflected !== ang) {
        ang = deflected;
        wantSplit = false; // se diviser vers un virus est le pire des scenarios
        dist = Math.max(dist, virusD + virus.r + VIRUS_CLEARANCE);
      }
    }

    aim(room, p, self, ang, dist);
    if (wantSplit) room.doSplit(p);
  };
}

/**
 * Devie un cap pour passer a cote d'un virus.
 *
 * On calcule le demi-angle du cone occupe par le virus vu depuis la cellule.
 * Si le cap vise tombe dans ce cone, on l'ecarte jusqu'au bord - du cote le
 * plus proche, donc en s'ecartant le moins possible de la direction voulue.
 * Hors du cone, la route est libre et le cap est conserve.
 */
function deflect(self, virus, ang, d) {
  const toVirus = Math.atan2(virus.y - self.y, virus.x - self.x);
  let diff = ang - toVirus;
  while (diff > Math.PI) diff -= TAU;
  while (diff < -Math.PI) diff += TAU;

  const clearance = virus.r + self.r + VIRUS_CLEARANCE;
  // asin borne a 1 : colle au virus, le cone couvre tout l'avant.
  const half = Math.asin(Math.min(1, clearance / Math.max(d, 1)));

  if (Math.abs(diff) >= half) return ang; // on passe deja a cote
  return toVirus + (diff >= 0 ? half : -half);
}

// Vise un point a `dist` dans la direction `ang`, en restant dans le monde.
function aim(room, p, self, ang, dist) {
  const x = Math.max(60, Math.min(room.world - 60, self.x + Math.cos(ang) * dist));
  const y = Math.max(60, Math.min(room.world - 60, self.y + Math.sin(ang) * dist));
  room.setTarget(p, x, y);
}
