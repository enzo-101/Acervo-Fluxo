import cron from 'node-cron';
import { config, isGroupAllowed } from './config.js';
import { getActiveGroupsSince, getAllGroups, getTotals } from './db.js';
import { buildRankingText, startOfDay } from './ranking.js';
import { checarLeads } from './lead-watcher.js';

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

/**
 * Liga o vigia de leads. Sem token configurado ele nem sobe — assim o bot
 * continua servindo o ranking normalmente em quem nao usa o Pipefy.
 */
export function startLeadWatcher(send, destinos) {
  if (!config.pipefyToken) {
    console.log('[leads] PIPEFY_TOKEN ausente — vigia de leads desligado');
    return null;
  }
  if (!cron.validate(config.leadPollCron)) {
    console.error(`[leads] cron invalido: "${config.leadPollCron}" — vigia desligado`);
    return null;
  }

  const tarefa = cron.schedule(
    config.leadPollCron,
    () => {
      checarLeads(send, destinos)
        .then((r) => {
          if (r.status === 'primeira-execucao') {
            console.log(`[leads] primeira execucao: ${r.registrados} cards registrados sem anunciar`);
          } else if (r.avisados > 0) {
            console.log(`[leads] ${r.avisados} lead(s) anunciado(s)`);
          }
        })
        .catch((error) => console.error('[leads] erro:', error.message));
    },
    { timezone: config.timezone }
  );

  console.log(`[leads] vigia ativo: "${config.leadPollCron}" · pipe ${config.pipefyPipeId}`);
  return tarefa;
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
