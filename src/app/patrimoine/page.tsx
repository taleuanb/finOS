import { getDashboard } from '@/lib/load';
import { AppShell } from '@/ui/AppShell';
import { DisplayProvider } from '@/ui/display';
import { AddAssetLink, PatrimoineView } from '@/views/PatrimoineView';

export const dynamic = 'force-dynamic';

export default async function PatrimoinePage() {
  const d = await getDashboard();
  const addUrl = process.env.NEXT_PUBLIC_NOTION_ASSETS_URL;
  return (
    <DisplayProvider fx={d.fx}>
      <AppShell title="Patrimoine" actions={addUrl ? <AddAssetLink href={addUrl} /> : undefined}>
        <PatrimoineView data={d} />
      </AppShell>
    </DisplayProvider>
  );
}
