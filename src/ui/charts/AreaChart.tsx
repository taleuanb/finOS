'use client';

import { useId } from 'react';
import { Area, AreaChart as RAreaChart, CartesianGrid, Tooltip, XAxis, YAxis } from 'recharts';
import { useDisplay } from '../display';
import { formatDisplayMoney } from '../Money';
import {
  AXIS_TICK, ChartFrame, COLORS, chartLabel, formatCompactMoney, formatDateFr, formatMonthYear,
  type ChartSizeProps,
} from './shared';

export interface AreaPoint { date: string; value: number }   // value en EUR

export function AreaChart({
  data,
  label = 'Évolution du patrimoine',
  width,
  height = 160,
}: { data: AreaPoint[]; label?: string } & ChartSizeProps) {
  const d = useDisplay();
  const gradId = useId();
  return (
    <ChartFrame label={chartLabel(label, d.hidden)} width={width} height={height}>
      <RAreaChart data={data} margin={{ top: 6, right: 4, bottom: 0, left: 0 }} accessibilityLayer={false}>
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={COLORS.curve} stopOpacity={0.22} />
            <stop offset="100%" stopColor={COLORS.curve} stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid vertical={false} stroke={COLORS.grid} strokeDasharray="3 4" />
        <XAxis
          dataKey="date"
          hide={d.hidden}
          tick={AXIS_TICK}
          tickLine={false}
          axisLine={false}
          tickFormatter={formatMonthYear}
          interval="preserveStartEnd"
          minTickGap={40}
        />
        <YAxis
          hide={d.hidden}
          width={56}
          tick={AXIS_TICK}
          tickLine={false}
          axisLine={false}
          domain={['auto', 'auto']}
          tickFormatter={(v: number) => formatCompactMoney(v, d.currency, d.fx)}
        />
        {d.hidden ? null : (
          <Tooltip
            formatter={(v) => [formatDisplayMoney(Number(v), d), 'Patrimoine']}
            labelFormatter={(l) => formatDateFr(String(l))}
          />
        )}
        <Area
          type="monotone"
          dataKey="value"
          stroke={COLORS.curve}
          strokeWidth={2}
          fill={`url(#${gradId})`}
          dot={false}
          isAnimationActive={false}
        />
      </RAreaChart>
    </ChartFrame>
  );
}
