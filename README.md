# Tabata Timer

PWA de timer d'entraînement (Tabata et EMOM) en HTML, CSS et JavaScript vanilla.
Elle s'installe sur l'écran d'accueil et fonctionne hors ligne.

## Fichiers

| Fichier | Rôle |
|---|---|
| `index.html` | Structure des 5 écrans (accueil, séances, édition, historique, séance) |
| `css/style.css` | Thème sombre, couleurs des phases, mise en page portrait et paysage |
| `js/app.js` | Toute la logique, en 12 sections commentées |
| `manifest.json` | Nom, icônes, couleurs, mode plein écran (standalone) |
| `sw.js` | Service worker : cache hors ligne |
| `icons/` | Icône source (SVG) et versions PNG (192, 512, 180 pour l'iPhone) |

## Tester en local

```bash
python3 -m http.server 8000
```

Puis ouvre http://localhost:8000.

## Après chaque modification

Augmente `CACHE_VERSION` dans `sw.js` (`v1` → `v2`…), sinon les téléphones gardent l'ancienne version en cache.
