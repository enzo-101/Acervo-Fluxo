import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pipe-test-'));
process.env.DB_PATH = path.join(tmpDir, 'test.db');
process.env.TZ = 'America/Sao_Paulo';
process.env.PIPEFY_TOKEN = 'token-de-teste';
process.env.PIPEFY_PIPE_ID = '156763';
process.env.PIPEFY_CACHE_SECONDS = '0';

const AGORA = Date.now();
const iso = (ms) => new Date(ms).toISOString();
const horasAtras = (h) => AGORA - h * 60 * 60 * 1000;

/** Respostas falsas da API do Pipefy, no formato cru do GraphQL. */
let cardsDoPipe = [];
let chamadas = [];

globalThis.fetch = async (url, init) => {
  const corpo = JSON.parse(init.body);
  chamadas.push({ url, auth: init.headers.Authorization, query: corpo.query });

  if (corpo.query.includes('phases {')) {
    return jsonOk({
      pipe: {
        name: 'Comercial',
        phases: [
          { id: '1', name: 'Prospeccao', done: false },
          { id: '2', name: 'Qualificacao', done: false },
          { id: '3', name: 'Ganho', done: true },
        ],
      },
    });
  }
  return jsonOk({
    cards: {
      pageInfo: { hasNextPage: false, endCursor: null },
      edges: cardsDoPipe.map((node) => ({ node })),
    },
  });
};

function jsonOk(data) {
  return { ok: true, status: 200, json: async () => ({ data }) };
}

const { buildPipeReport, limparCache } = await import('../src/pipe-report.js');
const { checarLeads } = await import('../src/lead-watcher.js');
const { graphql, PipefyError, fetchCards } = await import('../src/pipefy.js');
const { contarLeadsAvisados, closeDb } = await import('../src/db.js');

function cardCru({ id, titulo, fase, labels = [], entradas = [], criadoHaHoras = 1 }) {
  return {
    id,
    title: titulo,
    createdAt: iso(horasAtras(criadoHaHoras)),
    done: fase === '3',
    current_phase: { id: fase, name: { 1: 'Prospeccao', 2: 'Qualificacao', 3: 'Ganho' }[fase] },
    labels: labels.map((name, i) => ({ id: String(i), name })),
    assignees: [{ id: '1', name: 'Jonas' }],
    phases_history: entradas.map((faseId) => ({
      phase: { id: faseId, name: faseId },
      firstTimeIn: iso(horasAtras(criadoHaHoras)),
      lastTimeOut: null,
    })),
  };
}

test('o token vai no header Authorization', async () => {
  chamadas = [];
  cardsDoPipe = [];
  await fetchCards();
  assert.equal(chamadas[0].auth, 'Bearer token-de-teste');
  assert.match(chamadas[0].url, /api\.pipefy\.com/);
});

test('erro do GraphQL vira PipefyError legivel', async () => {
  const anterior = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    json: async () => ({ errors: [{ message: 'Pipe not found' }] }),
  });
  await assert.rejects(() => graphql('{ x }'), (e) => e instanceof PipefyError && /Pipe not found/.test(e.message));
  globalThis.fetch = anterior;
});

test('token recusado tem mensagem propria', async () => {
  const anterior = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: false, status: 401, json: async () => ({}) });
  await assert.rejects(() => graphql('{ x }'), (e) => /PIPEFY_TOKEN/.test(e.message));
  globalThis.fetch = anterior;
});

