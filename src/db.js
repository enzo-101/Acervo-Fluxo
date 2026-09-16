import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { config } from './config.js';

fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });

// SQLite embutido no Node (22.5+): sem dependencia nativa para compilar.
export const db = new DatabaseSync(config.dbPath);
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');

db.exec(`
  CREATE TABLE IF NOT EXISTS groups (
    group_id   TEXT PRIMARY KEY,
    name       TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS people (
    group_id     TEXT NOT NULL,
    author_id    TEXT NOT NULL,
    display_name TEXT NOT NULL,
    updated_at   INTEGER NOT NULL,
    PRIMARY KEY (group_id, author_id)
  );

  CREATE TABLE IF NOT EXISTS contributions (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    group_id    TEXT NOT NULL,
    author_id   TEXT NOT NULL,
    kind        TEXT NOT NULL,
    category    TEXT NOT NULL,
    label       TEXT NOT NULL,
    fingerprint TEXT NOT NULL,
    raw         TEXT,
    message_id  TEXT,
    created_at  INTEGER NOT NULL
  );

  -- O mesmo material nao pontua duas vezes dentro de um grupo.
  CREATE UNIQUE INDEX IF NOT EXISTS idx_contrib_unique
    ON contributions (group_id, fingerprint);

  CREATE INDEX IF NOT EXISTS idx_contrib_group_time
    ON contributions (group_id, created_at);

  CREATE INDEX IF NOT EXISTS idx_contrib_author
    ON contributions (group_id, author_id, created_at);
`);

const statements = {
  upsertGroup: db.prepare(`
    INSERT INTO groups (group_id, name, created_at, updated_at)
    VALUES (@groupId, @name, @now, @now)
    ON CONFLICT(group_id) DO UPDATE SET
      name = COALESCE(excluded.name, groups.name),
      updated_at = excluded.updated_at
  `),
  upsertPerson: db.prepare(`
    INSERT INTO people (group_id, author_id, display_name, updated_at)
    VALUES (@groupId, @authorId, @displayName, @now)
    ON CONFLICT(group_id, author_id) DO UPDATE SET
      display_name = excluded.display_name,
      updated_at = excluded.updated_at
  `),
  insertContribution: db.prepare(`
    INSERT INTO contributions
      (group_id, author_id, kind, category, label, fingerprint, raw, message_id, created_at)
    VALUES
      (@groupId, @authorId, @kind, @category, @label, @fingerprint, @raw, @messageId, @createdAt)
  `),
  findByFingerprint: db.prepare(`
    SELECT c.author_id, c.created_at, p.display_name
    FROM contributions c
    LEFT JOIN people p ON p.group_id = c.group_id AND p.author_id = c.author_id
    WHERE c.group_id = ? AND c.fingerprint = ?
  `),
  countByAuthorSince: db.prepare(`
    SELECT COUNT(*) AS total FROM contributions
    WHERE group_id = ? AND author_id = ? AND created_at >= ?
  `),
  ranking: db.prepare(`
    SELECT
      c.author_id,
      COALESCE(p.display_name, c.author_id) AS display_name,
      COUNT(*) AS total,
      MIN(c.created_at) AS first_at,
      MAX(c.created_at) AS last_at
    FROM contributions c
    LEFT JOIN people p ON p.group_id = c.group_id AND p.author_id = c.author_id
    WHERE c.group_id = ? AND c.created_at >= ?
    GROUP BY c.author_id
    ORDER BY total DESC, first_at ASC
  `),
  totals: db.prepare(`
    SELECT COUNT(*) AS contributions, COUNT(DISTINCT author_id) AS people
    FROM contributions
    WHERE group_id = ? AND created_at >= ?
  `),
  breakdown: db.prepare(`
    SELECT label, COUNT(*) AS total
    FROM contributions
    WHERE group_id = ? AND created_at >= ?
    GROUP BY label
    ORDER BY total DESC
  `),
  authorStats: db.prepare(`
    SELECT COUNT(*) AS total, MAX(created_at) AS last_at
    FROM contributions
    WHERE group_id = ? AND author_id = ? AND created_at >= ?
  `),
  recent: db.prepare(`
    SELECT
      c.label,
      c.raw,
      c.created_at,
      COALESCE(p.display_name, c.author_id) AS display_name
    FROM contributions c
    LEFT JOIN people p ON p.group_id = c.group_id AND p.author_id = c.author_id
    WHERE c.group_id = ?
    ORDER BY c.created_at DESC
    LIMIT ?
  `),
  activeGroupsSince: db.prepare(`
    SELECT DISTINCT group_id FROM contributions WHERE created_at >= ?
  `),
  allGroups: db.prepare('SELECT group_id, name FROM groups'),
  groupName: db.prepare('SELECT name FROM groups WHERE group_id = ?'),
};

export function rememberGroup(groupId, name) {
  statements.upsertGroup.run({ groupId, name: name ?? null, now: Date.now() });
}

export function rememberPerson(groupId, authorId, displayName) {
  statements.upsertPerson.run({ groupId, authorId, displayName, now: Date.now() });
}

/** SQLITE_CONSTRAINT_UNIQUE (2067) — o material ja existe neste grupo. */
function isUniqueViolation(error) {
  return error?.errcode === 2067 || /UNIQUE constraint failed/i.test(error?.message ?? '');
}

/**
 * Grava uma contribuicao.
 *
 * @returns {{ status: 'counted' } | { status: 'duplicate', by: string, at: number }}
 */
export function recordContribution({ groupId, authorId, item, messageId, createdAt = Date.now() }) {
  try {
    statements.insertContribution.run({
      groupId,
      authorId,
      kind: item.kind,
      category: item.category,
      label: item.label,
      fingerprint: item.fingerprint,
      raw: item.raw ?? null,
      messageId: messageId ?? null,
      createdAt,
    });
    return { status: 'counted' };
  } catch (error) {
    if (isUniqueViolation(error)) {
      const previous = statements.findByFingerprint.get(groupId, item.fingerprint);
      return {
        status: 'duplicate',
        by: previous?.display_name ?? previous?.author_id ?? 'alguem',
        at: previous?.created_at ?? 0,
        sameAuthor: previous?.author_id === authorId,
      };
    }
    throw error;
  }
}

export function countByAuthorSince(groupId, authorId, since) {
  return statements.countByAuthorSince.get(groupId, authorId, since)?.total ?? 0;
}

export function getRanking(groupId, since = 0) {
  return statements.ranking.all(groupId, since);
}

export function getTotals(groupId, since = 0) {
  return statements.totals.get(groupId, since) ?? { contributions: 0, people: 0 };
}

export function getBreakdown(groupId, since = 0) {
  return statements.breakdown.all(groupId, since);
}

export function getAuthorStats(groupId, authorId, since = 0) {
  return statements.authorStats.get(groupId, authorId, since) ?? { total: 0, last_at: null };
}

export function getRecent(groupId, limit = 5) {
  return statements.recent.all(groupId, limit);
}

export function getActiveGroupsSince(since) {
  return statements.activeGroupsSince.all(since).map((row) => row.group_id);
}

export function getAllGroups() {
  return statements.allGroups.all();
}

export function getGroupName(groupId) {
  return statements.groupName.get(groupId)?.name ?? null;
}

export function closeDb() {
  db.close();
}
