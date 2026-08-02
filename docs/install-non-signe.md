# Installer Sift (build non signé)

Sift n'a pas encore de certificat de signature de code Windows ni de compte
Apple Developer (notarization macOS) — voir
`docs/superpowers/changes/archive/2026-07-24-auto-update/design.md` pour le contexte.
Le premier lancement d'un installeur téléchargé déclenche donc un
avertissement de l'OS. Ces étapes ne sont nécessaires qu'à la **première**
installation manuelle — les mises à jour suivantes passent par l'auto-update
intégré à l'app.

## Windows

1. Double-cliquer l'installeur (`.exe` ou `.msi`) téléchargé.
2. Windows SmartScreen affiche « Windows a protégé votre ordinateur ».
3. Cliquer **Informations complémentaires**, puis **Exécuter quand même**.

## macOS

Les builds publiés sont **Apple Silicon uniquement** (`aarch64`) : la matrice de
`.github/workflows/build.yml` n'a pas d'entrée Intel, et un binaire arm64 ne démarre
pas du tout sur un Mac Intel.

1. Ouvrir le `.dmg`, glisser Sift dans Applications.
2. Un double-clic affiche « Sift ne peut pas être ouvert car il provient d'un
   développeur non identifié » et bloque le lancement.
3. Ouvrir **Réglages Système → Confidentialité et sécurité**, descendre jusqu'au
   message concernant Sift, et cliquer **Ouvrir quand même**. Nécessaire une seule
   fois.
4. En dernier recours, si l'étape 3 ne débloque pas :
   `xattr -d com.apple.quarantine /Applications/Sift.app`

> ⚠️ L'étape 3 disait « clic droit → Ouvrir » jusqu'au 2026-08-02. Ce contournement
> a été **retiré à partir de macOS 15 Sequoia** : le menu contextuel n'offre plus de
> dérogation pour une app non signée, et suivre l'ancienne instruction sur un Mac
> récent mène à une impasse sans message utile. Le passage par les Réglages Système
> fonctionne sur les deux générations.

Ces mêmes étapes sont reprises dans le pied de page des notes de version, ajouté par
`scripts/changelog-section.mjs` — c'est ce que lit quelqu'un à qui on envoie le lien
d'une release. Les deux se corrigent ensemble.
