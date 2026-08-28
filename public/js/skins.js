// Skins procedurraux : dessines au canvas, aucun asset a charger.
// Chaque skin recoit un contexte deja translate sur le centre de la cellule,
// avec un clip circulaire de rayon r et le fond de base deja peint.

import { darken } from './theme.js';

const TAU = Math.PI * 2;

export const SKIN_IDS = ['solid', 'ring', 'stripes', 'dots', 'star', 'eye', 'slice', 'target'];

export const SKIN_LABELS = {
  solid: 'Uni',
  ring: 'Anneau',
  stripes: 'Rayures',
  dots: 'Pois',
  star: 'Etoile',
  eye: 'Oeil',
  slice: 'Quartiers',
  target: 'Cible',
};

const painters = {
  solid() {
    /* le fond suffit */
  },

  ring(ctx, r, color) {
    ctx.strokeStyle = darken(color, 0.7);
    ctx.lineWidth = r * 0.18;
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.62, 0, TAU);
    ctx.stroke();
  },

  stripes(ctx, r, color) {
    ctx.fillStyle = darken(color, 0.72);
    const w = r * 0.26;
    for (let x = -r; x < r; x += w * 2) ctx.fillRect(x, -r, w, r * 2);
  },

  dots(ctx, r, color) {
    ctx.fillStyle = darken(color, 0.68);
    const step = r * 0.55;
    const rad = r * 0.13;
    for (let y = -r; y <= r; y += step) {
      for (let x = -r; x <= r; x += step) {
        const off = (Math.round(y / step) % 2) * (step / 2);
        ctx.beginPath();
        ctx.arc(x + off, y, rad, 0, TAU);
        ctx.fill();
      }
    }
  },

  star(ctx, r, color) {
    ctx.fillStyle = darken(color, 0.68);
    const outer = r * 0.72;
    const inner = outer * 0.42;
    ctx.beginPath();
    for (let i = 0; i < 10; i++) {
      const rad = i % 2 === 0 ? outer : inner;
      const a = (i / 10) * TAU - Math.PI / 2;
      const px = Math.cos(a) * rad;
      const py = Math.sin(a) * rad;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fill();
  },

  eye(ctx, r, color) {
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.6, 0, TAU);
    ctx.fill();
    ctx.fillStyle = darken(color, 0.35);
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.28, 0, TAU);
    ctx.fill();
  },

  slice(ctx, r, color) {
    ctx.fillStyle = darken(color, 0.7);
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * TAU;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.arc(0, 0, r, a, a + TAU / 8);
      ctx.closePath();
      ctx.fill();
    }
  },

  target(ctx, r, color) {
    const dark = darken(color, 0.7);
    for (let i = 3; i >= 1; i--) {
      ctx.fillStyle = i % 2 ? dark : color;
      ctx.beginPath();
      ctx.arc(0, 0, (r * i) / 3.2, 0, TAU);
      ctx.fill();
    }
  },
};

/**
 * Peint le motif d'un skin. Le contexte doit deja etre translate sur le centre
 * de la cellule et clippe au disque de rayon r.
 */
export function paintSkin(ctx, skin, r, color) {
  const fn = painters[skin] || painters.solid;
  fn(ctx, r, color);
}

/** Vignette de previsualisation pour le menu. */
export function drawSkinPreview(canvas, skin, color) {
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const size = canvas.clientWidth || 48;
  canvas.width = size * dpr;
  canvas.height = size * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, size, size);

  const r = size / 2 - 2;
  ctx.save();
  ctx.translate(size / 2, size / 2);
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, TAU);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
  ctx.save();
  ctx.clip();
  paintSkin(ctx, skin, r, color);
  ctx.restore();
  ctx.strokeStyle = darken(color, 0.82);
  ctx.lineWidth = Math.max(2, r * 0.09);
  ctx.stroke();
  ctx.restore();
}
