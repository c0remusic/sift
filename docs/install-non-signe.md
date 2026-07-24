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

1. Ouvrir le `.dmg`, glisser Sift dans Applications.
2. Un double-clic normal affiche « Sift ne peut pas être ouvert car il
   provient d'un développeur non identifié » et bloque le lancement.
3. Clic droit (ou Ctrl+clic) sur Sift.app dans Applications → **Ouvrir** →
   confirmer **Ouvrir** dans la boîte de dialogue. Nécessaire une seule fois.
4. Alternative en ligne de commande, si l'étape 3 ne débloque pas :
   `xattr -d com.apple.quarantine /Applications/Sift.app`
