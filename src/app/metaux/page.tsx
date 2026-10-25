import { getDashboard } from '@/lib/load';
import { AppShell } from '@/ui/AppShell';
import { DisplayProvider } from '@/ui/display';
import { MetauxView } from '@/views/MetauxView';

export const dynamic = 'force-dynamic';

export default async function MetauxPage() {
  const d = await getDashboard();
  return (
    <DisplayProvider fx={d.fx}>
      <AppShell title="Métaux précieux">
        <MetauxView data={d} />
      </AppShell>
    </DisplayProvider>
  );
}
