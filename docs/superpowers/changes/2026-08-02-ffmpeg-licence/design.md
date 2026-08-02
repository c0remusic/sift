# FFmpeg — sortir des builds GPL et non-free

**Ouvert** : 2026-08-02 · **Windows : livré** · **macOS : bloqué, aucune source retenue**

## Le problème, mesuré

Sift redistribue un binaire FFmpeg par plateforme, récupéré au bootstrap par
`scripts/fetch-ffmpeg.mjs`. Les trois sources épinglées ont été téléchargées et
inspectées le 2026-08-02 — pas déduites d'un nom de fichier, mais lues dans la ligne
`configuration:` du binaire lui-même (`ffmpeg -version` sur Windows ; recherche de la
chaîne dans le Mach-O pour les deux builds macOS, qui ne s'exécutent pas ici).

| Source | plateforme | `--enable-gpl` | `--enable-nonfree` |
| --- | --- | --- | --- |
| `ffmpeg-master-latest-win64-gpl.zip` (BtbN) | Windows | oui | non |
| `ffmpeg711arm.zip` (osxexperts) | macOS arm64 | **oui** | non |
| `ffmpeg7intel.zip` (osxexperts) | macOS x86_64 | **oui** | **oui** |

Les trois embarquent `libx264` et `libx265`, deux bibliothèques GPL-only.

## Pourquoi c'est du poids mort autant qu'un risque

Sift n'invoque que **trois encodeurs**, tous nommés en clair dans
`src-tauri/src/encode.rs:143-145` :

- `libmp3lame` — LAME, LGPL-2.1
- `pcm_s16be`, `pcm_s16le` — natifs FFmpeg

Côté décodage, FFmpeg n'a besoin que des décodeurs natifs (mp3, flac, alac, aac,
vorbis, opus, pcm). Aucun composant GPL-only n'est requis par le produit. Les drapeaux
GPL n'apportent donc rien à Sift : ils ne font qu'imposer leurs contraintes.

Deux conséquences de nature différente, à ne pas confondre :

- **`--enable-gpl`** rend le binaire GPL. Sift l'invoque en sidecar (processus séparé,
  `ffmpeg-sidecar`), ce qui est l'argument classique de l'agrégation — mais c'est une
  question juridique, pas technique, et elle n'est pas tranchée ici. Elle pèse sur le
  projet de vente (voir la mémoire `sift-cle-usb-etat-2026-08-02`, décision « licence
  de Sift »).
- **`--enable-nonfree`** ne demande aucune interprétation : la documentation de FFmpeg
  indique qu'un binaire construit avec ce drapeau **n'est redistribuable sous aucune
  licence**. Il est aujourd'hui dans l'installeur macOS Intel de Sift.

## Windows — livré

`scripts/fetch-ffmpeg.mjs` pointe désormais sur
`ffmpeg-master-latest-win64-lgpl.zip`. Vérifié sur le binaire réellement déposé dans
`src-tauri/binaries/` après un `npm run fetch-ffmpeg` :

- `--enable-gpl` absent, `--enable-nonfree` absent, `--enable-version3` présent
- `libmp3lame`, `pcm_s16be`, `pcm_s16le` présents
- décodeurs `mp3`, `flac`, `alac`, `aac`, `vorbis`, `opus`, `pcm_*` présents
- taille : 204 Mo (GPL) → 110 Mo (LGPL)

Le script cherche le binaire récursivement (`where /r`), donc le changement de nom du
dossier interne (`…-gpl/` → `…-lgpl/`) n'a demandé aucune autre modification.

## macOS — bloqué

Aucune source LGPL macOS n'a été retenue. Les pistes, par ordre de robustesse :

1. **Construire un FFmpeg minimal en CI.** `build.yml` a déjà un runner macOS. Sift
   n'a besoin que de trois encodeurs et d'une poignée de décodeurs : un
   `--disable-everything` suivi des seuls `--enable-encoder` / `--enable-decoder`
   utiles, sans `--enable-gpl`, produirait quelques Mo au lieu de 50-75, et lèverait
   toute ambiguïté. Coût : un job de build à écrire et à épingler.
2. **Trouver un build LGPL macOS publié.** À vérifier de la même façon que ci-dessus
   (lire la ligne `configuration:` du binaire, jamais se fier au nom de l'archive).
   Non exploré.
3. **Renoncer à l'encodage MP3 sur macOS** — écarté : c'est une fonction centrale.

Tant que ce point n'est pas résolu, la distribution macOS reste non conforme, et le
build Intel est le cas dur.

## Trace

- `scripts/fetch-ffmpeg.mjs` — URL Windows changée, commentaire de licence ajouté
  nommant les deux sources macOS non conformes.
- Vérifications faites dans le scratchpad de session, hors dépôt.
