// Couche reseau : WebSocket, decodage des snapshots binaires, interpolation.
//
// Le serveur envoie ~15 snapshots/s et on rend a 60 fps : il faut donc inventer
// les images intermediaires.
//
// On rend LEGEREMENT DANS LE PASSE (voir `delay`). A chaque frame on cherche les
// deux snapshots qui encadrent l'instant rendu et on interpole entre eux. Ce
// retard volontaire absorbe la gigue reseau : un paquet en retard n'interrompt
// plus le mouvement, il arrive simplement avant qu'on en ait besoin.
//
// L'approche naive - viser en permanence le dernier snapshot recu et s'arreter
// une fois arrive - fige toutes les entites des qu'un paquet tarde, ce qui donne
// un deplacement saccade tres visible.

export const KIND = { FOOD: 0, CELL: 1, VIRUS: 2, EJECTED: 3, BULLET: 4 };
const CMD = { TARGET: 0, SPLIT: 1, EJECT: 2 };

const BUFFER_MAX = 12; // snapshots conserves

// --- Physique rejouee cote client (doit rester identique au serveur) ---------
// Elle ne sert QU'A predire nos propres cellules entre deux paquets. Le serveur
// reste seul juge : ses positions corrigent la prediction a chaque snapshot.
const R_PER_MASS = 10;
const SPEED_SCALE = 940;
const MIN_SPEED = 42;
// Au-dela, on ne predit plus (paquets perdus, onglet en arriere-plan) : mieux
// vaut s'arreter que de partir tres loin et revenir d'un coup.
const MAX_PREDICT = 0.35; // secondes

export class Net {
  constructor(handlers = {}) {
    this.ws = null;
    this.on = handlers;

    /** @type {Map<number, object>} entites telles qu'affichees (positions interpolees) */
    this.entities = new Map();
    /** @type {Map<number, object>} pseudo/couleur/skin par joueur visible */
    this.roster = new Map();

    /** File de snapshots horodates : [{ t, map: Map<id, rec> }] */
    this.buffer = [];

    /**
     * Nos propres cellules, predites localement.
     * id -> { ax, ay, at, x, y }
     *   ax/ay/at : derniere position FAISANT AUTORITE et son horodatage
     *   x/y      : position affichee, rejouee depuis l'autorite a chaque image
     */
    this.own = new Map();
    this.speedMul = 1;
    this.worldSize = 14142;
    // Rayons deduits de la masse (rayon = 10 * racine(masse)), renseignes a
    // l'arrivee en jeu. Valeurs de repli en attendant le message d'accueil.
    this.foodR = R_PER_MASS * Math.SQRT2;
    this.ejectR = R_PER_MASS * Math.sqrt(14);
    this.bulletR = R_PER_MASS * Math.sqrt(22);
    this.snapInterval = 66; // moyenne glissante, recalculee a la reception
    this.lastSnapAt = 0;

    this.selfId = 0;
    this.mode = null;
    this.score = 0;
    this.cellCount = 0;
    this.leaderboard = [];
    this.playerCount = 0;

    // Camera : reprise du serveur quand on n'a plus de cellule (mort, spectateur).
    this.serverCam = { x: 0, y: 0 };
    this.cam = { x: 0, y: 0 };
    this.camReady = false;

    this._targetBuf = new ArrayBuffer(9);
    this._targetView = new DataView(this._targetBuf);
    this._oneByte = new Uint8Array(1);
  }

  get connected() {
    return this.ws && this.ws.readyState === 1;
  }

  /** Retard de rendu : une fois et demie l'intervalle, borne. */
  get delay() {
    return Math.max(70, Math.min(this.snapInterval * 1.5 + 12, 220));
  }

  connect() {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${proto}//${location.host}/ws`);
    ws.binaryType = 'arraybuffer';
    this.ws = ws;

    ws.onopen = () => this.on.open?.();
    ws.onclose = () => this.on.close?.();
    ws.onerror = () => this.on.error?.();
    ws.onmessage = (ev) => {
      if (typeof ev.data === 'string') this._json(JSON.parse(ev.data));
      else this._snapshot(ev.data);
    };
    return this;
  }

  _reset() {
    this.entities.clear();
    this.roster.clear();
    this.own.clear();
    this.buffer.length = 0;
    this.camReady = false;
  }

