/**
 * Ve o ranking pelo terminal, sem precisar do WhatsApp rodando.
 *
 *   npm run ranking                 -> lista os grupos
 *   npm run ranking -- <groupId>    -> ranking geral do grupo
 *   npm run ranking -- <groupId> mes
 */
import { getAllGroups, getRecent } from '../src/db.js';
import { buildRankingText, resolvePeriod } from '../src/ranking.js';

const [groupId, periodWord] = process.argv.slice(2);

if (!groupId) {
  const groups = getAllGroups();
  if (groups.length === 0) {
    console.log('Nenhum grupo registrado ainda. Rode o bot e mande um material no grupo.');
    process.exit(0);
  }
  console.log('Grupos conhecidos:\n');
  for (const group of groups) {
    console.log(`  ${group.group_id}  ${group.name ?? '(sem nome)'}`);
  }
  console.log('\nUse: npm run ranking -- <groupId> [geral|mes|semana|hoje]');
  process.exit(0);
}

const period = resolvePeriod(periodWord ?? '');
if (!period) {
  console.error(`Periodo invalido: ${periodWord}. Use geral, mes, semana ou hoje.`);
  process.exit(1);
}

console.log(buildRankingText(groupId, { periodKey: period.key }));

const recent = getRecent(groupId, 5);
if (recent.length > 0) {
  console.log('\nUltimos materiais:');
  for (const row of recent) {
    console.log(`  ${new Date(row.created_at).toLocaleString('pt-BR')}  ${row.display_name} — ${row.label} — ${row.raw ?? ''}`);
  }
}
