/**
 * Monta o texto do !pipe e guarda um cache curto dos cards.
 *
 * O cache existe porque varias pessoas pedindo !pipe seguido bateriam na API
 * do Pipefy uma vez por pedido — e a listagem e paginada, entao cada pedido
 * sao varias chamadas.
 */
import { config } from './config.js';
import { fetchCards, fetchPipe, PipefyError } from './pipefy.js';
import { snapshot, conversaoPorEtapa, conversaoPorCoordenacao, novosNaJanela } from './funil.js';
import { startOfWeek, startOfMonth, startOfDay } from './ranking.js';

let cache = null;

export function limparCache() {
  cache = null;
}

async function carregar() {
  if (cache && Date.now() - cache.em < config.pipefyCacheMs) return cache.dados;
  const [pipe, cards] = await Promise.all([fetchPipe(), fetchCards()]);
  cache = { em: Date.now(), dados: { pipe, cards } };
  return cache.dados;
}

const JANELAS = {
  semana: { label: 'esta semana', inicio: () => startOfWeek() },
  mes: { label: 'este mes', inicio: () => startOfMonth() },
  hoje: { label: 'hoje', inicio: () => startOfDay() },
};

export function resolverJanela(palavra) {
  const chave = (palavra ?? '').trim().toLowerCase();
  const apelidos = { '': 'semana', semana: 'semana', semanal: 'semana', mes: 'mes', mês: 'mes', mensal: 'mes', hoje: 'hoje', dia: 'hoje' };
  const resolvida = apelidos[chave];
  return resolvida ? { chave: resolvida, ...JANELAS[resolvida] } : null;
}

function pct(taxa) {
  return taxa == null ? '—' : `${Math.round(taxa * 100)}%`;
}

function data(ms) {
  return new Intl.DateTimeFormat('pt-BR', { timeZone: config.timezone, day: '2-digit', month: '2-digit' }).format(new Date(ms));
}

/**
 * @returns {Promise<string>} texto pronto para o WhatsApp
 */
export async function buildPipeReport(palavraDeJanela = '') {
  const janela = resolverJanela(palavraDeJanela);
  if (!janela) {
    return 'Periodo desconhecido. Use `!pipe`, `!pipe mes` ou `!pipe hoje`.';
  }

  const { pipe, cards } = await carregar();
  const inicio = janela.inicio();
  const fim = Date.now();

  const foto = snapshot(cards, pipe.phases);
  const porEtapa = conversaoPorEtapa(cards, pipe.phases, inicio, fim);
  const porCoord = conversaoPorCoordenacao(cards, pipe.phases, inicio, fim);
  const novos = novosNaJanela(cards, inicio, fim);

  const linhas = [
    `📊 *Funil comercial* — ${janela.label}`,
    `_${pipe.name} · ${foto.total} cards · desde ${data(inicio)}_`,
    '',
    '*Situacao do funil*',
  ];

  for (const fase of foto.fases) {
    linhas.push(`• ${fase.name} — *${fase.total}*`);
  }
  if (foto.semFase > 0) linhas.push(`• (sem fase) — ${foto.semFase}`);

  linhas.push('', '*Conversao por etapa*', '_entraram na etapa no periodo → avancaram_');
  for (const fase of porEtapa) {
    if (fase.ehFinal) {
      // Fase final nao converte para lugar nenhum: o numero que importa e
      // quantos chegaram ate ela no periodo.
      linhas.push(`• ${fase.name} — *${fase.entraram}* ${fase.entraram === 1 ? 'chegou' : 'chegaram'}`);
    } else if (fase.entraram === 0) {
      linhas.push(`• ${fase.name} — sem entradas`);
    } else {
      linhas.push(`• ${fase.name} — ${fase.avancaram}/${fase.entraram} · *${pct(fase.taxa)}*`);
    }
  }

  linhas.push('', '*Conversao por coordenacao*');
  if (porCoord.length === 0) {
    linhas.push('_Nenhum card entrou no funil no periodo._');
  } else {
    for (const linha of porCoord) {
      const ganhos = linha.ganhos > 0 ? ` · ${linha.ganhos} ganho${linha.ganhos === 1 ? '' : 's'}` : '';
      linhas.push(`• ${linha.label} — ${linha.avancaram}/${linha.entraram} · *${pct(linha.taxa)}*${ganhos}`);
    }
  }

  linhas.push('', `🆕 ${novos.length} lead${novos.length === 1 ? '' : 's'} ${novos.length === 1 ? 'novo' : 'novos'} no periodo`);

  return linhas.join('\n');
}

/** Traduz falha da API em algo acionavel dentro do grupo. */
export function explicarErro(error) {
  if (error instanceof PipefyError) {
    return `⚠️ Nao consegui falar com o Pipefy.\n_${error.message}_`;
  }
  return `⚠️ Erro inesperado ao montar o funil.\n_${error.message}_`;
}
