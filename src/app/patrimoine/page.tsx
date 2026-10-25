import { getDashboard } from '@/lib/load';
import { AppShell } from '@/ui/AppShell';
import { DisplayProvider } from '@/ui/display';
import { PatrimoineView } from '@/views/PatrimoineView';
import { addMovement, archiveAsset, createAsset, createDebt, deleteDebt, updateAsset, updateDebt } from './actions';

export const dynamic = 'force-dynamic';
/** Vercel : jusqu'à 60 s ; les actions serveur de la page (écritures Notion multiples) héritent de cette durée. */
export const maxDuration = 60;

export default async function PatrimoinePage() {
  const d = await getDashboard();
  return (
    <DisplayProvider fx={d.fx}>
      <AppShell title="Patrimoine">
        <PatrimoineView
          data={d}
          actions={{ createAsset, updateAsset, archiveAsset, addMovement, createDebt, updateDebt, deleteDebt }}
        />
      </AppShell>
    </DisplayProvider>
  );
}
