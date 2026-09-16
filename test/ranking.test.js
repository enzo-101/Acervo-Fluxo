import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Banco descartavel: precisa ser definido antes de importar src/db.js.
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ranking-test-'));
process.env.DB_PATH = path.join(tmpDir, 'test.db');
process.env.TZ = 'America/Sao_Paulo';

const { recordContribution, rememberPerson, rememberGroup, getRanking, getTotals, closeDb } =
  await import('../src/db.js');
const { buildRankingText, buildPersonalText } = await import('../src/ranking.js');
const { classifyMessage } = await import('../src/detect.js');

const GROUP = '120363000000000000@g.us';
const ANA = '5521900000001@c.us';
const BRUNO = '5521900000002@c.us';
const CARLA = '5521900000003@c.us';

rememberGroup(GROUP, 'Grupo de Estudos');
rememberPerson(GROUP, ANA, 'Ana Paula');
rememberPerson(GROUP, BRUNO, 'Bruno');
rememberPerson(GROUP, CARLA, 'Carla');

/** Simula uma mensagem entrando no bot e devolve o resultado de cada item. */
function send(authorId, message) {
  const items = classifyMessage(message, { maxItemsPerMessage: 3 });
  return items.map((item) => recordContribution({ groupId: GROUP, authorId, item }));
}

test('contribuicoes sao contabilizadas por pessoa', () => {
  assert.deepEqual(
    send(ANA, { attachment: { type: 'document', filename: 'calculo-2.pdf', size: 100 } }),
    [{ status: 'counted' }]
  );
  send(ANA, { text: 'https://arxiv.org/abs/2301.00001' });
  send(ANA, { text: 'https://youtu.be/aulaDeCalculo' });
  send(BRUNO, { attachment: { type: 'document', filename: 'listas.zip', size: 200 } });
  send(BRUNO, { text: 'https://docs.google.com/document/d/1ResumoProvaAbcDef/edit' });
  send(CARLA, { text: 'https://medium.com/@carla/como-estudar' });

  const totals = getTotals(GROUP);
  assert.equal(totals.contributions, 6);
  assert.equal(totals.people, 3);

  const rows = getRanking(GROUP);
  assert.deepEqual(
    rows.map((row) => [row.display_name, row.total]),
    [
      ['Ana Paula', 3],
      ['Bruno', 2],
      ['Carla', 1],
    ]
  );
});

test('material repetido nao pontua e mantem o credito de quem mandou primeiro', () => {
  // Bruno reenvia o video da Ana, com rastreador e em outro formato de URL.
  const resultado = send(BRUNO, { text: 'https://www.youtube.com/watch?v=aulaDeCalculo&si=xyz' });
  assert.equal(resultado[0].status, 'duplicate');
  assert.equal(resultado[0].by, 'Ana Paula');
  assert.equal(resultado[0].sameAuthor, false);
  assert.equal(getTotals(GROUP).contributions, 6);
});

test('a mesma pessoa reenviando o proprio material tambem nao pontua', () => {
  const resultado = send(ANA, { attachment: { type: 'document', filename: 'calculo-2.pdf', size: 100 } });
  assert.equal(resultado[0].status, 'duplicate');
  assert.equal(resultado[0].sameAuthor, true);
});

test('mensagem sem material nao gera linha no banco', () => {
  assert.deepEqual(send(CARLA, { text: 'valeu pessoal!' }), []);
  assert.equal(getTotals(GROUP).contributions, 6);
});

test('o texto do ranking traz podio, contagem e resumo por tipo', () => {
  const texto = buildRankingText(GROUP);
  assert.match(texto, /🥇 \*Ana Paula\* — 3/);
  assert.match(texto, /🥈 \*Bruno\* — 2/);
  assert.match(texto, /🥉 \*Carla\* — 1/);
  assert.match(texto, /6 contribuicoes · 3 pessoas/);
  assert.match(texto, /PDF: 1/);
});

test('empate e desempatado por quem chegou primeiro', () => {
  // Carla tem 1 ponto, marcado antes de todo mundo abaixo — fica na frente deles.
  for (let i = 0; i < 12; i += 1) {
    const pessoa = `55219999900${String(i).padStart(2, '0')}@c.us`;
    rememberPerson(GROUP, pessoa, `Pessoa ${i}`);
    send(pessoa, { text: `https://arxiv.org/abs/9000.${i}` });
  }

  const nomes = getRanking(GROUP).map((row) => row.display_name);
  assert.deepEqual(nomes.slice(0, 4), ['Ana Paula', 'Bruno', 'Carla', 'Pessoa 0']);
});

test('o top respeita o limite e mostra quem pediu, mesmo ficando de fora', () => {
  const ultimo = '5521999990011@c.us'; // Pessoa 11: ultimo a pontuar, 15º lugar
  const texto = buildRankingText(GROUP, { size: 10, highlightAuthorId: ultimo });
  const linhasDeposicao = texto.split('\n').filter((linha) => /— \d+$/.test(linha));

  // 10 posicoes do top + a linha extra de quem pediu e ficou fora dele.
  assert.equal(linhasDeposicao.length, 11);
  assert.match(texto, /⋯/);
  assert.match(texto, /15\. \*Pessoa 11\* — 1/);
});

test('o top nao ganha linha extra quando quem pediu ja esta nele', () => {
  const texto = buildRankingText(GROUP, { size: 10, highlightAuthorId: CARLA });
  assert.equal(texto.split('\n').filter((linha) => /— \d+$/.test(linha)).length, 10);
  assert.doesNotMatch(texto, /⋯/);
});

test('texto pessoal mostra posicao e a distancia para o proximo', () => {
  assert.match(buildPersonalText(GROUP, ANA, 'Ana Paula'), /lideranca/);

  const bruno = buildPersonalText(GROUP, BRUNO, 'Bruno');
  assert.match(bruno, /2 contribuicoes · 2º lugar/);
  assert.match(bruno, /Faltam 2 contribuicoes para passar Ana Paula/);

  const novato = buildPersonalText(GROUP, '5521911111111@c.us', 'Novato');
  assert.match(novato, /ainda nao registrou nenhuma contribuicao/);
});

test('grupo sem nada registrado tem mensagem propria', () => {
  const texto = buildRankingText('120363999999999999@g.us');
  assert.match(texto, /Nenhuma contribuicao registrada ainda/);
});

test.after(() => {
  // No Windows o arquivo so pode ser apagado depois que o banco fecha.
  closeDb();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});
