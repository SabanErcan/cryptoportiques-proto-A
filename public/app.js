/**
 * Prototype A — Déformation deux murs
 *
 * Une source (vidéo ou image de test), deux zones déformables par 4 coins,
 * avec vraie correction perspective (homographie) via shaders WebGL.
 *
 * Architecture :
 *   - SceneThreeJS : initialise Three.js, la caméra orthographique et le rendu
 *   - ZoneDeformation : un quad (rectangle) avec shader homographique par zone
 *   - GestionCoins : les poignées visuelles et la logique de drag & drop
 *   - Source : gère la vidéo ou la grille de test
 *   - ReglagesServeur : sauvegarde/chargement JSON via le serveur
 */

'use strict';

// ─── Shaders GLSL ────────────────────────────────────────────────────────────
// Un shader est un programme qui tourne sur la carte graphique (GPU).
// GLSL est le langage de ces programmes (similaire au C).

// Shader de vertex : passe les coordonnées NDC au fragment shader.
//
// IMPORTANT — deux espaces de coordonnées coexistent :
//   • UV  (0..1) : repère du quad, (0,0) en bas-gauche, (1,1) en haut-droite
//   • NDC (-1..1) : repère WebGL, (-1,-1) en bas-gauche, (+1,+1) en haut-droite
//
// L'homographie a été calculée avec les coins en NDC. Le shader doit donc
// recevoir des NDC, pas des UV. On passe position.xy directement.
const VERTEX_SHADER = `
attribute vec3 position;
attribute vec2 uv;
varying vec2 vNDC;
void main() {
    vNDC = position.xy;
    gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

// Shader de fragment : applique H⁻¹(NDC → UV source) puis lit la texture.
//
// H⁻¹ reçoit un point en NDC et retourne sa coordonnée UV dans la source
// (0..1). Le masquage noir se fait si le résultat est hors [0,1].
//
// Inversion Y obligatoire : les canvas HTML ont Y=0 en HAUT, mais Three.js
// retourne les textures à l'upload (flipY=true par défaut) pour WebGL qui
// attend Y=0 en BAS. Résultat : UV y=0 lit le bas du canvas, UV y=1 lit
// le haut. On corrige avec (1 - uvSource.y).
const FRAGMENT_SHADER = `
precision mediump float;
uniform sampler2D uTexture;
uniform mat3 uHomographie;
uniform float uCoteSource;

varying vec2 vNDC;

