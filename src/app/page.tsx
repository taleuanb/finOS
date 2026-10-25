import { getDashboard } from '@/lib/load';
import { AppShell } from '@/ui/AppShell';
import { DisplayProvider } from '@/ui/display';
import { EyeButton, SyntheseView } from '@/views/SyntheseView';

export const dynamic = 'force-dynamic';

export default async function Page() {
  const d = await getDashboard();
  return (
    <DisplayProvider fx={d.fx}>
      <AppShell title="Synthèse" actions={<EyeButton />}>
        <SyntheseView data={d} />
      </AppShell>
    </DisplayProvider>
  );
}
