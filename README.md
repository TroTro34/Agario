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
| **Choisi ici** | Les chiffres : 12 de masse par tir, 20 arrachés en vol, 22 rapportés à qui ramasse le projectile arrêté, cadence 0,12 s, masse minimum 40 par cellule. Vitesse ×1,5 (sinon on démarre en limace à 1000 de masse) |

Le cœur du mode tient en trois règles qui se répondent :

- **Toutes les cellules tirent en même temps.** Une salve part de chaque morceau, pas seulement du
  plus gros. Être éclaté n'affaiblit donc pas la puissance de feu — ça la disperse.
- **Le tir est bon marché** (16 de masse) et **le projectile ne disparaît pas** : il ralentit,
  s'immobilise, et devient alors ramassable pour **12** — soit six pastilles d'un coup. Mitrailler à
  l'aveugle nourrit donc l'adversaire, et on peut revenir chercher ses propres tirs perdus.
- **Tirer sur un virus le nourrit**, exactement comme la masse éjectée : au bout de quatre
  projectiles il se duplique et le nouveau part dans la direction du tir.

Deux invariants tiennent cette économie, et les casser rend le mode injouable :

**`eatMass` doit rester inférieur à `cost`.** Sinon tirer *crée* de la masse à partir de rien, et
comme on peut ramasser ses propres projectiles, il suffit de tirer en boucle pour grossir sans
limite. C'est la même règle que l'éjection classique, qui coûte 18 pour une pastille de 14.

**`damage` doit rester sous `cost`.** Sinon chaque projectile est rentable isolément, et comme
*toutes* les cellules tirent, être divisé en 16 multiplie par 16 une action déjà gagnante. À 12 pour
16, arroser coûte toujours plus que ça ne rapporte : tirer redevient un outil tactique — affaiblir
une cible pour la manger — et non une façon de farmer.

**La duplication des virus est bornée par virus, jamais par un total.** Nourrir un virus en crée un
nouveau, qui peut à son tour être nourri. Un plafond global serait le mauvais levier : il punit tout
le monde dès qu'un seul joueur mitraille les virus, et rend le résultat d'un tir dépendant de ce que
font les autres à l'autre bout de la carte. Chaque virus porte donc ses propres limites —
`virusMaxSpawns` dédoublements, et une profondeur de lignée `virusMaxGen`. Un virus d'origine
engendre au plus deux descendants, qui n'engendrent plus rien : la croissance est bornée sans
jamais compter les virus en jeu.

La portée se calcule : `speed × dt / (1 − friction)`, soit environ **1760 unités** parcourues en 3 s.
Le repère utile est le champ de vision — un joueur à 1000 de masse voit environ 2600 unités autour de
lui, donc le tir traverse une bonne part de l'écran. Baisser `friction` raccourcit très vite la
portée : à 0,90 elle tombe à 440 unités, ce qui ne portait même pas jusqu'à une cible visible.
- **Les virus se mangent et font exploser**, comme partout ailleurs. C'est jouable parce que le seuil
  de tir est bas : après explosion, les 16 morceaux font ~69 de masse, au-dessus des 40 requis. On
  reste armé.

Ces trois règles sont liées. `virusEatMinMass` avait été monté à 2500 à une époque où seule la plus
grosse cellule tirait, à partir de 150 : un virus réduisait alors le joueur en morceaux de 69, sous
le seuil, et le désarmait pour de bon. En faisant tirer toutes les cellules à partir de 40, le
problème disparaît et les virus peuvent redevenir mangeables.

Le mécanisme central (masse de départ + `W` qui devient une arme) est bien celui de l'original.

---

## Contrôles

| Touche | Effet |
|---|---|
| Souris | Diriger la cellule |
| Molette | Zoomer / dézoomer (en plus du dézoom automatique lié à la masse) |
| `Espace` | Se diviser — à partir de 36 de masse |
| `W` | Éjecter de la masse — à partir de 32 ; **tirer** en Demolition |
| `Entrée` | Ouvrir le chat / envoyer |
| `Échap` | Fermer le chat, sinon quitter la partie |

Les seuils de masse comptent : sous 32, `W` ne fait volontairement rien. Avec des pastilles à
2 de masse, on les atteint en une dizaine de pastilles.

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

| Mode | Débit par joueur |
|---|---|
| Classique | ~30 ko/s |
| Hardcore | ~23 ko/s |
| Demolition | ~44 ko/s |

Deux leviers, par ordre d'efficacité :

