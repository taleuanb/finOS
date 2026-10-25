import { getDashboard } from '@/lib/load';
import { AppShell } from '@/ui/AppShell';
import { DisplayProvider } from '@/ui/display';
import { EpargneView, MonthPill } from '@/views/EpargneView';
import { declarePurchase, validatePlan } from './actions';

export const dynamic = 'force-dynamic';

export default async function EpargnePage() {
  const d = await getDashboard();
  return (
    <DisplayProvider fx={d.fx}>
      <AppShell title="Épargne" actions={<MonthPill month={d.plan.month} />}>
        <EpargneView data={d} validatePlan={validatePlan} declarePurchase={declarePurchase} />
      </AppShell>
    </DisplayProvider>
  );
}