  // --- Emission --------------------------------------------------------------
  send(obj) {
    if (this.connected) this.ws.send(JSON.stringify(obj));
  }

  join({ name, skin, mode, color }) {
    this._reset();
    this.send({ t: 'join', name, skin, mode, color });
  }

  respawn() {
    this.send({ t: 'respawn' });
  }

  chat(m) {
    this.send({ t: 'chat', m });
  }

  leave() {
    this.send({ t: 'leave' });
    this._reset();
  }

  sendTarget(x, y) {
    if (!this.connected) return;
    this._targetView.setUint8(0, CMD.TARGET);
    this._targetView.setFloat32(1, x, true);
    this._targetView.setFloat32(5, y, true);
    this.ws.send(this._targetBuf);
  }

  sendSplit() {
    this._cmd(CMD.SPLIT);
  }

  sendEject() {
    this._cmd(CMD.EJECT);
  }

  _cmd(op) {
    if (!this.connected) return;
    this._oneByte[0] = op;
    this.ws.send(this._oneByte);
  }

  // --- Reception -------------------------------------------------------------
  _json(msg) {
    switch (msg.t) {
      case 'hello':
        this.on.hello?.(msg);
        break;
      case 'welcome':
        this.selfId = msg.id;
        this.mode = msg.mode;
        this.speedMul = msg.mode.speedMul ?? 1;
        this.worldSize = msg.mode.world;
        this.foodR = R_PER_MASS * Math.sqrt(msg.mode.foodMass ?? 2);
        this.ejectR = R_PER_MASS * Math.sqrt(msg.mode.ejectMass ?? 14);
        this.bulletR = R_PER_MASS * Math.sqrt(msg.mode.cannon?.eatMass ?? 22);
        this._reset();
        this.on.welcome?.(msg);
        break;
      case 'cam':
        this.serverCam = { x: msg.x, y: msg.y };
        if (!this.camReady) {
          this.cam = { x: msg.x, y: msg.y };
          this.camReady = true;
        }
        this.score = msg.s;
        this.cellCount = msg.n;
        break;
      case 'lb':
        this.leaderboard = msg.items;
        this.playerCount = msg.players;
        this.roster.clear();
        for (const r of msg.roster) this.roster.set(r.id, r);
        this.on.leaderboard?.(msg);
        break;
      case 'chat':
        this.on.chat?.(msg);
        break;
      case 'sys':
        this.on.sys?.(msg);
        break;
      case 'chatlog':
        this.on.chatlog?.(msg);
        break;
      case 'dead':
        this.on.dead?.(msg);
        break;
    }
  }

  _snapshot(buf) {
    const dv = new DataView(buf);
    let o = 0;
    if (dv.getUint8(o) !== 1) return;
    o += 1;
    o += 2; // tick, non utilise cote client
    const count = dv.getUint16(o, true);
    o += 2;

    const now = performance.now();
    if (this.lastSnapAt) {
      const dt = now - this.lastSnapAt;
      // Moyenne glissante, en ignorant les valeurs aberrantes (onglet en veille).
      if (dt < 500) this.snapInterval = this.snapInterval * 0.85 + dt * 0.15;
    }
    this.lastSnapAt = now;

    const map = new Map();
    for (let i = 0; i < count; i++) {
      const kind = dv.getUint8(o);
      o += 1;
      const id = dv.getUint16(o, true);
      o += 2;
      const x = dv.getUint16(o, true);
      o += 2;
      const y = dv.getUint16(o, true);
      o += 2;

      let r = 0;
      let ownerId = 0;
      let color = 0;

      if (kind === KIND.CELL) {
        r = dv.getUint16(o, true);
        o += 2;
        ownerId = dv.getUint16(o, true);
        o += 2;
      } else if (kind === KIND.VIRUS) {
        r = dv.getUint16(o, true);
        o += 2;
      } else {
        color = dv.getUint8(o);
        o += 1;
        // Rayons deduits, pas transmis : ces entites ont une masse fixe par
        // mode, autant economiser 2 octets par entite dans chaque snapshot.
        r = kind === KIND.FOOD ? this.foodR : kind === KIND.BULLET ? this.bulletR : this.ejectR;
      }

      map.set(id, { kind, x, y, r, ownerId, color });
    }

    this.buffer.push({ t: now, map });
    while (this.buffer.length > BUFFER_MAX) this.buffer.shift();

    // Nos cellules : on retient la position faisant autorite. La prediction
    // repart de la a chaque image, ce qui borne la derive.
    for (const [id, rec] of map) {
      if (rec.kind !== KIND.CELL || rec.ownerId !== this.selfId) continue;
      const o = this.own.get(id);
      if (o) {
        o.ax = rec.x;
        o.ay = rec.y;
        o.at = now;
      } else {
        // Cellule inconnue (apparition, division, reapparition) : on s'y colle
        // sans transition, il n'y a rien a corriger.
        this.own.set(id, { ax: rec.x, ay: rec.y, at: now, x: rec.x, y: rec.y });
      }
    }
    for (const id of this.own.keys()) if (!map.has(id)) this.own.delete(id);
  }

