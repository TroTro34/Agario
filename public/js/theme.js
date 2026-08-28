// -----------------------------------------------------------------------------
// THEME - tout l'aspect visuel du jeu est ici.
//
// C'est le SEUL fichier a toucher pour retoucher la direction artistique :
// couleurs de l'arene, palette des cellules, virus, typo, epaisseurs.
// -----------------------------------------------------------------------------

// Palette des cellules et de la nourriture.
// 16 teintes vives et saturees, dans l'esprit du jeu original.
export const PALETTE = [
  '#ff3b3b', // rouge
  '#ff8c1a', // orange
  '#ffd21a', // jaune
  '#a3e635', // vert clair
  '#33d94c', // vert
  '#22c39b', // turquoise
  '#22b8cf', // cyan
  '#3b9bff', // bleu
  '#5f6bff', // indigo
  '#9b5bff', // violet
  '#d94ce8', // magenta
  '#ff4fa3', // rose
  '#ff6b6b', // corail
  '#8fbf4a', // olive
  '#4a90d9', // bleu acier
  '#c77dff', // lilas
];

// Deux ambiances d'arene. `dark` = rendu par defaut, `light` = look historique.
export const ARENAS = {
  dark: {
    bg: '#111114',
    grid: '#22222c',
    gridStep: 50, // unites monde entre deux lignes
    border: '#ff3b3b',
    borderWidth: 12,
    outside: '#0a0a0c', // au-dela des limites du monde
    nameFill: '#ffffff',
    nameStroke: '#000000',
    massFill: '#ffffff',
    massStroke: '#000000',
  },
  light: {
    bg: '#f2fbff',
    grid: '#cfdce6',
    gridStep: 50,
    border: '#ff3b3b',
    borderWidth: 12,
    outside: '#e2ecf2',
    nameFill: '#ffffff',
    nameStroke: '#2b2b2b',
    massFill: '#ffffff',
    massStroke: '#2b2b2b',
  },
};

export const CELL = {
  // Contour : une version assombrie du remplissage, comme dans le jeu d'origine.
  strokeDarken: 0.82, // facteur multiplicatif sur le RGB
  strokeWidth: (r) => Math.max(2, r * 0.035),
  // Typo des pseudos : taille proportionnelle au rayon, bornee.
  nameSize: (r) => Math.max(12, Math.min(r * 0.42, 92)),
  nameOutline: (size) => Math.max(2, size / 6),
  massSize: (nameSize) => nameSize * 0.5,
  minRadiusForName: 22,
  minRadiusForMass: 42,
};

export const VIRUS = {
  fill: '#33ff33',
  stroke: '#2bbf2b',
  strokeWidth: 8,
  spikes: 22, // nombre de pointes
  spikeDepth: 0.09, // amplitude des pointes, en fraction du rayon
};

export const FOOD = {
  // La nourriture garde un rayon constant a l'ecran quelle que soit la masse.
  jitterSpeed: 0, // mettre > 0 pour faire vibrer les pastilles
};

export const EJECTED = {
  strokeDarken: 0.82,
  strokeWidth: 2,
};

export const BULLET = {
  // Mode Demolition : obus lumineux.
  glow: 18,
  strokeWidth: 3,
  core: '#ffffff',
};

export const FONT = {
  family: '"Ubuntu", "Trebuchet MS", "Segoe UI", system-ui, sans-serif',
  weight: '700',
};

// --- Utilitaires de couleur --------------------------------------------------

const _cache = new Map();

/** Assombrit une couleur hex par un facteur (0..1). Resultat memoise. */
export function darken(hex, factor) {
  const key = hex + factor;
  const hit = _cache.get(key);
  if (hit) return hit;
  const n = parseInt(hex.slice(1), 16);
  const r = Math.round(((n >> 16) & 255) * factor);
  const g = Math.round(((n >> 8) & 255) * factor);
  const b = Math.round((n & 255) * factor);
  const out = `rgb(${r},${g},${b})`;
  _cache.set(key, out);
  return out;
}

export const colorOf = (i) => PALETTE[((i % PALETTE.length) + PALETTE.length) % PALETTE.length];
