import { describe, expect, it } from 'vitest';
import { gridIssue, neutralZone, zoneFor } from './zones';
import { DEFAULT_METAL_GRID } from './types';

describe('zones', () => {
  it('zoneFor choisit la zone contenant le ratio', () => {
    expect(zoneFor(64.5, DEFAULT_METAL_GRID).label).toBe('Neutre');
    expect(zoneFor(0, DEFAULT_METAL_GRID).label).toBe('Or bon marché');
  });
  it('la borne max est exclue', () => {
    expect(zoneFor(65, DEFAULT_METAL_GRID).label).toBe('Penche argent');
    expect(zoneFor(50, DEFAULT_METAL_GRID).label).toBe('Neutre');
  });
  it('la dernière zone est ouverte', () => {
    expect(zoneFor(120, DEFAULT_METAL_GRID).goldShare).toBe(0.2);
  });
  it('neutralZone renvoie la zone « Neutre », sinon celle du milieu', () => {
    expect(neutralZone(DEFAULT_METAL_GRID).label).toBe('Neutre');
    const g = [
      { label: 'A', min: 0, max: 10, goldShare: 0.7 },
      { label: 'B', min: 10, max: 20, goldShare: 0.5 },
      { label: 'C', min: 20, max: Infinity, goldShare: 0.3 },
    ];
    expect(neutralZone(g).label).toBe('B');
  });

  const holes = [
    { label: 'Or bon marché', min: 0, max: 45, goldShare: 0.8 },
    { label: 'Neutre', min: 50, max: 65, goldShare: 0.55 },
    { label: 'Argent bon marché', min: 80, max: Infinity, goldShare: 0.2 },
  ];
  it('I10 : un ratio dans un trou de la grille donne la zone neutre, pas la dernière', () => {
    expect(zoneFor(47, holes).label).toBe('Neutre');
    expect(zoneFor(70, holes).label).toBe('Neutre');
    expect(zoneFor(90, holes).label).toBe('Argent bon marché');
  });
  it('I10 : gridIssue signale une grille à trous, sans départ à 0 ou sans zone ouverte', () => {
    expect(gridIssue(DEFAULT_METAL_GRID)).toBeNull();
    expect(gridIssue(holes)).not.toBeNull();
    expect(gridIssue(DEFAULT_METAL_GRID.slice(1))).not.toBeNull();
    expect(gridIssue(DEFAULT_METAL_GRID.slice(0, -1))).not.toBeNull();
    expect(gridIssue([])).not.toBeNull();
  });
});

