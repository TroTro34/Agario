// Grille de hachage spatiale : evite le O(n^2) sur les collisions.
// Les entites sont reinserees a chaque tick (le monde est petit, c'est peu cher).

export class SpatialHash {
  constructor(worldSize, cellSize = 256) {
    this.cellSize = cellSize;
    this.cols = Math.ceil(worldSize / cellSize) + 1;
    this.buckets = new Map();
  }

  clear() {
    this.buckets.clear();
  }

  _key(cx, cy) {
    return cy * this.cols + cx;
  }

  insert(entity) {
    const cx = (entity.x / this.cellSize) | 0;
    const cy = (entity.y / this.cellSize) | 0;
    const k = this._key(cx, cy);
    let b = this.buckets.get(k);
    if (!b) { b = []; this.buckets.set(k, b); }
    b.push(entity);
  }

  // Renvoie toutes les entites dont le bucket croise le cercle (x, y, r).
  queryCircle(x, y, r, out = []) {
    out.length = 0;
    const cs = this.cellSize;
    const x0 = ((x - r) / cs) | 0, x1 = ((x + r) / cs) | 0;
    const y0 = ((y - r) / cs) | 0, y1 = ((y + r) / cs) | 0;
    for (let cy = y0; cy <= y1; cy++) {
      for (let cx = x0; cx <= x1; cx++) {
        const b = this.buckets.get(this._key(cx, cy));
        if (b) for (let i = 0; i < b.length; i++) out.push(b[i]);
      }
    }
    return out;
  }

  // Idem pour une boite (utilise par le calcul de champ de vision).
  queryBox(minX, minY, maxX, maxY, out = []) {
    out.length = 0;
    const cs = this.cellSize;
    const x0 = (minX / cs) | 0, x1 = (maxX / cs) | 0;
    const y0 = (minY / cs) | 0, y1 = (maxY / cs) | 0;
    for (let cy = y0; cy <= y1; cy++) {
      for (let cx = x0; cx <= x1; cx++) {
        const b = this.buckets.get(this._key(cx, cy));
        if (b) for (let i = 0; i < b.length; i++) out.push(b[i]);
      }
    }
    return out;
  }
}
