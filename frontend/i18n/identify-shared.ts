// Les textes partagés de l'identification Discogs (`identify-shared.ts`) : liste de candidats vide,
// nom accessible de la liste, et les quatre messages d'échec — jeton absent, jeton refusé, débit
// limité, Discogs injoignable. Relus par Revue, la fiche Bibliothèque et le bouton « Vérifier » des
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
};

export const D = { fr, en };
export const T = dict(D);
