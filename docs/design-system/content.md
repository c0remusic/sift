# Sift Design System - Content

## Voix

Sift parle comme un outil de travail : sobre, précis, utile. Les textes doivent
être courts, mais pas cryptiques.

Ton :

- direct ;
- technique quand c'est nécessaire ;
- jamais marketing ;
- jamais paternaliste ;
- jamais ludique pour une erreur ou une action destructive.

## Vocabulaire Canonique

| Concept | Libellé recommandé | Anglais (locale `en`) |
|---|---|---|
| Écran de décision | Revue | Review |
| Liste de traitement | File | Queue |
| Analyse audio | Diagnostic audio | Audio diagnostics |
| Identification/tags | Métadonnées | Metadata |
| Choix de dossier | Destination | Destination |
| Format de sortie | Format | Format |
| Nom calculé | Nom final | Final name |
| Action principale | Convertir | Convert |
| Rejet | Écarter | Set aside |
| État prêt | Prêt à ranger | Ready to file |
| État incomplet | À finaliser | Needs finishing |
| Revérification | Rechercher à nouveau | Search again |
| Tags écrits | Appliquer les tags | Apply tags |
| Résultat Discogs | Match | Match |

⚠️ **« Écarter » ne devient PAS « Discard ».** Le verbe français a été choisi contre « Jeter »
parce que rien n'est supprimé — la piste part dans Écartés et reste là. « Discard » porte la
finalité que « Jeter » portait, donc il rejouerait en anglais l'erreur corrigée en français.
« Set aside » garde le geste et son innocuité.

## États

Libellés courts recommandés :

- Prêt à ranger
- À finaliser
- À vérifier
- Métadonnées fiables
- Diagnostic OK
- Sur-encodé
- Faux lossless probable
- CDJ compatible
- CDJ incompatible
- Destination manquante

Règle : un état doit dire ce que l'utilisateur peut faire maintenant, pas
seulement nommer un résultat technique.

## Actions

Verbes préférés :

- Convertir
- Écarter
- Rechercher
- Appliquer
- Choisir
- Ouvrir
- Annuler

Note : "Convertir" est le libellé du bouton d'action principale (remplace
"Ranger" le 2026-07-10, retour utilisateur — rendu par `frontend/filing.ts`, texte dans
`frontend/i18n/filing.ts` (clé `convert`) depuis la migration i18n du 2026-09-23, décision en
doc-comment à `filing.ts:98`). Le concept
produit reste "déplacer = encoder + ranger" (CLAUDE.md) ; ce n'est plus le
libellé affiché. "Écarter" remplace "Jeter" (même date — commentaire d'origine
`filing.ts:169`, markup `filing.ts:175`).

⚠️ Les deux citations précédentes (`filing.ts:220` et `filing.ts:717`) étaient fausses et
ont été corrigées le 2026-08-05 : `filing.ts` ne compte que 650 lignes, et la ligne 220
est la fermeture d'un handler sans rapport.

Éviter :

- Valider, trop vague ;
- Confirmer, sauf dans une confirmation explicite ;
- Sauvegarder, si l'action encode et déplace ;
- Exporter, sauf pour un vrai fichier de sortie externe.

## Microcopy

La microcopy doit enlever une ambiguïté, pas expliquer l'interface.

Bon usage :

- "Choisis une destination pour convertir"
- "Nom final"
- "Destination manquante"

À éviter :

- longues explications de fonctionnement ;
- répétition d'un warning déjà visible ;
- texte pédagogique permanent dans une zone expert ;
- instructions clavier trop présentes.

## Données Techniques

Pour les valeurs audio et fichier :

- garder les unités visibles ;
- utiliser la police mono pour valeurs tabulaires ;
- aligner les paires label/valeur ;
- éviter les phrases quand une valeur suffit.

Exemples :

- `44 100 Hz`
- `22.1 kHz`
- `0.00 dBFS`
- `AIFF`
- `lossless`

## Tutoiement

