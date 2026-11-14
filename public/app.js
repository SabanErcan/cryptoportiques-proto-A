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

