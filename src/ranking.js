import { config } from './config.js';
import { getRanking, getTotals, getBreakdown, getAuthorStats } from './db.js';

const MEDALS = ['🥇', '🥈', '🥉'];

export const PERIODS = {
  geral: { label: 'Geral', since: () => 0 },
  mes: { label: 'Este mes', since: () => startOfMonth() },
  semana: { label: 'Esta semana', since: () => startOfWeek() },
  hoje: { label: 'Hoje', since: () => startOfDay() },
};

/** Converte "agora" para os campos de data ja no fuso configurado. */
function zonedParts(date = new Date()) {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: config.timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
    weekday: 'short',
  });
  const parts = Object.fromEntries(formatter.formatToParts(date).map((p) => [p.type, p.value]));
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour === '24' ? '0' : parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
    weekday: parts.weekday,
  };
}

/** Milissegundos decorridos hoje, no fuso configurado. */
function msIntoDay(date = new Date()) {
  const { hour, minute, second } = zonedParts(date);
  return ((hour * 60 + minute) * 60 + second) * 1000 + date.getMilliseconds();
}

export function startOfDay(date = new Date()) {
  return date.getTime() - msIntoDay(date);
}

export function startOfWeek(date = new Date()) {
  const order = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  const weekdayIndex = order[zonedParts(date).weekday] ?? 0;
  return startOfDay(date) - weekdayIndex * 24 * 60 * 60 * 1000;
}

export function startOfMonth(date = new Date()) {
  const { day } = zonedParts(date);
  return startOfDay(date) - (day - 1) * 24 * 60 * 60 * 1000;
}

export function resolvePeriod(word) {
  const key = (word ?? '').trim().toLowerCase();
  const aliases = {
    '': 'geral',
    geral: 'geral',
    total: 'geral',
    tudo: 'geral',
    sempre: 'geral',
    mes: 'mes',
    mês: 'mes',
    mensal: 'mes',
    semana: 'semana',
    semanal: 'semana',
    hoje: 'hoje',
    dia: 'hoje',
  };
  const resolved = aliases[key];
  return resolved ? { key: resolved, ...PERIODS[resolved] } : null;
}

function plural(n, singular, pluralForm) {
  return `${n} ${n === 1 ? singular : pluralForm}`;
}

/** Trunca nomes muito longos para o ranking nao virar uma parede de texto. */
function shortName(name, max = 24) {
  const clean = (name ?? '').replace(/\s+/g, ' ').trim();
  if (clean.length <= max) return clean || 'Sem nome';
  return `${clean.slice(0, max - 1)}…`;
}

/**
 * Monta o texto do ranking top N de um grupo.
 */
export function buildRankingText(groupId, { periodKey = 'geral', size = config.rankingSize, title = 'Ranking de Conhecimento', highlightAuthorId = null } = {}) {
  const period = PERIODS[periodKey] ?? PERIODS.geral;
  const since = period.since();
  const rows = getRanking(groupId, since);
  const totals = getTotals(groupId, since);

  const lines = [`🏆 *${title}* — ${period.label}`];

  if (rows.length === 0) {
    lines.push('', '_Nenhuma contribuicao registrada ainda._');
    lines.push('Mande um PDF, um .zip ou um link de material e a contagem comeca.');
    return lines.join('\n');
  }

  lines.push(
    `_${plural(totals.contributions, 'contribuicao', 'contribuicoes')} · ${plural(totals.people, 'pessoa', 'pessoas')}_`,
    ''
  );

  const top = rows.slice(0, size);
  top.forEach((row, index) => {
    const marker = MEDALS[index] ?? `${String(index + 1).padStart(2, ' ')}.`;
    const name = shortName(row.display_name);
    const isMe = highlightAuthorId && row.author_id === highlightAuthorId;
    const label = index < 3 || isMe ? `*${name}*` : name;
    lines.push(`${marker} ${label} — ${row.total}`);
  });

  // Quem pediu o ranking mas ficou de fora do top N ganha a propria linha.
  if (highlightAuthorId) {
    const position = rows.findIndex((row) => row.author_id === highlightAuthorId);
    if (position >= size) {
      lines.push('⋯', `${position + 1}. *${shortName(rows[position].display_name)}* — ${rows[position].total}`);
    }
  }

  const breakdown = getBreakdown(groupId, since).slice(0, 4);
  if (breakdown.length > 0) {
    lines.push('', `_${breakdown.map((row) => `${row.label}: ${row.total}`).join(' · ')}_`);
  }

  return lines.join('\n');
}

/**
 * Linha curta com a situacao de uma pessoa especifica.
 */
export function buildPersonalText(groupId, authorId, displayName) {
  const total = getAuthorStats(groupId, authorId).total;
  if (total === 0) {
    return `📭 *${shortName(displayName)}*, voce ainda nao registrou nenhuma contribuicao.\nMande um PDF, um .zip ou um link de material para entrar no ranking.`;
  }

  const rows = getRanking(groupId, 0);
  const position = rows.findIndex((row) => row.author_id === authorId) + 1;
  const ahead = position > 1 ? rows[position - 2] : null;

  const lines = [
    `📊 *${shortName(displayName)}*`,
    `${plural(total, 'contribuicao', 'contribuicoes')} · ${position}º lugar de ${rows.length}`,
  ];

  if (ahead) {
    const gap = ahead.total - total + 1;
    lines.push(`_Faltam ${plural(gap, 'contribuicao', 'contribuicoes')} para passar ${shortName(ahead.display_name)}._`);
  } else {
    lines.push('_Voce esta na lideranca._ 👑');
  }

  const month = getAuthorStats(groupId, authorId, startOfMonth()).total;
  const week = getAuthorStats(groupId, authorId, startOfWeek()).total;
  lines.push('', `_Este mes: ${month} · Esta semana: ${week}_`);

  return lines.join('\n');
}
