import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bot-test-'));
process.env.DB_PATH = path.join(tmpDir, 'test.db');
process.env.TZ = 'America/Sao_Paulo';
process.env.CONFIRM_MODE = 'both'; // para conseguir inspecionar as respostas

const { handleIncoming } = await import('../src/bot.js');
const { normalize } = await import('../src/baileys-message.js');
const { closeDb } = await import('../src/db.js');

const GRUPO = '120363000000000000@g.us';
const ANA = '5521900000001@s.whatsapp.net';
const BRUNO = '5521900000002@s.whatsapp.net';

/** Transporte de mentira: guarda o que o bot tentaria enviar. */
function fakeTransport() {
  const replies = [];
  const reactions = [];
  return {
    replies,
    reactions,
    reply: async (texto) => void replies.push(texto),
    react: async (emoji) => void reactions.push(emoji),
  };
}

/** Monta uma mensagem no formato cru do Baileys. */
function baileysMsg({ from = ANA, nome = 'Ana Paula', texto, documento } = {}) {
  const message = documento
    ? {
        documentMessage: {
          fileName: documento.nome,
          mimetype: documento.mime ?? 'application/pdf',
          fileLength: { low: documento.tamanho ?? 1000, high: 0, unsigned: true },
          fileSha256: Buffer.from(documento.sha ?? 'abc'),
          caption: texto ?? '',
        },
      }
    : { conversation: texto ?? '' };

  return {
    key: { remoteJid: GRUPO, fromMe: false, id: `MSG${Math.random()}`, participant: from },
    pushName: nome,
    messageTimestamp: Math.floor(Date.now() / 1000),
    message,
  };
}

async function enviar(msg) {
  const transport = fakeTransport();
  const incoming = normalize(msg);
  const resultado = await handleIncoming({ ...incoming, groupName: 'Estudos' }, transport);
  return { ...resultado, transport };
}

test('normalize extrai autor, nome, texto e anexo de uma mensagem do Baileys', () => {
  const incoming = normalize(
    baileysMsg({ texto: 'segue material', documento: { nome: 'apostila.pdf', tamanho: 2048 } })
  );
  assert.equal(incoming.groupId, GRUPO);
  assert.equal(incoming.authorId, ANA);
  assert.equal(incoming.displayName, 'Ana Paula');
  assert.equal(incoming.text, 'segue material');
  assert.deepEqual(
    { type: incoming.attachment.type, filename: incoming.attachment.filename, size: incoming.attachment.size },
    { type: 'document', filename: 'apostila.pdf', size: 2048 }
  );
});

test('normalize ignora mensagens do proprio bot e reacoes', () => {
  const propria = baileysMsg({ texto: 'oi' });
  propria.key.fromMe = true;
  assert.equal(normalize(propria), null);

  const reacao = baileysMsg({ texto: '' });
  reacao.message = { reactionMessage: { text: '👍' } };
  assert.equal(normalize(reacao), null);
});

test('normalize desembrulha mensagem efemera', () => {
  const msg = baileysMsg({ texto: '' });
  msg.message = { ephemeralMessage: { message: { conversation: 'https://arxiv.org/abs/123' } } };
  assert.equal(normalize(msg).text, 'https://arxiv.org/abs/123');
});

test('um PDF e contabilizado, com reacao e confirmacao', async () => {
  const { action, transport } = await enviar(
    baileysMsg({ documento: { nome: 'Calculo II.pdf', sha: 'hash-calculo' } })
  );
  assert.equal(action, 'counted');
  assert.deepEqual(transport.reactions, ['📚']);
  assert.match(transport.replies[0], /PDF registrado para \*Ana Paula\* — agora sao 1 contribuicao/);
});

test('conversa normal nao gera nada', async () => {
  const { action, transport } = await enviar(baileysMsg({ texto: 'bom dia pessoal' }));
  assert.equal(action, 'ignored');
  assert.deepEqual(transport.replies, []);
  assert.deepEqual(transport.reactions, []);
});

test('reenvio por outra pessoa nao pontua e credita quem mandou primeiro', async () => {
  const { action, transport } = await enviar(
    baileysMsg({
      from: BRUNO,
      nome: 'Bruno',
      documento: { nome: 'Calculo II.pdf', sha: 'hash-calculo' },
    })
  );
  assert.equal(action, 'duplicate');
  assert.deepEqual(transport.reactions, ['♻️']);
  assert.match(transport.replies[0], /ja foi compartilhado por \*Ana Paula\*/);
});

test('!ranking responde com o top', async () => {
  await enviar(baileysMsg({ from: BRUNO, nome: 'Bruno', texto: 'https://youtu.be/aula123' }));

  const { action, transport } = await enviar(baileysMsg({ from: BRUNO, nome: 'Bruno', texto: '!ranking' }));
  assert.equal(action, 'command');
  assert.match(transport.replies[0], /🏆 \*Ranking de Conhecimento\* — Geral/);
  assert.match(transport.replies[0], /🥇 \*Ana Paula\* — 1/);
  assert.match(transport.replies[0], /🥈 \*Bruno\* — 1/);
});

test('!meu responde com a situacao de quem perguntou', async () => {
  const { transport } = await enviar(baileysMsg({ from: BRUNO, nome: 'Bruno', texto: '/meu' }));
  assert.match(transport.replies[0], /📊 \*Bruno\*/);
  assert.match(transport.replies[0], /2º lugar de 2/);
});

test('comando inexistente nao gera resposta', async () => {
  const { action, transport } = await enviar(baileysMsg({ texto: '!qualquercoisa' }));
  assert.equal(action, 'unknown-command');
  assert.deepEqual(transport.replies, []);
});

test('material da fila offline recente e contabilizado', async () => {
  // Chegou ha 6 horas, enquanto o bot estava fora do ar.
  const msg = baileysMsg({ documento: { nome: 'offline.pdf', sha: 'hash-offline' } });
  msg.messageTimestamp = Math.floor((Date.now() - 6 * 60 * 60 * 1000) / 1000);

  const { action } = await enviar(msg);
  assert.equal(action, 'counted');
});

test('material antigo demais nao entra no ranking', async () => {
  const msg = baileysMsg({ documento: { nome: 'antigo.pdf', sha: 'hash-antigo' } });
  msg.messageTimestamp = Math.floor((Date.now() - 30 * 24 * 60 * 60 * 1000) / 1000);

  const { action, transport } = await enviar(msg);
  assert.equal(action, 'too-old');
  assert.deepEqual(transport.replies, []);
  assert.deepEqual(transport.reactions, []);
});

test('mensagem fora de grupo e ignorada', async () => {
  const msg = baileysMsg({ documento: { nome: 'outro.pdf', sha: 'x' } });
  msg.key.remoteJid = '5521900000009@s.whatsapp.net';
  msg.key.participant = undefined;
  const transport = fakeTransport();
  const resultado = await handleIncoming(normalize(msg), transport);
  assert.equal(resultado.action, 'ignored');
  assert.deepEqual(transport.replies, []);
});

test.after(() => {
  closeDb();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});
