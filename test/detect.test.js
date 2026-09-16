import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyUrl, classifyAttachment, classifyMessage, extractUrls } from '../src/detect.js';

test('reconhece links de conhecimento', () => {
  const casos = [
    'https://docs.google.com/document/d/1AbCdEfGhIjKlMnOpQrStUv/edit',
    'https://drive.google.com/file/d/1AbCdEfGhIjKlMnOpQrStUv/view?usp=sharing',
    'https://www.notion.so/Meu-Doc-1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d',
    'https://youtu.be/dQw4w9WgXcQ',
    'https://open.spotify.com/episode/4AbCdEfGhIjKlMnOpQ',
    'https://arxiv.org/abs/2301.00001',
    'https://github.com/anthropics/claude-code',
    'https://medium.com/@alguem/artigo-legal-123',
    'https://exemplo.com/material/apostila.pdf',
    'https://www.dropbox.com/s/abc/arquivo.zip',
    'https://www.alura.com.br/curso-online-sql',
  ];
  for (const url of casos) {
    assert.ok(classifyUrl(url), `deveria contar: ${url}`);
  }
});

test('ignora links que nao sao material', () => {
  const casos = [
    'https://chat.whatsapp.com/ABC123',
    'https://www.instagram.com/reel/XYZ/',
    'https://www.tiktok.com/@alguem/video/123',
    'https://x.com/alguem/status/123',
    'https://meet.google.com/abc-defg-hij',
    'https://www.mercadolivre.com.br/produto/123',
    'nao-e-url',
  ];
  for (const url of casos) {
    assert.equal(classifyUrl(url), null, `nao deveria contar: ${url}`);
  }
});

test('o mesmo video do YouTube em formatos diferentes tem o mesmo fingerprint', () => {
  const a = classifyUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42s');
  const b = classifyUrl('https://youtu.be/dQw4w9WgXcQ?si=algumRastreador');
  const c = classifyUrl('https://www.youtube.com/embed/dQw4w9WgXcQ');
  assert.equal(a.fingerprint, b.fingerprint);
  assert.equal(b.fingerprint, c.fingerprint);
});

test('parametros de rastreamento nao criam materiais diferentes', () => {
  const a = classifyUrl('https://medium.com/@x/artigo-1?utm_source=whatsapp&utm_medium=social');
  const b = classifyUrl('https://medium.com/@x/artigo-1');
  assert.equal(a.fingerprint, b.fingerprint);
});

test('o mesmo documento do Drive por URLs diferentes colapsa em um item', () => {
  const a = classifyUrl('https://docs.google.com/document/d/1AbCdEfGhIjKlMnOp/edit#heading=h.x');
  const b = classifyUrl('https://docs.google.com/document/d/1AbCdEfGhIjKlMnOp/preview');
  assert.equal(a.fingerprint, b.fingerprint);
});

test('classifica anexos por extensao e por mimetype', () => {
  const pdf = classifyAttachment({ type: 'document', filename: 'Apostila Calculo II.pdf', size: 12345 });
  assert.equal(pdf.kind, 'document');
  assert.equal(pdf.label, 'PDF');

  const zip = classifyAttachment({ type: 'document', filename: 'materiais.zip', size: 999 });
  assert.equal(zip.kind, 'archive');

  const semExtensao = classifyAttachment({
    type: 'document',
    filename: 'arquivo',
    mimetype: 'application/pdf',
    size: 10,
  });
  assert.equal(semExtensao?.label, 'PDF');

  const executavel = classifyAttachment({ type: 'document', filename: 'setup.exe', size: 10 });
  assert.equal(executavel, null);
});

test('audio de voz e midia solta nao contam por padrao', () => {
  assert.equal(classifyAttachment({ type: 'ptt', size: 100 }), null);
  assert.equal(classifyAttachment({ type: 'image', filename: 'foto.jpg', size: 100 }), null);
  assert.equal(classifyAttachment({ type: 'video', filename: 'clipe.mp4', size: 100 }), null);
  assert.ok(classifyAttachment({ type: 'video', filename: 'aula.mp4', size: 100 }, { countNativeMedia: true }));
});

test('dedup por hash ignora o nome do arquivo', () => {
  const opcoes = { dedupFilesByHash: true };
  const a = classifyAttachment({ type: 'document', filename: 'apostila.pdf', size: 1, hash: 'HASH123' }, opcoes);
  const b = classifyAttachment({ type: 'document', filename: 'copia (1).pdf', size: 2, hash: 'HASH123' }, opcoes);
  assert.equal(a.fingerprint, b.fingerprint);
});

test('uma mensagem com anexo e link rende dois itens', () => {
  const itens = classifyMessage({
    text: 'Segue a apostila e o video complementar: https://youtu.be/abc12345678',
    attachment: { type: 'document', filename: 'apostila.pdf', size: 500 },
  });
  assert.equal(itens.length, 2);
  assert.deepEqual(itens.map((i) => i.kind).sort(), ['document', 'link']);
});

test('respeita o teto de itens por mensagem', () => {
  const texto = [
    'https://arxiv.org/abs/1',
    'https://arxiv.org/abs/2',
    'https://arxiv.org/abs/3',
    'https://arxiv.org/abs/4',
    'https://arxiv.org/abs/5',
  ].join(' ');
  assert.equal(classifyMessage({ text: texto }, { maxItemsPerMessage: 3 }).length, 3);
});

test('links repetidos na mesma mensagem contam uma vez', () => {
  const texto = 'https://arxiv.org/abs/1 e de novo https://arxiv.org/abs/1';
  assert.equal(classifyMessage({ text: texto }).length, 1);
});

test('extrai urls grudadas em pontuacao e sem protocolo', () => {
  const urls = extractUrls('Olha isso (https://arxiv.org/abs/1). Tambem www.github.com/x/y, vale.');
  assert.deepEqual(urls, ['https://arxiv.org/abs/1', 'https://www.github.com/x/y']);
});

test('mensagem comum nao gera contribuicao', () => {
  assert.equal(classifyMessage({ text: 'bom dia pessoal, tudo certo?' }).length, 0);
  assert.equal(classifyMessage({ text: '' }).length, 0);
});
