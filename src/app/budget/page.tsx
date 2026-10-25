import { getDashboard } from '@/lib/load';
import { AppShell } from '@/ui/AppShell';
import { DisplayProvider } from '@/ui/display';
import { BudgetView } from '@/views/BudgetView';
import { deleteBudgetLine, reorderBudget, saveBudgetLine } from './actions';

export const dynamic = 'force-dynamic';

export default async function BudgetPage() {
  const d = await getDashboard();
  return (
    <DisplayProvider fx={d.fx}>
      <AppShell title="Budget">
        <BudgetView data={d} actions={{ save: saveBudgetLine, remove: deleteBudgetLine, reorder: reorderBudget }} />
      </AppShell>
    </DisplayProvider>
  );
}
