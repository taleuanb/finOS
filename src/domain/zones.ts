import type { MetalZone } from './types';

/** Zone contenant le ratio : [min, max), la dernière zone est ouverte (max Infinity). */
export function zoneFor(ratio: number, grid: MetalZone[]): MetalZone {
  const found = grid.find((z) => ratio >= z.min && ratio < z.max);
  if (found) return found;
  return ratio < grid[0].min ? grid[0] : grid[grid.length - 1];
}

/** Zone nommée « Neutre », sinon la zone du milieu. */
export function neutralZone(grid: MetalZone[]): MetalZone {
  return grid.find((z) => z.label === 'Neutre') ?? grid[Math.floor(grid.length / 2)];
}
