# Wealth OS — Spécification de conception

- **Date :** 2026-10-25
- **Statut :** à relire par l'utilisateur
- **Maquettes :** https://claude.ai/artifact/3vmbwEfwJnwvuoN24qPqas (V2 mobile, 5 écrans)

## 1. Objectif

Une application web personnelle, mobile d'abord, pour suivre son patrimoine et piloter son épargne, dans l'esprit de Finary. **Notion est la base de données** : l'utilisateur y voit et corrige tout, et l'application y ajoute les calculs, les cours automatiques, les graphiques et l'aide à la décision.

**Utilisateur :** une seule personne, propriétaire des données. Ses actifs sont en France (Revolut, LCL, Suravenir) et au Maroc (immobilier et épargne en MAD).

**Critères de succès :**
1. Ouvrir l'app sur mobile et voir son patrimoine net à jour (cours du jour, conversion MAD→EUR) sans rien ressaisir.
2. Savoir chaque mois combien épargner et **où le mettre** (actif par actif), selon ses propres règles.
3. Voir ce qui a été prévu mais pas encore investi, et où se trouve cet argent.
4. Suivre ses métaux précieux achat par achat, avec le signal or/argent.

## 2. Périmètre

### Dans la V1
- **Patrimoine :** actifs et passifs, multi-devises (EUR, MAD, USD), valorisation automatique ou manuelle, historique quotidien.
- **Classes d'actifs :** Immobilier, Autres, Fonds & ETF, PER, Épargne, Crypto, Comptes courants, Startups, Métaux précieux, Noms de domaine. Les passifs sont des crédits.
- **Calculateur de budget :** un budget *type* mensuel (revenus et dépenses par catégorie), qui donne le taux d'épargne et un diagramme de flux.
- **Plan d'épargne mensuel :** répartition de l'épargne à investir par actif, déclaration des achats, et cumul de ce qui n'a pas été investi.
- **Moteur de décision :** rééquilibrage par les apports selon les cibles, et signal or/argent.
- **Écrans :** Synthèse, Patrimoine, Budget, Épargne, Métaux, avec un menu en bas.
- **Confort :** bascule d'affichage EUR/MAD, masquage des montants, synchronisation quotidienne et manuelle.

### Hors V1 (explicitement)
- Agrégation bancaire automatique (Powens, GoCardless…).
- Suivi des dépenses réelles transaction par transaction : le budget est un plan, pas un relevé.
- Projections à long terme (ex. "valeur 2030").
- Notifications push et e-mail.
- Plusieurs utilisateurs ou détenteurs.
- Version bureau dédiée : la mise en page mobile s'élargit simplement sur grand écran.

## 3. Architecture

```
┌────────────┐   lecture/écriture   ┌──────────────────────────────┐
│  Notion    │ ◄──────────────────► │ App Next.js (Vercel Hobby)   │
│ page       │                      │  ├─ pages (mobile-first)     │
│ "Patrimoine│                      │  ├─ /api/sync  (Cron 1×/jour │
│  " (WEALTH)│                      │  │   + bouton manuel)        │
└────────────┘                      │  └─ /api/* actions (budget,  │
                                    │      déclarer un achat)      │
       Sources de cours ───────────►│                              │
       Yahoo · CoinGecko · Change   └──────────────────────────────┘
```

