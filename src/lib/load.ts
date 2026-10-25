import type { Dashboard } from './dashboard';
import { fixtureDashboard } from './fixtures';

/** T1 : renvoie les données des maquettes. T15 le remplace par le calcul réel depuis le Repo. */
export async function getDashboard(): Promise<Dashboard> {
  return fixtureDashboard;
}
