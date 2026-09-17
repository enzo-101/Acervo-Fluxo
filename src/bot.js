import { config, isGroupAllowed, isRankingGroup } from './config.js';
import { classifyMessage } from './detect.js';
import {
  rememberGroup,
  rememberPerson,
  recordContribution,
  countByAuthorSince,
} from './db.js';
import { parseCommand, runCommand } from './commands.js';
import { startOfDay } from './ranking.js';

/**
 * Ao reconectar, o WhatsApp entrega a fila do periodo offline. Isso e o que
 * queremos (ninguem perde credito porque o bot caiu de madrugada), mas na
 * primeira conexao a fila pode trazer coisa antiga demais. O corte evita que
 * um material de meses atras entre no ranking de uma vez.
 */
export function isTooOld(timestamp) {
  if (config.maxMessageAgeDays <= 0 || !timestamp) return false;
  return Date.now() - timestamp > config.maxMessageAgeDays * 24 * 60 * 60 * 1000;
}

/**
 * Nucleo do bot, independente de biblioteca de WhatsApp.
 *
 * @param {{
 *   groupId: string,
 *   groupName?: string,
 *   authorId: string,
 *   displayName: string,
 *   text?: string,
 *   attachment?: object|null,
 *   timestamp?: number,
 * }} incoming
 * @param {{ reply: (texto: string) => Promise<void>, react: (emoji: string) => Promise<void> }} transport
 */
export async function handleIncoming(incoming, transport) {
  const { groupId, groupName, authorId, displayName, text = '', attachment = null } = incoming;

  if (!groupId.endsWith('@g.us')) return { action: 'ignored' };
  if (!isGroupAllowed(groupId)) return { action: 'ignored' };
  if (isTooOld(incoming.timestamp)) return { action: 'too-old' };

  rememberGroup(groupId, groupName);
  rememberPerson(groupId, authorId, displayName);

  const command = parseCommand(text);
  if (command) {
    const resposta = await runCommand(command, { groupId, authorId, displayName });
    if (resposta) await transport.reply(resposta);
    return { action: resposta ? 'command' : 'unknown-command' };
  }

  // Fora dos grupos de ranking o bot nao contabiliza nada: no grupo do
  // comercial ele so responde !pipe e anuncia lead.
  if (!isRankingGroup(groupId)) return { action: 'ignored' };

  const items = classifyMessage(
    { text, attachment },
    {
      maxItemsPerMessage: config.maxItemsPerMessage,
      countNativeMedia: config.countNativeMedia,
      dedupFilesByHash: config.dedupFilesByHash,
      extraKnowledgeDomains: config.extraKnowledgeDomains,
      extraBlockedDomains: config.extraBlockedDomains,
    }
  );
  if (items.length === 0) return { action: 'ignored' };

  const counted = [];
  const duplicates = [];
  let hitDailyCap = false;

  for (const item of items) {
    if (config.maxItemsPerPersonPerDay > 0) {
      const hoje = countByAuthorSince(groupId, authorId, startOfDay());
      if (hoje >= config.maxItemsPerPersonPerDay) {
        hitDailyCap = true;
        break;
      }
    }

    const resultado = recordContribution({
      groupId,
      authorId,
      item,
      messageId: incoming.messageId,
      createdAt: incoming.timestamp ?? Date.now(),
    });

    if (resultado.status === 'counted') counted.push(item);
    else duplicates.push({ item, ...resultado });
  }

  await confirm(transport, { counted, duplicates, hitDailyCap, displayName, groupId, authorId });

  if (counted.length > 0) return { action: 'counted', items: counted };
  if (hitDailyCap) return { action: 'capped' };
  return { action: 'duplicate', duplicates };
}

async function confirm(transport, { counted, duplicates, hitDailyCap, displayName, groupId, authorId }) {
  const mode = config.confirmMode;
  if (mode === 'silent') return;

  const querReacao = mode === 'reaction' || mode === 'both';
  const querResposta = mode === 'reply' || mode === 'both';

  if (counted.length > 0) {
    if (querReacao) await transport.react(config.confirmEmoji);
    if (querResposta) {
      const total = countByAuthorSince(groupId, authorId, 0);
      const oQue = counted.map((item) => item.label).join(' + ');
      await transport.reply(
        `📚 ${oQue} registrado para *${displayName}* — agora sao ${total} ${total === 1 ? 'contribuicao' : 'contribuicoes'}.`
      );
    }
    return;
  }

  if (hitDailyCap) {
    await transport.react('⏳');
    if (querResposta) {
      await transport.reply(
        `⏳ *${displayName}*, voce ja bateu o limite de ${config.maxItemsPerPersonPerDay} contribuicoes hoje. O material segue valendo para o grupo, so nao entra na contagem.`
      );
    }
    return;
  }

  if (duplicates.length > 0) {
    // Repetido nao pontua, mas a reacao avisa que o bot viu e reconheceu.
    await transport.react('♻️');
    if (querResposta) {
      const primeiro = duplicates[0];
      await transport.reply(
        primeiro.sameAuthor
          ? '♻️ Voce ja tinha compartilhado esse material aqui — nao conta de novo.'
          : `♻️ Esse material ja foi compartilhado por *${primeiro.by}* — o credito continua com ${primeiro.by}.`
      );
    }
  }
}
