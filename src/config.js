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
  extraKnowledgeDomains: list('EXTRA_KNOWLEDGE_DOMAINS'),
  extraBlockedDomains: list('EXTRA_BLOCKED_DOMAINS'),
};

export function isGroupAllowed(groupId) {
  if (config.allowedGroups.length === 0) return true;
  return config.allowedGroups.includes(groupId.toLowerCase());
}
