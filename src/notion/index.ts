import type { Repo } from './repo';
import { FakeRepo, fixtureSeed } from './fakeRepo';

/** T1 : renvoie toujours un FakeRepo sur les données des maquettes. T11 le remplace par le Repo Notion. */
export function getRepo(): Repo {
  return new FakeRepo(fixtureSeed);
}
