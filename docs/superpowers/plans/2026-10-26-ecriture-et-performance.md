# Écriture dans l'app et performance — Plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** (1) Accélérer le chargement des écrans de Wealth OS ; (2) permettre de créer et modifier actifs, mouvements, crédits et réglages de Stratégie directement dans l'app au lieu de renvoyer vers Notion.

**Architecture:** Même architecture que la V1 (`docs/superpowers/plans/2026-10-25-wealth-os.md`) : `Repo` (Notion / FakeRepo), server actions minces + fonctions pures `xxxWith(repo, …)` dans un module non-`'use server'`, vues client testées avec `fixtureDashboard`. La performance repose sur un cache par base Notion (tags par base), des requêtes qui ne demandent que les colonnes utiles et un historique borné.

**Tech Stack:** inchangé (Next.js 15, TypeScript, Tailwind 4, Recharts, `@notionhq/client` v5, Vitest, Playwright). Aucune nouvelle dépendance.

**Spec:** `docs/superpowers/specs/2026-10-25-wealth-os-design.md` (inchangée) ; cette évolution est décrite par la conversation avec l'utilisateur (voir Goal).

## Parallélisation

| Vague | Tâches | Prérequis |
|---|---|---|
| 0 | T0 Contrats (Repo d'écriture, tags de cache, BottomSheet) | — |
| 1 | T1 Performance · T2 Écriture Patrimoine (actifs, mouvements, crédits) · T3 Stratégie (page de réglages) | T0 |

## Global Constraints

Toutes les contraintes de `docs/superpowers/plans/2026-10-25-wealth-os.md` (section Global Constraints) restent valables, en particulier : interface en français et tutoiement ; montants via `<Money>` ; mode masqué (aucun montant en clair, champs montant en `type="password"` quand masqué) ; cibles tactiles ≥ 44 px ; dates en Europe/Paris (`parisDate`, `parisMonth`) ; limite Notion 3 req/s via `withRateLimit` ; jamais de secret dans le code ; pas de nouvelle dépendance.

Règles complémentaires pour cette évolution :
- `Movement.amount` et `Asset.manualValue` sont **dans la devise de l'actif** (EUR, MAD ou USD) ; les formulaires saisissent et affichent dans cette devise.
- Pattern server actions (ruling R6 de la V1) : `src/app/<route>/actions.ts` (`'use server'`, minces : `getRepo()`, appel de la fonction pure, `revalidateNotion(...)` seulement en cas de succès, erreurs génériques en français) + `src/app/<route>/<xxx>Ops.ts` (module normal avec `xxxWith(repo, …)`). Toute entrée du client est revalidée côté serveur (types, énumérations, longueurs ≤ 200, montants finis, dates réelles) et **tout identifiant fourni par le client est vérifié contre les bases** (ex. `listAssets()` / `listDebts()`) avant écriture.
- Les erreurs serveur sont journalisées avec `console.error` (jamais renvoyées au client).
- Feuilles de formulaire : composant partagé `src/ui/BottomSheet.tsx` (T0), jamais de feuille ad hoc.
- Les écritures utilisent `revalidateNotion` (T0) avec les clés de bases concernées, jamais `revalidateTag('notion')`.

## Review Focus

1. **Devise des montants saisis** : un actif en MAD saisi en MAD ne doit jamais être stocké comme des euros (et inversement) ; la valeur € affichée suit le taux du jour.
2. **Identifiants client non vérifiés** : modifier/archiver un actif, un crédit ou une clé de Stratégie dont l'identifiant n'appartient pas à la base doit être refusé sans rien écrire.
3. **Annulation de la dernière modification** : un clic sur Enregistrer qui échoue côté Notion doit conserver la saisie et afficher l'erreur (jamais de feuille fermée avec une saisie perdue).
4. **Cache après écriture** : après création/modification d'un actif, l'écran Patrimoine doit refléter le changement au rechargement (tags de cache corrects), sans vider les autres caches.
5. **Mode masqué** : aucun montant (valeur manuelle, capital restant dû, quantité d'or fin) en clair dans les nouveaux formulaires et listes.

---

### Task 0: Contrats — Repo d'écriture, tags de cache, BottomSheet

**Files:**
- Modify: `src/notion/repo.ts` (interface), `src/notion/fakeRepo.ts`, `src/notion/notionRepo.ts`, `src/notion/mappers.ts`
- Create: `src/lib/cacheTags.ts`, `src/ui/BottomSheet.tsx`
- Test: `src/notion/fakeRepo.test.ts` (étendre), `src/notion/notionRepo.test.ts` (étendre), `src/notion/mappers.test.ts` (étendre), `src/lib/cacheTags.test.ts`, `src/ui/BottomSheet.test.tsx`

**Interfaces:**
- Produces (exact, tout le reste en dépend) :

```ts
// src/domain/types.ts — ajouter
export interface AssetInput {
  name: string; assetClass: AssetClass; subtype?: string; institution?: string;
  currency: Currency; mode: 'auto' | 'manual'; quoteId?: string;
  manualValue?: number; manualValueDate?: string;      // yyyy-mm-dd
  fixedMonthly?: number; archived?: boolean;
}
export interface DebtInput {
  name: string; type?: string; currency: Currency; outstanding: number;
  rate?: number; monthly?: number; endDate?: string; financedAssetId?: string;
}
export interface StrategyEntryInput { key: string; value?: number | null; text?: string | null; assetId?: string | null }

// src/notion/repo.ts — ajouter à l'interface Repo
createAsset(a: AssetInput): Promise<string>;
/** N'écrit que les clés présentes ; `null` efface un champ optionnel. */
updateAsset(id: string, patch: { [K in keyof AssetInput]?: AssetInput[K] | null }): Promise<void>;
createDebt(d: DebtInput): Promise<string>;
updateDebt(id: string, patch: { [K in keyof DebtInput]?: DebtInput[K] | null }): Promise<void>;
deleteDebt(id: string): Promise<void>;                  // corbeille Notion
/** Upsert par clé (titre) ; `null` efface le champ ; absent = inchangé. */
setStrategyEntry(e: StrategyEntryInput): Promise<void>;
deleteStrategyEntry(key: string): Promise<void>;        // corbeille Notion ; sans effet si la clé n'existe pas

// src/lib/cacheTags.ts
export const TAGS = {
  assets: 'notion:assets', movements: 'notion:movements', debts: 'notion:debts', budget: 'notion:budget',
  strategy: 'notion:strategy', plan: 'notion:plan', history: 'notion:history', series: 'series',
} as const;
export type CacheKey = keyof typeof TAGS;
/** Invalide les caches des bases données (`revalidateTag` de next/cache pour chaque tag). Sans argument : toutes les bases Notion (pas `series`). */
export function revalidateNotion(...keys: CacheKey[]): void;

// src/ui/BottomSheet.tsx ('use client')
export function BottomSheet(props: { open: boolean; title: string; onClose: () => void; children: React.ReactNode; footer?: React.ReactNode }): JSX.Element | null;
```

- `BottomSheet` : `role="dialog"`, `aria-modal="true"`, `aria-labelledby` (titre), fond cliquable, défilement interne (`max-height: 90dvh`), 44 px min pour tout contrôle ; à l'ouverture le dialogue prend le focus ; **Tab / Maj+Tab bouclent dans le dialogue** (liste des éléments focusables triée par `compareDocumentPosition`) ; **Échap** (écouteur `document`, `onClose` gardé dans une ref, effet `[]`) et clic sur le fond appellent `onClose` ; à la fermeture le focus revient à l'élément qui avait le focus à l'ouverture (capturé quand `open` passe à vrai) s'il est encore connecté ; défilement du body bloqué pendant l'ouverture ; rendu `null` si `!open`. Reprendre le comportement et les tests de `FilterSheet` dans `src/views/PatrimoineView.tsx` (ne pas modifier ce fichier).
- Implémentations Notion : `createAsset`/`updateAsset` écrivent uniquement les propriétés d'entrée de `P.assets` (jamais rollups/formules/propriétés « script ») ; `institution` et `subtype` écrits en select/texte comme les mappers de lecture les lisent ; `mode` via `OPT.mode` ; `archived` en case à cocher ; dates `{ date: { start } }`. `createDebt`/`updateDebt` : propriétés de `P.debts` (sauf `valueEur`), relation `financedAsset`. `deleteDebt` : `pages.update({ in_trash: true })`. `setStrategyEntry` : requête `Clé` égale à la clé → mise à jour sinon création ; ne touche que `value` (number), `text` (rich_text) et `asset` (relation) fournis ; `null` efface. `deleteStrategyEntry` : requête puis corbeille.
- FakeRepo : mêmes sémantiques (ids générés `asset-<n>`, `debt-<n>`), en mémoire, sans muter `fixtureSeed`.

- [ ] **Step 1:** Écrire les tests en échec : `fakeRepo.test.ts` (créer/modifier/archiver un actif, `null` efface un champ, créer/modifier/supprimer un crédit, upsert et suppression de clé Stratégie, `fixtureSeed` non muté), `mappers.test.ts` (`assetInputToProperties` n'inclut ni Quantité, Prix de revient, Plus-value, % ; `null` → propriété vidée ; `debtInputToProperties`), `notionRepo.test.ts` (faux client : create/update envoient les bonnes propriétés avec `limit`, `setStrategyEntry` met à jour une clé existante au lieu de créer, `deleteDebt` met en corbeille), `cacheTags.test.ts` (`revalidateNotion('assets')` appelle `revalidateTag('notion:assets')` ; sans argument, toutes les bases sauf `series`), `BottomSheet.test.tsx` (focus à l'ouverture, restauration après Échap/clic fond/bouton, boucle Tab/Maj+Tab, `null` quand fermé, `aria-labelledby`).
- [ ] **Step 2:** Lancer `npx vitest run src/notion src/lib/cacheTags.test.ts src/ui/BottomSheet.test.tsx` → ÉCHEC (garder un extrait RED).
- [ ] **Step 3:** Implémenter types, interface `Repo`, `FakeRepo`, `notionRepo` + mappers, `cacheTags.ts`, `BottomSheet.tsx`.
- [ ] **Step 4:** `npx vitest run && npm run typecheck && npm run build` → tout passe.
- [ ] **Step 5:** Commit `feat: contrats d'écriture, tags de cache et BottomSheet`.

---

### Task 1: Performance — caches par base, colonnes utiles, historique borné

**Files:**
- Modify: `src/lib/load.ts`, `src/notion/notionRepo.ts` (`queryAll` + listes), `src/app/api/sync/route.ts`, `src/app/budget/actions.ts`, `src/app/epargne/actions.ts` (passer à `revalidateNotion`)
- Test: `src/lib/load.test.ts`, `src/notion/notionRepo.test.ts`, `src/app/api/sync/route.test.ts`, tests des actions budget/épargne (mise à jour)

**Interfaces:**
- Consumes: `TAGS`, `revalidateNotion` (T0) ; `buildDashboard` (inchangé).
- Produces: `getDashboard()` inchangé de signature ; `Repo` inchangé.

Décisions :
- `queryAll` accepte `props?: string[]` : ids/noms de propriétés à lire (`filter_properties` de `dataSources.query` : passer les **noms**, convertis en identifiants via un `retrieve` mis en cache, ou les identifiants si l'API v5 les exige — lire les types du SDK installé) ; chaque liste ne demande que les colonnes que son mapper lit. **Exclure** de `listAssets` les propriétés calculées par Notion (Quantité, Prix de revient, Plus-value, %, Mouvements) : les quantités et prix de revient viennent des mouvements (`src/domain/positions.ts`) ; pour `listMovements` exclure Quantité signée, Montant signé, Prime %. Vérifier par test que les mappers n'ont pas besoin des colonnes exclues (un actif sans mouvement garde alors `quantity`/`costBasis` à 0 — voir `positions.ts` : « actifs sans mouvement gardent leurs propres valeurs » devient valeurs 0 ; adapter sans changer le comportement des actifs manuels avec valeur saisie).
- `listSnapshots()` sans argument ne lit que les 800 derniers jours (filtre `on_or_after` calculé avec `parisDate`) ; la première photo n'est pas indispensable.
- `src/lib/load.ts` : un `unstable_cache` **par liste** (assets, movements, debts, budget, strategy, plan, history), chacun avec son tag de `TAGS`, `revalidate: 900`, lus en parallèle ; `buildDashboard` est exécuté à chaque requête (pur, rapide) et n'est plus mis en cache ; `reviveDashboard` ne doit plus servir qu'à restaurer `Infinity` dans la grille de la Stratégie après le cache JSON (le déplacer sur le chargeur de la Stratégie). Conserver le repli « dernière valeur réussie » (`lastGood`) avec `stale: true`, et ajouter `console.error` quand il est utilisé.
- Instrumentation : chronomètre par base (`console.log('[perf] assets 312ms')`) dans le chargeur ; la route `/api/sync` ajoute un en-tête `Server-Timing`.
- `/api/sync` : après la synchro, `revalidateNotion('assets', 'movements', 'history')` puis **préchauffage** : `await getDashboard()` (erreur avalée et journalisée).
- Actions Budget : `revalidateNotion('budget')` ; actions Épargne : `revalidateNotion('movements', 'plan')`.

- [ ] **Step 1:** Tests en échec : `notionRepo.test.ts` (les requêtes d'actifs/mouvements envoient `filter_properties` sans les colonnes calculées ; `listSnapshots()` envoie un filtre de date de 800 jours), `load.test.ts` (chaque liste est lue via son tag ; une panne d'une liste → repli `lastGood` avec `stale`, `console.error` appelé ; `buildDashboard` est appelé à chaque `getDashboard()` ; `Infinity` de la grille restauré), route de synchro (`Server-Timing` présent, `revalidateNotion` avec les trois bases puis préchauffage, une erreur de préchauffage n'échoue pas la réponse), actions budget/épargne (bons tags).
- [ ] **Step 2:** Lancer les tests ciblés → ÉCHEC.
- [ ] **Step 3:** Implémenter.
- [ ] **Step 4:** `npx vitest run && npm run typecheck && npm run build` → tout passe.
- [ ] **Step 5:** Commit `perf: caches par base, colonnes utiles et historique borné`.

---

### Task 2: Écriture Patrimoine — actifs, mouvements, crédits

**Files:**
- Create: `src/app/patrimoine/actions.ts`, `src/app/patrimoine/patrimoineOps.ts`, `src/views/AssetSheet.tsx`, `src/views/MovementSheet.tsx`, `src/views/DebtSheet.tsx`
- Modify: `src/views/PatrimoineView.tsx`, `src/app/patrimoine/page.tsx`
- Test: `src/app/patrimoine/patrimoineOps.test.ts`, `src/app/patrimoine/actions.test.ts`, `src/views/AssetSheet.test.tsx`, `src/views/MovementSheet.test.tsx`, `src/views/DebtSheet.test.tsx`, `src/views/PatrimoineView.test.tsx` (étendre)

**Interfaces:**
- Consumes: `Repo` d'écriture, `revalidateNotion`, `BottomSheet` (T0) ; `Dashboard` (assets, debts, fx, strategy).
- Produces (actions, retour `{ ok: true; id?: string } | { ok: false; error: string }`) :
  - `createAsset(input: AssetInput)`, `updateAsset(id: string, patch: Partial<AssetInput>)`, `archiveAsset(id: string, archived: boolean)` (`revalidateNotion('assets')`)
  - `addMovement(m: { assetId: string; kind: 'buy' | 'sell'; date: string; quantity: number; amount: number; label?: string; nature?: string })` (`revalidateNotion('movements', 'assets')`)
  - `createDebt(input: DebtInput)`, `updateDebt(id: string, patch: Partial<DebtInput>)`, `deleteDebt(id: string)` (`revalidateNotion('debts')`)
- Fonctions pures dans `patrimoineOps.ts` : `createAssetWith(repo, input)`, `updateAssetWith(repo, id, patch)`, `archiveAssetWith(repo, id, archived)`, `addMovementWith(repo, m, now?)`, `createDebtWith`, `updateDebtWith`, `deleteDebtWith`.

Comportement :
- **Validation serveur** : nom 1–200 caractères ; classe ∈ `ASSET_CLASSES` ; devise ∈ EUR/MAD/USD ; mode auto/manual ; mode `auto` exige `quoteId` ; mode `manual` : `manualValue` fini ≥ 0 et `manualValueDate` date réelle (par défaut aujourd'hui Paris si valeur fournie sans date) ; `fixedMonthly` fini ≥ 0 ; montants ≤ 1 000 000 000 ; **id vérifié contre `listAssets()`/`listDebts()`** (`'Actif introuvable'`, `'Crédit introuvable'`) ; mouvement : actif existant et non archivé, date réelle, `quantity` ≥ 0, `amount` > 0, pour la classe `Métaux précieux` `quantity` > 0 (poids fin, grammes) ; `kind` `buy`/`sell`. Libellé par défaut : `'Achat'`/`'Vente'` + date, ou `label` fourni. Erreurs génériques en français, `console.error` du détail.
- **Écran Patrimoine** : l'en-tête garde un bouton **Ajouter** qui ouvre `AssetSheet` (plus de lien vers Notion ; retirer `AddAssetLink` et `NEXT_PUBLIC_NOTION_ASSETS_URL` du code, de `.env.example` et du README). Un clic/toucher sur une ligne d'actif ouvre `AssetSheet` en édition, avec : champs (nom, classe, sous-type, établissement, devise, valorisation Auto/Manuelle, identifiant de cotation si Auto, valeur manuelle + date si Manuelle, versement fixe mensuel), bouton **Enregistrer**, bouton **Archiver** (confirmation `window.confirm`), bouton **Ajouter un mouvement** (ouvre `MovementSheet` : type Achat/Vente, date (aujourd'hui Paris par défaut), quantité (libellée « Poids fin (g) » pour les métaux, « Quantité (parts / unités) » sinon), montant dans la devise de l'actif avec son suffixe, libellé facultatif). L'onglet **Passifs** a un bouton **Ajouter un crédit** et ouvre `DebtSheet` au toucher d'une ligne (nom, type, devise, capital restant dû, taux, mensualité, date de fin, actif financé via liste des actifs immobiliers/tous les actifs ; bouton **Supprimer** avec confirmation).
- Les formulaires gardent leur saisie et affichent l'erreur si l'action échoue ; Enregistrer est désactivé pendant l'envoi ; succès → fermeture de la feuille (le focus revient à la ligne ouverte) ; les champs montant/quantité passent en `type="password"` quand le mode masqué est actif ; virgule française acceptée ; chaque champ a un `<label>` ; erreurs de champ `aria-describedby`.
- `PatrimoineView` reçoit les actions en props (comme `BudgetView`) ; le test de la vue injecte des actions factices.

- [ ] **Step 1:** Écrire les tests en échec — `patrimoineOps.test.ts` (chaque rejet de validation, id inconnu, création, MAD stocké tel quel, mouvement d'un métal sans poids refusé), `actions.test.ts` (wrappers : erreur générique, `revalidateNotion` seulement en succès, rien d'écrit sur échec), vues (`AssetSheet` : champs conditionnels Auto/Manuelle, erreur conservée, masquage ; `MovementSheet` : devise de l'actif affichée, libellé du poids fin pour les métaux ; `DebtSheet` ; `PatrimoineView` : le bouton Ajouter ouvre la feuille, un clic sur une ligne ouvre l'édition, plus de lien Notion).
- [ ] **Step 2:** Lancer les tests ciblés → ÉCHEC (extrait RED).
- [ ] **Step 3:** Implémenter ops, actions, feuilles et branchement dans la vue et la page.
- [ ] **Step 4:** `npx vitest run && npm run typecheck && npm run build` → tout passe.
- [ ] **Step 5:** Commit `feat(ui): écriture des actifs, mouvements et crédits dans l'app`.

---

### Task 3: Page Stratégie — réglages dans l'app

**Files:**
- Create: `src/app/strategie/page.tsx`, `src/app/strategie/actions.ts`, `src/app/strategie/strategieOps.ts`, `src/views/StrategieView.tsx`
- Modify: `src/views/EpargneView.tsx` (lien d'accès + retrait du lien Notion), `src/app/epargne/page.tsx`
- Test: `src/app/strategie/strategieOps.test.ts`, `src/app/strategie/actions.test.ts`, `src/views/StrategieView.test.tsx`

**Interfaces:**
- Consumes: `setStrategyEntry`, `deleteStrategyEntry`, `revalidateNotion`, `BottomSheet` (T0) ; `STRATEGY_KEY` (`src/notion/schema.ts`) ; `Dashboard.strategy`, `Dashboard.assets`.
- Produces (retour `{ ok: true } | { ok: false; error: string }`) :
  - `saveMonthlyInvest(amount: number)` → clé `investissement_mensuel`
  - `saveTarget(assetClass: AssetClass, percent: number | null, mainAssetId: string | null)` → clé `cible:<Classe>` (`percent` `null` = supprimer la cible)
  - `saveSpecialAssets(p: { goldAssetId?: string | null; silverAssetId?: string | null; savingsAssetId?: string | null })` → clés `actif:or`, `actif:argent`, `actif:epargne`
  - `saveMetalGrid(zones: { label: string; min: number; max: number | null; goldPercent: number }[])` → clés `zone:<label>` (`Texte` = `"min-max"`, `"80-"` pour l'infini ; supprime les zones absentes)
  - toutes : `revalidateNotion('strategy')`

Comportement :
- Validation serveur : `percent` ∈ [0, 100] ; somme des cibles ≤ 100 % (refus sinon, calculée à partir de la Stratégie lue) ; classe ∈ `ASSET_CLASSES` ; `mainAssetId` doit exister, être non archivé et de la classe ciblée ; `monthlyInvest` fini ≥ 0 et ≤ 1 000 000 ; or/argent/épargne : actif existant, non archivé, classe `Métaux précieux` pour or/argent et `Épargne` pour l'épargne ; grille : 2 à 8 zones, bornes croissantes sans trou ni recouvrement, première borne 0, dernière sans max, `goldPercent` ∈ [0, 100], labels uniques de 1 à 40 caractères.
- `/strategie` : page (force-dynamic, R4) avec sections **Investissement mensuel**, **Cibles par classe** (une ligne par classe d'actifs pilotable : pourcentage + actif principal, total affiché avec avertissement si ≠ 100 %), **Actifs spéciaux** (or, argent, épargne), **Grille or / argent** (tableau de zones modifiable : seuils et part d'or). Chaque section a son bouton **Enregistrer** avec état « Enregistré » / erreur (`aria-live`), saisies conservées en cas d'erreur, champs en `type="password"` quand masqué pour le montant mensuel.
- Accès : lien « Régler la stratégie » dans l'écran Épargne (remplace « Ouvrir la Stratégie dans Notion » : retirer `NEXT_PUBLIC_NOTION_STRATEGY_URL` du code, de `.env.example` et du README) ; pas d'onglet de plus dans le menu du bas.
- `StrategieView` reçoit les actions en props ; le test injecte des actions factices.

- [ ] **Step 1:** Tests en échec — `strategieOps.test.ts` (chaque rejet : somme > 100 %, actif principal d'une autre classe, grille avec trou/recouvrement, id inconnu ; chaque écriture : clé et valeurs exactes, `percent: null` supprime, zones supprimées), `actions.test.ts`, `StrategieView.test.tsx` (sections, total ≠ 100 % signalé, erreur conservée, masquage, actions appelées avec les bons arguments), test du lien dans l'écran Épargne.
- [ ] **Step 2:** Lancer les tests ciblés → ÉCHEC.
- [ ] **Step 3:** Implémenter.
- [ ] **Step 4:** `npx vitest run && npm run typecheck && npm run build` → tout passe.
- [ ] **Step 5:** Commit `feat(ui): page Stratégie`.
