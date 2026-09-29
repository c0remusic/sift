// Les textes partagés de l'identification Discogs (`identify-shared.ts`) : liste de candidats vide,
// nom accessible de la liste, les quatre messages d'échec — jeton absent, jeton refusé, débit
// limité, Discogs injoignable —, et depuis #68 la ligne choisie qui rouvre la liste (« N autres »)
// et les toasts d'une release appliquée. Relus par Revue, la fiche Bibliothèque et le bouton « Vérifier » des
// Réglages, qui passent tous par ce module.
//
// Les codes reconnus (`NO_TOKEN`, `BAD_TOKEN`, `RATE_LIMITED:<s>`) sont du PROTOCOLE et restent
// dans le module source : seul le texte affiché vit ici.
import { dict } from "../i18n";

const fr = {
  nothing: "Rien sur Discogs.",
  releases: "Éditions Discogs",
  noToken:
    "L'identification Discogs demande un jeton — sans lui, Sift n'interroge pas Discogs du tout. Il est gratuit et se colle dans Réglages.",
  badToken:
    "Discogs a refusé le jeton — il est invalide, expiré ou révoqué. Ce n'est pas la connexion : réessayer ne changera rien.",
  rateLimited: (seconds: string) => `Discogs limite le débit — réessaie dans ${seconds}s.`,
  unreachable: "Discogs injoignable.",
  others: (n: number) => (n === 1 ? "1 autre" : `${n} autres`),
  switchTitle: "Changer de release parmi les résultats Discogs",
  releaseApplied: "Release appliquée au fichier",
  releaseAppliedNoCover: "Release appliquée — sa pochette n'a pas pu être téléchargée",
  undoFailed: "Rétablir impossible — réessaie",
};

const en: typeof fr = {
  nothing: "Nothing on Discogs.",
  releases: "Discogs releases",
  noToken:
    "Discogs identification needs a token — without one, Sift doesn't query Discogs at all. It's free: paste it in Settings.",
  badToken:
    "Discogs rejected the token — it's invalid, expired or revoked. It's not the connection: trying again won't change anything.",
  rateLimited: (seconds) => `Discogs is rate-limiting — try again in ${seconds}s.`,
  unreachable: "Can't reach Discogs.",
  others: (n) => (n === 1 ? "1 other" : `${n} others`),
  switchTitle: "Change to another Discogs release",
  releaseApplied: "Release applied to the file",
  releaseAppliedNoCover: "Release applied — its cover couldn't be downloaded",
  undoFailed: "Couldn't restore — try again",
};

export const D = { fr, en };
export const T = dict(D);