L'app **tutoie** partout : « Choisis une destination », « Sélectionne un dossier »,
« Les pistes que **tu** écartes ». Ce n'est écrit nulle part jusqu'ici, donc rien ne
l'empêchait de dériver — et ça a dérivé : `frontend/empty-state.stories.ts:37` vouvoie
(« **Ajoutez** des sources dans Réglages pour commencer. »), et se trompe en plus
d'écran, les sources s'ajoutant depuis Accueil. Storybook étant le miroir vivant des
états, une story fausse est une source de vérité fausse.

Règle : tutoiement, sans exception, y compris dans les stories.

## Langue

L'interface est en français. Les formats, noms de fichiers, genres et sources
externes gardent leur casse et leur langue d'origine.

Éviter le franglais de contrôle quand un terme français clair existe. Garder
"Discogs", "CDJ", "ID3", "AIFF", "WAV", "MP3" tels quels.

Liste complète du jargon conservé, alignée sur `CLAUDE.md` : LOSSLESS, DUPLICATE, MATCH,
FAKE, XML, kbps, kHz, MP3, AIFF, WAV. Ne pas le "corriger".

✅ **`FAKE` dans la modale de lot : TRANCHÉ, gardé tel quel (Antoine, 2026-09-23).**
`frontend/confirm-modal.ts:82` rendait `${data.fakeCount} FAKE → Écarter` (depuis la migration i18n : `frontend/i18n/confirm-modal.ts`, clé `batchFake`), alors que Revue dit
« FAUX » depuis le 2026-09-10 et que `CLAUDE.md` réserve le jargon anglais au rail, aux facettes
et aux chips — « jamais le mot de verdict ». La question s'est posée : compter des pistes fausses
dans une modale, est-ce un mot de verdict ? **Non** — c'est un décompte de catégorie, du même
registre que les chips, et il reste en anglais. Ne pas rouvrir : `lint:jargon` exige d'ailleurs
que `FAKE` figure dans les trois listes, puisqu'il est bel et bien affiché.

⚠️ **Deux corrections à cette liste, le 2026-09-23.** `CHECK MATCH` en sort : il est RETIRÉ du
produit (`frontend/filing.ts:627`, « CHECK MATCH removed entirely — annotation confirmed
intentional »), donc la liste promettait une étiquette que personne ne peut voir. `XML` y entre :
il est AFFICHÉ (« XML Rekordbox illisible — relie un fichier », `frontend/i18n/rekordbox-view.ts`, clé `xmlUnreadable` — `rekordbox-view.ts:371` avant la migration i18n)
et manquait. Les deux défauts vivaient aussi dans `docs/manuel.html`, en ligne, corrigé dans le
même geste. ⚠️ `CLAUDE.md` porte la même liste et le même `CHECK MATCH` mort — son retrait là-bas
demande la validation d'Antoine.

### Locale `en` — ce qui change, et ce qui ne se traduit pas

✅ **L'interface existe en anglais depuis le 2026-09-23** (décision d'Antoine : les deux langues,
au choix — Réglages › Apparence › Langue, `auto` suivant le système). Chaque texte vient d'un
dictionnaire de `frontend/i18n/`, et CE TABLEAU est la source de sa colonne anglaise.
Architecture et pièges : `docs/superpowers/changes/2026-09-23-i18n/design.md`.

Jusqu'à ce jour, ce paragraphe disait « l'app reste en français » : la locale n'existait que pour
le site. Elle vaut désormais pour l'interface d'abord, et pour le site ensuite — voir la règle de
glose plus bas, qui se rattache maintenant à la RELEASE et non plus à l'architecture.

⚠️ **La section « Les mots anglais gardés tels quels » du manuel DISPARAÎT en anglais, elle ne se
traduit pas.** Elle explique au lecteur français pourquoi LOSSLESS, DUPLICATE, MATCH, kbps
restent en anglais ; pour un lecteur anglophone ces mots ne sont pas gardés, ils sont ordinaires,
et la section n'explique plus rien. La remplacer par une note sur les VERDICTS, qui eux ont un
libellé propre.

**Verdicts.** Le français dit VRAI / FAUX / À VÉRIFIER depuis le 2026-09-10.

