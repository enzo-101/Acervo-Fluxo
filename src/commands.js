import { config } from './config.js';
import { getRecent } from './db.js';
import { buildRankingText, buildPersonalText, resolvePeriod } from './ranking.js';
import { buildPipeReport, explicarErro } from './pipe-report.js';

/**
 * Se a mensagem for um comando, devolve `{ name, args }`. Senao, `null`.
 */
export function parseCommand(text) {
  const trimmed = (text ?? '').trim();
  const prefix = config.commandPrefixes.find((item) => trimmed.startsWith(item));
  if (!prefix) return null;

  const withoutPrefix = trimmed.slice(prefix.length).trim();
  if (!withoutPrefix) return null;

  const [name, ...args] = withoutPrefix.split(/\s+/);
  return { name: stripAccents(name.toLowerCase()), args };
}

function stripAccents(text) {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

function formatDate(timestamp) {
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: config.timezone,
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(timestamp));
}

const HELP_TEXT = [
  '📚 *Bot do Ranking de Conhecimento*',
  '',
  'Eu acompanho o grupo e conto toda vez que alguem compartilha material: PDF, documento, slide, planilha, e-book, .zip/.rar, link de Drive/Docs/Notion, artigo, repositorio, curso, aula, video ou podcast.',
  '',
  '*Comandos*',
  '`!ranking` — top 10 geral',
  '`!ranking mes` · `!ranking semana` · `!ranking hoje` — por periodo',
  '`!meu` — sua posicao e quanto falta para subir',
  '`!ultimas` — os ultimos materiais compartilhados',
  '`!regras` — o que conta e o que nao conta',
  '',
  '*Comercial*',
  '`!pipe` — situacao do funil e conversao da semana',
  '`!pipe mes` · `!pipe hoje` — outros periodos',
  '',
  '_Todo dia eu posto o top 10 automaticamente._',
].join('\n');

const RULES_TEXT = [
  '📋 *O que conta como contribuicao*',
  '',
  '✅ *Anexos*',
  'PDF, Word, slides, planilhas, .txt, .md, e-books, notebooks, .zip, .rar, .7z, .tar.gz — e audio/video enviado como documento.',
  '',
  '✅ *Links*',
  'Google Docs/Drive/Sheets/Slides, Notion, Dropbox, OneDrive, GitHub, Colab, Kaggle, artigos (arXiv, Medium, Substack, Wikipedia), cursos (Udemy, Coursera, Alura...), apresentacoes (Canva, Figma, Miro, Loom), documentacao tecnica, YouTube e podcasts do Spotify. Qualquer URL que aponte direto para um arquivo tambem conta.',
  '',
  '❌ *Nao conta*',
  'Audio de voz, figurinha, foto solta, link de Instagram/TikTok/X, convite de grupo, loja, link de reuniao.',
  '',
  '♻️ *Repetido nao pontua*',
  'Se o material ja foi compartilhado no grupo, o credito continua com quem mandou primeiro.',
  '',
  `⚖️ No maximo ${config.maxItemsPerMessage} ${config.maxItemsPerMessage === 1 ? 'item' : 'itens'} por mensagem.`,
].join('\n');

/**
 * Executa um comando. Devolve o texto da resposta, ou `null` se o comando
 * nao existir (nesse caso o bot fica quieto).
 */
export async function runCommand({ name, args }, context) {
  const { groupId, authorId, displayName } = context;

  switch (name) {
    case 'ranking':
    case 'rank':
    case 'top':
    case 'top10': {
      const period = resolvePeriod(args[0] ?? '');
      if (!period) {
        return `Periodo desconhecido. Use: \`!ranking\`, \`!ranking mes\`, \`!ranking semana\` ou \`!ranking hoje\`.`;
      }
      return buildRankingText(groupId, {
        periodKey: period.key,
        highlightAuthorId: authorId,
      });
    }

    case 'pipe':
    case 'funil':
      if (!config.pipefyToken) {
        return '⚠️ O !pipe nao esta configurado: falta a variavel PIPEFY_TOKEN.';
      }
      try {
        return await buildPipeReport(args[0] ?? '');
      } catch (error) {
        return explicarErro(error);
      }

    case 'meu':
    case 'meus':
    case 'minhas':
    case 'eu':
      return buildPersonalText(groupId, authorId, displayName);

    case 'ultimas':
    case 'ultimos':
    case 'recentes': {
      const rows = getRecent(groupId, 8);
      if (rows.length === 0) return '_Nada registrado ainda._';
      const lines = ['🕒 *Ultimos materiais*', ''];
      for (const row of rows) {
        const what = (row.raw ?? '').slice(0, 60);
        lines.push(`• *${row.display_name}* — ${row.label}${what ? ` · ${what}` : ''}`);
        lines.push(`  _${formatDate(row.created_at)}_`);
      }
      return lines.join('\n');
    }

    case 'regras':
    case 'oquevale':
    case 'criterios':
      return RULES_TEXT;

    case 'ajuda':
    case 'help':
    case 'comandos':
    case 'bot':
      return HELP_TEXT;

    default:
      return null;
  }
}
