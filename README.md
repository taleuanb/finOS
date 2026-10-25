# Wealth OS

Application personnelle, pensée pour le mobile (colonne de 390 px), qui suit un patrimoine multi-devises (EUR, MAD, USD) : actifs, métaux précieux, dettes, calculateur de budget et plan d'épargne mensuel. **Notion est l'unique base de données** ; l'app (Next.js 15, TypeScript, Tailwind 4, Recharts) lit et écrit dans Notion, et une synchro quotidienne met à jour les cours et l'historique.

Écrans : Synthèse `/`, Patrimoine `/patrimoine`, Budget `/budget`, Épargne `/epargne`, Métaux `/metaux`.

## Prérequis

- Node.js 20.12 ou plus récent (pour `process.loadEnvFile`) et npm
- Un compte Notion (pour la mise en production) et un compte Vercel (pour le déploiement)

## Développement local

```bash
npm install
cp .env.example .env.local   # puis renseigner au minimum APP_PASSWORD et SESSION_SECRET
npm run dev:demo             # données de démonstration (WOS_DEMO=1), sans Notion
npm run dev                  # avec Notion : NOTION_TOKEN et NOTION_DB_* requis
```

- `APP_PASSWORD` : le mot de passe unique de l'application.
- `SESSION_SECRET` : une chaîne aléatoire d'au moins 32 caractères (par exemple `openssl rand -hex 32`).

`npm run dev` exige les variables Notion (`NOTION_TOKEN` et les `NOTION_DB_*`) : sans `NOTION_TOKEN`, l'app refuse de démarrer les écrans avec une erreur explicite, pour ne jamais afficher de fausses données par oubli. Pour essayer l'app **sans Notion**, lancer `npm run dev:demo` (ou définir `WOS_DEMO=1`) : `FakeRepo` sert alors des données de démonstration gardées en mémoire (les écritures persistent tant que le serveur tourne) et la Synthèse affiche « Données de démonstration ». Ouvrir <http://localhost:3000> et se connecter avec `APP_PASSWORD`.

## Configuration de Notion

1. Créer une **intégration interne** sur <https://www.notion.so/profile/integrations> et copier son jeton : c'est `NOTION_TOKEN`.
2. Dans Notion, ouvrir la page parente **WEALTH** existante, menu `…` → `Connexions` → ajouter l'intégration (la partager avec elle). Copier l'identifiant de la page : c'est `NOTION_PARENT_PAGE_ID`.
3. Renseigner `NOTION_TOKEN` et `NOTION_PARENT_PAGE_ID` dans `.env.local`, puis lancer :

   ```bash
   npx tsx --env-file=.env.local scripts/setup-notion.ts
   ```

   Le script crée la page « Patrimoine » sous WEALTH, avec les bases Actifs, Mouvements, Dettes, Budget, Stratégie, Plan mensuel et Historique. Chaque identifiant `NOTION_DB_*` est affiché dès que sa base est créée ; en cas d'échec, le script rappelle les bases déjà créées (à supprimer avec la page « Patrimoine » avant de relancer).
4. Coller dans `.env.local` les lignes `NOTION_DB_*` affichées par le script. Ce sont des identifiants de **sources de données** (data sources), pas d'anciennes bases.
5. **Restreindre l'accès** : partager la seule page « Patrimoine » avec l'intégration (menu `…` → `Connexions`), puis retirer l'intégration de la page WEALTH. L'intégration n'a ainsi accès qu'à « Patrimoine » et à ses bases.
6. **Compléter la base Stratégie** (une ligne par réglage, colonne `Clé`). Le script crée les lignes avec leurs valeurs par défaut ; il reste à choisir les actifs dans la colonne relation `Actif` :

   | Clé | Colonne utilisée | Rôle |
   | --- | --- | --- |
   | `cible:<Classe>` (ex. `cible:Fonds & ETF`) | `Valeur` = % ; `Actif` = **actif principal** de la classe | Cible de la classe et actif qui reçoit sa part |
   | `actif:or` | `Actif` | Actif « Or » (métaux) |
   | `actif:argent` | `Actif` | Actif « Argent » (métaux) |
   | `actif:epargne` | `Actif` | Actif Épargne qui porte l'argent non investi |
   | `investissement_mensuel` | `Valeur` | Montant à investir par mois (ex. 900) |
   | `zone:<libellé>` (ex. `zone:Neutre`) | `Valeur` = % d'or ; `Texte` = bornes `min-max` (`80-` pour « plus de 80 ») | Grille or/argent ; les bornes acceptent `-`, `–` ou `—` |
   | `devise_affichage` | `Texte` (`EUR`, `MAD` ou `USD`) | Devise d'affichage par défaut |

   **Renseigner les relations `Actif` (actif principal de chaque ligne `cible:…`, `actif:or`, `actif:argent`, `actif:epargne`) avant d'importer les métaux ou de valider un plan** : sans elles, la répartition affiche « Aucun actif principal pour la classe … ».