- **Stack :** Next.js (App Router), TypeScript, Tailwind, Recharts (courbes, barres, Sankey) et Vitest.
- **Hébergement :** Vercel, plan Hobby, gratuit.
  - Une tâche Vercel Cron par jour, vers 7 h, heure de Paris.
  - Les secrets (jeton Notion, mot de passe de l'app, secret du cron) sont dans les variables d'environnement Vercel.
- **Accès :** un mot de passe unique. La session est conservée dans un cookie signé, HttpOnly, valable 30 jours. Toutes les routes sont protégées, sauf `/login`. `/api/sync` accepte en plus le secret du cron.
- **Notion :** l'intégration n'a accès **qu'à la page "Patrimoine"**, créée sous la sphère WEALTH du Life OS.
- **Cache :** les lectures Notion sont mises en cache 10 minutes. Le cache est vidé après chaque synchro ou écriture.

### Découpage du code (unités indépendantes)

| Module | Rôle | Dépend de |
|---|---|---|
| `domain/` | Calculs purs, sans réseau : valorisation, conversion de devises, primes métaux, ratio et zones, algorithme de répartition, cumul du plan, budget, agrégats d'historique | rien |
| `prices/` | Un adaptateur par source (Yahoo, CoinGecko, taux de change), derrière une interface `PriceProvider` / `FxProvider` | réseau |
| `notion/` | Lecture et écriture des bases, conversion vers les types du domaine (`Asset`, `Movement`, `Debt`, `BudgetLine`, `PlanLine`, `Strategy`, `Snapshot`) | API Notion |
| `sync/` | Orchestration de la synchro quotidienne | `prices/`, `notion/`, `domain/` |
| `app/` | Écrans et routes d'API d'action | `notion/`, `domain/` |

## 4. Modèle de données Notion

Toutes les bases se trouvent sous la page **Patrimoine**. Les champs marqués *(script)* sont écrits par l'application, jamais à la main.

### 4.1 Actifs
| Propriété | Type | Notes |
|---|---|---|
| Nom | Titre | |
| Classe | Select | Immobilier · Autres · Fonds & ETF · PER · Épargne · Crypto · Comptes courants · Startups · Métaux précieux · Noms de domaine |
| Sous-type | Texte | ex. "Résidence secondaire", "Terrain", "Bien locatif" |
| Établissement | Select | Revolut · LCL · Suravenir · Finary · Banque Maroc · Physique… |
| Devise | Select | EUR · MAD · USD |
| Valorisation | Select | **Auto** ou **Manuelle** |
| Identifiant cotation | Texte | Ticker Yahoo (`AAPL`, `IWDA.AS`), ISIN, identifiant CoinGecko, `XAU`/`XAG`. Seulement pour Auto |
| Valeur manuelle | Nombre | Dans la devise de l'actif. Seulement pour Manuelle |
| Date valeur manuelle | Date | Sert à dater la valeur saisie |
| Quantité | Rollup | Somme des quantités de ses Mouvements (achats − ventes). Pour les métaux, en grammes fins |
| Prix de revient | Rollup | Somme des montants de ses Mouvements, dans la devise de l'actif |
| Cours unitaire | Nombre *(script)* | Dans la devise de cotation |
| Valeur | Nombre *(script)* | Dans la devise de l'actif |
| Valeur € | Nombre *(script)* | Convertie au taux du jour |
| Plus-value / % | Formules | Valeur − prix de revient, dans la devise de l'actif |
| Versement fixe mensuel | Nombre | Optionnel (ex. PER 100 €) |
| Statut sync / Dernière MAJ | Texte / Date *(script)* | |
| Archivé | Case | Exclu des totaux |

### 4.2 Mouvements (versements et achats)
C'est une ligne par achat, versement, vente ou retrait.

| Propriété | Type | Notes |
|---|---|---|
| Libellé | Titre | ex. "20 Francs Suisse" |
| Date | Date | |
| Actif | Relation → Actifs | |
| Type | Select | Achat/versement · Vente/retrait |
| Nature | Select | Pièce · Lingot · Bijou · Part · Token · Versement… |
| Quantité | Nombre | Parts, unités, ou **poids fin en grammes** pour les métaux |
| Montant | Nombre | Prix payé, dans la devise de l'actif |
| Cours spot jour J | Nombre *(script)* | Métaux seulement, en €/kg, d'après l'historique Yahoo |
| Prime % | Formule | Métaux : Montant / (poids fin × spot) − 1 |
| Mois du plan | Texte *(script)* | `AAAA-MM`, renseigné quand le mouvement est déclaré depuis le plan |

### 4.3 Dettes
Nom, Type, Devise, **Capital restant dû** (saisi à la main), Taux, Mensualité, Date de fin, Actif financé (relation), Valeur € *(script)*.

### 4.4 Budget
Une ligne par poste du budget type mensuel.

| Propriété | Type | Notes |
|---|---|---|
| Nom | Titre | "Salaire", "Loyer", "Courses"… |
| Section | Select | Revenu · Dépense |
| Catégorie | Select | Activité, Revenus locatifs, Logement, Vie quotidienne, Abonnements, Dons & famille… (extensible) |
| Montant mensuel | Nombre | |
| Devise | Select | EUR · MAD · USD |
| Ordre | Nombre | Ordre d'affichage (glisser-déposer) |

L'onglet "Investissements" du calculateur n'est **pas** stocké ici : il affiche le plan du mois (4.6).

### 4.5 Stratégie
Une base de paramètres, une ligne par réglage, modifiable à tout moment et relue à chaque calcul.

- **Cible par classe :** % de l'épargne pilotable. Valeurs initiales : Fonds & ETF 45, PER 20, Crypto 10, Métaux 8, Startups 5. Elles sont à ajuster par l'utilisateur. Les classes sans cible ne reçoivent rien ; c'est le cas de l'Épargne, qui est la source de l'argent.
- **Actif principal par classe :** l'actif qui reçoit la part de sa classe. Pour les métaux, ce sont les deux actifs Or et Argent.
- **Montant à investir par mois :** par exemple 900 €. Il doit être inférieur ou égal à l'épargne du mois. Le reste constitue l'épargne libre.
- **Grille or/argent :** 5 zones avec bornes et répartition. Valeurs initiales :

  | Zone | Répartition or / argent |
  |---|---|
  | Moins de 45 | 80/20 |
  | 45–50 | 65/35 |
  | 50–65 | 55/45 |
  | 65–80 | 40/60 |
  | Plus de 80 | 20/80 |

- **Devise d'affichage par défaut :** EUR.
- **Actif "Épargne" de référence :** celui qui porte l'argent non investi.

### 4.6 Plan mensuel
Une ligne par (mois, actif), créée quand le plan du mois est **validé**.

| Propriété | Type |
|---|---|
| Mois | Texte `AAAA-MM` |
| Actif | Relation → Actifs |
| Montant prévu | Nombre (€) |
| Origine | Select : Fixe · Cible · Signal métaux |

### 4.7 Historique
Une ligne par jour *(script)*. Elle contient :
- la date ;
- le total des actifs en €, le total des dettes en €, le patrimoine net en € ;
- une colonne par classe en € ;
- le ratio or/argent ;
- le taux EUR/MAD et le taux EUR/USD du jour ;
- un indicateur "Partiel" (au moins un cours obsolète).

L'écriture est idempotente : relancer la synchro le même jour met à jour la ligne existante.

## 5. Règles métier

### 5.1 Devises
- Chaque actif, mouvement, dette et ligne de budget porte sa **devise**. Les plus-values sont calculées **dans la devise de l'actif**, pour ne pas mélanger performance et effet de change.
- Tout est converti en **EUR** pour les totaux, avec les taux du jour. La bascule d'affichage EUR/MAD reconvertit les totaux.
- **Source des taux :** une API gratuite qui couvre le MAD, par exemple `open.er-api.com` (mise à jour quotidienne, sans clé). La BCE n'est pas utilisée car elle ne publie pas le MAD.
  - Si la source échoue, on garde les derniers taux connus (Historique) et l'instantané est marqué partiel.

### 5.2 Valorisation
- **Auto :** valeur = quantité × cours. Le cours est converti dans la devise de l'actif.
  - Pour les métaux, le cours de l'or `GC=F` ou de l'argent `SI=F` (en $/oz) est converti en €/kg, puis valeur = grammes fins × €/kg ÷ 1000.
- **Manuelle :** valeur = valeur manuelle.
- **Actif Épargne :** son solde est **estimé** (voir 5.4).

### 5.3 Budget
- Épargne du mois = Σ revenus − Σ dépenses, en €.
- Taux d'épargne = épargne du mois ÷ revenus.
- Montant à investir = paramètre Stratégie, plafonné à l'épargne du mois.
- Épargne libre = épargne du mois − montant à investir.
- Le diagramme de flux suit le chemin Revenus → Budget → (Investissements, chaque catégorie de dépense, Épargne libre).

### 5.4 Plan d'épargne et cumul (« l'argent prévu mais non investi »)
1. **Génération :** au 1er du mois (ou à l'ouverture de l'écran Épargne si le plan n'existe pas encore), l'app propose le plan via l'algorithme 5.5. L'utilisateur le **valide**, ce qui écrit les lignes dans Plan mensuel. Il peut ajuster un montant avant de valider.
2. **Déclaration :** "Déclarer l'achat" crée un Mouvement lié à l'actif et au mois. Les mouvements saisis directement dans Notion comptent aussi, via leur date.
3. **À investir (cumul) par actif :** Σ des montants prévus depuis le début du plan − Σ des mouvements d'achat sur la même période, avec un minimum de 0. Un montant non déclaré **reste donc à investir et s'ajoute au mois suivant**.
4. **Statut du mois par actif :** "Déclaré" si les mouvements du mois couvrent le cumul à investir, sinon "En attente".
5. **Solde estimé de l'Épargne :**
   - On part de la dernière valeur manuelle saisie.
   - On ajoute chaque mois l'épargne du mois.
   - On retire les achats déclarés et payés depuis l'Épargne.
   - On repart de zéro à chaque nouvelle saisie manuelle du solde réel.
   - Réservé au plan = Σ des montants à investir. Libre = solde estimé − réservé.

### 5.5 Algorithme de répartition (rééquilibrage par les apports, sans vente)
- **Entrée :** le montant M du mois. Le simulateur accepte aussi un montant annuel.
- **Étape 1, versements fixes :** chaque actif ayant un versement fixe le reçoit en premier. Reste R = M − Σ des versements fixes.
- **Étape 2, classes en retard :**
  - Base = valeur € des classes pilotées + M.
  - Écart par classe = base × cible − (valeur actuelle + versements fixes déjà attribués).
  - Les écarts positifs se partagent R au prorata.
  - Si Σ des écarts est inférieure à R, chaque écart est comblé et le surplus est réparti selon les cibles.
- **Étape 3, dans une classe :** la part de la classe va à son **actif principal** (paramètre Stratégie, ex. Fonds & ETF → HSBC Islamic Global Equity). Pour les métaux, elle est répartie entre l'or et l'argent selon la zone du ratio du jour (grille 4.5).
- **Résultat :** une ligne par actif, avec sa justification (ex. "À 39,8 % pour une cible de 45 % → en retard").

### 5.6 Signal or/argent
- Ratio = cours de l'or en €/kg ÷ cours de l'argent en €/kg. La zone correspondante dans la grille donne la répartition.
- **Alerte de réajustement :** si le ratio reste hors de la zone neutre pendant 14 jours consécutifs, d'après l'Historique.

## 6. Synchronisation quotidienne (`/api/sync`)

1. Lire les Actifs non archivés, la Stratégie, et les Mouvements de métaux dont le spot n'est pas renseigné.
2. Récupérer les cours en lot, chaque source étant traitée indépendamment :
   - Yahoo pour les tickers et les métaux, avec l'historique pour les spots aux dates d'achat ;
   - CoinGecko pour la crypto ;
   - l'API de change pour EUR→MAD et EUR→USD.
3. Calculer les valeurs (règles de la section 5) et écrire dans Notion le cours, la valeur, la valeur €, le statut et la date de MAJ.
4. Renseigner les spots manquants des Mouvements.
5. Écrire ou mettre à jour l'instantané Historique du jour.
6. Vider le cache de l'app.

## 7. Écrans (mobile d'abord, menu en bas)

La référence visuelle est la maquette V2 : fond clair `#F4F5F7`, cartes blanches arrondies, pastilles de performance vertes et rouges, accent pêche `#F4B183`, courbe orange et police Inter. Le menu du bas comporte 5 onglets : **Synthèse · Patrimoine · Budget · Épargne · Métaux**.

1. **Synthèse**
   - Patrimoine net, avec bascule EUR/MAD et 👁 pour masquer les montants (choix mémorisé sur l'appareil).
   - Variation, courbe d'évolution (1M / YTD / 1A / Tout), actifs bruts et passifs.
   - Carte "Plan du mois" (investi / en attente / libre), répartition par classe, cartes "Ma performance" (défilement horizontal).
2. **Patrimoine** : onglets Actifs / Passifs, filtres (Type, Établissement, Devise), groupement par classe avec sous-totaux, et valeur € avec la valeur d'origine en MAD si besoin. Le bouton "Ajouter" ouvre Notion.
3. **Budget** : onglets Revenus / Investissements (plan du mois, lecture seule) / Dépenses. Lignes **modifiables dans l'app** (ajout, suppression, montant, devise, réordonnancement), écrites dans Notion. Résumé avec taux d'épargne, diagramme de flux et export PNG.
4. **Épargne**
   - Sélecteur de mois et épargne du mois.
   - Plan d'investissement avec statut par actif, cumul à investir et bouton "Déclarer l'achat" (montant modifiable avant validation).
   - Compte Épargne (solde estimé, réservé, libre).
   - Graphique épargné vs investi sur 6 mois, et simulateur mensuel/annuel.
5. **Métaux** : valeur totale, fiches or et argent (cours, cours moyen d'achat, investi, prime), signal et répartition du mois, courbe du ratio sur 5 ans avec zones, liste des achats (alerte poids brut/fin).

Sur un écran large, le contenu se centre (`max-width`). Le menu du bas reste, car la V1 n'a pas de version bureau dédiée.

## 8. Gestion des erreurs

- **Synchro :** chaque actif est isolé. En cas d'échec, l'actif garde son dernier cours, son statut passe à "⚠ <raison>" et l'instantané est marqué partiel. Les autres actifs continuent.
- **Notion lent ou injoignable :** l'app affiche le cache avec un bandeau "Données du <date>". Les actions d'écriture affichent une erreur claire et ne sont pas perdues : le formulaire garde sa saisie.
- **Limite de débit de Notion** (environ 3 requêtes par seconde) : une file avec temporisation et nouvelles tentatives à délai croissant sur les erreurs 429.
- **Saisie incohérente :** un actif Auto sans identifiant, ou un métal sans poids fin, reçoit un statut explicite, sans planter.
- **Dernière synchro réussie :** toujours visible dans l'app.

## 9. Tests

- **`domain/` (tests unitaires, priorité) :**
  - prime de la pièce de 20 Francs Suisse (547 €, 6,4516 g, 82 100 €/kg) = 3,27 % ;
  - conversions MAD, €/kg ;
  - ratio et zones ;
  - algorithme de répartition : cas chiffrés calculés à la main (écarts inférieurs à R, écarts supérieurs à R, versement fixe seul, zone métaux non neutre) ;
  - cumul du plan sur plusieurs mois avec et sans déclaration ;
  - solde estimé de l'Épargne ;
  - calculs du budget.
- **`prices/` et `notion/` :** tests sur des réponses enregistrées, sans appel réseau.
- **`sync/` :** test d'orchestration avec des faux fournisseurs, y compris l'échec d'une source.
- **Bout en bout :** test de fumée Playwright (connexion puis Synthèse visible) à la largeur d'un mobile.

## 10. Mise en place et données initiales

1. Un script crée la page "Patrimoine" sous la sphère WEALTH, puis les 7 bases et leurs propriétés.
2. **Import des 7 achats de métaux** du tableur, après correction par l'utilisateur de 3 incohérences :
   - le poids total d'argent : 593,3 g contre environ 780 g attendus ;
   - les cours de l'argent saisis ;
   - le poids fin du collier.
3. L'utilisateur saisit ses actifs dans Notion, en reprenant la liste Finary (19 actifs, 1 crédit), son budget type et ses paramètres de Stratégie.

## 11. Livraison par phases (un seul plan d'implémentation)

1. **Socle :** projet, authentification, couche Notion, création des bases, `domain/` valorisation et devises, synchro, Synthèse et Patrimoine.
2. **Métaux :** spots historiques, primes, signal, écran Métaux.
3. **Budget et Épargne :** calculateur, plan mensuel, cumul, solde estimé, déclaration d'achat, simulateur.

## 12. Hypothèses

- La valeur par défaut des cibles par classe est un point de départ, à ajuster dans Notion.
- Une seule source de taux de change gratuite suffit ; on pourra en changer derrière `FxProvider`.
- Les fonds sans ticker Yahoo exploitable (ex. HSBC Islamic Global Equity, ISIN LU0806931092) passent en valorisation **Manuelle** si la recherche par ISIN échoue.
- Le plan du mois est validé par l'utilisateur ; aucune génération silencieuse n'écrit dans Notion sans son action.
