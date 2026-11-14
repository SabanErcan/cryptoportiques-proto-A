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

