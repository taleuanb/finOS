import { describe, expect, it } from 'vitest';
import { neutralZone, zoneFor } from './zones';
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
});
