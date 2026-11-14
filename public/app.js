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

