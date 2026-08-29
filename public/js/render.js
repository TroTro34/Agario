// Rendu de l'arene. Canvas 2D, un seul passage par frame.
//
// Echelle : la camera dezoome quand on grossit, suivant la meme courbe que
// le jeu d'origine -> scale = (min(64 / rayonTotal, 1)) ^ 0.4

import { ARENAS, CELL, VIRUS, EJECTED, BULLET, FONT, colorOf, darken } from './theme.js';
import { KIND } from './net.js';
import { paintSkin } from './skins.js';

const TAU = Math.PI * 2;
const REF_W = 1920;
const REF_H = 1080;

export class Renderer {
  constructor(canvas, opts = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false });
    this.arena = ARENAS[opts.arena || 'dark'];
    this.showGrid = opts.showGrid !== false;
    this.showMass = opts.showMass !== false;
    this.showNames = opts.showNames !== false;

    this.scale = 1;
    this.targetScale = 1;
    this.userZoom = 1; // molette, cf. zoomBy()
    this.w = 0;
    this.h = 0;
    this.dpr = 1;

    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  setArena(name) {
    this.arena = ARENAS[name] || ARENAS.dark;
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2); // au-dela de 2, on paie sans rien gagner
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.w = w;
    this.h = h;
    this.dpr = dpr;
    // La minimap memorise sa taille : on l'invalide pour qu'elle se remesure.
    this._mmCanvas = null;
  }

  /** Echelle cible d'apres la somme des rayons des cellules du joueur. */
  computeScale(totalR) {
    const base = Math.pow(Math.min(64 / Math.max(totalR, 1), 1), 0.4);
    const viewMul = Math.max(this.w / REF_W, this.h / REF_H);
    return base * viewMul * this.userZoom;
  }

  /**
   * Zoom manuel a la molette, en plus du dezoom automatique lie a la masse.
   * Borne : trop dezoomer donnerait un avantage (on verrait venir les autres
   * de bien plus loin), trop zoomer rend le jeu illisible.
   */
  zoomBy(factor) {
    this.userZoom = Math.max(0.55, Math.min(this.userZoom * factor, 1.8));
    return this.userZoom;
  }

  resetZoom() {
    this.userZoom = 1;
  }

  screenX(wx, cam) {
    return (wx - cam.x) * this.scale + this.w / 2;
  }

  screenY(wy, cam) {
    return (wy - cam.y) * this.scale + this.h / 2;
  }

  /** Convertit une position ecran en coordonnees monde (pour viser a la souris). */
  toWorld(sx, sy, cam) {
    return {
      x: (sx - this.w / 2) / this.scale + cam.x,
      y: (sy - this.h / 2) / this.scale + cam.y,
    };
  }

  render(net, cam, worldSize) {
    const ctx = this.ctx;
    const A = this.arena;

    // Zoom : on lisse pour eviter l'a-coup a chaque split/fusion.
    let totalR = 0;
    for (const e of net.entities.values()) {
      if (e.kind === KIND.CELL && e.ownerId === net.selfId) totalR += e.r;
    }
    if (totalR > 0) this.targetScale = this.computeScale(totalR);
    this.scale += (this.targetScale - this.scale) * 0.12;

    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

    // Fond
    ctx.fillStyle = A.outside;
    ctx.fillRect(0, 0, this.w, this.h);

    // Interieur du monde
    const x0 = this.screenX(0, cam);
    const y0 = this.screenY(0, cam);
    const side = worldSize * this.scale;
    ctx.fillStyle = A.bg;
    ctx.fillRect(x0, y0, side, side);

    if (this.showGrid) this.drawGrid(cam, worldSize);
    this.drawBorder(x0, y0, side);

    // Tri : les petites entites dessous, les grosses dessus.
    // Tableau reutilise d'une image sur l'autre plutot que realloue 60 fois/s.
    const cells = this._sortBuf || (this._sortBuf = []);
    cells.length = 0;
    for (const e of net.entities.values()) {
      if (e.kind === KIND.FOOD) this.drawFood(e, cam);
      else if (e.kind === KIND.EJECTED) this.drawEjected(e, cam);
      else if (e.kind === KIND.BULLET) this.drawBullet(e, cam);
      else cells.push(e);
    }
    cells.sort((a, b) => a.r - b.r);

    for (const e of cells) {
      if (e.kind === KIND.VIRUS) this.drawVirus(e, cam);
      else this.drawCell(e, cam, net);
    }
  }

  drawGrid(cam, worldSize) {
    const ctx = this.ctx;
    const A = this.arena;
    const step = A.gridStep * this.scale;
    if (step < 6) return; // trop dense : illisible et couteux

    ctx.strokeStyle = A.grid;
    ctx.lineWidth = 1;
    ctx.beginPath();

    const left = Math.max(0, cam.x - this.w / 2 / this.scale);
    const right = Math.min(worldSize, cam.x + this.w / 2 / this.scale);
    const top = Math.max(0, cam.y - this.h / 2 / this.scale);
    const bottom = Math.min(worldSize, cam.y + this.h / 2 / this.scale);

    // Surtout PAS d'arrondi au pixel ici. Aligner les lignes sur des pixels
    // entiers les rend nettes, mais elles sautent alors d'un pixel d'un coup,
    // chacune a un moment different, pendant que les cellules avancent en
    // sous-pixel : le fond se met a grouiller par rapport au reste. On garde
    // donc les positions exactes - lignes legerement adoucies, mais tout le
    // decor glisse d'un seul bloc.
    const sy0 = this.screenY(top, cam);
    const sy1 = this.screenY(bottom, cam);
    for (let wx = Math.ceil(left / A.gridStep) * A.gridStep; wx <= right; wx += A.gridStep) {
      const sx = this.screenX(wx, cam);
      ctx.moveTo(sx, sy0);
      ctx.lineTo(sx, sy1);
    }

    const sx0 = this.screenX(left, cam);
    const sx1 = this.screenX(right, cam);
    for (let wy = Math.ceil(top / A.gridStep) * A.gridStep; wy <= bottom; wy += A.gridStep) {
      const sy = this.screenY(wy, cam);
      ctx.moveTo(sx0, sy);
      ctx.lineTo(sx1, sy);
    }
    ctx.stroke();
  }

  drawBorder(x0, y0, side) {
    const ctx = this.ctx;
    ctx.strokeStyle = this.arena.border;
    ctx.lineWidth = this.arena.borderWidth * Math.max(this.scale, 0.25);
    ctx.strokeRect(x0, y0, side, side);
  }

  drawFood(e, cam) {
    const ctx = this.ctx;
    const r = e.r * this.scale;
    if (r < 0.6) return;
    ctx.fillStyle = colorOf(e.color);
    ctx.beginPath();
    ctx.arc(this.screenX(e.x, cam), this.screenY(e.y, cam), r, 0, TAU);
    ctx.fill();
  }

  drawEjected(e, cam) {
    const ctx = this.ctx;
    const r = e.r * this.scale;
    if (r < 1) return;
    const fill = colorOf(e.color);
    ctx.fillStyle = fill;
    ctx.beginPath();
    ctx.arc(this.screenX(e.x, cam), this.screenY(e.y, cam), r, 0, TAU);
    ctx.fill();
    if (r > 4) {
      ctx.strokeStyle = darken(fill, EJECTED.strokeDarken);
      ctx.lineWidth = EJECTED.strokeWidth;
      ctx.stroke();
    }
  }

  drawBullet(e, cam) {
    const ctx = this.ctx;
    const r = e.r * this.scale;
    if (r < 1) return;
    const fill = colorOf(e.color);
    ctx.fillStyle = fill;
    ctx.beginPath();
    ctx.arc(this.screenX(e.x, cam), this.screenY(e.y, cam), r, 0, TAU);
    ctx.fill();
    if (r > 4) {
      ctx.strokeStyle = darken(fill, BULLET.strokeDarken);
      ctx.lineWidth = BULLET.strokeWidth;
      ctx.stroke();
    }
  }

  drawVirus(e, cam) {
    const ctx = this.ctx;
    const r = e.r * this.scale;
    if (r < 2) return;
    const sx = this.screenX(e.x, cam);
    const sy = this.screenY(e.y, cam);

    ctx.beginPath();
    const n = VIRUS.spikes * 2;
    for (let i = 0; i < n; i++) {
      const rad = i % 2 === 0 ? r : r * (1 - VIRUS.spikeDepth);
      const a = (i / n) * TAU;
      const px = sx + Math.cos(a) * rad;
      const py = sy + Math.sin(a) * rad;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fillStyle = VIRUS.fill;
    ctx.fill();
    ctx.strokeStyle = VIRUS.stroke;
    ctx.lineWidth = Math.max(1.5, VIRUS.strokeWidth * this.scale);
    ctx.stroke();
  }

  drawCell(e, cam, net) {
    const ctx = this.ctx;
    const r = e.r * this.scale;
    if (r < 1) return;

    const info = net.roster.get(e.ownerId);
    const fill = colorOf(info ? info.c : e.ownerId % 16);
    const sx = this.screenX(e.x, cam);
    const sy = this.screenY(e.y, cam);

    // Corps
    ctx.beginPath();
    ctx.arc(sx, sy, r, 0, TAU);
    ctx.fillStyle = fill;
    ctx.fill();

    // Motif du skin, clippe au disque
    const skin = info?.s;
    if (skin && skin !== 'solid' && r > 14) {
      ctx.save();
      ctx.clip();
      ctx.translate(sx, sy);
      paintSkin(ctx, skin, r, fill);
      ctx.restore();
    }

    // Contour
    ctx.strokeStyle = darken(fill, CELL.strokeDarken);
    ctx.lineWidth = CELL.strokeWidth(r);
    ctx.stroke();

    // Pseudo + masse
    const name = info?.n;
    if (this.showNames && name && r > CELL.minRadiusForName) {
      const size = CELL.nameSize(r);
      ctx.font = `${FONT.weight} ${size}px ${FONT.family}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.lineJoin = 'round';
      ctx.miterLimit = 2;
      ctx.lineWidth = CELL.nameOutline(size);
      ctx.strokeStyle = this.arena.nameStroke;
      ctx.fillStyle = this.arena.nameFill;

      const showMass = this.showMass && r > CELL.minRadiusForMass;
      const ny = showMass ? sy - size * 0.28 : sy;
      ctx.strokeText(name, sx, ny);
      ctx.fillText(name, sx, ny);

      if (showMass) {
        const ms = CELL.massSize(size);
        const mass = Math.round((e.r / 10) ** 2); // inverse de r = 10 * sqrt(masse)
        ctx.font = `${FONT.weight} ${ms}px ${FONT.family}`;
        ctx.lineWidth = CELL.nameOutline(ms);
        ctx.strokeText(String(mass), sx, ny + size * 0.72);
        ctx.fillText(String(mass), sx, ny + size * 0.72);
      }
    }
  }

  /**
   * Minimap : petit carre avec la position du joueur.
   * Le contexte et la taille sont memorises : les relire a chaque image
   * (getContext, clientWidth) declenche un recalcul de layout pour rien.
   */
  drawMinimap(mmCanvas, net, cam, worldSize) {
    if (this._mmCanvas !== mmCanvas) {
      this._mmCanvas = mmCanvas;
      this._mmCtx = mmCanvas.getContext('2d');
      this._mmSize = mmCanvas.clientWidth || 160;
      const d = Math.min(window.devicePixelRatio || 1, 2);
      mmCanvas.width = this._mmSize * d;
      mmCanvas.height = this._mmSize * d;
      this._mmDpr = d;
    }
    const ctx = this._mmCtx;
    const size = this._mmSize;
    const dpr = this._mmDpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size, size);

    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillRect(0, 0, size, size);
    ctx.strokeStyle = 'rgba(255,255,255,0.18)';
    ctx.lineWidth = 1;
    ctx.strokeRect(0.5, 0.5, size - 1, size - 1);

    const k = size / worldSize;
    const px = cam.x * k;
    const py = cam.y * k;

    // Champ de vision approximatif
    const vw = (this.w / this.scale) * k;
    const vh = (this.h / this.scale) * k;
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.strokeRect(px - vw / 2, py - vh / 2, vw, vh);

    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(px, py, 3.5, 0, TAU);
    ctx.fill();
  }
}
