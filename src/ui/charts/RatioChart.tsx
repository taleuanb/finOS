'use client';

import { CartesianGrid, Line, LineChart, ReferenceArea, Tooltip, XAxis, YAxis } from 'recharts';
import type { MetalZone } from '@/domain/types';
import { AXIS_TICK, ChartFrame, COLORS, formatDateFr, formatMonthYear, type ChartSizeProps } from './shared';

export interface RatioPoint { date: string; ratio: number }

/** Teinte d'une zone selon sa part d'or : ambre pour « penche or », gris-bleu pour « penche argent ». */
function zoneFill(goldShare: number): { fill: string; opacity: number } {
  if (goldShare > 0.6) return { fill: COLORS.accent, opacity: 0.32 };
  if (goldShare > 0.5) return { fill: COLORS.accent, opacity: 0.14 };
  if (goldShare === 0.5) return { fill: '#E5E7EB', opacity: 0.4 };
  return { fill: '#9AA3B2', opacity: 0.2 };
}

/**
 * Ratio or/argent avec une bande par zone de la grille.
 * Le ratio est un indice de marché public, pas un montant du patrimoine : il reste affiché en mode masqué.
 */
export function RatioChart({
  data,
  grid,
  label = 'Ratio or/argent',
  width,
  height = 200,
}: { data: RatioPoint[]; grid: MetalZone[]; label?: string } & ChartSizeProps) {
  const values = data.map((p) => p.ratio);
  const finiteMaxes = grid.map((z) => z.max).filter(Number.isFinite);
  const yMin = Math.floor(Math.min(...values, ...grid.map((z) => z.min)));
  const yMax = Math.ceil(Math.max(...values, ...finiteMaxes));
  return (
    <ChartFrame label={label} width={width} height={height}>
      <LineChart data={data} margin={{ top: 6, right: 4, bottom: 0, left: 0 }} accessibilityLayer={false}>
        <CartesianGrid vertical={false} stroke={COLORS.grid} strokeDasharray="3 4" />
        {grid.map((z) => {
          const { fill, opacity } = zoneFill(z.goldShare);
          return (
            <ReferenceArea
              key={z.label}
              y1={Math.max(z.min, yMin)}
              y2={Number.isFinite(z.max) ? Math.min(z.max, yMax) : yMax}
              fill={fill}
              fillOpacity={opacity}
              ifOverflow="hidden"
              stroke="none"
            />
          );
        })}
        <XAxis
          dataKey="date"
          tick={AXIS_TICK}
          tickLine={false}
          axisLine={false}
          tickFormatter={formatMonthYear}
          interval="preserveStartEnd"
          minTickGap={40}
        />
        <YAxis width={32} tick={AXIS_TICK} tickLine={false} axisLine={false} domain={[yMin, yMax]} />
        <Tooltip
          formatter={(v) => [Number(v).toFixed(1).replace('.', ','), 'Ratio']}
          labelFormatter={(l) => formatDateFr(String(l))}
        />
        <Line type="monotone" dataKey="ratio" stroke={COLORS.curve} strokeWidth={2} dot={false} isAnimationActive={false} />
      </LineChart>
    </ChartFrame>
  );
}
