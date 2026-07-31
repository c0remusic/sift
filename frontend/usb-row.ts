// Rendu d'une ligne de disque amovible, extrait de `usb-view.ts` pour deux raisons : la story
// Storybook doit appeler la MÊME fonction que l'app (sinon elle documente une copie qui dérive),
// et ce module n'importe que `dom.ts` plus un type — donc l'importer n'entraîne aucun code Tauri,
// contrairement à `usb-view.ts` qui tire `ipc.ts`.
import type { RemovableDrive } from "./ipc";
import { esc } from "./dom";

/** Ce que l'utilisateur appelle ce disque. `drive.id` est devenu un chemin de disque physique
 * (`\\.\PHYSICALDRIVE2`, `/dev/disk4`) le 2026-07-31 pour que les clés non formatées puissent
 * exister dans la liste — correct côté backend, mais illisible sur une ligne et impossible à
 * retaper dans une confirmation. La lettre d'abord ; un disque non monté n'en a pas, donc son
 * numéro. */
export function driveDisplayName(drive: RemovableDrive): string {
  if (drive.mount) return drive.mount;
  const n = /(?:PHYSICALDRIVE|disk)(\d+)/i.exec(drive.id)?.[1];
  return n ? `Disque ${n}` : drive.id;
}

/** Une ligne de la liste. Un lecteur énuméré mais vide (`has_media: false`) garde sa lettre dans
 * l'explorateur Windows et n'a pourtant rien à formater : il est listé ET expliqué, sans bouton,
 * plutôt que masqué — c'est cette contradiction (« aucun disque détecté » alors que l'explorateur
 * montre un lecteur USB) qui a coûté la soirée du 2026-07-31.
 *
 * Toute donnée non fiable passe par `esc()` : modèle et système de fichiers viennent du disque. */
export function usbRowHtml(drive: RemovableDrive): string {
  const sizeGb = (drive.size_bytes / 1_000_000_000).toFixed(1);
  const meta = drive.has_media
    ? `${esc(drive.label || "Disque amovible")} · ${sizeGb} Go · ${esc(drive.current_fs)}`
    : `${esc(drive.label || "Lecteur amovible")} · aucun média inséré`;
  return (
    '<div class="sift-usb-row-info">' +
    `<span class="sift-usb-row-id">${esc(driveDisplayName(drive))}</span>` +
    `<span class="sift-usb-row-meta">${meta}</span>` +
    "</div>" +
    (drive.has_media
      ? '<button type="button" class="sift-settings-btn" data-usb-format>Formater…</button>'
      : "")
  );
}
