/**
 * Traduz uma mensagem crua do Baileys para o formato que o bot entende.
 * Logica pura: nao toca em rede nem em banco.
 */

/** Campos numericos do Baileys as vezes chegam como Long do protobuf. */
export function toNumber(value) {
  if (value == null) return 0;
  if (typeof value === 'number') return value;
  if (typeof value === 'string') return Number(value) || 0;
  if (typeof value === 'bigint') return Number(value);
  if (typeof value.toNumber === 'function') return value.toNumber();
  if (typeof value.low === 'number') return value.low;
  return 0;
}

/** Desembrulha mensagens efemeras, "ver uma vez", editadas e afins. */
export function unwrap(message, depth = 0) {
  if (!message || depth > 5) return message ?? null;
  const inner =
    message.ephemeralMessage ??
    message.viewOnceMessage ??
    message.viewOnceMessageV2 ??
    message.viewOnceMessageV2Extension ??
    message.documentWithCaptionMessage ??
    message.editedMessage;
  return inner?.message ? unwrap(inner.message, depth + 1) : message;
}

export function textOf(content) {
  if (!content) return '';
  return (
    content.conversation ??
    content.extendedTextMessage?.text ??
    content.imageMessage?.caption ??
    content.videoMessage?.caption ??
    content.documentMessage?.caption ??
    ''
  );
}

export function attachmentOf(content) {
  if (!content) return null;

  const hashOf = (sha) => (sha?.length ? Buffer.from(sha).toString('base64') : '');

  const doc = content.documentMessage;
  if (doc) {
    return {
      type: 'document',
      filename: doc.fileName ?? '',
      mimetype: doc.mimetype ?? '',
      size: toNumber(doc.fileLength),
      hash: hashOf(doc.fileSha256),
    };
  }

  const audio = content.audioMessage;
  if (audio) {
    return {
      // Audio de voz (ptt) nao e material publicado; arquivo de audio pode ser.
      type: audio.ptt ? 'ptt' : 'audio',
      filename: audio.fileName ?? '',
      mimetype: audio.mimetype ?? '',
      size: toNumber(audio.fileLength),
      hash: hashOf(audio.fileSha256),
    };
  }

  for (const [chave, tipo] of [
    ['videoMessage', 'video'],
    ['imageMessage', 'image'],
  ]) {
    const media = content[chave];
    if (media) {
      return {
        type: tipo,
        filename: media.fileName ?? '',
        mimetype: media.mimetype ?? '',
        size: toNumber(media.fileLength),
        hash: hashOf(media.fileSha256),
      };
    }
  }

  return null;
}

/**
 * @returns {null | { groupId, authorId, displayName, text, attachment, timestamp, messageId }}
 */
export function normalize(msg) {
  const groupId = msg?.key?.remoteJid;
  if (!groupId || msg.key.fromMe) return null;

  const content = unwrap(msg.message);
  if (!content) return null;

  // Reacoes, recibos e afins nao sao mensagens de conteudo.
  if (content.reactionMessage || content.protocolMessage || content.pollUpdateMessage) return null;

  const authorId = msg.key.participant ?? msg.participant ?? groupId;
  const timestampSegundos = toNumber(msg.messageTimestamp);

  return {
    groupId,
    authorId,
    displayName: (msg.pushName ?? '').trim() || authorId.split('@')[0],
    text: textOf(content),
    attachment: attachmentOf(content),
    timestamp: timestampSegundos > 0 ? timestampSegundos * 1000 : Date.now(),
    messageId: msg.key.id ?? null,
  };
}
