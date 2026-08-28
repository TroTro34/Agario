// Protocole reseau.
//
// Chemin chaud (snapshot du monde) : binaire, ~8-11 octets par entite.
// Chemin froid (join, chat, roster, leaderboard) : JSON, lisible et rare.
//
// Les ids sont des u16 recycles par salon : 65535 entites simultanees suffisent
// tres largement et on economise 2 octets par entite face a un u32.

export const KIND = {
  FOOD: 0,
  CELL: 1,
  VIRUS: 2,
  EJECTED: 3,
  BULLET: 4,
};

export const OP_SNAPSHOT = 1;

// Ops client -> serveur
export const CMD = {
  TARGET: 0,   // + f32 x, f32 y  (position monde visee)
  SPLIT: 1,
  EJECT: 2,    // ejection de masse, ou tir en Demolition
};

const SIZE_BY_KIND = {
  [KIND.FOOD]: 1 + 2 + 2 + 2 + 1,        // kind id x y color
  [KIND.CELL]: 1 + 2 + 2 + 2 + 2 + 2,    // kind id x y r owner
  [KIND.VIRUS]: 1 + 2 + 2 + 2 + 2,       // kind id x y r
  [KIND.EJECTED]: 1 + 2 + 2 + 2 + 1,     // kind id x y color
  [KIND.BULLET]: 1 + 2 + 2 + 2 + 1,      // kind id x y color
};

// `entities` : tableau deja filtre sur le champ de vision du joueur.
export function encodeSnapshot(entities, tick) {
  let bytes = 1 + 2 + 2;
  for (let i = 0; i < entities.length; i++) bytes += SIZE_BY_KIND[entities[i].kind];

  const buf = new ArrayBuffer(bytes);
  const dv = new DataView(buf);
  let o = 0;

  dv.setUint8(o, OP_SNAPSHOT); o += 1;
  dv.setUint16(o, tick & 0xffff, true); o += 2;
  dv.setUint16(o, entities.length, true); o += 2;

  for (let i = 0; i < entities.length; i++) {
    const e = entities[i];
    dv.setUint8(o, e.kind); o += 1;
    dv.setUint16(o, e.id, true); o += 2;
    dv.setUint16(o, e.x < 0 ? 0 : e.x > 65535 ? 65535 : e.x | 0, true); o += 2;
    dv.setUint16(o, e.y < 0 ? 0 : e.y > 65535 ? 65535 : e.y | 0, true); o += 2;

    if (e.kind === KIND.CELL) {
      dv.setUint16(o, e.r | 0, true); o += 2;
      dv.setUint16(o, e.ownerId, true); o += 2;
    } else if (e.kind === KIND.VIRUS) {
      dv.setUint16(o, e.r | 0, true); o += 2;
    } else {
      dv.setUint8(o, e.color); o += 1;
    }
  }
  return buf;
}

// Decode une commande client. Renvoie null si le paquet est malforme.
export function decodeCommand(buf) {
  if (!buf || buf.byteLength < 1) return null;
  const dv = new DataView(buf.buffer ?? buf, buf.byteOffset ?? 0, buf.byteLength);
  const op = dv.getUint8(0);
  if (op === CMD.TARGET) {
    if (dv.byteLength < 9) return null;
    return { op, x: dv.getFloat32(1, true), y: dv.getFloat32(5, true) };
  }
  if (op === CMD.SPLIT || op === CMD.EJECT) return { op };
  return null;
}
