import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ACERVO = '120363000000000001@g.us';
const COMERCIAL = '120363000000000002@g.us';
const OUTRO = '120363000000000003@g.us';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'escopo-test-'));
process.env.DB_PATH = path.join(tmpDir, 'test.db');
process.env.TZ = 'America/Sao_Paulo';
process.env.RANKING_GROUPS = ACERVO;
process.env.PIPE_GROUPS = COMERCIAL;
process.env.PIPEFY_TOKEN = 'token-de-teste';
process.env.PIPEFY_CACHE_SECONDS = '0';

// API do Pipefy simulada, para o !pipe nao sair na rede.
globalThis.fetch = async (url, init) => {
  const q = JSON.parse(init.body).query;
  const data = q.includes('phases {')
    ? { pipe: { name: 'Comercial', phases: [{ id: '1', name: 'Prospeccao', done: false }] } }
    : { cards: { pageInfo: { hasNextPage: false }, edges: [] } };
  return { ok: true, status: 200, json: async () => ({ data }) };
};

const { isRankingGroup, isPipeGroup } = await import('../src/config.js');
const { runCommand, comandoPermitido } = await import('../src/commands.js');
const { handleIncoming } = await import('../src/bot.js');
const { closeDb } = await import('../src/db.js');

function transporte() {
  const replies = [];
  return { replies, reply: async (t) => void replies.push(t), react: async () => {} };
}

const contexto = (groupId) => ({ groupId, authorId: '5521900000001@s.whatsapp.net', displayName: 'Ana' });

test('os grupos caem no escopo certo', () => {
  assert.equal(isRankingGroup(ACERVO), true);
  assert.equal(isPipeGroup(ACERVO), false);
  assert.equal(isPipeGroup(COMERCIAL), true);
  assert.equal(isRankingGroup(COMERCIAL), false);
  assert.equal(isRankingGroup(OUTRO), false);
  assert.equal(isPipeGroup(OUTRO), false);
});

test('!pipe nao responde no grupo do acervo', async () => {
  assert.equal(comandoPermitido('pipe', ACERVO), false);
  const resposta = await runCommand({ name: 'pipe', args: [] }, contexto(ACERVO));
  assert.equal(resposta, null, 'silencio: responder ja revelaria que existe um funil');
});

test('!pipe responde no grupo do comercial', async () => {
  const resposta = await runCommand({ name: 'pipe', args: [] }, contexto(COMERCIAL));
  assert.match(resposta, /Funil comercial/);
});

test('!ranking nao responde no grupo do comercial', async () => {
  assert.equal(await runCommand({ name: 'ranking', args: [] }, contexto(COMERCIAL)), null);
  assert.equal(await runCommand({ name: 'meu', args: [] }, contexto(COMERCIAL)), null);
});

test('!ranking responde no acervo', async () => {
  const resposta = await runCommand({ name: 'ranking', args: [] }, contexto(ACERVO));
  assert.match(resposta, /Ranking de Conhecimento/);
});

test('a ajuda mostra so o que vale naquele grupo', async () => {
  const noAcervo = await runCommand({ name: 'ajuda', args: [] }, contexto(ACERVO));
  assert.match(noAcervo, /!ranking/);
  assert.doesNotMatch(noAcervo, /!pipe/, 'nao anunciar o funil para quem nao tem acesso');

  const noComercial = await runCommand({ name: 'ajuda', args: [] }, contexto(COMERCIAL));
  assert.match(noComercial, /!pipe/);
  assert.doesNotMatch(noComercial, /!ranking/);
});

test('material compartilhado so conta no grupo de ranking', async () => {
  const pdf = { type: 'document', filename: 'apostila.pdf', size: 100, hash: 'h1' };

  const noAcervo = transporte();
  const r1 = await handleIncoming(
    { ...contexto(ACERVO), text: '', attachment: pdf, timestamp: Date.now() },
    noAcervo
  );
  assert.equal(r1.action, 'counted');

  const noComercial = transporte();
  const r2 = await handleIncoming(
    { ...contexto(COMERCIAL), text: '', attachment: { ...pdf, hash: 'h2', filename: 'outro.pdf' }, timestamp: Date.now() },
    noComercial
  );
  assert.equal(r2.action, 'ignored', 'PDF no grupo do comercial nao vira ranking paralelo');
  assert.deepEqual(noComercial.replies, []);
});

test('ajuda responde em qualquer grupo permitido', () => {
  assert.equal(comandoPermitido('ajuda', OUTRO), true);
});

test.after(() => {
  closeDb();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});
