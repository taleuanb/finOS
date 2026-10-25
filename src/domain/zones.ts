import type { MetalZone } from './types';

/**
 * Zone contenant le ratio : [min, max), la dernière zone est ouverte (max Infinity).
 * Un ratio hors de toute zone (grille à trous ou incomplète) donne la zone neutre, jamais une zone extrême
 * par défaut ; `gridIssue` permet de le signaler.
 */
export function zoneFor(ratio: number, grid: MetalZone[]): MetalZone {
  return grid.find((z) => ratio >= z.min && ratio < z.max) ?? neutralZone(grid);
}

/** Zone nommée « Neutre », sinon la zone du milieu. */
export function neutralZone(grid: MetalZone[]): MetalZone {
  return grid.find((z) => z.label === 'Neutre') ?? grid[Math.floor(grid.length / 2)];
}

/**
 * null si la grille couvre [0, ∞) sans trou ni chevauchement ; sinon la raison, en français.
 */
export function gridIssue(grid: MetalZone[]): string | null {
  if (grid.length === 0) return 'aucune zone';
  const zones = [...grid].sort((a, b) => a.min - b.min);
  if (zones[0].min > 0) return `rien sous ${zones[0].min}`;
  for (let i = 1; i < zones.length; i++) {
    if (zones[i].min !== zones[i - 1].max) return `trou ou chevauchement entre ${zones[i - 1].max} et ${zones[i].min}`;
  }
  const last = zones[zones.length - 1];
  return last.max === Infinity ? null : `rien au-delà de ${last.max}`;
}
