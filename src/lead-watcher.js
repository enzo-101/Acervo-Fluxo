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

/** Corta valor longo para o aviso nao virar uma parede de texto. */
function resumir(valor, max = 180) {
  const limpo = valor.replace(/\s+/g, ' ').trim();
  return limpo.length <= max ? limpo : `${limpo.slice(0, max - 1)}…`;
}

/**
 * Escolhe o que mostrar do formulario. Sem LEAD_FIELDS configurado mostra
 * todos os campos preenchidos, porque nao da para adivinhar como o pipe de
 * cada um se chama. Com a variavel, mostra so aqueles, na ordem pedida.
 */
function camposParaMostrar(card) {
  const desejados = config.leadFields;
  if (desejados.length === 0) return card.fields.slice(0, config.leadMaxCampos);

  return desejados
    .map((alvo) => card.fields.find((f) => f.name.toLowerCase().includes(alvo)))
    .filter(Boolean);
}

export function formatar(card) {
  const linhas = ['🆕 *Lead novo no Pipefy*', '', `*${card.title}*`];

  for (const campo of camposParaMostrar(card)) {
    linhas.push(`${campo.name}: ${resumir(campo.value)}`);
  }

  if (card.phaseName) linhas.push(`Etapa: ${card.phaseName}`);
  if (card.labels.length > 0) linhas.push(`Tags: ${card.labels.join(', ')}`);

  linhas.push('');
  if (card.assignees.length > 0) {
    linhas.push(`Responsavel: ${card.assignees.join(', ')}`);
    linhas.push(card.url);
  } else {
    // Nao existe URL que atribua o responsavel em um clique; o link abre o
    // card e a pessoa se atribui la dentro.
    linhas.push('👤 *Sem responsavel* — abra e se atribua:');
    linhas.push(card.url);
  }

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


