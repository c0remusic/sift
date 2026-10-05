// Le bandeau de la surface de travail de Revue (`.sift-dup-banner`) : icône, titre teinté, ligne
// d'explication. Sans DOM ni IPC — Storybook et Vitest exécutent le VRAI rendu
// (`notice-banner.stories.ts`, `test/notice-banner.test.ts`), modèle `rail-source-entry.ts`.
//
// Extrait de `filing.ts::dupBanner` le 2026-09-28, quand un second bandeau l'a rejoint : « Sous
// 320 kbps — trop bas pour le club » (issue #69, piste A choisie par Antoine sur captures de la
// vraie fenêtre). Une seule recette pour les deux, parce que la décision était « même grammaire que
// le doublon » — deux copies du markup auraient dérivé.

type NoticeTone = "warning" | "neutral";

/** Balisage du bandeau. `head`, `body` et `action` sont du MARKUP : l'appelant échappe ce qui
 *  vient de données (un nom de fichier dans le bandeau de doublon), jamais ce qui vient d'un
 *  dictionnaire. `action` : un bouton texte en fin de ligne — « Voir le groupe » sur le bandeau
 *  de doublon (`docs/ui-specs/revue.md`, amendement du 2026-10-05). Le bandeau informe, il ne
 *  décide rien : l'action ne fait que mener ailleurs. */
export function noticeBannerHtml(o: { tone: NoticeTone; icon: string; head: string; body: string; action?: string }): string {
  const fg = o.tone === "warning" ? "var(--color-text-warning)" : "var(--color-text-tertiary)";
  const bg = o.tone === "warning" ? "var(--color-background-warning)" : "var(--color-background-secondary)";
  return (
    `<div class="sift-dup-banner" style="background:${bg}">` +
    `<i class="ti ${o.icon}" style="color:${fg}"></i>` +
    `<div class="sift-dup-banner-body">` +
    `<div class="sift-dup-banner-head" style="color:${fg}">${o.head}</div>` +
    `<div class="sift-dup-banner-where">${o.body}</div>` +
    `</div>${o.action ?? ""}</div>`
  );
}
