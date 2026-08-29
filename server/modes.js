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
  // Pastilles a 2 de masse : un peu plus grosses (rayon 14 au lieu de 10) et
  // deux fois plus nourrissantes. On atteint donc les seuils de split et
  // d'ejection deux fois plus vite.
  foodMass: 2,
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
  // Seuil abaisse a 32 : il doit rester au-dessus de ejectCost + minMass (28),
  // sinon ejecter ferait passer sous le plancher de masse.
  ejectMinMass: 32,
  ejectCost: 18,         // masse retiree au joueur
  ejectMass: 14,         // masse du projectile
  ejectSpeed: 780,

  // --- Fusion --------------------------------------------------------------
  mergeBase: 30,         // secondes avant de pouvoir refusionner
  mergeMassFactor: 0.0233,

  // --- Attrition -----------------------------------------------------------
  decayRate: 0.002,      // fraction de masse perdue par seconde
  decayMin: 50,          // en dessous de cette masse, pas d'attrition

  // --- Manger --------------------------------------------------------------
  eatRatio: 1.25,        // il faut etre 25% plus gros
  eatOverlap: 0.4,       // fraction de recouvrement exigee

  // --- Virus ---------------------------------------------------------------
  // Masse d'un virus, tiree au hasard dans cet intervalle a chaque apparition.
  // Une masse fixe rendait tous les virus identiques : il fallait toujours le
  // meme nombre de tirs pour en dedoubler un. Avec une masse variable, certains
  // sont deja proches du seuil et d'autres non, ce qui rend leur lecture utile.
  virusMass: 100,        // plancher, sert aussi de masse de reinitialisation
  virusMassMax: 150,
  virusSplitMass: 180,   // masse a laquelle un virus nourri en ejecte un nouveau
  // La duplication est bornee PAR VIRUS, pas par un plafond global : un plafond
  // global punit tout le monde des qu'un seul joueur mitraille les virus, et
  // rend le resultat d'un tir dependant de ce que font les autres a l'autre
  // bout de la carte.
  //
  // Chaque virus ne peut se dedoubler qu'un nombre limite de fois, et la
  // lignee a une profondeur maximale. Un virus d'origine engendre donc au plus
  // virusMaxSpawns descendants, qui eux-memes n'engendrent plus rien : la
  // croissance est bornee sans jamais regarder le total.
  virusMaxSpawns: 2,     // dedoublements possibles pour un meme virus
  virusMaxGen: 1,        // profondeur de lignee (0 = seuls les virus d'origine)
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
    foodCount: 3400,   // densite 2.7 : la reference est a 4.0, mais 4.0 fait
                       // grimper la bande passante a 68 ko/s par joueur (cf. README)
    virusCount: 90,
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
    foodCount: 2200,   // meme densite que classique
    virusCount: 60,
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
    // Plancher bas : une explosion sur virus produit 16 morceaux d'environ 62,
    // donc bien en dessous. Un plancher a 100 rendait ces morceaux incapables
    // de tirer, et surtout il servait de pretexte a des Math.max() qui
    // REMONTAIENT leur masse. Voir doFire() et moveCells().
    minMass: 20,
    // On demarre a 1000 de masse, donc la camera est tres dezoomee et le champ
    // de vision couvre ~4,5x plus de surface que dans les autres modes. A la
    // densite de reference, un joueur recevrait plus de 1300 pastilles par
    // snapshot : intenable en bande passante. On double la densite precedente
    // sans aller jusqu'a la reference - compromis assume, mesure dans le README.
    foodCount: 1700,
    virusCount: 55,
    bots: 30,
    decayRate: 0.003,
    speedMul: 1.5,           // sinon 1000 de masse = une limace
    // Seuil de duplication ajuste pour ce mode : avec 12 par projectile, le
    // seuil commun de 180 demanderait jusqu'a 7 tirs. A 172 il en faut 4 pour
    // un virus de masse moyenne (125), 2 pour un gros, 6 pour un petit.
    //
    // Le seuil doit IMPERATIVEMENT rester au-dessus de virusMassMax (150),
    // sinon les virus les plus gros naissent deja au-dessus et se dedoublent
    // des le premier tir.
    virusSplitMass: 172,
    // Les virus se mangent et font exploser, comme dans les autres modes : le
    // seuil de base s'applique. (Il avait ete releve a 2500 pour proteger le
    // canon quand seule la plus grosse cellule pouvait tirer et qu'il fallait
    // 150 de masse ; maintenant que TOUTES les cellules tirent a partir de 40,
    // exploser sur un virus ne desarme plus.)
    // W n'ejecte plus de la masse : il tire un projectile.
    //
    // Le tir est BON MARCHE, et TOUTES les cellules du joueur tirent a la fois.
    // Le projectile ralentit puis s'immobilise : une fois arrete, il devient
    // mangeable et rapporte plus qu'il n'a coute. Mitrailler a l'aveugle nourrit
    // donc l'adversaire - c'est tout l'equilibre du mode.
    cannon: {
      minMass: 40,           // masse mini d'une cellule pour tirer
      // eatMass DOIT rester inferieur a cost, sinon tirer cree de la masse a
      // partir de rien : le tireur ramasse ses propres tirs et grossit sans
      // limite. Meme regle que l'ejection classique (18 pour une pastille
      // de 14). Le gain reste gros pour l'adversaire : 12, soit six pastilles.
      cost: 16,              // masse perdue par tir et par cellule
      // damage DOIT rester sous cost. A 20 pour 16, chaque projectile etait
      // rentable en lui-meme : etre divise en 16 multipliait par 16 une action
      // deja gagnante, sans aucune contrepartie. A 12 pour 16, arroser coute
      // toujours plus que ca ne rapporte - tirer redevient un outil tactique
      // (affaiblir une cible pour la manger) et non une facon de farmer.
      damage: 12,            // masse arrachee a la cible en vol
      eatMass: 12,           // masse rapportee a qui le mange une fois arrete
      // Portee = speed * dt / (1 - friction), soit ~1760 unites ici, parcourues
      // en ~3 s. A titre de repere, un joueur a 1000 de masse voit environ
      // 2600 unites autour de lui : le tir porte donc loin dans l'ecran.
      speed: 2200,           // px/s au depart
      friction: 0.95,        // amortissement par pas
      stopSpeed: 40,         // en dessous, le projectile est considere arrete
      cooldown: 0.12,        // secondes entre deux salves
    },
  },
};

export const MODE_IDS = Object.keys(MODES);

export function getMode(id) {
  return MODES[id] || MODES.classique;
}