test('relatorio traz funil, conversao por etapa e por coordenacao', async () => {
  limparCache();
  cardsDoPipe = [
    cardCru({ id: '1', titulo: 'Ocean Pact', fase: '2', labels: ['PRO'], entradas: ['1', '2'] }),
    cardCru({ id: '2', titulo: 'Beni', fase: '1', labels: ['PRO', 'QAB'], entradas: ['1'] }),
    cardCru({ id: '3', titulo: 'Croydon', fase: '3', labels: ['MNP'], entradas: ['1', '2', '3'] }),
  ];

  const texto = await buildPipeReport('semana');

  assert.match(texto, /📊 \*Funil comercial\* — esta semana/);
  assert.match(texto, /Comercial · 3 cards/);
  // Foto: 1 em Prospeccao, 1 em Qualificacao, 1 em Ganho
  assert.match(texto, /• Prospeccao — \*1\*/);
  assert.match(texto, /• Ganho — \*1\*/);
  // Coorte: 3 entraram em Prospeccao, 2 avancaram
  assert.match(texto, /• Prospeccao — 2\/3 · \*67%\*/);
  // Coordenacao: PRO teve 2 cards, 1 avancou
  assert.match(texto, /• PRO — 1\/2 · \*50%\*/);
  assert.match(texto, /• MNP — 1\/1 · \*100%\* · 1 ganho/);
  assert.match(texto, /🆕 3 leads novos no periodo/);
});

test('etapa sem entradas nao vira 0%', async () => {
  limparCache();
  cardsDoPipe = [cardCru({ id: '1', titulo: 'X', fase: '1', labels: ['PRO'], entradas: ['1'] })];
  const texto = await buildPipeReport('semana');
  assert.match(texto, /• Qualificacao — sem entradas/);
});

test('periodo invalido avisa em vez de quebrar', async () => {
  assert.match(await buildPipeReport('trimestre'), /Periodo desconhecido/);
});

test('primeira execucao do vigia registra sem anunciar', async () => {
  cardsDoPipe = [
    cardCru({ id: '10', titulo: 'A', fase: '1', entradas: ['1'] }),
    cardCru({ id: '11', titulo: 'B', fase: '1', entradas: ['1'] }),
  ];
  const enviados = [];
  const r = await checarLeads(async (d, t) => enviados.push({ d, t }), () => ['g1@g.us']);

  assert.equal(r.status, 'primeira-execucao');
  assert.deepEqual(enviados, [], 'nao despeja o funil existente no grupo');
  assert.equal(contarLeadsAvisados(), 2);
});

test('card novo depois da primeira execucao e anunciado uma unica vez', async () => {
  cardsDoPipe.push(cardCru({ id: '12', titulo: 'PE Ocean Pact', fase: '1', labels: ['PRO'], entradas: ['1'] }));

  const enviados = [];
  const send = async (destino, texto) => enviados.push({ destino, texto });

  const primeira = await checarLeads(send, () => ['g1@g.us']);
  assert.equal(primeira.avisados, 1);
  assert.equal(enviados.length, 1);
  assert.match(enviados[0].texto, /🆕 \*Lead novo no Pipefy\*/);
  assert.match(enviados[0].texto, /PE Ocean Pact/);
  assert.match(enviados[0].texto, /Tags: PRO/);

  // Rodar de novo com o mesmo card nao pode anunciar outra vez.
  const segunda = await checarLeads(send, () => ['g1@g.us']);
  assert.equal(segunda.avisados, 0);
  assert.equal(enviados.length, 1);
});

test('o lead vai para todos os grupos informados', async () => {
  cardsDoPipe.push(cardCru({ id: '13', titulo: 'Novo Multi', fase: '1', entradas: ['1'] }));
  const enviados = [];
  await checarLeads(async (d, t) => enviados.push(d), () => ['g1@g.us', 'g2@g.us']);
  assert.deepEqual(enviados, ['g1@g.us', 'g2@g.us']);
});

test('card antigo nao e tratado como lead novo', async () => {
  cardsDoPipe.push(cardCru({ id: '14', titulo: 'Velho', fase: '1', entradas: ['1'], criadoHaHoras: 100 }));
  const enviados = [];
  const r = await checarLeads(async (d, t) => enviados.push(d), () => ['g1@g.us']);
  assert.equal(r.avisados, 0);
  assert.deepEqual(enviados, []);
});

test.after(() => {
  closeDb();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});