  /**
   * Reconstruit `entities` pour l'instant rendu, et renvoie la position camera.
   * A appeler une fois par frame, avant le rendu.
   */
  interpolate(now, mouse) {
    const buf = this.buffer;
    if (buf.length === 0) return this.cam;

    const renderTime = now - this.delay;

    // Les deux snapshots encadrant l'instant rendu.
    let i = buf.length - 1;
    while (i > 0 && buf[i].t > renderTime) i--;
    const s0 = buf[i];
    const s1 = buf[i + 1];

    if (!s1) {
      // On est en retard sur le buffer (paquets en retard) : on tient la
      // derniere position connue plutot que d'extrapoler et de faire l'elastique.
      this._apply(s0.map, null, 0);
    } else {
      const span = s1.t - s0.t;
      const a = span > 0 ? Math.max(0, Math.min(1, (renderTime - s0.t) / span)) : 1;
      this._apply(s0.map, s1.map, a);
    }

    this._predictOwn(now, mouse);
    this._updateCamera();
    return this.cam;
  }

  /**
   * Prediction locale de nos propres cellules.
   *
   * Sans elle, notre cellule n'est qu'un echo du serveur : elle avance par
   * paliers de 20 Hz, avec en plus le retard de rendu. Meme parfaitement
   * interpolee, elle ne colle jamais a la souris.
   *
   * Ici on rejoue la physique du serveur depuis la derniere position faisant
   * autorite, sur le temps ecoule depuis ce paquet. La position devient une
   * fonction continue de `now` : elle est donc lisse quel que soit le nombre
   * d'images par seconde, et sans latence ajoutee.
   *
   * Le rayon, lui, reste celui du serveur (interpole) : la masse depend de ce
   * qu'on mange, le client n'a pas a en decider.
   */
  _predictOwn(now, mouse) {
    const dt = Math.min((now - (this._predictAt || now)) / 1000, 0.1);
    this._predictAt = now;
    if (!mouse || dt <= 0) return;
    const W = this.worldSize;

    for (const [id, o] of this.own) {
      const e = this.entities.get(id);
      if (!e) continue;

      const r = e.r;
      const mass = (r / R_PER_MASS) ** 2;
      const speed = Math.max(
        MIN_SPEED,
        2.2 * Math.pow(mass, -0.439) * SPEED_SCALE * this.speedMul,
      );

      // --- 1. Integration continue vers le curseur ---------------------------
      // C'est ce qui rend le changement de direction instantane : on tourne
      // localement, sans attendre que le serveur soit au courant.
      const dx = mouse.x - o.x;
      const dy = mouse.y - o.y;
      const d = Math.hypot(dx, dy);
      if (d > 1) {
        // Zone morte identique au serveur : on ralentit pres du curseur.
        const throttle = Math.min(1, d / (r + 12));
        o.x += (dx / d) * speed * throttle * dt;
        o.y += (dy / d) * speed * throttle * dt;
      }

      // --- 2. Rappel vers l'autorite ----------------------------------------
      // Rejeu depuis le dernier paquet, en sous-pas car la direction evolue au
      // fur et a mesure qu'on approche du curseur.
      const elapsed = Math.min((now - o.at) / 1000, MAX_PREDICT);
      let ax = o.ax;
      let ay = o.ay;
      const steps = 3;
      const h = elapsed / steps;
      for (let s = 0; s < steps; s++) {
        const ex = mouse.x - ax;
        const ey = mouse.y - ay;
        const ed = Math.hypot(ex, ey);
        if (ed <= 1) break;
        const th = Math.min(1, ed / (r + 12));
        ax += (ex / ed) * speed * th * h;
        ay += (ey / ed) * speed * th * h;
      }

      const err = Math.hypot(ax - o.x, ay - o.y);
      if (err > 600) {
        // Ecart massif (division, explosion sur virus, reapparition) : recalage
        // sec. L'adoucir donnerait un effet elastique bien pire que le saut.
        o.x = ax;
        o.y = ay;
      } else {
        // Rappel DOUX, et independant du nombre d'images par seconde.
        //
        // Ce point est le coeur du probleme des virages. Quand on tourne, le
        // serveur bouge encore selon l'ancienne direction - il n'a pas encore
        // recu la nouvelle. Chaque paquet tire donc la cellule en arriere.
        // Un rappel brutal rend ce tiraillement visible a la cadence des
        // paquets ; un rappel lent le filtre, pendant que l'integration
        // ci-dessus assure la reactivite.
        const k = 1 - Math.pow(1 - 0.06, dt * 60);
        o.x += (ax - o.x) * k;
        o.y += (ay - o.y) * k;
      }

      o.x = Math.max(r, Math.min(W - r, o.x));
      o.y = Math.max(r, Math.min(W - r, o.y));

      e.x = o.x;
      e.y = o.y;
    }
  }

