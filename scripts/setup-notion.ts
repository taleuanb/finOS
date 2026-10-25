// Crée la page « Patrimoine » et les 7 bases Notion. Usage : npx tsx scripts/setup-notion.ts
// Lit NOTION_TOKEN et NOTION_PARENT_PAGE_ID dans l'environnement ou dans .env.local.
import { createNotionClient } from '../src/notion/client';
import { setupNotion } from '../src/notion/setup';

for (const file of ['.env.local', '.env']) {
  try { process.loadEnvFile(file); } catch { /* fichier absent : on s'appuie sur l'environnement */ }
}

async function main() {
  const token = process.env.NOTION_TOKEN;
  const parentPageId = process.env.NOTION_PARENT_PAGE_ID;
  if (!token || !parentPageId) {
    console.error('Renseignez NOTION_TOKEN et NOTION_PARENT_PAGE_ID (dans .env.local ou l’environnement).');
    console.error('La page indiquée doit être partagée avec l’intégration Notion ; la page « Patrimoine » est créée dedans.');
    process.exit(1);
  }

  console.error('Création de la page « Patrimoine » et des bases (environ 10 s)…');
  const ids = await setupNotion(createNotionClient(token), parentPageId);

  console.log('\n# À copier dans .env.local (identifiants des sources de données Notion)');
  console.log(`NOTION_DB_ASSETS=${ids.assets}`);
  console.log(`NOTION_DB_MOVEMENTS=${ids.movements}`);
  console.log(`NOTION_DB_DEBTS=${ids.debts}`);
  console.log(`NOTION_DB_BUDGET=${ids.budget}`);
  console.log(`NOTION_DB_STRATEGY=${ids.strategy}`);
  console.log(`NOTION_DB_PLAN=${ids.plan}`);
  console.log(`NOTION_DB_HISTORY=${ids.history}`);
}

main().catch(error => {
  console.error('Échec de la création des bases :', error instanceof Error ? error.message : error);
  process.exit(1);
});
