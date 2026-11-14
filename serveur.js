/**
 * Serveur du prototype A
 *
 * Rôle : servir la page web et enregistrer/lire les réglages des coins.
 *
 * Routes HTTP :
 *   GET  /                     → la page principale (public/index.html)
 *   GET  /reglages             → lit reglages.json et le renvoie
 *   POST /reglages             → reçoit le JSON et l'enregistre dans reglages.json
 *   GET  /media/*              → sert les fichiers vidéo depuis le dossier media/
 *   GET  /api/source-disponible → indique si media/source.mp4 existe (sans 404)
 */

'use strict';

const express = require('express');
const fs      = require('fs');
const path    = require('path');

const app  = express();
const PORT = 3000;

// Chemin vers le fichier de réglages (dans le même dossier que ce serveur)
const CHEMIN_REGLAGES = path.join(__dirname, 'reglages.json');

// Dossier des fichiers statiques (HTML, JS, CSS)
app.use(express.static(path.join(__dirname, 'public')));

// Dossier des médias (vidéo source)
app.use('/media', express.static(path.join(__dirname, 'media')));

// Lecture du corps des requêtes JSON (pour le POST /reglages)
app.use(express.json());

// ── GET /reglages ─────────────────────────────────────────────────────────────
// Renvoie le contenu de reglages.json si le fichier existe.
app.get('/reglages', (req, res) => {
    if (!fs.existsSync(CHEMIN_REGLAGES)) {
        // Première fois : pas encore de réglages sauvegardés
        return res.status(404).json({ erreur: 'Pas encore de réglages.' });
    }
    try {
        const contenu = fs.readFileSync(CHEMIN_REGLAGES, 'utf-8');
        res.json(JSON.parse(contenu));
    } catch (err) {
        res.status(500).json({ erreur: 'Impossible de lire les réglages.' });
    }
});

// ── GET /api/source-disponible ────────────────────────────────────────────────
// Vérifie côté serveur si media/source.mp4 existe et répond toujours 200.
// Cela évite qu'une erreur 404 apparaisse dans la console du navigateur
// quand la vidéo n'a pas encore été déposée dans le dossier media/.
app.get('/api/source-disponible', (req, res) => {
    const chemin = path.join(__dirname, 'media', 'source.mp4');
    res.json({ disponible: fs.existsSync(chemin) });
});

// ── POST /reglages ────────────────────────────────────────────────────────────
// Reçoit les positions des coins et les enregistre dans reglages.json.
app.post('/reglages', (req, res) => {
    const donnees = req.body;

    // Validation minimale : on vérifie que chaque zone a bien 4 coins
    if (!donnees.gauche || !donnees.droite ||
        donnees.gauche.length !== 4 || donnees.droite.length !== 4) {
        return res.status(400).json({ erreur: 'Format de données invalide.' });
    }

    try {
        fs.writeFileSync(CHEMIN_REGLAGES, JSON.stringify(donnees, null, 2), 'utf-8');
        console.log('Réglages sauvegardés.');
        res.json({ ok: true });
    } catch (err) {
        res.status(500).json({ erreur: 'Impossible d\'enregistrer les réglages.' });
    }
});

// ── Démarrage ─────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
    console.log(`Serveur démarré : http://localhost:${PORT}`);
    console.log('Ouvrez cette adresse dans votre navigateur.');
    console.log('Raccourcis : C = coins | G = grille | F = plein écran | S = sauvegarder');
});
