/**
 * Cliente da API GraphQL do Pipefy.
 *
 * Fala so o necessario: descobrir as fases do pipe e listar cards com o
 * historico de fases. O historico vem junto da listagem paginada (50 por
 * pagina), entao a conversao por coorte nao custa uma chamada por card.
 */
import { config } from './config.js';

const ENDPOINT = 'https://api.pipefy.com/graphql';

export class PipefyError extends Error {
  constructor(message, { status = null, errors = null } = {}) {
    super(message);
    this.name = 'PipefyError';
    this.status = status;
    this.errors = errors;
  }
}

/**
 * Executa uma query GraphQL. Injeta o token e normaliza os modos de falha:
 * o Pipefy devolve 200 com `errors` no corpo em vez de status de erro.
 */
export async function graphql(query, variables = {}, { token = config.pipefyToken, signal } = {}) {
  if (!token) {
    throw new PipefyError('PIPEFY_TOKEN nao esta configurado.');
  }

  let resposta;
  try {
    resposta = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ query, variables }),
      signal,
    });
  } catch (error) {
    throw new PipefyError(`Falha de rede ao falar com o Pipefy: ${error.message}`);
  }

  if (resposta.status === 401 || resposta.status === 403) {
    throw new PipefyError('Pipefy recusou o token (401/403). Confira PIPEFY_TOKEN.', {
      status: resposta.status,
    });
  }
  if (resposta.status === 429) {
    throw new PipefyError('Pipefy limitou a taxa de requisicoes (429). Tente de novo em instantes.', {
      status: 429,
    });
  }
  if (!resposta.ok) {
    throw new PipefyError(`Pipefy respondeu ${resposta.status}.`, { status: resposta.status });
  }

  const corpo = await resposta.json();
  if (corpo.errors?.length) {
    throw new PipefyError(corpo.errors.map((e) => e.message).join(' | '), { errors: corpo.errors });
  }
  return corpo.data;
}

const QUERY_FASES = `
  query ($pipeId: ID!) {
    pipe(id: $pipeId) {
      name
      phases { id name done }
    }
  }
`;

/**
 * As fases sao descobertas em tempo de execucao: se o time renomear ou criar
 * uma etapa no Pipefy, o bot acompanha sem precisar de deploy.
 */
export async function fetchPipe(pipeId = config.pipefyPipeId, opcoes = {}) {
  const data = await graphql(QUERY_FASES, { pipeId: String(pipeId) }, opcoes);
  if (!data?.pipe) throw new PipefyError(`Pipe ${pipeId} nao encontrado ou sem acesso.`);
  return {
    name: data.pipe.name,
    phases: data.pipe.phases.map((f, indice) => ({
      id: String(f.id),
      name: f.name,
      done: Boolean(f.done),
      ordem: indice,
    })),
  };
}

const QUERY_CARDS = `
  query ($pipeId: ID!, $after: String) {
    cards(pipe_id: $pipeId, first: 50, after: $after) {
      pageInfo { hasNextPage endCursor }
      edges {
        node {
          id
          title
          createdAt
          done
          current_phase { id name }
          labels { id name }
          fields { name report_value value }
          assignees { id name }
          phases_history { firstTimeIn lastTimeOut phase { id name } }
        }
      }
    }
  }
`;

/**
 * Lista todos os cards do pipe, seguindo a paginacao ate o fim.
 *
 * `maxPaginas` existe como freio: um pipe grande com uma query em loop
 * consumiria a cota da API inteira sem que ninguem percebesse.
 */
export async function fetchCards(pipeId = config.pipefyPipeId, { maxPaginas = 40, ...opcoes } = {}) {
  const cards = [];
  let after = null;
  let paginas = 0;

  do {
    const data = await graphql(QUERY_CARDS, { pipeId: String(pipeId), after }, opcoes);
    const conexao = data?.cards;
    if (!conexao) break;

    for (const edge of conexao.edges ?? []) {
      if (edge?.node) cards.push(normalizeCard(edge.node));
    }

    after = conexao.pageInfo?.hasNextPage ? conexao.pageInfo.endCursor : null;
    paginas += 1;
  } while (after && paginas < maxPaginas);

  return cards;
}

/** Achata o card do GraphQL no formato que o resto do bot usa. */
export function normalizeCard(node) {
  const id = String(node.id);
  return {
    id,
    url: `https://app.pipefy.com/open-cards/${id}`,
    title: node.title ?? '(sem titulo)',
    createdAt: node.createdAt ? Date.parse(node.createdAt) : null,
    done: Boolean(node.done),
    phaseId: node.current_phase?.id ? String(node.current_phase.id) : null,
    phaseName: node.current_phase?.name ?? null,
    labels: (node.labels ?? []).map((l) => l.name).filter(Boolean),
    // report_value ja vem formatado para leitura (datas, selects, moeda);
    // value e o cru, usado so quando o outro nao existe.
    fields: (node.fields ?? [])
      .map((f) => ({ name: f.name ?? '', value: (f.report_value ?? f.value ?? '').trim() }))
      .filter((f) => f.name && f.value),
    assignees: (node.assignees ?? []).map((a) => a.name).filter(Boolean),
    history: (node.phases_history ?? [])
      .filter((h) => h?.phase?.id)
      .map((h) => ({
        phaseId: String(h.phase.id),
        phaseName: h.phase.name ?? '',
        firstTimeIn: h.firstTimeIn ? Date.parse(h.firstTimeIn) : null,
        lastTimeOut: h.lastTimeOut ? Date.parse(h.lastTimeOut) : null,
      })),
  };
}
