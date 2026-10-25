// Crée la page « Patrimoine » et les 7 bases Notion. Usage : npx tsx scripts/setup-notion.ts
// Lit NOTION_TOKEN et NOTION_PARENT_PAGE_ID dans l'environnement ou dans .env.local.
import { createNotionClient } from '../src/notion/client';
import { setupNotion } from '../src/notion/setup';

for (const file of ['.env.local', '.env']) {
  try { process.loadEnvFile(file); } catch { /* fichier absent : on s'appuie sur l'environnement */ }
}

const created: string[] = [];

async function main() {
  const token = process.env.NOTION_TOKEN;
  const parentPageId = process.env.NOTION_PARENT_PAGE_ID;
  if (!token || !parentPageId) {
    console.error('Renseignez NOTION_TOKEN et NOTION_PARENT_PAGE_ID (dans .env.local ou l’environnement).');
    console.error('La page indiquée doit être partagée avec l’intégration Notion ; la page « Patrimoine » est créée dedans.');
    process.exit(1);
  }

  console.error('Création de la page « Patrimoine » et des bases (environ 15 s)…');
  console.log('\n# À copier dans .env.local (identifiants des sources de données Notion)');
  // Chaque identifiant est affiché dès que sa base existe : en cas d'échec, ceux déjà créés restent visibles.
  await setupNotion(createNotionClient(token), parentPageId, undefined, (key, id) => {
    created.push(`NOTION_DB_${key.toUpperCase()}=${id}`);
    console.log(created.at(-1));
  });
  console.error('\nTerminé. Dans Notion, partagez ensuite la seule page « Patrimoine » avec l’intégration (retirez l’accès à WEALTH).');
}

main().catch(error => {
  console.error('Échec de la création des bases :', error instanceof Error ? error.message : error);
  if (created.length > 0) {
    console.error('Bases déjà créées dans Notion (à supprimer ou à réutiliser avant de relancer) :');
    for (const line of created) console.error(`  ${line}`);
  } else {
    console.error('Aucune base n’a été créée.');
  }
  console.error('La page « Patrimoine » a pu être créée sous la page parente : supprimez-la avant de relancer le script.');
  process.exit(1);
});
