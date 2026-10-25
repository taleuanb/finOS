import type { FxRates } from './types';

/** Once troy en grammes. */
export const OZ_G = 31.1034768;

/** Convertit un cours en $/oz en €/kg. */
export function usdPerOzToEurPerKg(usdPerOz: number, fx: FxRates): number {
  return (usdPerOz / OZ_G) * 1000 / fx.USD;
}
