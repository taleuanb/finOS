// Noms exacts des bases et propriétés Notion (spec §4). Source unique pour T10 et T11.
import type { AssetClass } from '@/domain/types';

export const DB = {
  assets: 'Actifs', movements: 'Mouvements', debts: 'Dettes', budget: 'Budget',
  strategy: 'Stratégie', plan: 'Plan mensuel', history: 'Historique',
} as const;

export const P = {
  // 4.1 Actifs (titre : name)
  assets: {
    name: 'Nom', assetClass: 'Classe', subtype: 'Sous-type', institution: 'Établissement', currency: 'Devise',
    mode: 'Valorisation', quoteId: 'Identifiant cotation', manualValue: 'Valeur manuelle',
    manualValueDate: 'Date valeur manuelle', quantity: 'Quantité', costBasis: 'Prix de revient',
    unitPrice: 'Cours unitaire', value: 'Valeur', valueEur: 'Valeur €', gain: 'Plus-value', gainPct: '%',
    fixedMonthly: 'Versement fixe mensuel', syncStatus: 'Statut sync', lastUpdate: 'Dernière MAJ',
    archived: 'Archivé', movements: 'Mouvements',
  },
  // 4.2 Mouvements (titre : label)
  movements: {
    label: 'Libellé', date: 'Date', asset: 'Actif', kind: 'Type', nature: 'Nature', quantity: 'Quantité',
    amount: 'Montant', spotEurPerKg: 'Cours spot jour J', premium: 'Prime %', planMonth: 'Mois du plan',
    // Formules (T10) : alimentent les rollups Quantité / Prix de revient de la base Actifs.
    signedQuantity: 'Quantité signée', signedAmount: 'Montant signé',
  },
  // 4.3 Dettes (titre : name)
  debts: {
    name: 'Nom', type: 'Type', currency: 'Devise', outstanding: 'Capital restant dû', rate: 'Taux',
    monthly: 'Mensualité', endDate: 'Date de fin', financedAsset: 'Actif financé', valueEur: 'Valeur €',
  },
  // 4.4 Budget (titre : name)
  budget: {
    name: 'Nom', section: 'Section', category: 'Catégorie', monthlyAmount: 'Montant mensuel',
    currency: 'Devise', order: 'Ordre',
  },
  // 4.5 Stratégie : format clé/valeur (titre : key)
  strategy: { key: 'Clé', value: 'Valeur', text: 'Texte', asset: 'Actif' },
  // 4.6 Plan mensuel (titre : month, au format 'AAAA-MM')
  plan: { month: 'Mois', asset: 'Actif', amount: 'Montant prévu', origin: 'Origine' },
  // 4.7 Historique (titre : title = date ISO ; date : propriété Date)
  history: {
    title: 'Nom', date: 'Date', totalAssetsEur: 'Total actifs €', totalDebtsEur: 'Total dettes €', netEur: 'Patrimoine net €',
    byClass: {
      'Immobilier': 'Immobilier €', 'Autres': 'Autres €', 'Fonds & ETF': 'Fonds & ETF €', 'PER': 'PER €',
      'Épargne': 'Épargne €', 'Crypto': 'Crypto €', 'Comptes courants': 'Comptes courants €', 'Startups': 'Startups €',
      'Métaux précieux': 'Métaux précieux €', 'Noms de domaine': 'Noms de domaine €',
    } satisfies Record<AssetClass, string>,
    goldSilverRatio: 'Ratio or/argent', eurMad: 'EUR/MAD', eurUsd: 'EUR/USD', partial: 'Partiel',
  },
} as const;

/** Libellés des options Select. */
export const OPT = {
  mode: { auto: 'Auto', manual: 'Manuelle' },
  kind: { buy: 'Achat/versement', sell: 'Vente/retrait' },
  section: { revenu: 'Revenu', depense: 'Dépense' },
  origin: { fixe: 'Fixe', cible: 'Cible', signal: 'Signal métaux' },
} as const;

/** Clés reconnues de la base Stratégie (colonne `Clé`). */
export const STRATEGY_KEY = {
  targetPrefix: 'cible:',          // cible:<Classe> — Valeur = %, Actif = actif principal
  gold: 'actif:or',                // Actif
  silver: 'actif:argent',          // Actif
  savings: 'actif:epargne',        // Actif
  monthlyInvest: 'investissement_mensuel', // Valeur
  zonePrefix: 'zone:',             // zone:<label> — Valeur = % or, Texte = "min-max" ("80-" pour l'infini)
  displayCurrency: 'devise_affichage',     // Texte
} as const;
