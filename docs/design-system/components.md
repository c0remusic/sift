# Sift Design System - Components

> Catalogue oriente usage. Pour les etats precis, consulter
> `docs/design-system-states.md`.

## Shell

Sources principales :

- `frontend/chrome.ts`
- `frontend/styles.css`

Roles :

- title bar native/custom ;
- rail de navigation ;
- espace central ;
- panneaux contextuels.

Regles :

- la title bar doit prolonger visuellement le rail gauche et le fond principal ;
- les separations doivent etre continues, sans decalage ni double bordure ;
- le rail est une structure permanente, pas une carte ;
- la navigation active reste neutre et lisible.

## File De Morceaux

Sources principales :

- `frontend/chrome.ts`
- `frontend/styles.css`

Roles :

- montrer le contexte de traitement ;
- permettre la selection rapide ;
- garder la progression mentale dans un lot.

Regles :

- le panneau peut etre flottant/collapsible ;
- pas d'ombre portee si la position et le fond suffisent ;
- la ligne active doit etre evidente sans ecraser la liste ;
- les noms longs doivent rester scannables.

## Hero Lecteur

Sources principales :

- `frontend/report-view.ts`
- classes `.sift-player-row`, waveform, sliders.

Roles :

- donner l'identite du morceau ;
- permettre l'ecoute rapide ;
- montrer le signal audio au premier niveau.

Regles :

- le hero est la premiere ancre de l'ecran Revue ;
- il peut etre plus grand que les sections d'analyse ;
- waveform, lecture, volume, key-lock et tempo appartiennent au meme groupe ;
- ne pas transformer le lecteur en carte decorative isolee.

## Sections Revue

Sources principales :

- `frontend/report-view.ts`
- `frontend/filing.ts`
- `frontend/styles.css`

Sections canoniques :

- Diagnostic audio ;
- Metadonnees ;
- A finaliser.

Regles :

- Diagnostic audio au-dessus de Metadonnees en layout vertical ;
- les sections reposent sur le fond, pas dans des cartes imbriquees ;
- les titres de section peuvent etre des bulles/pills ;
- pas de separateurs internes gratuits ;
- espacement homogene par niveau : entre sections, entre groupes, entre lignes.

## Diagnostic Audio

Sources principales :

- `frontend/report-view.ts`
- spectrogramme et lignes de mesures.

Roles :

- confirmer le verdict audio ;
- rendre visible le cutoff, la dynamique, le conteneur, les anomalies.

Regles :

- "Signal" et "Conteneur" sont des categories, pas des alertes ;
- ne pas les rendre ambre par defaut ;
- le spectrogramme est une preuve, pas une decoration ;
- les valeurs techniques doivent etre compactes et comparables.

## Metadonnees

Sources principales :

- `frontend/filing.ts`
- `frontend/identify-shared.ts`

Roles :

- confirmer ou corriger Discogs ;
- appliquer les tags utiles ;
- signaler clairement ce qui n'est pas encore grave dans le fichier.

Regles :

- un warning ID3 dans Metadonnees suffit ; ne pas le dupliquer dans A finaliser ;
- les candidats Discogs doivent rester lisibles ;
- les genres sont des tags de selection, pas des badges de statut ;
- "metadonnees fiables" doit rester un signal discret.

## A Finaliser

Sources principales :

- `frontend/filing.ts`
- `#filfoot`
- `#fldz`

Roles :

- choisir la destination ;
- choisir le format ;
- voir le nom final apres format ;
- ranger ou jeter.

Ordre recommande :

1. titre compact "Destination" ;
2. selection de destination ;
3. choix de format ;
4. nom final ;
5. actions principales.

Regles :

- Destination est obligatoire, car elle dit ou ranger ;
- le nom final vient apres le format, car le format change son extension ;
- le nom final ne doit pas dominer visuellement la decision ;
- les actions Convertir/Écarter restent proches du resultat final ;
- `#filfoot` et `#fldz` restent des siblings de `.mid`, pas des enfants de
  l'inspecteur.

## Feedback

Composants concernes :

- verdict ;
- warning ;
- toast ;
- progression ;
- etats de selection.

Regles :

- pas d'aplat vert permanent pour dire "c'est fait" si l'etat est deja compris ;
- utiliser un flash court lors d'une confirmation, puis revenir a un etat neutre ;
- les erreurs bloquantes doivent etre plus visibles que les recommandations ;
- aucune action destructive ne doit dependre de `window.confirm()`.

