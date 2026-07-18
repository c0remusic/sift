# Checklist comportementale — routage actions Rekordbox (avant/après extraction)

Vérifié dans `tauri dev` réel, page Rekordbox (`renderRekordboxLive`), avec
au moins un candidat en attente par section (Tier 1/2/3 texte/3 pochette) —
sur des données de test, jamais un vrai `master.db`.

## Export
- [ ] Bouton "Réexporter" (`rkbreexport`) déclenche `runNavExport("rekordbox")`
  — statut de lien Rekordbox rafraîchi après.

## Tier 1 — réparations de chemin (`mdb*`)
- [ ] `mdbpick` : clic sur une ligne candidate coche/décoche sa sélection
  (checkbox visuel synchronisé), ne rafraîchit QUE la section réparations.
- [ ] `mdbgrouptoggle` : clic sur l'en-tête de groupe replie/déplie le
  groupe.
- [ ] `mdbgroupselect` : clic sur la sélection de groupe coche/décoche tous
  les IDs du groupe (tri-state : partiel → tout sélectionner, complet →
  tout désélectionner).
- [ ] `mdbdismiss` : ignore une ligne, elle disparaît de la liste pending.
- [ ] `mdbresolve` : résolution manuelle d'un candidat ambigu vers le bon
  chemin.
- [ ] `mdbapply` : nécessite une confirmation `confirmAction` avant
  d'écrire ; annuler la confirmation → aucun appel IPC ; confirmer → applique,
  toast de résultat (N synchronisés / N échoués), rafraîchit la page.

## Tier 2 — dédoublonnage playlist (`mdbdedup`)
- [ ] `mdbdedup` : nécessite une confirmation `confirmAction` avant
  d'écrire ; annuler → aucun appel IPC ; confirmer → applique
  `rekordboxMasterdbDedupPlaylistGroup`, toast de résultat, rafraîchit la
  page.

## Tier 3 métadonnées (`mds*`)
- [ ] `mdspick`/`mdsgrouptoggle`/`mdsgroupselect`/`mdsdismiss`/`mdsresolve`/
  `mdsapply` : même comportement que Tier 1, section métadonnées seule
  rafraîchie.

## Tier 3 pochette (`mas*`)
- [ ] `maspick`/`masgrouptoggle`/`masgroupselect`/`masdismiss`/`masresolve`/
  `masapply` : même comportement que Tier 1, section pochette seule
  rafraîchie.

## Non-régression des autres écrans (le handler de clic est partagé)
- [ ] Écran Revue : sélection de piste dans la file, mode Lot, toujours OK.
- [ ] Écran Écartés : trash/restore/requeue/purge toujours OK.
- [ ] Écran Bibliothèque : facettes/tri/édition toujours OK.
