/**
 * Vigia de leads novos no Pipefy.
 *
 * Usa polling em vez de webhook de proposito: o bot nao precisa abrir porta
 * HTTP nem expor URL publica, e o intervalo de poucos minutos e imperceptivel
 * para quem le no WhatsApp. O preco disso e lembrar o que ja foi avisado —
 * daqui sai a tabela `leads_avisados`.
 */
import { config } from './config.js';
import { fetchCards } from './pipefy.js';
import { marcarLeadAvisado, jaAvisouLead, contarLeadsAvisados } from './db.js';

let rodando = false;

function formatar(card) {
  const linhas = [`🆕 *Lead novo no Pipefy*`, '', `*${card.title}*`];
  if (card.phaseName) linhas.push(`Etapa: ${card.phaseName}`);
  if (card.labels.length > 0) linhas.push(`Tags: ${card.labels.join(', ')}`);
  if (card.assignees.length > 0) linhas.push(`Responsavel: ${card.assignees.join(', ')}`);
  return linhas.join('\n');
}

/**
 * Busca cards novos e avisa os grupos. Idempotente: um card so e anunciado
 * uma vez, mesmo que a checagem rode duas vezes ou o bot reinicie.
 *
 * @param {(destino: string, texto: string) => Promise<void>} send
 * @param {() => string[]} destinos onde postar
 */
export async function checarLeads(send, destinos) {
  if (rodando) return { status: 'ja-rodando' }; // evita sobreposicao em pipe grande
  rodando = true;

  try {
    const cards = await fetchCards();
    const primeiraVez = contarLeadsAvisados() === 0;
    const corte = Date.now() - config.leadMaxAgeMs;

    const novos = cards
      .filter((card) => card.createdAt != null)
      .filter((card) => card.createdAt >= corte)
      .filter((card) => !jaAvisouLead(card.id))
      .sort((a, b) => a.createdAt - b.createdAt);

    // Na primeira execucao o banco esta vazio e TODO card recente pareceria
    // novo. Registramos sem anunciar, para nao despejar o funil no grupo.
    if (primeiraVez) {
      for (const card of cards) marcarLeadAvisado(card.id, card.createdAt ?? Date.now());
      return { status: 'primeira-execucao', registrados: cards.length };
    }

    const enviados = [];
    for (const card of novos.slice(0, config.leadMaxPorRodada)) {
      const texto = formatar(card);
      for (const destino of destinos()) {
        try {
          await send(destino, texto);
        } catch (error) {
          console.error(`[leads] falha ao avisar ${destino}:`, error.message);
        }
      }
      marcarLeadAvisado(card.id, card.createdAt ?? Date.now());
      enviados.push(card.id);
    }

    // O que passou do teto entra no banco sem alarde, para nao virar enxurrada.
    for (const card of novos.slice(config.leadMaxPorRodada)) {
      marcarLeadAvisado(card.id, card.createdAt ?? Date.now());
    }

    return { status: 'ok', avisados: enviados.length, encontrados: novos.length };
  } finally {
    rodando = false;
  }
}

export { formatar as formatarLead };
