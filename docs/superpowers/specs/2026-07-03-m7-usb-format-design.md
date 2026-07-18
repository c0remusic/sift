# M7 — Utilitaire "Formater la clé USB" (design)

## Problème

M7 (`docs/plan-implementation.md:233`) demande un utilitaire de formatage de
clé USB : FAT32 par défaut (contourne la limite 32 Go de l'assistant GUI
Windows), **amovible uniquement**, double confirmation, exFAT proposé avec
avertissement. Brique isolée, peu de dépendances avec le reste de l'app.
Windows et Mac dès cette itération (décision utilisateur).

## Architecture

Nouveau module `src-tauri/src/usb_format.rs`, deux responsabilités séparées
derrière un trait commun — **jamais** un `if cfg!(windows)` éparpillé dans une
seule fonction, pour isoler le risque (une des deux implémentations n'est pas
testable ici, faute de Mac) :

```rust
trait RemovableDriveBackend {
    fn list(&self) -> Result<Vec<RemovableDrive>, UsbFormatError>;
    fn format(&self, drive: &RemovableDrive, fs: TargetFs) -> Result<(), UsbFormatError>;
}
struct WindowsBackend;   // usb_format/windows.rs
struct MacBackend;       // usb_format/macos.rs
```

- **Windows** — énumération via WMI (`Win32_DiskDrive` + `Win32_LogicalDisk`,
  crate `wmi`) filtrée sur `MediaType`/`InterfaceType` amovible. Formatage via
  `diskpart` scripté (script généré à la volée, `format fs=fat32 quick`) —
  seule voie CLI fiable pour dépasser la limite 32 Go du GUI `format.com`.
- **macOS** — énumération via `diskutil list -plist` (parsing plist), filtré
  sur `RemovableMedia`/`Internal=false`. Formatage via
  `diskutil eraseDisk FAT32 <nom> <identifiant>`.
- **Filtre amovible conservateur** : en cas de doute sur un disque (propriété
  manquante, ambiguë), il est **exclu** de la liste plutôt qu'inclus. Aucun
  disque interne ne doit jamais apparaître, même par bug de détection.

## IPC

- `list_removable_drives() -> Vec<RemovableDrive>` (id, label, taille,
  système de fichiers actuel, identifiant volume/série).
- `format_drive(drive_id: String, fs: TargetFs) -> Result<(), UsbFormatError>`.

## Garde-fou anti-race sur l'identité du disque

Entre le moment où l'utilisateur voit la liste et le moment où il confirme,
une lettre de lecteur peut être réassignée (autre clé USB branchée/débranchée
entre-temps). `format_drive` **revérifie l'identité complète** (numéro de
série volume, pas seulement la lettre/l'id affiché) juste avant d'exécuter le
formatage, et échoue explicitement si elle a changé — pas de fallback silencieux
sur "la lettre correspond toujours, ça doit être la même clé".

## Confirmation (jamais `window.confirm()`)

Rappel CLAUDE.md : un incident réel a déjà eu lieu avec `window.confirm()`
non-bloquant dans ce Tauri/WebView2 (un clic l'a traversé sans affichage,
~265 pistes rangées par erreur). Le formatage est **irréversible** — le
garde-fou doit être construit dans l'UI de l'app, pas dans une boîte système :

- Modal in-app à deux étapes, même famille que
  `BATCH_CONFIRM_THRESHOLD`/`batchConfirmArmed` (`sift-live.ts`) : armé au
  premier clic, confirmé au second, horodaté pour rejeter un double-clic/
  évènement dupliqué.
- Le modal affiche taille + label du disque et exige une **saisie manuelle**
  de confirmation (ex. taper la lettre du lecteur ou son nom) avant que le
  bouton de confirmation finale ne s'active — friction volontaire, cohérente
  avec le caractère destructeur de l'action.
- exFAT accessible seulement via un choix explicite secondaire, avec un
  avertissement inline sur la compatibilité CDJ (pas un simple tooltip).

## Intégration frontend (carte Réglages)

La carte "Formater la clé USB" s'ajoute dans `renderReglagesLive()`
(`frontend/sift-live.ts`) comme une carte de plus **à l'intérieur du wrapper
existant** `<div id="sift-reglages-live">` (voir `wrap.appendChild(...)` —
fix 2026-07-04, doc `docs/design-system-states.md` § Cartes Réglages) — jamais
comme sibling direct de `#content` avec son propre `document.getElementById(
id)?.remove()`, sinon le bug de duplication déjà corrigé une fois
(Bibliothèque/Apparence dupliquées au re-render) se reproduit pour cette
nouvelle carte.

## Hors scope

- Pas de vérification post-formatage du contenu (juste confirmation que la
  commande OS a réussi).
- Pas de support d'autres systèmes de fichiers que FAT32/exFAT.

## Tests

- Rust : tests unitaires sur le filtre de sélection amovible (données WMI/
  diskutil simulées, cas ambigus → exclusion), et sur la revérification
  d'identité (numéro de série changé → erreur).
- Pas de test automatisé du formatage réel (destructif) — vérification
  manuelle sur une vraie clé USB de test avant merge, documentée dans le plan
  d'implémentation.
