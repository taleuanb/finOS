import { getDashboard } from '@/lib/load';
import { AppShell } from '@/ui/AppShell';
import { DisplayProvider } from '@/ui/display';
import { StrategieView } from '@/views/StrategieView';
import { saveMetalGrid, saveMonthlyInvest, saveSpecialAssets, saveTarget } from './actions';

export const dynamic = 'force-dynamic';

export default async function StrategiePage() {
  const d = await getDashboard();
  return (
    <DisplayProvider fx={d.fx}>
      <AppShell title="Stratégie">
        <StrategieView data={d} actions={{ saveMonthlyInvest, saveTarget, saveSpecialAssets, saveMetalGrid }} />
      </AppShell>
    </DisplayProvider>
  );
}
