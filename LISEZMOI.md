# Prototype A — Déformation deux murs

## À quoi sert ce prototype ?

Ce prototype prouve qu'on peut prendre **une seule source** (vidéo ou image) et la projeter sur **deux murs en angle**, en déformant chaque partie pour qu'elle tombe pile sur son mur.

C'est le principe de base de tout le projet : la moitié gauche de l'image va sur le mur de gauche, la moitié droite sur le mur de droite. Chaque zone est ajustée par 4 coins déplaçables à la souris.

La déformation est une vraie **homographie** (correction de perspective complète), pas une simple division en deux triangles qui casserait les lignes droites.

---

## Structure des fichiers

```
A-deformation/
├── serveur.js          — le serveur Node.js (Express)
├── package.json        — description des dépendances
├── reglages.json       — positions des coins (créé automatiquement)
├── media/
│   └── source.mp4      — votre vidéo (à déposer ici)
└── public/
    ├── index.html      — la page envoyée au projecteur
    ├── app.js          — le code principal (Three.js, souris, clavier)
    └── homographie.js  — module de calcul d'homographie (réutilisable)
```

---

## Comment lancer le prototype

### Prérequis
- **Node.js** installé (version 18 ou plus récente)
- Une connexion Internet pour la première ouverture (Three.js est chargé depuis le web)

### Étapes

**1. Ouvrir un terminal** dans le dossier `A-deformation/`

Sur Mac/Linux :
```bash
cd Desktop/cryptoportiques/prototypes/A-deformation
```

**2. Installer les dépendances** (une seule fois)
```bash
npm install
```
> `npm install` lit le fichier `package.json` et télécharge Express (le serveur web).

**3. Lancer le serveur**
```bash
npm start
```
> Vous devriez voir : `Serveur démarré : http://localhost:3000`

**4. Ouvrir le navigateur**

Allez sur : **http://localhost:3000**

La page s'affiche avec deux zones colorées (bleue = mur gauche, orange = mur droit) et leur grille de test.

---

## Ajouter une vraie vidéo (optionnel)

Déposez votre fichier vidéo ici :
```
A-deformation/media/source.mp4
```
Puis relancez le serveur (`Ctrl+C` pour arrêter, `npm start` pour relancer).

---

## Raccourcis clavier

| Touche | Action |
|--------|--------|
| **C** | Afficher / cacher les poignées de réglage (les ronds colorés) |
| **G** | Basculer entre la grille de test et la vraie vidéo |
| **F** | Passer en plein écran (et en sortir) |
| **S** | Sauvegarder les réglages manuellement |

Les réglages sont aussi **sauvegardés automatiquement** après chaque déplacement de coin.

---

## Régler les zones à la souris

1. Appuyez sur **C** pour afficher les poignées.
2. **Cliquez et glissez** un rond coloré pour déplacer un coin.
3. Les positions sont enregistrées automatiquement dans `reglages.json`.
4. Au prochain lancement, les positions sont rechargées.

---

## Tester avec un deuxième écran (à la place du projecteur)

C'est la façon la plus simple de tester sans projecteur.

### Sur Mac
1. Connectez votre deuxième écran (HDMI ou adaptateur).
2. Allez dans **Réglages Système → Écrans** → activez **"Étendre les écrans"**.
3. Ouvrez Chrome ou Firefox sur le deuxième écran.
4. Naviguez vers **http://localhost:3000**.
5. Appuyez sur **F** pour passer en plein écran.
6. Appuyez sur **G** pour afficher la grille de test.
7. Placez-vous dans un coin de la pièce, mettez deux feuilles de papier en angle (90°) et réglez les coins pour que chaque grille tombe pile sur sa feuille.

### Sur Windows
1. Connectez le deuxième écran.
2. Faites un clic droit sur le bureau → **Paramètres d'affichage** → choisissez **"Étendre ces affichages"**.
3. Même démarche ensuite.

### Astuce pour simuler le coin des deux murs
- Posez deux feuilles A4 sur une table en faisant un angle droit (comme le coin d'un mur).
- Projetez depuis l'écran (en mode fenêtré, tournée vers les feuilles) ou utilisez l'écran à la place du mur.
- Réglez les 4 coins de chaque zone pour que la grille s'aligne sur les feuilles.
- Vérifiez que les lignes de la grille restent droites même dans les coins : si oui, l'homographie fonctionne.

---

## Comment ça marche (en bref)

```
[Source vidéo/grille]
       │
       ▼
[Shader homographie]  ← matrice calculée depuis les 4 coins
       │
  ┌────┴────┐
  │         │
[Zone gauche]   [Zone droite]
(0..50% source)  (50..100% source)
       │
       ▼
[Fond noir — tout ce qui dépasse est masqué]
       │
       ▼
[Navigateur → Projecteur → Mur]
```

L'**homographie** est la transformation mathématique qui transforme un rectangle en n'importe quel quadrilatère en gardant les lignes droites. Elle est calculée en JavaScript (module `homographie.js`) et envoyée à la carte graphique sous forme de matrice 3×3.

---

## Module réutilisable

Le fichier `public/homographie.js` expose `window.Homographie` avec deux fonctions :

- `Homographie.calculerHomographie(coins)` — retourne une matrice Float32Array 3×3 prête pour les shaders GLSL
- `Homographie.coinsParDefaut(cote)` — retourne les 4 coins par défaut pour 'gauche' ou 'droite'

Ce module sera réutilisé dans les prototypes B, C et suivants.
