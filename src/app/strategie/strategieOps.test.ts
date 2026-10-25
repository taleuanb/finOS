import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Asset } from '@/domain/types';
import { FakeRepo, fixtureSeed } from '@/notion/fakeRepo';
import { saveMetalGridWith, saveMonthlyInvestWith, saveSpecialAssetsWith, saveTargetWith } from './strategieOps';

let repo: FakeRepo;
let setEntry: ReturnType<typeof vi.spyOn>;
let deleteEntry: ReturnType<typeof vi.spyOn>;

function useRepo(r: FakeRepo) {
  repo = r;
  setEntry = vi.spyOn(repo, 'setStrategyEntry');
  deleteEntry = vi.spyOn(repo, 'deleteStrategyEntry');
}

beforeEach(() => {
  useRepo(new FakeRepo(structuredClone(fixtureSeed)));
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

const noWrite = () => {
  expect(setEntry).not.toHaveBeenCalled();
  expect(deleteEntry).not.toHaveBeenCalled();
};

const zone = (label: string, min: number, max: number | null, goldPercent: number) => ({ label, min, max, goldPercent });
const GRID = [zone('Or pas cher', 0, 50, 70), zone('Neutre', 50, 70, 50), zone('Argent pas cher', 70, null, 30)];
const GENERIC = "L'enregistrement a échoué. Réessaie dans un instant.";

function withArchived(id: string): FakeRepo {
  const assets: Asset[] = fixtureSeed.assets.map((a) => (a.id === id ? { ...a, archived: true } : a));
  return new FakeRepo({ ...structuredClone(fixtureSeed), assets });
}

describe('saveMonthlyInvestWith', () => {
  it('écrit la clé investissement_mensuel', async () => {
    expect(await saveMonthlyInvestWith(repo, 1200.5)).toEqual({ ok: true });
    expect(setEntry).toHaveBeenCalledWith({ key: 'investissement_mensuel', value: 1200.5 });
    expect((await repo.getStrategy()).monthlyInvest).toBe(1200.5);
  });

  it('accepte 0 et la borne haute', async () => {
    expect(await saveMonthlyInvestWith(repo, 0)).toEqual({ ok: true });
    expect(await saveMonthlyInvestWith(repo, 1_000_000)).toEqual({ ok: true });
  });

  it.each([-1, 1_000_001, NaN, Infinity, '900' as unknown as number, null as unknown as number])('refuse %s', async (v) => {
    expect(await saveMonthlyInvestWith(repo, v)).toEqual({ ok: false, error: 'Montant invalide' });
    noWrite();
  });

  it('erreur Notion : message générique, journalisée, détail jamais renvoyé', async () => {
    setEntry.mockRejectedValueOnce(new Error('notion 500 secret'));
    expect(await saveMonthlyInvestWith(repo, 100)).toEqual({ ok: false, error: GENERIC });
    expect(console.error).toHaveBeenCalled();
  });
});

describe('saveTargetWith', () => {
  it('écrit cible:<Classe> avec le pourcentage et l’actif principal', async () => {
    // Fonds & ETF 45 -> 50 : total 50+20+10+8+5 = 93
    expect(await saveTargetWith(repo, 'Fonds & ETF', 50, 'etf-revolut')).toEqual({ ok: true });
    expect(setEntry).toHaveBeenCalledWith({ key: 'cible:Fonds & ETF', value: 50, assetId: 'etf-revolut' });
    const s = await repo.getStrategy();
    expect(s.targets['Fonds & ETF']).toBe(0.5);
    expect(s.mainAssetByClass['Fonds & ETF']).toBe('etf-revolut');
  });

  it('crée la cible d’une classe sans cible (Noms de domaine)', async () => {
    expect(await saveTargetWith(repo, 'Noms de domaine', 7, 'domaines')).toEqual({ ok: true });
    expect((await repo.getStrategy()).targets['Noms de domaine']).toBe(0.07);
  });

  it('percent null supprime la cible', async () => {
    expect(await saveTargetWith(repo, 'Crypto', null, null)).toEqual({ ok: true });
    expect(deleteEntry).toHaveBeenCalledWith('cible:Crypto');
    expect(setEntry).not.toHaveBeenCalled();
    const s = await repo.getStrategy();
    expect(s.targets.Crypto).toBeUndefined();
    expect(s.mainAssetByClass.Crypto).toBeUndefined();
  });

  it('sans actif principal : efface l’actif principal existant', async () => {
    expect(await saveTargetWith(repo, 'Crypto', 10, null)).toEqual({ ok: true });
    expect(setEntry).toHaveBeenCalledWith({ key: 'cible:Crypto', value: 10, assetId: null });
    expect((await repo.getStrategy()).mainAssetByClass.Crypto).toBeUndefined();
  });

  it('métaux précieux : cible sans actif principal', async () => {
    expect(await saveTargetWith(repo, 'Métaux précieux', 10, null)).toEqual({ ok: true });
    expect((await repo.getStrategy()).targets['Métaux précieux']).toBe(0.1);
  });

  it('refuse un actif principal pour les métaux précieux', async () => {
    expect(await saveTargetWith(repo, 'Métaux précieux', 8, 'or')).toEqual({ ok: false, error: 'Pas d’actif principal pour les métaux précieux' });
    noWrite();
  });

  it('refuse une somme des cibles > 100 % (calculée sur la Stratégie lue)', async () => {
    // autres cibles : 20+10+8+5 = 43 ; 58 -> 101
    expect(await saveTargetWith(repo, 'Fonds & ETF', 58, 'hsbc')).toEqual({ ok: false, error: 'La somme des cibles dépasse 100 %' });
    noWrite();
  });

  it('accepte une somme exactement égale à 100 %', async () => {
    expect(await saveTargetWith(repo, 'Fonds & ETF', 57, 'hsbc')).toEqual({ ok: true });
  });

  it('une cible qui diminue reste possible même si le total était déjà > 100 %', async () => {
    await repo.setStrategyEntry({ key: 'cible:Fonds & ETF', value: 90 });
    setEntry.mockClear();
    expect(await saveTargetWith(repo, 'Fonds & ETF', 50, 'hsbc')).toEqual({ ok: true });
  });

  it.each([-1, 100.5, NaN, Infinity, '10' as unknown as number])('refuse le pourcentage %s', async (p) => {
    expect(await saveTargetWith(repo, 'Crypto', p, 'crypto')).toEqual({ ok: false, error: 'Pourcentage invalide' });
    noWrite();
  });

  it('refuse une classe inconnue ou non pilotable', async () => {
    expect(await saveTargetWith(repo, 'Licornes' as never, 5, null)).toEqual({ ok: false, error: 'Classe invalide' });
    expect(await saveTargetWith(repo, 'Immobilier', 5, null)).toEqual({ ok: false, error: 'Classe invalide' });
    expect(await saveTargetWith(repo, 'Épargne', 5, null)).toEqual({ ok: false, error: 'Classe invalide' });
    expect(await saveTargetWith(repo, 'Comptes courants', null, null)).toEqual({ ok: false, error: 'Classe invalide' });
    noWrite();
  });

  it('refuse un actif principal d’une autre classe', async () => {
    expect(await saveTargetWith(repo, 'Crypto', 10, 'hsbc')).toEqual({ ok: false, error: 'Actif principal invalide pour cette classe' });
    noWrite();
  });

  it('refuse un identifiant inconnu', async () => {
    expect(await saveTargetWith(repo, 'Crypto', 10, 'page-inconnue')).toEqual({ ok: false, error: 'Actif principal invalide pour cette classe' });
    noWrite();
  });

  it('refuse un actif archivé', async () => {
    useRepo(withArchived('etf-revolut'));
    expect(await saveTargetWith(repo, 'Fonds & ETF', 40, 'etf-revolut')).toEqual({ ok: false, error: 'Actif principal invalide pour cette classe' });
    noWrite();
  });

  it('erreur Notion : générique', async () => {
    setEntry.mockRejectedValueOnce(new Error('boom'));
    expect(await saveTargetWith(repo, 'Crypto', 10, 'crypto')).toEqual({ ok: false, error: GENERIC });
  });
});

describe('saveSpecialAssetsWith', () => {
  it('écrit actif:or, actif:argent et actif:epargne', async () => {
    expect(await saveSpecialAssetsWith(repo, { goldAssetId: 'or', silverAssetId: 'ag', savingsAssetId: 'epargne' })).toEqual({ ok: true });
    expect(setEntry).toHaveBeenCalledWith({ key: 'actif:or', assetId: 'or' });
    expect(setEntry).toHaveBeenCalledWith({ key: 'actif:argent', assetId: 'ag' });
    expect(setEntry).toHaveBeenCalledWith({ key: 'actif:epargne', assetId: 'epargne' });
  });

  it('absent = inchangé ; null = supprime', async () => {
    expect(await saveSpecialAssetsWith(repo, { goldAssetId: null })).toEqual({ ok: true });
    expect(deleteEntry).toHaveBeenCalledWith('actif:or');
    expect(setEntry).not.toHaveBeenCalled();
    const s = await repo.getStrategy();
    expect(s.goldAssetId).toBeUndefined();
    expect(s.silverAssetId).toBe('ag');
  });

  it("refuse un actif or qui n'est pas un métal", async () => {
    expect(await saveSpecialAssetsWith(repo, { goldAssetId: 'hsbc' })).toEqual({ ok: false, error: 'Actif or invalide' });
    noWrite();
  });

  it("refuse un actif argent qui n'est pas un métal", async () => {
    expect(await saveSpecialAssetsWith(repo, { silverAssetId: 'epargne' })).toEqual({ ok: false, error: 'Actif argent invalide' });
    noWrite();
  });

  it("refuse un actif épargne qui n'est pas de la classe Épargne", async () => {
    expect(await saveSpecialAssetsWith(repo, { savingsAssetId: 'or' })).toEqual({ ok: false, error: 'Actif épargne invalide' });
    noWrite();
  });

  it('un identifiant invalide parmi plusieurs : rien n’est écrit', async () => {
    expect(await saveSpecialAssetsWith(repo, { goldAssetId: 'or', savingsAssetId: 'inconnu' })).toEqual({ ok: false, error: 'Actif épargne invalide' });
    noWrite();
  });

  it('refuse un actif archivé', async () => {
    useRepo(withArchived('ag'));
    expect(await saveSpecialAssetsWith(repo, { silverAssetId: 'ag' })).toEqual({ ok: false, error: 'Actif argent invalide' });
    noWrite();
  });

  it('refuse un objet vide', async () => {
    expect(await saveSpecialAssetsWith(repo, {})).toEqual({ ok: false, error: 'Aucun réglage à enregistrer' });
    noWrite();
  });
});

describe('saveMetalGridWith', () => {
  it('écrit zone:<label> avec Texte "min-max" et "70-" pour la dernière', async () => {
    expect(await saveMetalGridWith(repo, GRID)).toEqual({ ok: true });
    expect(setEntry).toHaveBeenCalledWith({ key: 'zone:Or pas cher', value: 70, text: '0-50' });
    expect(setEntry).toHaveBeenCalledWith({ key: 'zone:Neutre', value: 50, text: '50-70' });
    expect(setEntry).toHaveBeenCalledWith({ key: 'zone:Argent pas cher', value: 30, text: '70-' });
    expect((await repo.getStrategy()).metalGrid).toEqual([
      { label: 'Or pas cher', min: 0, max: 50, goldShare: 0.7 },
      { label: 'Neutre', min: 50, max: 70, goldShare: 0.5 },
      { label: 'Argent pas cher', min: 70, max: Infinity, goldShare: 0.3 },
    ]);
  });

  it('supprime les zones absentes', async () => {
    await saveMetalGridWith(repo, GRID);
    for (const old of ['Or bon marché', 'Penche or', 'Penche argent', 'Argent bon marché']) {
      expect(deleteEntry).toHaveBeenCalledWith(`zone:${old}`);
    }
    expect(deleteEntry).not.toHaveBeenCalledWith('zone:Neutre');
    expect((await repo.getStrategy()).metalGrid.map((z) => z.label)).toEqual(['Or pas cher', 'Neutre', 'Argent pas cher']);
  });

  it('accepte des bornes décimales', async () => {
    expect(await saveMetalGridWith(repo, [zone('A', 0, 52.5, 70), zone('B', 52.5, null, 30)])).toEqual({ ok: true });
    expect(setEntry).toHaveBeenCalledWith({ key: 'zone:A', value: 70, text: '0-52.5' });
  });

  const reject = async (zones: unknown, error: string) => {
    expect(await saveMetalGridWith(repo, zones as never)).toEqual({ ok: false, error });
    noWrite();
  };

  it('refuse moins de 2 ou plus de 8 zones', async () => {
    await reject([zone('A', 0, null, 50)], 'La grille doit avoir entre 2 et 8 zones');
    await reject(
      Array.from({ length: 9 }, (_, i) => zone(`Z${i}`, i * 10, i === 8 ? null : (i + 1) * 10, 50)),
      'La grille doit avoir entre 2 et 8 zones',
    );
    await reject('x', 'La grille doit avoir entre 2 et 8 zones');
  });

  it('refuse un trou entre deux zones', async () => {
    await reject([zone('A', 0, 50, 70), zone('B', 55, null, 30)], 'Les zones doivent se suivre sans trou ni recouvrement');
  });

  it('refuse un recouvrement', async () => {
    await reject([zone('A', 0, 50, 70), zone('B', 45, null, 30)], 'Les zones doivent se suivre sans trou ni recouvrement');
  });

  it('refuse une première borne ≠ 0', async () => {
    await reject([zone('A', 10, 50, 70), zone('B', 50, null, 30)], 'La première zone doit commencer à 0');
  });

  it('refuse une dernière zone bornée', async () => {
    await reject([zone('A', 0, 50, 70), zone('B', 50, 90, 30)], 'La dernière zone doit rester ouverte (sans maximum)');
  });

  it('refuse une zone intermédiaire sans maximum', async () => {
    await reject([zone('A', 0, null, 70), zone('B', 50, null, 30)], 'Chaque zone sauf la dernière doit avoir un maximum');
  });

  it('refuse une zone vide ou inversée', async () => {
    await reject([zone('A', 0, 0, 70), zone('B', 0, null, 30)], 'Chaque zone doit avoir un maximum supérieur à son minimum');
    await reject([zone('A', 0, 50, 70), zone('B', 50, 40, 30), zone('C', 40, null, 30)], 'Chaque zone doit avoir un maximum supérieur à son minimum');
  });

  it('refuse une part d’or hors [0, 100]', async () => {
    await reject([zone('A', 0, 50, -1), zone('B', 50, null, 30)], 'Part d’or invalide');
    await reject([zone('A', 0, 50, 101), zone('B', 50, null, 30)], 'Part d’or invalide');
    await reject([zone('A', 0, 50, NaN), zone('B', 50, null, 30)], 'Part d’or invalide');
  });

  it('refuse des libellés vides, trop longs ou en double', async () => {
    await reject([zone('  ', 0, 50, 70), zone('B', 50, null, 30)], 'Libellé de zone invalide');
    await reject([zone('x'.repeat(41), 0, 50, 70), zone('B', 50, null, 30)], 'Libellé de zone invalide');
    await reject([zone('A', 0, 50, 70), zone('a', 50, null, 30)], 'Les libellés de zones doivent être uniques');
  });

  it('refuse des bornes non finies', async () => {
    await reject([zone('A', 0, NaN, 70), zone('B', 50, null, 30)], 'Bornes invalides');
    await reject([zone('A', 0, 50, 70), zone('B', 50, Infinity, 30)], 'Bornes invalides');
  });

  it('erreur Notion : générique', async () => {
    setEntry.mockRejectedValueOnce(new Error('boom'));
    expect(await saveMetalGridWith(repo, GRID)).toEqual({ ok: false, error: GENERIC });
  });
});