Aucune écriture n'est faite dans Notion sans action explicite de votre part, sauf les champs « (script) » mis à jour par la synchro.

## Import des achats de métaux

Les achats se trouvent dans `data/metals-purchases.csv` (séparateur `;`, décimales à virgule). **Corrigez le fichier avant l'import** :

- renseigner le poids fin du **Collier** (colonne `poids_fin_g`, vide aujourd'hui) ;
- vérifier les poids des pièces et lingots en argent.

Puis lancer :

```bash
npx tsx --env-file=.env.local scripts/import-metals.ts            # fichier par défaut
npx tsx --env-file=.env.local scripts/import-metals.ts autre.csv  # ou un autre chemin
```

## Déploiement sur Vercel

1. Pousser le dépôt sur GitHub, puis **importer le projet** dans Vercel (framework Next.js détecté).
2. Définir toutes les variables d'environnement (Settings → Environment Variables) :

   | Variable | Rôle |
   | --- | --- |
   | `NOTION_TOKEN` | Jeton de l'intégration Notion |
   | `NOTION_PARENT_PAGE_ID` | Page WEALTH parente |
   | `NOTION_DB_ASSETS`, `NOTION_DB_MOVEMENTS`, `NOTION_DB_DEBTS`, `NOTION_DB_BUDGET`, `NOTION_DB_STRATEGY`, `NOTION_DB_PLAN`, `NOTION_DB_HISTORY` | Identifiants des sources de données (sortie de `setup-notion`) |
   | `APP_PASSWORD` | Mot de passe unique de l'app |
   | `SESSION_SECRET` | Secret de signature du cookie de session (32 caractères minimum) |
   | `CRON_SECRET` | Secret accepté par `/api/sync` pour le cron |
   | `NEXT_PUBLIC_NOTION_STRATEGY_URL` (facultatif) | Lien vers la base Stratégie dans Notion |

   Les actifs, leurs mouvements et les crédits se créent et se modifient directement dans l'écran **Patrimoine** (bouton **Ajouter**, toucher d'une ligne pour la modifier ; plus besoin de passer par Notion, ni de lien vers la base Actifs).

3. Déployer. Le fichier `vercel.json` programme un cron qui appelle `/api/sync` **tous les jours à 05:00 UTC**. Quand `CRON_SECRET` est défini, Vercel l'envoie automatiquement dans l'en-tête `Authorization: Bearer <CRON_SECRET>`, que le middleware accepte pour cette seule route.
4. Sur le plan **Hobby**, un cron ne peut s'exécuter qu'**une fois par jour**.

## Synchronisation manuelle

La synchro (cours, valorisation, instantané d'historique) se lance à la demande avec le bouton **Synchroniser maintenant** (icône ↻ dans l'en-tête de la Synthèse) : il appelle `POST /api/sync`, annonce « N actifs mis à jour » (et le nombre d'erreurs éventuelles) puis rafraîchit l'écran. La Synthèse affiche en permanence « Dernière synchro : JJ/MM HH:mm » (heure de Paris). Hors de l'app, la même route accepte le secret du cron :

```bash
curl -X POST https://<votre-app>.vercel.app/api/sync -H "Authorization: Bearer $CRON_SECRET"
```

En cas d'échec partiel d'une source, les autres actifs sont mis à jour et l'instantané est écrit avec `partial: true` ; le rapport liste les erreurs.

## Tests

```bash
npm test               # tests unitaires et de composants (Vitest)
npm run typecheck      # vérification TypeScript
npm run test:e2e       # test de bout en bout (Playwright)
```

Le test de bout en bout construit l'app (`npm run build`), la démarre avec `next start` sur le port 3210 (`E2E_PORT` pour en changer), avec `APP_PASSWORD=test`, sans `NOTION_TOKEN` et avec `WOS_DEMO=1` (donc `FakeRepo`). Il vérifie la redirection vers `/login`, la connexion, la navigation « Budget » et l'absence de défilement horizontal à 390×844 sur les 5 écrans. Il utilise Chromium : si le navigateur de Playwright est absent, exécuter `npx playwright install chromium`, ou pointer `E2E_CHROMIUM_PATH` vers un exécutable Chromium existant.
