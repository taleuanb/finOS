'use client';

import { Bar, BarChart, CartesianGrid, Tooltip, XAxis, YAxis } from 'recharts';
import { useDisplay } from '../display';
import { formatDisplayMoney } from '../Money';
import { AXIS_TICK, ChartFrame, COLORS, chartLabel, formatCompactMoney, type ChartSizeProps } from './shared';

export interface StackedBarsDatum {
  label: string;
  parts: { key: string; value: number; color: string }[];   // value en EUR
}

export function StackedBars({
  data,
  label = 'Épargné et investi par mois',
  width,
  height = 180,
}: { data: StackedBarsDatum[]; label?: string } & ChartSizeProps) {
  const d = useDisplay();
  const colors = new Map<string, string>();
  const rows = data.map((row) => {
    const r: Record<string, string | number> = { label: row.label };
    for (const p of row.parts) {
      if (!colors.has(p.key)) colors.set(p.key, p.color);
      r[p.key] = (Number(r[p.key]) || 0) + p.value;
    }
    return r;
  });
  const keys = [...colors.keys()];

  return (
    <ChartFrame label={chartLabel(label, d.hidden)} width={width} height={height}>
      <BarChart data={rows} margin={{ top: 6, right: 4, bottom: 0, left: 0 }} accessibilityLayer={false}>
        <CartesianGrid vertical={false} stroke={COLORS.grid} strokeDasharray="3 4" />
        <XAxis dataKey="label" tick={AXIS_TICK} tickLine={false} axisLine={false} />
        <YAxis
          hide={d.hidden}
          width={52}
          tick={AXIS_TICK}
          tickLine={false}
          axisLine={false}
          tickFormatter={(v: number) => formatCompactMoney(v, d.currency, d.fx)}
        />
        {d.hidden ? null : (
          <Tooltip
            cursor={{ fill: 'rgba(17,19,24,0.04)' }}
            formatter={(v, name) => [formatDisplayMoney(Number(v), d), String(name)]}
          />
        )}
        {keys.map((k) => (
          <Bar key={k} dataKey={k} stackId="a" fill={colors.get(k)} isAnimationActive={false} />
        ))}
      </BarChart>
    </ChartFrame>
  );
}
