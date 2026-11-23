# Intégrations

Le code de ce dossier ne tourne pas dans notre application. Il n'est pas compilé par `npm run build`.

## Google Sheets : `google-sheets/apps-script.gs`

Reçoit les demandes du formulaire de la page d'accueil (`/api/demande-essai`) et les range dans
l'onglet `Marques` d'un Google Sheet : dédoublonnage par e-mail, refus des e-mails invalides,
notification par mail possible (renseigner `DESTINATAIRE` dans `notify_`).

**Le Sheet actuel** (celui de l'ancienne landing) : son script doit être mis à jour pour enregistrer
les colonnes Plateforme et Commandes par mois.

1. Ouvrir le Google Sheet, **Extensions → Apps Script**.
2. Remplacer le code par celui de `apps-script.gs`, enregistrer.
3. **Déployer → Gérer les déploiements → crayon → Version : Nouvelle version**.

Son URL `/exec` est dans `.env.example`. La mettre dans `GOOGLE_SHEETS_WEBHOOK_URL`.

**Un Sheet neuf** :

1. `sheets.new`, puis **Extensions → Apps Script**, coller `apps-script.gs`, enregistrer.
2. **Déployer → Nouveau déploiement**, type **Application web**, exécuter en tant que **Moi**,
   accès **Tout le monde**. Autoriser l'accès quand Google le demande.
3. Copier l'URL qui finit par `/exec` dans `GOOGLE_SHEETS_WEBHOOK_URL`.

Vérification : ouvrir l'URL `/exec` dans un navigateur, elle répond `{"ok":true,"service":"SwiftStyle pilotes"}`.
Chaque modification du script demande un redéploiement (étape 3 ci-dessus), sinon l'ancienne version reste en ligne.
