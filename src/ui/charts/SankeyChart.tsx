'use client';

import { Sankey, Tooltip } from 'recharts';
import { useDisplay } from '../display';
import { formatDisplayMoney } from '../Money';
import { ChartFrame, COLORS, chartLabel, type ChartSizeProps } from './shared';

/** Format de `budgetSankey` (T6) : valeurs en EUR. */
export interface SankeyData {
  nodes: { name: string }[];
  links: { source: number; target: number; value: number }[];
}

interface NodeProps {
  x: number;
  y: number;
  width: number;
  height: number;
  index: number;
  payload: { name: string };
}

function SankeyNode({ x, y, width, height, payload }: NodeProps) {
  return (
    <g>
      <rect x={x} y={y} width={width} height={Math.max(height, 1)} fill={COLORS.curve} fillOpacity={0.9} rx={2} />
      <text
        x={x + width + 6}
        y={y + height / 2}
        textAnchor="start"
        dominantBaseline="middle"
        fontSize={11}
        fill={COLORS.text}
      >
        {payload.name}
      </text>
    </g>
  );
}

export function SankeyChart({
  data,
  label = 'Flux du budget mensuel',
  width,
  height = 280,
}: { data: SankeyData; label?: string } & ChartSizeProps) {
  const d = useDisplay();
  return (
    <ChartFrame label={chartLabel(label, d.hidden)} width={width} height={height}>
      <Sankey
        data={data}
        nodePadding={18}
        nodeWidth={8}
        margin={{ top: 8, right: 90, bottom: 8, left: 4 }}
        link={{ stroke: COLORS.accent, strokeOpacity: 0.4 }}
        node={(props: NodeProps) => <SankeyNode {...props} />}
      >
        {d.hidden ? null : <Tooltip formatter={(v) => formatDisplayMoney(Number(v), d)} />}
      </Sankey>
    </ChartFrame>
  );
}
