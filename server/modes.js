// -----------------------------------------------------------------------------
// Configuration des modes de jeu.
//
// La physique de base suit les constantes classiques du genre :
//   rayon  = 10 * sqrt(masse)      (masse 10 -> r 31.6 ; virus 100 -> r 100)
//   vitesse = 2.2 * masse^-0.439   (px/s, mise a l'echelle par speedMul)
//
// Tout est reglable ici : un seul fichier a toucher pour retoucher un mode.
// -----------------------------------------------------------------------------

export const BASE = {
  // --- Monde ---------------------------------------------------------------
  world: 14142,          // arene carree, cote en unites monde
  foodCount: 1600,       // pastilles maintenues en permanence
  foodMass: 1,
  virusCount: 50,
  bots: 25,              // IA pour que l'arene ne soit jamais vide

  // --- Joueur --------------------------------------------------------------
  startMass: 10,
  minMass: 10,
  maxCells: 16,          // 4 splits successifs = 2^4
  speedMul: 1.0,

  // --- Split ---------------------------------------------------------------
  splitMinMass: 36,      // masse mini d'une cellule pour pouvoir se diviser
  splitSpeed: 780,       // impulsion initiale (px/s)
  splitDecay: 0.88,      // amortissement de l'impulsion par tick

  // --- Ejection (W) --------------------------------------------------------
  ejectMinMass: 35,
  ejectCost: 18,         // masse retiree au joueur
  ejectMass: 14,         // masse du projectile
  ejectSpeed: 780,

  // --- Fusion --------------------------------------------------------------
  mergeBase: 30,         // secondes avant de pouvoir refusionner
  mergeMassFactor: 0.0233,

  // --- Attrition -----------------------------------------------------------
  decayRate: 0.002,      // fraction de masse perdue par seconde
  decayMin: 100,         // en dessous de cette masse, pas d'attrition

  // --- Manger --------------------------------------------------------------
  eatRatio: 1.25,        // il faut etre 25% plus gros
  eatOverlap: 0.4,       // fraction de recouvrement exigee

  // --- Virus ---------------------------------------------------------------
  virusMass: 100,
  virusSplitMass: 180,   // masse a laquelle un virus nourri en ejecte un nouveau
  virusFeedSpeed: 700,
  virusEatMinMass: 133,  // en dessous, on peut traverser un virus sans exploser

  // --- Divers --------------------------------------------------------------
  xpMul: 1,
  cannon: null,          // active uniquement en Demolition
};

// -----------------------------------------------------------------------------
// Les trois modes demandes.
// -----------------------------------------------------------------------------

export const MODES = {
  classique: {
    ...BASE,
    id: 'classique',
    label: { fr: 'Classique', en: 'FFA' },
    desc: {
      fr: 'Mode classique, XP double. Espace pour diviser, W pour nourrir.',
      en: 'Classic mode, double XP. Space to split, W to feed.',
    },
    color: '#b46bff',        // hsl(280 70% 58%)
    icon: 'star',
    xpMul: 2,
    maxPlayers: 800,
    // Physique de reference. Le monde est dimensionne pour la population reelle
    // d'un serveur auto-heberge : sur 14142 unites, l'arene parait vide.
    world: 11180,
    foodCount: 2600,
    virusCount: 45,
    bots: 35,
  },

  hardcore: {
    ...BASE,
    id: 'hardcore',
    label: { fr: 'Hardcore', en: 'Hardcore' },
    desc: {
      fr: 'Sans filet : plus rapide, fusion plus lente, attrition doublee.',
      en: 'No safety net: faster, slower merge, double decay.',
    },
    color: '#e03131',        // hsl(0 72% 51%)
    icon: 'flame',
    maxPlayers: 800,
    world: 9000,             // arene plus serree : on se croise vite
    foodCount: 1300,
    virusCount: 26,
    bots: 30,
    speedMul: 1.25,          // ca va plus vite
    decayRate: 0.004,        // on fond deux fois plus vite
    mergeBase: 40,           // on reste eclate plus longtemps
    mergeMassFactor: 0.03,
    eatRatio: 1.15,          // on se fait manger plus facilement
    splitMinMass: 32,
  },

  demolition: {
    ...BASE,
    id: 'demolition',
    label: { fr: 'Demolition', en: 'Crazy FFA' },
    desc: {
      fr: 'Tu demarres a 1000 de masse. W tire sur les adversaires et leur fait perdre de la masse.',
      en: 'Start at 1000 mass. W shoots opponents and strips their mass.',
    },
    color: '#f76707',        // hsl(15 90% 55%)
    icon: 'bomb',
    maxPlayers: 800,
    // On demarre a 1000 de masse, donc la camera est deja tres dezoomee :
    // il faut un monde plus grand pour que la vue ne couvre pas la carte entiere.
    world: 13000,
    startMass: 1000,
    minMass: 100,            // on ne redescend jamais sous 100
    foodCount: 1500,
    virusCount: 34,
    bots: 30,
    decayRate: 0.003,
    speedMul: 1.5,           // sinon 1000 de masse = une limace
    // W n'ejecte plus de la masse : il tire un obus.
    cannon: {
      minMass: 150,          // masse mini pour tirer
      cost: 30,              // masse perdue par tir
      damage: 45,            // masse arrachee a la cible
      speed: 1150,           // px/s
      radius: 22,
      life: 1.4,             // secondes de vol
      cooldown: 0.18,        // secondes entre deux tirs
    },
  },
};

export const MODE_IDS = Object.keys(MODES);

export function getMode(id) {
  return MODES[id] || MODES.classique;
}