void main() {
    // Applique H⁻¹ : NDC du pixel → coordonnée UV dans le carré source [0,1]
    vec3 p = uHomographie * vec3(vNDC, 1.0);
    vec2 uvSource = p.xy / p.z;

    // Masquage : pixel hors du quadrilatère → noir
    if (uvSource.x < 0.0 || uvSource.x > 1.0 ||
        uvSource.y < 0.0 || uvSource.y > 1.0) {
        gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
        return;
    }

    // Lecture dans la moitié gauche (0..0.5) ou droite (0.5..1.0) de la source.
    // Inversion de Y : uvSource.y=0 = haut de la zone → texture y=1 = haut du canvas.
    vec2 uvFinal = vec2(uCoteSource + uvSource.x * 0.5, 1.0 - uvSource.y);
    gl_FragColor = texture2D(uTexture, uvFinal);
}
`;

// ─── Initialisation Three.js ──────────────────────────────────────────────────

const canvas = document.getElementById('canvas-principal');

// On utilise une caméra orthographique (pas de perspective 3D) :
// l'espace de rendu va de -1 à +1 en X et Y, ce qui correspond exactement
// aux coordonnées WebGL normalisées (NDC). C'est plus simple pour le mapping.
const rendu = new THREE.WebGLRenderer({ canvas, antialias: true });
rendu.setPixelRatio(window.devicePixelRatio);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x000000); // fond noir

// Caméra orthographique : [-1, 1] en X et Y — pas de déformation 3D
const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
camera.position.z = 1;

// ─── État global ──────────────────────────────────────────────────────────────

let afficherCoins = true;      // touche C
let modeGrille = false;        // touche G
let textureSource = null;      // la texture Three.js (vidéo ou grille)
let videoElement = null;       // l'élément <video> HTML si on lit une vidéo

// Les deux zones, chacune avec ses 4 coins et son matériau shader
const zones = {
    gauche: null,
    droite: null,
};

// Coin actuellement glissé à la souris
let coinEnCours = null;        // { zoneId, coinIndex }
let sourisEnfoncee = false;

// ─── Source : vidéo ou grille de test ────────────────────────────────────────

/**
 * Génère une texture de grille colorée pour tester l'alignement.
 * La grille a deux moitiés distinctes (une pour chaque mur).
 */
function creerTextureGrille() {
    const largeur = 1024;
    const hauteur = 512;
    const canvas2d = document.createElement('canvas');
    canvas2d.width = largeur;
    canvas2d.height = hauteur;
    const ctx = canvas2d.getContext('2d');

    // Fond noir
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, largeur, hauteur);

    const tailleCase = 64;
    const couleurs = ['#1a3a6b', '#2e6fb5']; // bleu foncé / moyen = moitié gauche
    const couleursD = ['#6b1a1a', '#b52e2e']; // rouge foncé / moyen = moitié droite

    // Damier pour chaque moitié
    for (let y = 0; y < hauteur; y += tailleCase) {
        for (let x = 0; x < largeur; x += tailleCase) {
            const pair = (Math.floor(x / tailleCase) + Math.floor(y / tailleCase)) % 2 === 0;
            if (x < largeur / 2) {
                ctx.fillStyle = pair ? couleurs[0] : couleurs[1];
            } else {
                ctx.fillStyle = pair ? couleursD[0] : couleursD[1];
            }
            ctx.fillRect(x, y, tailleCase, tailleCase);
        }
    }

    // Lignes de grille blanches
    ctx.strokeStyle = 'rgba(255,255,255,0.5)';
    ctx.lineWidth = 1;
    for (let x = 0; x <= largeur; x += tailleCase) {
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, hauteur); ctx.stroke();
    }
    for (let y = 0; y <= hauteur; y += tailleCase) {
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(largeur, y); ctx.stroke();
    }

    // Ligne de séparation gauche/droite bien visible
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 4;
    ctx.beginPath(); ctx.moveTo(largeur / 2, 0); ctx.lineTo(largeur / 2, hauteur); ctx.stroke();

    // Labels
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 32px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('MUR GAUCHE', largeur / 4, hauteur / 2);
    ctx.fillText('MUR DROITE', (3 * largeur) / 4, hauteur / 2);

    // Numéros de grille pour vérifier la distorsion
    ctx.font = '14px monospace';
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    for (let col = 0; col < largeur / tailleCase; col++) {
        for (let lig = 0; lig < hauteur / tailleCase; lig++) {
            ctx.fillText(`${col},${lig}`, col * tailleCase + tailleCase / 2, lig * tailleCase + tailleCase / 2 + 5);
        }
    }

    const texture = new THREE.CanvasTexture(canvas2d);
    return texture;
}

/**
 * Charge une vidéo MP4 depuis le serveur.
 * @param {string} url - chemin de la vidéo
 * @returns {THREE.VideoTexture}
 */
function chargerVideo(url) {
    const video = document.createElement('video');
    video.src = url;
    video.loop = true;
    video.muted = true;  // autoplay nécessite muted dans Chrome
    video.playsInline = true;
    video.crossOrigin = 'anonymous';

    // Lancement automatique dès que suffisamment chargé
    video.addEventListener('canplay', () => {
        video.play().catch(() => {
            // Si le navigateur bloque l'autoplay, on attend un clic
            document.addEventListener('click', () => video.play(), { once: true });
        });
    });

    video.load();
    videoElement = video;

    const texture = new THREE.VideoTexture(video);
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    return texture;
}

// ─── Zone de déformation ──────────────────────────────────────────────────────

/**
 * Crée une zone de déformation : un quad plein écran avec shader homographique.
 * @param {string} id - 'gauche' ou 'droite'
 * @param {Array} coinsInitiaux - 4 coins initiaux
 * @returns {object} zone avec getter/setter coins et méthode mettreAJour
 */
function creerZone(id, coinsInitiaux) {
    // Variable interne mutable : c'est la seule source de vérité pour les coins.
    // Bug closure classique : si on écrivait juste "coins" comme paramètre et
    // qu'on faisait zone.coins = nouveauTableau depuis l'extérieur, mettreAJour
    // continuerait de lire l'ancien tableau mémorisé à la création de la closure.
    // Avec le getter/setter ci-dessous, zone.coins = x met à jour coinsLocaux,
    // et mettreAJour lit toujours la valeur actuelle de coinsLocaux.
    let coinsLocaux = coinsInitiaux;

    // Un quad plein écran (-1 à 1 en X et Y)
    const geo = new THREE.BufferGeometry();
    const vertices = new Float32Array([
        -1, -1, 0,
        1, -1, 0,
        1, 1, 0,
        -1, 1, 0,
    ]);
    const uvs = new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]);
    const indices = new Uint16Array([0, 1, 2, 0, 2, 3]);
    geo.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    geo.setIndex(new THREE.BufferAttribute(indices, 1));

    // Uniforms : variables passées au shader depuis JavaScript
    const uniforms = {
        uTexture: { value: textureSource },
        uHomographie: { value: new THREE.Matrix3() },
        uCoteSource: { value: id === 'gauche' ? 0.0 : 0.5 },
        uAfficherCoins: { value: false },
    };

    const materiau = new THREE.RawShaderMaterial({
        vertexShader: VERTEX_SHADER,
        fragmentShader: FRAGMENT_SHADER,
        uniforms,
        side: THREE.FrontSide,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        depthTest: false,
    });

    const mesh = new THREE.Mesh(geo, materiau);
    scene.add(mesh);

    // Calcule et envoie la matrice homographique au shader.
    // Lit toujours depuis coinsLocaux (jamais depuis un paramètre figé).
    function mettreAJour() {
        const H = Homographie.calculerHomographie(coinsLocaux);
        const mat3 = new THREE.Matrix3();
        mat3.set(
            H[0], H[3], H[6],
            H[1], H[4], H[7],
            H[2], H[5], H[8]
        );
        mat3.invert();
        // Copie dans la matrice existante plutôt que remplacer la référence,
        // pour que Three.js détecte le changement via sa comparaison interne.
        uniforms.uHomographie.value.copy(mat3);
    }

    mettreAJour();

    // L'objet retourné expose coins via getter/setter.
    // getter : retourne le tableau courant (utilisé par creerPoignees, mettreAJourPoignees, etc.)
    // setter : remplace le tableau interne ET met à jour l'homographie immédiatement.
    return {
        mesh, materiau, uniforms, mettreAJour, id,
        get coins() { return coinsLocaux; },
        set coins(v) { coinsLocaux = v; },
    };
}

// ─── Poignées visuelles (coins) ───────────────────────────────────────────────

const RAYON_POIGNEE = 0.025;  // rayon en coordonnées NDC
const meshPoignees = [];       // tous les meshes de poignées

const COULEURS_ZONES = {
    gauche: new THREE.Color(0x00aaff),  // bleu clair
    droite: new THREE.Color(0xff6600),  // orange
};

/**
 * Crée les 4 poignées visuelles pour une zone.
 * Une poignée est un petit disque (cercle) cliquable.
 *
 * Problème de forme ovale : le canvas est plus large que haut.
 * En coordonnées NDC, 1 unité en X = la moitié de la LARGEUR de l'écran,
 * et 1 unité en Y = la moitié de la HAUTEUR. Un cercle NDC est donc aplati
 * horizontalement à l'affichage. On corrige en étirant le mesh en X par
 * le rapport hauteur/largeur (scale.x = H/L), ce qui annule l'aplatissement.
 */
function creerPoignees(zone) {
    const geo = new THREE.CircleGeometry(RAYON_POIGNEE, 32);
    zone.coins.forEach((coin, i) => {
        const mat = new THREE.MeshBasicMaterial({
            color: COULEURS_ZONES[zone.id],
            depthTest: false,
        });
        const mesh = new THREE.Mesh(geo, mat);
        mesh.position.set(coin.x, coin.y, 0.1);
        // Correction de l'aspect pour que le cercle reste rond
        mesh.scale.x = window.innerHeight / window.innerWidth;
        mesh.renderOrder = 1;
        mesh.userData = { zoneId: zone.id, coinIndex: i };
        scene.add(mesh);
        meshPoignees.push(mesh);
    });
}

/** Synchronise la position des meshes de poignées avec les données des zones. */
function mettreAJourPoignees() {
    meshPoignees.forEach((mesh) => {
        const zone = zones[mesh.userData.zoneId];
        const coin = zone.coins[mesh.userData.coinIndex];
        mesh.position.set(coin.x, coin.y, 0.1);
        mesh.visible = afficherCoins;
    });
}

// ─── Gestion de la souris ─────────────────────────────────────────────────────

/**
 * Convertit les coordonnées pixel de la souris en coordonnées NDC (-1 à 1).
 */
function sourisVersNDC(event) {
    const rect = canvas.getBoundingClientRect();
    return {
        x: ((event.clientX - rect.left) / rect.width) * 2 - 1,
        y: -((event.clientY - rect.top) / rect.height) * 2 + 1,
    };
}

/**
 * Trouve la poignée la plus proche du point donné (dans un rayon cliquable).
 */
function trouverPoigneeProche(pos) {
    const RAYON_CLIC = RAYON_POIGNEE * 2.5;
    let meilleurePoignee = null;
    let meilleureDistance = Infinity;

    meshPoignees.forEach((mesh) => {
        if (!mesh.visible) return;
        const dx = mesh.position.x - pos.x;
        const dy = mesh.position.y - pos.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < RAYON_CLIC && dist < meilleureDistance) {
            meilleureDistance = dist;
            meilleurePoignee = mesh.userData;
        }
    });

    return meilleurePoignee;
}

canvas.addEventListener('mousedown', (e) => {
    if (!afficherCoins) return;
    const pos = sourisVersNDC(e);
    coinEnCours = trouverPoigneeProche(pos);
    if (coinEnCours) sourisEnfoncee = true;
});

canvas.addEventListener('mousemove', (e) => {
    if (!sourisEnfoncee || !coinEnCours) return;
    const pos = sourisVersNDC(e);

    const zone = zones[coinEnCours.zoneId];
    zone.coins[coinEnCours.coinIndex] = { x: pos.x, y: pos.y };
    zone.mettreAJour();
    mettreAJourPoignees();
});

canvas.addEventListener('mouseup', () => {
    if (sourisEnfoncee && coinEnCours) {
        sauvegarderReglages();
    }
    sourisEnfoncee = false;
    coinEnCours = null;
});

// ─── Touches clavier ──────────────────────────────────────────────────────────

document.addEventListener('keydown', (e) => {
    switch (e.key.toLowerCase()) {
        case 'c':
            afficherCoins = !afficherCoins;
            mettreAJourPoignees();
            break;

        case 'g':
            modeGrille = !modeGrille;
            changerSource();
            break;

        case 'f':
            if (!document.fullscreenElement) {
                document.documentElement.requestFullscreen().catch(() => { });
            } else {
                document.exitFullscreen();
            }
            break;

        case 's':
            sauvegarderReglages();
            break;
    }
});

// ─── Sauvegarde et chargement des réglages ────────────────────────────────────

/** Envoie les positions des coins au serveur (POST /reglages). */
function sauvegarderReglages() {
    const donnees = {
        gauche: zones.gauche.coins,
        droite: zones.droite.coins,
    };

    fetch('/reglages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(donnees),
    })
        .then((r) => r.ok ? afficherMessage('Réglages sauvegardés ✓') : afficherMessage('Erreur de sauvegarde'))
        .catch(() => afficherMessage('Serveur inaccessible'));
}

/** Affiche un message temporaire en bas de l'écran. */
function afficherMessage(texte) {
    const el = document.getElementById('message');
    el.textContent = texte;
    el.classList.add('visible');
    setTimeout(() => el.classList.remove('visible'), 2000);
}

/** Charge les réglages depuis le serveur (GET /reglages). */
async function chargerReglages() {
    try {
        const rep = await fetch('/reglages');
        if (!rep.ok) return;
        const donnees = await rep.json();
        if (donnees.gauche) zones.gauche.coins = donnees.gauche;
        if (donnees.droite) zones.droite.coins = donnees.droite;
        zones.gauche.mettreAJour();
        zones.droite.mettreAJour();
        mettreAJourPoignees();
    } catch (_) {
        // Pas de réglages sauvegardés : on garde les valeurs par défaut
    }
}