- `NET_RATE` (variable d'environnement, 25 par défaut) — le débit y est directement proportionnel.
  **Cette valeur doit diviser `TICK_RATE`** (voir ci-dessous) ; le serveur arrondit au diviseur
  entier le plus proche et affiche la cadence réelle au démarrage. Avec `TICK_RATE` à 25, les
  valeurs saines sont 25 (un snapshot par pas) ou 12,5 (un sur deux).
- La marge de vue dans `viewRadiusFor()` (`server/room.js`) — elle compte **au carré**.

### Fluidité

Le serveur envoie 25 images/s, le client en affiche 60. Deux mécanismes différents, parce qu'on ne
peut prédire que soi-même.

**Nos propres cellules : prédiction locale.** Le client intègre le mouvement **en continu**, à
chaque image, vers le curseur — c'est ce qui rend le changement de direction instantané, sans
attendre que le serveur soit au courant. L'autorité du serveur n'intervient qu'en **rappel doux**
en arrière-plan (6 % par image, indépendant du nombre d'images par seconde), sauf écart massif
(division, virus, réapparition) où l'on recale d'un coup : adoucir un saut de cette taille donnerait
un élastique bien pire.

Le point subtil est là. Une première version rejouait la physique depuis la position officielle à
chaque image, puis s'y ramenait vivement. En ligne droite c'était lisse, mais **dans les virages
non** : le serveur bouge encore selon l'ancienne direction, puisqu'il n'a pas encore reçu la
nouvelle, donc chaque paquet tirait la cellule en arrière — un à-coup à la cadence des paquets,
uniquement quand on tournait. L'intégration continue supprime ce couplage. Mesuré, l'irrégularité
en ligne droite est passée de 11,2 % à 1,8 % au passage.

Le rayon, lui, reste celui du serveur : la masse dépend de ce qu'on mange, le client n'a pas à en
décider.

Sans ça, notre cellule n'est qu'un écho du serveur : elle avance par paliers et se fige dès que le
flux hoquette — avec la caméra, donc toute la scène.

**Les autres joueurs : interpolation retardée.** On ne connaît pas leurs intentions, donc on ne peut
pas les prédire. Le client garde une file de snapshots et **rend légèrement dans le passé**, en
interpolant entre les deux qui encadrent l'instant rendu. Ce retard absorbe la gigue.

#### `NET_RATE` doit diviser `TICK_RATE`

C'est le piège qui a coûté le plus cher. Avec une simulation à 25 Hz et une diffusion à 20 Hz, deux
snapshots consécutifs sont séparés tantôt par un pas, tantôt par deux : les positions arrivent par
bonds inégaux et **toute la scène tremble, terrain compris**. Mesuré, l'irrégularité passait de 11 %
à 24 % rien qu'à cause de ça.

La diffusion se fait donc **dans la boucle de simulation**, tous les N pas exactement — et non dans
un `setInterval` séparé, qui dériverait de toute façon.

#### Ne jamais réutiliser un identifiant tout de suite

Le client interpole les entités **par identifiant**. Si le serveur libère l'id d'une pastille mangée
et le redonne aussitôt à une pastille créée ailleurs, le client croit voir la même entité à deux
endroits et interpole entre les deux : les pastilles **traversent l'écran à toute vitesse**, en
permanence, à chaque pastille mangée.

Les identifiants avancent donc sans jamais être recyclés immédiatement, et au rebouclage (65535) on
saute ceux encore occupés, ce qui protège les entités de longue durée comme les virus. Le client
garde en plus un garde-fou : un bond de plus de 300 unités entre deux snapshots — six fois ce que
parcourt l'entité la plus rapide du jeu — est traité comme une téléportation, donc sans interpolation.

#### Ne pas aligner la grille sur les pixels

Arrondir les lignes de la grille à des pixels entiers les rend nettes, mais chacune saute d'un pixel
d'un coup, à un moment différent, pendant que les cellules avancent en sous-pixel. Le fond se met à
grouiller par rapport au reste. Positions exactes : lignes légèrement adoucies, décor d'un seul bloc.

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

## Calibrage

Les constantes de base ont été recoupées avec [owenashurst/agar.io-clone](https://github.com/owenashurst/agar.io-clone)
(MIT, © 2015 Huy Tran), une implémentation open source de référence du genre. Aucun code n'en a été
repris — seules les **valeurs** ont servi de point de comparaison :

| Paramètre | Référence | Ici |
|---|---|---|
| Masse de départ | 10 | 10 |
| Cellules max | 16 | 16 |
| Seuil de dédoublement d'un virus | 180 | 180 |
| Masse d'un virus | 100–150 (aléatoire) | 100–150 |
| Seuil d'attrition | 50 | 50 |
| Densité de nourriture | 4,0 / 100k unités² | 2,7 |

La densité est le seul écart assumé : à 4,0 la bande passante monte à 68 ko/s par joueur, contre
~38 à 2,7. C'est un arbitrage d'hébergement, pas de gameplay.

Le mode **Demolition n'existe pas** dans cette référence — c'est un clone d'agar.io classique, sans
tir. Ses mécaniques viennent de `jeu.video/agario`, dont le serveur fait autorité et ne publie
aucune constante de gameplay : son API expose la taille de carte (24000×24000) et le nombre de
joueurs, rien d'autre. Les valeurs du canon sont donc les nôtres, calibrées pour reproduire le
comportement observé.

## Licence

MIT.

Implémentation originale. *Agar.io* est une marque de Miniclip ; ce projet n'y est pas affilié
et ne reprend ni son code ni ses ressources.
