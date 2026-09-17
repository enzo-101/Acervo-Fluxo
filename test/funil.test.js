import test from 'node:test';
import assert from 'node:assert/strict';
import { snapshot, conversaoPorEtapa, conversaoPorCoordenacao, novosNaJanela } from '../src/funil.js';
import { normalizeCard } from '../src/pipefy.js';

const FASES = [
  { id: '1', name: 'Prospeccao', done: false, ordem: 0 },
  { id: '2', name: 'Qualificacao', done: false, ordem: 1 },
  { id: '3', name: 'Proposta', done: false, ordem: 2 },
  { id: '4', name: 'Ganho', done: true, ordem: 3 },
];

const SEMANA = Date.UTC(2026, 8, 14); // segunda
const FIM = SEMANA + 7 * 24 * 60 * 60 * 1000;
const dia = (n) => SEMANA + n * 24 * 60 * 60 * 1000;

/** Card de teste: `ate` diz ate que fase ele chegou. */
function card({ id, ate, entrouEm = dia(1), labels = [], faseAtual = null, done = false }) {
  const history = FASES.slice(0, ate).map((f, i) => ({
    phaseId: f.id,
    phaseName: f.name,
    firstTimeIn: entrouEm + i * 60 * 60 * 1000,
    lastTimeOut: null,
  }));
  return {
    id,
    title: `Card ${id}`,
    createdAt: entrouEm,
    done,
    phaseId: faseAtual ?? FASES[ate - 1].id,
    phaseName: FASES[ate - 1].name,
    labels,
    assignees: [],
    history,
  };
}

test('snapshot conta cards por fase atual', () => {
  const cards = [card({ id: 'a', ate: 1 }), card({ id: 'b', ate: 1 }), card({ id: 'c', ate: 3 })];
  const foto = snapshot(cards, FASES);
  assert.equal(foto.total, 3);
  assert.deepEqual(
    foto.fases.map((f) => [f.name, f.total]),
    [['Prospeccao', 2], ['Qualificacao', 0], ['Proposta', 1], ['Ganho', 0]]
  );
});

test('conversao por etapa mede quem entrou na janela e avancou', () => {
  const cards = [
    card({ id: 'a', ate: 2 }), // entrou em Prospeccao e avancou
    card({ id: 'b', ate: 2 }), // idem
    card({ id: 'c', ate: 1 }), // entrou e ficou parado
    card({ id: 'd', ate: 1 }), // idem
  ];
  const [prospeccao, qualificacao] = conversaoPorEtapa(cards, FASES, SEMANA, FIM);

  assert.deepEqual(
    { entraram: prospeccao.entraram, avancaram: prospeccao.avancaram, taxa: prospeccao.taxa },
    { entraram: 4, avancaram: 2, taxa: 0.5 }
  );
  // Dois chegaram em Qualificacao, nenhum passou dali.
  assert.deepEqual(
    { entraram: qualificacao.entraram, avancaram: qualificacao.avancaram, taxa: qualificacao.taxa },
    { entraram: 2, avancaram: 0, taxa: 0 }
  );
});

test('coorte vazia tem taxa null, nao zero', () => {
  const fases = conversaoPorEtapa([], FASES, SEMANA, FIM);
  assert.equal(fases[0].entraram, 0);
  assert.equal(fases[0].taxa, null, 'ninguem entrou: taxa e desconhecida, nao 0%');
});

test('card que entrou fora da janela nao entra na coorte', () => {
  const antigo = card({ id: 'velho', ate: 3, entrouEm: SEMANA - 10 * 24 * 60 * 60 * 1000 });
  const fases = conversaoPorEtapa([antigo], FASES, SEMANA, FIM);
  assert.equal(fases[0].entraram, 0);
});

