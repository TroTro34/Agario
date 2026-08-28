// Couche reseau : WebSocket, decodage des snapshots binaires, interpolation.
//
// Le serveur envoie ~20 snapshots/s ; on rend a 60 fps. On garde donc pour
// chaque entite sa position precedente et sa position cible, et on interpole
// entre les deux. Sans ca, le jeu saccade visiblement.

export const KIND = { FOOD: 0, CELL: 1, VIRUS: 2, EJECTED: 3, BULLET: 4 };
const CMD = { TARGET: 0, SPLIT: 1, EJECT: 2 };

export class Net {
  constructor(handlers = {}) {
    this.ws = null;
    this.on = handlers;

    /** @type {Map<number, object>} entites interpolees, par id */
    this.entities = new Map();
    /** @type {Map<number, object>} pseudo/couleur/skin par joueur visible */
    this.roster = new Map();

    this.selfId = 0;
    this.mode = null;
    this.cam = { x: 0, y: 0 };
    this.camPrev = { x: 0, y: 0 };
    this.camAt = 0;
    this.score = 0;
    this.cellCount = 0;
    this.leaderboard = [];
    this.playerCount = 0;

    this.lastSnapAt = 0;
    this.snapInterval = 50; // recalcule a la volee
    this._targetBuf = new ArrayBuffer(9);
    this._targetView = new DataView(this._targetBuf);
    this._oneByte = new Uint8Array(1);
  }

  get connected() {
    return this.ws && this.ws.readyState === 1;
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

  // --- Emission --------------------------------------------------------------
  send(obj) {
    if (this.connected) this.ws.send(JSON.stringify(obj));
  }

  join({ name, skin, mode, color }) {
    this.entities.clear();
    this.roster.clear();
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
    this.entities.clear();
    this.roster.clear();
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
        this.on.welcome?.(msg);
        break;
      case 'cam':
        this.camPrev = { ...this.cam };
        this.cam = { x: msg.x, y: msg.y };
        this.camAt = performance.now();
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
      // Moyenne glissante : absorbe la gigue reseau sans figer l'interpolation.
      this.snapInterval = this.snapInterval * 0.8 + (now - this.lastSnapAt) * 0.2;
    }
    this.lastSnapAt = now;

    const seen = new Set();

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
        r = kind === KIND.FOOD ? 10 : kind === KIND.BULLET ? 22 : 37;
      }

      seen.add(id);
      let e = this.entities.get(id);
      if (!e) {
        e = { id, kind, x, y, r, ownerId, color, px: x, py: y, pr: r, tx: x, ty: y, tr: r };
        this.entities.set(id, e);
      } else {
        // La position rendue devient le point de depart de la prochaine interpolation.
        e.px = e.x;
        e.py = e.y;
        e.pr = e.r;
        e.tx = x;
        e.ty = y;
        e.tr = r;
        e.kind = kind;
        e.ownerId = ownerId;
        e.color = color;
      }
    }

    for (const id of this.entities.keys()) if (!seen.has(id)) this.entities.delete(id);
  }

  /** Avance l'interpolation. A appeler une fois par frame avant le rendu. */
  interpolate(now) {
    const span = Math.max(16, Math.min(this.snapInterval, 200));
    const t = Math.min(1, (now - this.lastSnapAt) / span);
    for (const e of this.entities.values()) {
      e.x = e.px + (e.tx - e.px) * t;
      e.y = e.py + (e.ty - e.py) * t;
      e.r = e.pr + (e.tr - e.pr) * t;
    }
    const ct = Math.min(1, (now - this.camAt) / span);
    return {
      x: this.camPrev.x + (this.cam.x - this.camPrev.x) * ct,
      y: this.camPrev.y + (this.cam.y - this.camPrev.y) * ct,
    };
  }
}
