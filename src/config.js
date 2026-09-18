import 'dotenv/config';
import path from 'node:path';

function str(name, fallback) {
  const value = process.env[name];
  return value === undefined || value === '' ? fallback : value;
}

function bool(name, fallback) {
  const value = process.env[name];
  if (value === undefined || value === '') return fallback;
  return ['1', 'true', 'yes', 'sim', 'y'].includes(value.trim().toLowerCase());
}

function int(name, fallback) {
  const value = Number.parseInt(process.env[name] ?? '', 10);
  return Number.isFinite(value) ? value : fallback;
}

function list(name) {
  return str(name, '')
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

export const config = {
  dbPath: path.resolve(str('DB_PATH', './data/ranking.db')),
  logLevel: str('LOG_LEVEL', 'silent'),

  // --- Pipefy ---
  pipefyToken: str('PIPEFY_TOKEN', ''),
  pipefyPipeId: str('PIPEFY_PIPE_ID', '306460930'),
  pipefyCacheMs: int('PIPEFY_CACHE_SECONDS', 180) * 1000,
  leadPollCron: str('LEAD_POLL_CRON', '*/2 * * * *'),
  // Na primeira vez que o vigia roda ele so registra; depois disso, este corte
  // evita que um card antigo editado apareca como "lead novo".
  leadMaxAgeMs: int('LEAD_MAX_AGE_HOURS', 24) * 60 * 60 * 1000,
  leadMaxPorRodada: int('LEAD_MAX_POR_RODADA', 5),
  // Numero do bot com DDI, so digitos (ex.: 5521999998888). Preenchido, o
  // pareamento passa a ser por codigo de 8 caracteres em vez de QR code.
  botPhoneNumber: str('BOT_PHONE_NUMBER', '').replace(/\D/g, ''),
  timezone: str('TZ', 'America/Sao_Paulo'),
  dailySummaryCron: str('DAILY_SUMMARY_CRON', '0 20 * * *'),
  dailySummaryOnlyIfActive: bool('DAILY_SUMMARY_ONLY_IF_ACTIVE', true),
  confirmMode: str('CONFIRM_MODE', 'reaction'),
  confirmEmoji: str('CONFIRM_EMOJI', '📚'),
  commandPrefixes: str('COMMAND_PREFIXES', '!,/')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean),
  maxItemsPerMessage: int('MAX_ITEMS_PER_MESSAGE', 3),
  maxItemsPerPersonPerDay: int('MAX_ITEMS_PER_PERSON_PER_DAY', 0),
  rankingSize: int('RANKING_SIZE', 10),
  maxMessageAgeDays: int('MAX_MESSAGE_AGE_DAYS', 7),
  countNativeMedia: bool('COUNT_NATIVE_MEDIA', false),
  dedupFilesByHash: bool('DEDUP_FILES_BY_HASH', false),
  allowedGroups: list('ALLOWED_GROUPS'),
  // Escopo por assunto. Vazio = sem restricao, o comportamento de hoje.
  // ALLOWED_GROUPS continua valendo por cima: ele liga/desliga o bot inteiro.
  rankingGroups: list('RANKING_GROUPS'),
  pipeGroups: list('PIPE_GROUPS'),
  extraKnowledgeDomains: list('EXTRA_KNOWLEDGE_DOMAINS'),
  extraBlockedDomains: list('EXTRA_BLOCKED_DOMAINS'),
};

function pertence(lista, groupId) {
  if (lista.length === 0) return true; // lista vazia = todo grupo
  return lista.includes(String(groupId).toLowerCase());
}

/** O bot responde neste grupo? */
export function isGroupAllowed(groupId) {
  return pertence(config.allowedGroups, groupId);
}

/** Este grupo contabiliza ranking e responde !ranking/!meu/!ultimas? */
export function isRankingGroup(groupId) {
  return isGroupAllowed(groupId) && pertence(config.rankingGroups, groupId);
}

/** Este grupo ve o funil comercial: !pipe e avisos de lead novo? */
export function isPipeGroup(groupId) {
  return isGroupAllowed(groupId) && pertence(config.pipeGroups, groupId);
}
