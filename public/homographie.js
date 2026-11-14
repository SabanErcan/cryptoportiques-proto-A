/**
 * Module homographie — calcul de déformation perspective
 *
 * Une homographie est une transformation mathématique qui mappe
 * un rectangle source vers un quadrilatère quelconque en conservant
 * les lignes droites (contrairement à deux triangles qui les cassent).
 *
 * Ce module est réutilisable dans les prototypes suivants.
 *
 * Référence : algorithme de calcul de matrice homographique 3x3
 * via résolution du système linéaire Ah = 0 (méthode DLT).
 */

/**
 * Calcule la matrice homographique 3x3 qui transforme le carré unitaire
 * [0,0]-[1,0]-[1,1]-[0,1] vers les 4 coins destination.
 *
 * @param {Array} coins - tableau de 4 points [{x,y}, ...] dans l'ordre :
 *   haut-gauche, haut-droite, bas-droite, bas-gauche
 *   coordonnées en pixels dans l'espace WebGL normalisé (-1 à 1)
 * @returns {Float32Array} matrice 3x3 en ordre column-major pour GLSL
 */
function calculerHomographie(coins) {
    // Les 4 coins source : le carré unitaire UV (0 à 1)
    const src = [
        [0, 0],
        [1, 0],
        [1, 1],
        [0, 1],
    ];

    // Les 4 coins destination fournis par l'utilisateur
    const dst = coins.map((c) => [c.x, c.y]);

    // Construction du système linéaire 8x8 (méthode DLT - Direct Linear Transform)
    // Pour chaque correspondance de point, on génère 2 équations
    const A = [];
    for (let i = 0; i < 4; i++) {
        const [sx, sy] = src[i];
        const [dx, dy] = dst[i];
        // Équation 1 : pour la coordonnée x destination
        A.push([-sx, -sy, -1, 0, 0, 0, dx * sx, dx * sy, dx]);
        // Équation 2 : pour la coordonnée y destination
        A.push([0, 0, 0, -sx, -sy, -1, dy * sx, dy * sy, dy]);
    }

    // Résolution par élimination de Gauss pour trouver h (vecteur de 9 valeurs)
    const h = resoudreGauss(A);
    if (!h) {
        // Si la résolution échoue (coins dégénérés), on retourne l'identité
        return new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1]);
    }

    // La matrice 3x3 en ordre column-major pour GLSL (WebGL attend column-major)
    // h = [h00, h01, h02, h10, h11, h12, h20, h21, h22]
    return new Float32Array([
        h[0], h[3], h[6],  // colonne 0
        h[1], h[4], h[7],  // colonne 1
        h[2], h[5], h[8],  // colonne 2
    ]);
}

/**
 * Résout le système homogène Ah = 0 de dimension 8x8 (dernière variable = 1)
 * par élimination de Gauss avec pivot partiel.
 *
 * @param {Array} A - matrice 8x9 (8 équations, 9 inconnues dont la dernière = 1)
 * @returns {Array|null} vecteur solution de 9 valeurs, ou null si échec
 */
function resoudreGauss(A) {
    const n = 8;
    // On fixe h[8] = 1 (convention) et on résout le système 8x8 réduit
    const b = A.map((ligne) => -ligne[8]);
    const M = A.map((ligne) => ligne.slice(0, 8));

    // Élimination de Gauss avec pivot partiel
    for (let col = 0; col < n; col++) {
        // Chercher la ligne avec le plus grand pivot (stabilité numérique)
        let pivotLigne = col;
        let pivotVal = Math.abs(M[col][col]);
        for (let row = col + 1; row < n; row++) {
            if (Math.abs(M[row][col]) > pivotVal) {
                pivotVal = Math.abs(M[row][col]);
                pivotLigne = row;
            }
        }

        if (pivotVal < 1e-10) return null; // système singulier

        // Échange de lignes
        [M[col], M[pivotLigne]] = [M[pivotLigne], M[col]];
        [b[col], b[pivotLigne]] = [b[pivotLigne], b[col]];

        // Élimination vers le bas
        for (let row = col + 1; row < n; row++) {
            const factor = M[row][col] / M[col][col];
            b[row] -= factor * b[col];
            for (let k = col; k < n; k++) {
                M[row][k] -= factor * M[col][k];
            }
        }
    }

    // Remontée (back substitution)
    const h = new Array(9).fill(0);
    h[8] = 1;
    for (let i = n - 1; i >= 0; i--) {
        h[i] = b[i];
        for (let j = i + 1; j < n; j++) {
            h[i] -= M[i][j] * h[j];
        }
        h[i] /= M[i][i];
    }

    return h;
}

/**
 * Retourne les coins par défaut pour une zone (carré dans l'espace -1 à 1).
 *
 * @param {string} cote - 'gauche' ou 'droite'
 * @returns {Array} 4 coins dans l'ordre : haut-gauche, haut-droite, bas-droite, bas-gauche
 */
function coinsParDefaut(cote) {
    if (cote === 'gauche') {
        return [
            { x: -1.0, y:  0.8 },  // haut-gauche
            { x:  0.0, y:  0.8 },  // haut-droite
            { x:  0.0, y: -0.8 },  // bas-droite
            { x: -1.0, y: -0.8 },  // bas-gauche
        ];
    } else {
        return [
            { x:  0.0, y:  0.8 },  // haut-gauche
            { x:  1.0, y:  0.8 },  // haut-droite
            { x:  1.0, y: -0.8 },  // bas-droite
            { x:  0.0, y: -0.8 },  // bas-gauche
        ];
    }
}

// Export pour utilisation dans le navigateur (module global)
window.Homographie = { calculerHomographie, coinsParDefaut };