test('conversao por coordenacao agrupa por label e conta card em duas tags nas duas', () => {
  const cards = [
    card({ id: 'a', ate: 2, labels: ['PRO'] }),
    card({ id: 'b', ate: 1, labels: ['PRO'] }),
    card({ id: 'c', ate: 4, labels: ['PRO', 'QAB'], done: true }),
    card({ id: 'd', ate: 1, labels: ['MNP'] }),
  ];
  const linhas = conversaoPorCoordenacao(cards, FASES, SEMANA, FIM);
  const porLabel = Object.fromEntries(linhas.map((l) => [l.label, l]));

  assert.deepEqual(
    { entraram: porLabel.PRO.entraram, avancaram: porLabel.PRO.avancaram, ganhos: porLabel.PRO.ganhos },
    { entraram: 3, avancaram: 2, ganhos: 1 }
  );
  // O card 'c' tem duas tags e conta inteiro para cada uma.
  assert.deepEqual(
    { entraram: porLabel.QAB.entraram, avancaram: porLabel.QAB.avancaram, ganhos: porLabel.QAB.ganhos },
    { entraram: 1, avancaram: 1, ganhos: 1 }
  );
  assert.equal(porLabel.MNP.taxa, 0);
});

test('card sem tag aparece agrupado separadamente', () => {
  const linhas = conversaoPorCoordenacao([card({ id: 'x', ate: 1 })], FASES, SEMANA, FIM);
  assert.equal(linhas[0].label, '(sem tag)');
});

test('conversao de estoque e coorte dao respostas diferentes', () => {
  // 10 cards parados em Proposta ha meses, e 2 que entraram nesta semana e
  // nao avancaram. A foto do funil sugere movimento; a coorte mostra 0%.
  const parados = Array.from({ length: 10 }, (_, i) =>
    card({ id: `p${i}`, ate: 3, entrouEm: SEMANA - 60 * 24 * 60 * 60 * 1000 })
  );
  const novos = [card({ id: 'n1', ate: 1 }), card({ id: 'n2', ate: 1 })];
  const cards = [...parados, ...novos];

  assert.equal(snapshot(cards, FASES).fases[2].total, 10, 'foto mostra 10 em Proposta');
  const prospeccao = conversaoPorEtapa(cards, FASES, SEMANA, FIM)[0];
  assert.equal(prospeccao.taxa, 0, 'coorte da semana: ninguem avancou');
});

test('novosNaJanela filtra por data de criacao', () => {
  const cards = [card({ id: 'a', ate: 1 }), card({ id: 'b', ate: 1, entrouEm: SEMANA - 1000 })];
  assert.deepEqual(novosNaJanela(cards, SEMANA, FIM).map((c) => c.id), ['a']);
});

test('normalizeCard achata a resposta do GraphQL', () => {
  const node = {
    id: 42,
    title: 'PE Ocean Pact',
    createdAt: '2026-09-15T12:00:00Z',
    done: false,
    current_phase: { id: '3', name: 'Proposta' },
    labels: [{ id: '1', name: 'PRO' }, { id: '2', name: 'QAB' }],
    assignees: [{ id: '9', name: 'Vitor Modesto' }],
    phases_history: [
      { firstTimeIn: '2026-09-14T10:00:00Z', lastTimeOut: '2026-09-15T10:00:00Z', phase: { id: '1', name: 'Prospeccao' } },
      { firstTimeIn: '2026-09-15T10:00:00Z', lastTimeOut: null, phase: { id: '3', name: 'Proposta' } },
    ],
  };
  const c = normalizeCard(node);
  assert.equal(c.id, '42');
  assert.deepEqual(c.labels, ['PRO', 'QAB']);
  assert.deepEqual(c.assignees, ['Vitor Modesto']);
  assert.equal(c.phaseId, '3');
  assert.equal(c.history.length, 2);
  assert.equal(c.history[0].firstTimeIn, Date.parse('2026-09-14T10:00:00Z'));
});

test('normalizeCard aguenta campos ausentes', () => {
  const c = normalizeCard({ id: 1 });
  assert.deepEqual({ labels: c.labels, history: c.history, phaseId: c.phaseId }, { labels: [], history: [], phaseId: null });
  assert.equal(c.title, '(sem titulo)');
});

test('fase final nao recebe taxa de conversao', () => {
  const cards = [card({ id: 'a', ate: 4, done: true }), card({ id: 'b', ate: 4, done: true })];
  const ganho = conversaoPorEtapa(cards, FASES, SEMANA, FIM).at(-1);

  assert.equal(ganho.ehFinal, true);
  assert.equal(ganho.entraram, 2);
  assert.equal(ganho.taxa, null, 'da ultima fase nao se avanca: 0% leria como fracasso');
});
