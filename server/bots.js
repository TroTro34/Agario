import { KIND } from './protocol.js';

// IA volontairement simple : elle doit surtout peupler l'arene et rester lisible.
// Chaque bot a un temperament tire au sort, ce qui evite un troupeau uniforme.
//
// Priorites, dans l'ordre :
//   1. fuir une cellule capable de nous manger
//   2. eviter un virus quand on est assez gros pour exploser dessus
//   3. chasser une cellule plus petite
//   4. sinon, ramasser la nourriture la plus proche

const TAU = Math.PI * 2;

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
        // Un virus ne fait peur que si on est assez gros pour exploser dessus.
        if (self.mass >= room.mode.virusEatMinMass && d < virusD) {
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

    // 1. Fuir
    if (threat && threatD < trait.fear + self.r) {
      const ang = Math.atan2(self.y - threat.y, self.x - threat.x);
      return aim(room, p, self, ang, 1200);
    }

    // 2. Contourner un virus dangereux
    if (virus && virusD < self.r + virus.r + 90) {
      const ang = Math.atan2(self.y - virus.y, self.x - virus.x) + 0.9;
      return aim(room, p, self, ang, 700);
    }

    // 3. Chasser
    if (prey && preyD < scan * trait.aggression + self.r) {
      room.setTarget(p, prey.x, prey.y);
      // Split pour finir une proie a portee, si le pari est raisonnable.
      const canSplit =
        p.cells.length < room.mode.maxCells &&
        self.mass >= room.mode.splitMinMass &&
        self.mass / 2 > prey.mass * eat &&
        preyD < self.r * 3.2 &&
        Math.random() < trait.splitChance;
      if (canSplit) room.doSplit(p);
      return;
    }

    // 4. Manger
    if (food) {
      room.setTarget(p, food.x, food.y);
      return;
    }

    // 5. Errer : on garde un cap et on le fait deriver doucement.
    trait.wanderAngle += (Math.random() - 0.5) * 0.6;
    aim(room, p, self, trait.wanderAngle, 900);
  };
}

// Vise un point a `dist` dans la direction `ang`, en restant dans le monde.
function aim(room, p, self, ang, dist) {
  const x = Math.max(60, Math.min(room.world - 60, self.x + Math.cos(ang) * dist));
  const y = Math.max(60, Math.min(room.world - 60, self.y + Math.sin(ang) * dist));
  room.setTarget(p, x, y);
}
