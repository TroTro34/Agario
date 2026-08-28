# Agarium

Arène multijoueur type *agar.io*, jouable dans le navigateur, sans compte et sans installation.
Node.js + WebSocket côté serveur, Canvas 2D côté client. Aucune dépendance front, aucun asset externe.

**Trois modes** : Classique, Hardcore, Demolition — **chat en jeu**, **menu** avec pseudo / skin / couleur / choix du mode.

---

## Lancer en local

```bash
npm install
npm start
```

Puis <http://localhost:3000>.

## Déployer sur Render

Le dépôt contient déjà un [`render.yaml`](render.yaml) : Render le détecte tout seul.

1. Sur [dashboard.render.com](https://dashboard.render.com) → **New** → **Web Service**
2. Connecter ce dépôt GitHub
3. Render lit `render.yaml` et pré-remplit tout — il n'y a rien à saisir :
   - Runtime `node`, build `npm ci --omit=dev`, start `node server/index.js`
   - Health check sur `/healthz`
4. **Create Web Service**

Le serveur écoute sur `process.env.PORT`, et le WebSocket passe par le même port (chemin `/ws`),
donc rien à configurer côté réseau.

> **Palier gratuit** : le service s'endort après 15 min sans trafic et met ~30 s à repartir.
> La première connexion après une sieste peut donc traîner. C'est le comportement normal du plan free.

---

## Les modes

Les trois modes viennent du serveur `jeu.video/agario`. Ce que j'ai pu **confirmer** depuis leur
API publique de configuration, et ce que j'ai dû **choisir moi-même**, est séparé ci-dessous —
c'est important si tu veux coller au plus près de l'original.

### Classique (`classique`)

| | |
|---|---|
| **Confirmé** | Libellé « Classique » (`FFA` en anglais), XP double, `Espace` pour diviser / `W` pour nourrir, 4 splits successifs (16 cellules max), pas de bonus, 800 joueurs max |
| **Choisi ici** | Toutes les constantes chiffrées : monde 11180, 2600 pastilles, 45 virus, attrition 0,2 %/s, fusion 30 s + 0,0233 × masse |

C'est le mode de référence : physique classique du genre, sans surcouche.

### Hardcore (`hardcore`)

| | |
|---|---|
| **Confirmé** | Libellé, couleur rouge, `Espace` / `W` identiques, 16 cellules max, pas de bonus, 800 joueurs max |
| **Non publié** | **Le réglage exact.** Leur API décrit ce mode seulement par « Nouvelle version en test » — aucun paramètre chiffré n'est exposé. |
| **Choisi ici** | Interprétation de « sans filet » : vitesse ×1,25, attrition ×2 (0,4 %/s), fusion plus lente (40 s + 0,03 × masse), ratio pour manger abaissé à 1,15 (on se fait manger plus facilement), monde plus serré (9000) |

**C'est le seul mode dont je n'ai pas pu récupérer les spécificités.** Le réglage ci-dessus est
une interprétation cohérente, pas une reproduction. Tout est dans `server/modes.js` si tu veux l'ajuster.

### Demolition (`demolition`)

| | |
|---|---|
| **Confirmé** | Libellé « Demolition » (`Crazy FFA` en anglais), **on démarre à 1000 de masse**, **`W` tire sur les adversaires et leur fait perdre de la masse**, 16 cellules max, 800 joueurs max |
| **Choisi ici** | Chiffres du canon : 30 de masse par tir, 45 arrachés à la cible, portée 1,4 s à 1150 px/s, cadence 0,18 s, masse minimum 150 pour tirer. Vitesse ×1,5 (sinon on démarre en limace à 1000 de masse) |

Un réglage mérite une explication : `virusEatMinMass` est monté à **2500** dans ce mode, contre 133
partout ailleurs. Comme on démarre à 1000, le seuil de base faisait exploser le joueur sur le premier
virus venu, en 16 morceaux de ~69 — sous les 150 requis pour tirer. On perdait donc son canon en
quelques secondes, ce qui vide le mode de son intérêt. Les virus redeviennent dangereux une fois
qu'on a vraiment grossi.

Le mécanisme central (masse de départ + `W` qui devient une arme) est bien celui de l'original.

---

## Contrôles

| Touche | Effet |
|---|---|
| Souris | Diriger la cellule |
| `Espace` | Se diviser |
| `W` | Éjecter de la masse — **tirer** en Demolition |
| `Entrée` | Ouvrir le chat / envoyer |
| `Échap` | Fermer le chat |

---

## Réglages

### Direction artistique

Tout le visuel tient dans **un seul fichier** : [`public/js/theme.js`](public/js/theme.js).
Palette des cellules, couleurs de l'arène (thème sombre et thème clair), virus, épaisseurs de contour,
taille des pseudos. Rien d'autre à toucher pour changer le rendu.

L'arène claire se bascule depuis le menu (case « Arène claire »).

### Règles de jeu

Tout est dans [`server/modes.js`](server/modes.js) : `BASE` porte la physique commune,
chaque mode ne surcharge que ce qui le distingue.

Les deux constantes qui donnent l'échelle du jeu :

```
rayon   = 10 × √masse            → masse 10 = rayon 31,6 ; virus = rayon 100
vitesse = 2,2 × masse^-0,439     → plus on est gros, plus on est lent
```

Le dézoom de la caméra suit `(min(64 / rayon_total, 1))^0,4`.

### Salons au repos

Un salon sans joueur humain **n'est pas simulé du tout**, et ses bots sont retirés jusqu'au
prochain arrivant. Sans ça, trois arènes et une centaine de bots tournent à 25 Hz en permanence
pour personne : mesuré à 4,75 % d'un cœur en continu, soit près de la moitié du quota d'une
instance à 0,1 CPU — brûlé au repos. Au repos le coût est maintenant nul ; une arène active
coûte environ 1,6 % d'un cœur.

C'est le réglage qui rend le projet viable sur un petit hébergement.

### Bande passante

L'autre point à surveiller sur un hébergement gratuit. Consommation mesurée, par joueur :

| Mode | Entités visibles | Débit |
|---|---|---|
| Classique | ~170 | ~25 ko/s |
| Hardcore | ~135 | ~17 ko/s |
| Demolition | ~270 | ~37 ko/s |

Deux leviers, par ordre d'efficacité :

- `NET_RATE` (variable d'environnement, 20 par défaut) — le débit y est directement proportionnel.
  Attention : le client rend légèrement dans le passé pour absorber la gigue, et ce retard vaut
  environ 1,5 intervalle. Baisser `NET_RATE` économise de la bande passante **mais allonge
  d'autant la latence perçue**. 15 reste jouable, en dessous ça devient mou.
- La marge de vue dans `viewRadiusFor()` (`server/room.js`) — elle compte **au carré**.

### Fluidité

Le serveur envoie 20 images/s et le client en affiche 60 : il faut inventer les intermédiaires.

`net.js` conserve une file de snapshots horodatés et **rend légèrement dans le passé** (~85 ms),
en interpolant entre les deux snapshots qui encadrent l'instant rendu. Ce retard volontaire absorbe
la gigue réseau : un paquet en retard arrive avant qu'on en ait besoin, au lieu d'interrompre le
mouvement.

L'approche naïve — viser en permanence le dernier snapshot reçu et s'arrêter une fois arrivé — fige
toutes les entités dès qu'un paquet tarde, ce qui arrive environ une fois sur deux. Le résultat est
un déplacement très visiblement saccadé. `test/interpolation.mjs` mesure ça directement.

La caméra est le barycentre des cellules du joueur **calculé sur les positions déjà interpolées**,
et non une valeur interpolée séparément : sinon elle se désynchronise des cellules et toute la scène
vibre.

Le palier gratuit de Render offre 100 Go/mois, soit de l'ordre de 700 heures-joueur à 40 ko/s.

---

## Architecture

```
server/
  index.js      HTTP + WebSocket, boucles de simulation et de diffusion
  modes.js      configuration des trois modes          <- les règles
  room.js       simulation : physique, collisions, vue
  bots.js       IA (l'arène n'est jamais vide)
  spatial.js    grille de hachage (évite le O(n²))
  protocol.js   encodage binaire des snapshots
  sanitize.js   nettoyage des pseudos et des messages
public/
  js/theme.js   palette et direction artistique        <- le visuel
  js/render.js  rendu Canvas 2D
  js/net.js     WebSocket + interpolation
  js/ui.js      menu, chat, classement
  js/skins.js   skins générés au canvas (aucun asset)
  js/main.js    entrées clavier/souris, boucle de rendu
test/
  physics.mjs        règles du moteur (sans réseau)
  interpolation.mjs  fluidité du rendu sous gigue réseau
  integration.mjs    parcours complet en WebSocket
```

**Réseau.** Les snapshots passent en binaire (8 à 11 octets par entité, ids `u16` recyclés) ;
le reste — arrivée en jeu, chat, classement, roster — passe en JSON, c'est rare et lisible.
Le serveur ne transmet que ce que le joueur voit.

**Le serveur fait autorité** sur toute la simulation. Le client n'envoie que trois choses :
une position visée, « je me divise », « j'éjecte ». Il ne décide jamais de manger quoi que ce soit.

## Tests

```bash
npm test
```

`physics.mjs` vérifie les règles moteur (échelle rayon/masse, seuils de split et d'éjection,
ratio pour manger, explosion sur virus, fusion, dégâts du canon, attrition) en pilotant une `Room`
directement.

`interpolation.mjs` mesure la fluidité : il rejoue un mouvement rectiligne uniforme à travers la
couche réseau, avec gigue et pertes, et compte les **images figées** — celles où rien ne bouge,
exactement ce que l'œil perçoit comme un à-coup. Le seuil est à 0 %.

`integration.mjs` rejoue un parcours complet en WebSocket sur les trois modes — il faut que le
serveur tourne :

```bash
npm run test:net
```

> Sur Windows, `npm test` peut échouer avec « 'node' n'est pas reconnu » : npm lance les scripts via
> `cmd.exe`, qui n'a pas forcément Node dans son `PATH`. Les fichiers se lancent directement
> (`node test/physics.mjs`).

## Licence

MIT.

Implémentation originale. *Agar.io* est une marque de Miniclip ; ce projet n'y est pas affilié
et ne reprend ni son code ni ses ressources.
