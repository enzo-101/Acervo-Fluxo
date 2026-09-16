import cron from 'node-cron';
import { config, isGroupAllowed } from './config.js';
import { getActiveGroupsSince, getAllGroups, getTotals } from './db.js';
import { buildRankingText, startOfDay } from './ranking.js';

/**
 * Monta e envia o resumo diario para os grupos relevantes.
 *
 * @param {(groupId: string, texto: string) => Promise<void>} send
 */
export async function sendDailySummary(send) {
  const dayStart = startOfDay();
  const groupIds = config.dailySummaryOnlyIfActive
    ? getActiveGroupsSince(dayStart)
    : getAllGroups().map((row) => row.group_id);

  const targets = groupIds.filter(isGroupAllowed);
  if (targets.length === 0) {
    console.log('[resumo] nenhum grupo com atividade hoje — nada enviado');
    return;
  }

  for (const groupId of targets) {
    const today = getTotals(groupId, dayStart);
    const header = buildRankingText(groupId, { title: 'Ranking do dia' });
    const footer =
      today.contributions > 0
        ? `\n\n📈 _Hoje: ${today.contributions} ${today.contributions === 1 ? 'nova contribuicao' : 'novas contribuicoes'} de ${today.people} ${today.people === 1 ? 'pessoa' : 'pessoas'}._`
        : '\n\n😴 _Hoje ninguem compartilhou nada. Bora?_';

    try {
      await send(groupId, header + footer);
      console.log(`[resumo] enviado para ${groupId}`);
    } catch (error) {
      console.error(`[resumo] falhou para ${groupId}:`, error.message);
    }
  }
}

export function startScheduler(send) {
  if (!cron.validate(config.dailySummaryCron)) {
    console.error(`[resumo] cron invalido: "${config.dailySummaryCron}" — resumo diario desligado`);
    return null;
  }

  const task = cron.schedule(
    config.dailySummaryCron,
    () => {
      sendDailySummary(send).catch((error) => console.error('[resumo] erro:', error));
    },
    { timezone: config.timezone }
  );

  console.log(`[resumo] agendado: "${config.dailySummaryCron}" (${config.timezone})`);
  return task;
}
