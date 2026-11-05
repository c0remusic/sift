# Lancement

Décidé par #95 (mécanisme) et #90 (forme, variante C′), tranché le 2026-11-05 pour la sortie.

## Déroulé

1. **Fenêtre native** (`lancement_natif.rs`), visible à ≈ 50 ms : fond de fenêtre et mark complet à
   sa pose de l'icône, centré. `main` reste cachée, WebView2 se crée derrière.
2. **Relais** : la page peint la même pose (`#sift-lancement`) et appelle `lancement_peint`. `main`
   se montre sous la fenêtre native, qui se ferme. L'écart mesuré entre les deux images reste
   invisible : au plus 16 niveaux sur 255, sur les pixels de bord.
3. **Rangement**, 600 ms : l'ambre se redresse et glisse sous le vert, tout le dessin se décale pour
   que le vert finisse au centre, « Sift » apparaît dessous.
4. **Si l'app tarde** : pause de 600 ms, puis l'ambre ressort à sa pose et se range à nouveau. Le
   vert et le nom ne bougent pas. Le logo ne disparaît jamais.
5. **App prête** : le geste en cours finit, puis fondu de 300 ms.

Mouvement réduit (réglage système) : mark fixe, sans geste, seul le fondu reste.

## Valeurs

- Mark : 18 % de la largeur de fenêtre. Nom : 40 % de la largeur du mark, Inter 600.
- Fond : `--color-background-tertiary`. Mark : `--color-hue-orange-solid` et
  `--color-hue-green-solid` en clair, `--color-text-warning` et `--color-text-success` en sombre,
  comme la barre de titre.
- Le rangement vaut le prototype au ralenti ×2. Le ×4 préféré au départ repoussait l'app à ≈ 2,4 s
  à chaque lancement, au-delà du budget de 2 s.
- L'arrivée du vert et la chute de l'ambre du prototype n'existent pas : le natif montre déjà le
  mark complet. Choix d'Antoine du 2026-11-05.

## Contraintes

- Le natif ne lit pas `styles.css`. Ses couleurs sont copiées, et `test/lancement-couleurs.test.ts`
  les tient contre les tokens.
- La taille enregistrée par `window-state` est plus petite que la zone cliente réelle de `main`,
  de la largeur du cadre invisible. Le natif ajoute ce cadre, sinon le mark saute de 8 pixels.
- Un thème forcé dans Réglages passe par `localStorage` pour la page : `theme.ts` n'arrive qu'après
  un aller-retour IPC.
