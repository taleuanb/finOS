import { describe, expect, it } from 'vitest';
import { OZ_G, usdPerOzToEurPerKg } from './units';
import type { FxRates } from './types';

const fx: FxRates = { date: '2026-10-25', EUR: 1, MAD: 10.85, USD: 1.08, GBP: 0.84 };

describe('units', () => {
  it('OZ_G vaut une once troy en grammes', () => {
    expect(OZ_G).toBe(31.1034768);
  });
  it('usdPerOzToEurPerKg convertit des $/oz en €/kg', () => {
    expect(usdPerOzToEurPerKg(31.1034768, { ...fx, USD: 1 })).toBeCloseTo(1000, 6);
    // or : 4 229,88 $/oz, USD 1.08 → ≈125 920 €/kg
    expect(usdPerOzToEurPerKg(4229.88, fx)).toBeCloseTo(125920.185, 2);
  });
});