| FR | EN | pourquoi |
|---|---|---|
| FAUX | FAKE | déjà dans la liste de jargon ci-dessus, donc déjà le mot du métier |
| VRAI | GENUINE | « TRUE » se lit comme un booléen ; « genuine » est le mot du domaine face à un faux |
| À VÉRIFIER | TO CHECK | pas « CHECK » seul, qui se lit comme un bouton d'action et non comme un état |

**Écrans du rail**, dans l'ordre : Review · Log · Filed · To re-source · Trash · Rekordbox ·
USB drive · Settings. Accueil → Home.

**Verbes préférés** : Convert · Set aside · Search · Apply · Choose · Open · Cancel.

**Le tutoiement n'a pas d'équivalent**, et ce n'est pas une perte de règle : l'anglais n'a pas
l'opposition tu/vous, donc ce que le tutoiement encodait — registre direct, jamais cérémonieux —
se rend par la deuxième personne nue et l'impératif. Interdits correspondants : pas de
« please », pas de « kindly », pas de tournure passive pour adoucir une erreur.

⚠️ **RÈGLE DE GLOSE, et c'est elle qui décide de la forme d'une doc anglaise.** Une doc publique
décrit l'app qu'on TÉLÉCHARGE, pas celle de `main`. Tant que la dernière RELEASE expédie des
libellés français, une page anglaise **glose** ces libellés, elle ne les remplace pas : le lecteur
a l'écran sous les yeux, et une doc qui nomme autrement ce qu'il voit est fausse. On écrit donc
« the Review screen (**Revue**) » et « the FAUX verdict (fake) », jamais « the GENUINE verdict »
— ce dernier décrirait une app qu'on ne peut pas encore télécharger.
Mesuré le 2026-09-23 : une première traduction du manuel, faite sans cette règle, annonçait les
trois verdicts en anglais alors que l'app les affichait en français — inutilisable.

**La règle s'éteint à la release qui livre l'interface anglaise**, et pas avant : le site se
déploie depuis `main` (Vercel), donc réécrire le manuel au commit l'aurait publié des semaines
avant l'app qu'il décrit. Ce jour-là, dans le même geste : `docs/manuel.en.html` cesse de gloser
(58 `lang="fr"` au 2026-09-23) et nomme les libellés anglais des dictionnaires ; la section de
jargon y devient une note sur le réglage Langue et les verdicts ; `docs/accueil.en.html` retire
« The app's interface is in French » ; les deux PDF se réimpriment (procédé dans
`scripts/build-site.mjs`) ; et la section `## vX.Y.Z` de `CHANGELOG.md` annonce le réglage.

⚠️ **`CHECK MATCH` est MORT dans le produit** (`frontend/filing.ts:627`, ligne 624 au 2026-09-23 avant la migration i18n). Retiré de la liste de
jargon ci-dessus et de `docs/manuel.html` le 2026-09-23 ; il survit dans `CLAUDE.md`, dont le
retrait demande la validation d'Antoine.

**Divergence assumée vis-à-vis des HIG.** HIG Writing demande une langue simple et
prescrit d'éviter le jargon. Sift le garde parce que ce n'en est pas au sens visé : ce
n'est pas du vocabulaire d'implémentation qui fuit vers l'utilisateur, c'est le
vocabulaire professionnel de sa cible. Le traduire dégraderait la reconnaissance au lieu
de l'améliorer. La règle HIG suppose un public général ; Sift a un public spécialiste.

## Apports HIG Writing

Les HIG rejoignent ce qui précède sur trois points, qui valent d'être nommés :

- **la voix se décide, puis se tient.** Établir un vocabulaire commun et y revenir — le
  tableau § Vocabulaire Canonique est exactement cet instrument ;
- **le ton suit le contexte.** Même voix, registre différent selon que l'utilisateur
  réussit une action ou en rate une. Correspond à l'interdit projet du ton ludique sur
  une erreur ou une action destructive ;
- **un libellé de bouton est un verbe.** Déjà appliqué (§ Actions). Corollaire HIG :
  privilégier la clarté sur l'esprit — "Convertir" bat toute formule trouvée.

Un quatrième point n'est pas encore acquis : les HIG rappellent d'écrire aussi pour les
lecteurs d'écran, et donc de ne pas laisser un libellé ne prendre son sens que de sa
position ou de sa couleur.