  /** Ecrit les positions interpolees dans `entities`, en reutilisant les objets. */
  _apply(m0, m1, a) {
    const src = m1 || m0;
    const ents = this.entities;

    for (const [id, r1] of src) {
      const r0 = m1 ? m0.get(id) : r1;
      let e = ents.get(id);
      if (!e) {
        e = { id, kind: r1.kind, x: r1.x, y: r1.y, r: r1.r, ownerId: r1.ownerId, color: r1.color };
        ents.set(id, e);
      }
      e.kind = r1.kind;
      e.ownerId = r1.ownerId;
      e.color = r1.color;
      // Garde-fou : un bond trop grand pour etre un deplacement reel signale
      // un identifiant reattribue a une AUTRE entite (ou une teleportation).
      // Sans ca, on interpole entre les deux positions et l'entite traverse
      // l'ecran. A 25 snapshots/s, le plus rapide du jeu (un obus a 1150 px/s)
      // parcourt 46 unites : 300 laisse une marge tres large.
      const jumped =
        r0 && ((r1.x - r0.x) ** 2 + (r1.y - r0.y) ** 2 > 300 * 300 || r0.kind !== r1.kind);

      if (r0 && !jumped) {
        // Entite presente dans les deux snapshots : interpolation classique.
        e.x = r0.x + (r1.x - r0.x) * a;
        e.y = r0.y + (r1.y - r0.y) * a;
        e.r = r0.r + (r1.r - r0.r) * a;
      } else {
        // Entite qui vient d'entrer dans le champ : rien a interpoler.
        e.x = r1.x;
        e.y = r1.y;
        e.r = r1.r;
      }
    }

    for (const id of ents.keys()) if (!src.has(id)) ents.delete(id);
  }

  /**
   * Camera = barycentre (pondere par la masse) de mes propres cellules, calcule
   * sur les positions DEJA interpolees. La camera colle ainsi exactement aux
   * cellules affichees ; l'interpoler separement depuis le serveur les
   * desynchronise et fait vibrer toute la scene.
   */
  _updateCamera() {
    let x = 0;
    let y = 0;
    let w = 0;
    for (const e of this.entities.values()) {
      if (e.kind !== KIND.CELL || e.ownerId !== this.selfId) continue;
      const m = e.r * e.r; // proportionnel a la masse
      x += e.x * m;
      y += e.y * m;
      w += m;
    }

    if (w > 0) {
      this.cam.x = x / w;
      this.cam.y = y / w;
      this.camReady = true;
      return;
    }

    // Plus de cellule (mort ou spectateur) : on suit la camera du serveur,
    // en lissant pour eviter les sauts brusques.
    if (!this.camReady) {
      this.cam = { ...this.serverCam };
      this.camReady = true;
      return;
    }
    this.cam.x += (this.serverCam.x - this.cam.x) * 0.08;
    this.cam.y += (this.serverCam.y - this.cam.y) * 0.08;
  }
}
