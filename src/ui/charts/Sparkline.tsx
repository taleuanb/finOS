'use client';

import { Line, LineChart, YAxis } from 'recharts';
import { COLORS, ChartFrame, type ChartSizeProps } from './shared';

/** Mini-courbe sans axe, ni étiquette, ni infobulle : aucun chiffre n'est jamais rendu. */
export function Sparkline({
  values,
  color = COLORS.curve,
  label = 'Tendance',
  width,
  height = 40,
}: { values: number[]; color?: string; label?: string } & ChartSizeProps) {
  const data = values.map((v, i) => ({ i, v }));
  return (
    <ChartFrame label={label} width={width} height={height}>
      <LineChart data={data} margin={{ top: 3, right: 2, bottom: 3, left: 2 }} accessibilityLayer={false}>
        <YAxis hide domain={['dataMin', 'dataMax']} />
        <Line type="monotone" dataKey="v" stroke={color} strokeWidth={2} dot={false} isAnimationActive={false} />
      </LineChart>
    </ChartFrame>
  );
}
