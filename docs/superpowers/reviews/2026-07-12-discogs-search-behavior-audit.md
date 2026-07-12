# Audit comportement recherche Discogs (2026-07-12)

Déclenché par une vérification manuelle M8 : une piste retaggée avec un chiffre de
marqueur de test ("Friskeee8" / "The Brain Is... 8") ne trouvait aucun résultat
Discogs — cas attendu (chiffre halluciné, aucune release réelle ne le contient), mais
la question soulevée était réelle : le pipeline résiste-t-il au bruit *réaliste* de
nom de fichier Soulseek, et se comporte-t-il comme un humain taperait dans la barre
de recherche Discogs ? Audit direct (lecture de code, pas de fan-out d'agents —
palier mini/normal, 2 fichiers) sur `naming.rs` (reconciliation tags/filename) et
`metadata/discogs.rs` (requête + scoring de mix).

## Corrigé

**Version de mix perdue si du bruit existe ailleurs dans le nom de fichier**
(`naming.rs`, commit `701679e`) — `reconcile()` ne récupérait la version
("(Extended Mix)") depuis le nom de fichier que si **tout le stem** passait le gate
`is_clean`, alors même que les tags étaient propres. Un `[WEB]`/bitrate ailleurs dans
le nom faisait perdre toute la version, privant `best_track_match` de son signal de
désambiguïsation de mix. Découplé via `extract_version_hint`/`extract_trailing_version`
— la version se récupère indépendamment de la propreté globale du stem.

**Bruit source non retiré dans le nettoyage de dernier recours** (`naming.rs`,
même commit) — `clean_stem` ne retirait que les tokens de qualité nus et les
segments `[...]`, jamais les parenthèses de bruit ("(Vinyl Rip)", "(Bootleg)").
Fix sélectif par mot-clé connu (`rip`/`bootleg`/`promo`/`unofficial`) — les
parenthèses porteuses de sens ("(Original Mix)", feat.) restent intactes.

**Fallback recherche déclenché seulement sur 0 résultat littéral** (`discogs.rs`,
commit `701679e`) — un artiste pollué ne renvoie quasiment jamais 0 résultat Discogs
(moteur full-text Solr/Lucene, retourne presque toujours du bruit non pertinent) donc
le retry "titre seul" (le réflexe qu'un humain aurait) ne se déclenchait jamais.
Le scoring tracklist (déjà calculé pour le ranking) est maintenant réutilisé comme
signal : `best_primary <= 0` déclenche aussi le fallback, et seul le meilleur des
deux jeux de résultats (primaire vs titre seul) est gardé. `per_page` aligné de 8 à 6
(= `TRACKLIST_PROBE`, 2 candidats fetché-mais-jamais-scorés supprimés).

**Caractères de syntaxe Lucene non neutralisés dans `q=`** (`discogs.rs`, même
commit) — `sanitize_discogs_query` neutralise `:`/`"`/`AND`/`OR`/`NOT` (mots entiers)
avant l'appel Discogs. Défensif uniquement, parenthèses/tirets/apostrophes laissés
intacts (trop fréquents dans de vrais titres pour risquer un strip aveugle).

## Écarté après vérification

**Version embarquée dans le tag Title jamais promue en `target_version`** — soupçon
initial (asymétrie de poids ×1 vs ×3 dans `track_match_score`) infirmé par un test
écrit pour le prouver (`best_track_match_disambiguates_via_title_tokens_when_version_is_embedded_not_split`,
`discogs.rs`) : le recouvrement de tokens simple suffit déjà à désambiguïser
correctement dans ce cas, puisque chaque mot du nom de mix fait partie des tokens du
titre cible. Pas de gap réel trouvé.

## Confiance moyenne, non vérifié de première main

**Syntaxe de champ Lucene/Solr sur `q=`** — fetch direct de la doc officielle Discogs
et du forum bloqués (403 / connexions réinitialisées, l'automatisation est bloquée
côté Discogs). M'appuie sur une synthèse de recherche web citant elstensoftware.com et
un thread du forum Discogs, non lus directement. Le fix (neutralisation) a été
appliqué par prudence défensive malgré la confiance moyenne, car sans risque de
régression sur une recherche qui ne contenait jamais ces caractères.

360 tests (12 nouveaux) + clippy `-D warnings` clean. Aucune vérification manuelle
`tauri dev` faite sur ce chantier précis (recherche Discogs réelle non requêtée en
session) — à confirmer par Antoine sur un vrai fichier bruité au prochain usage.
