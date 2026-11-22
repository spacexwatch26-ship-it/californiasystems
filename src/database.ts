import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { config } from "./config.js";

const databasePath = resolve(config.databasePath);
mkdirSync(dirname(databasePath), { recursive: true });

export const database = new DatabaseSync(databasePath);

database.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS discord_events (
    id INTEGER PRIMARY KEY,
    event_type TEXT NOT NULL,
    guild_id TEXT,
    actor_id TEXT,
    subject_id TEXT,
    details TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS game_events (
    id INTEGER PRIMARY KEY,
    event_type TEXT NOT NULL,
    is_911 INTEGER NOT NULL DEFAULT 0,
    details TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS tickets (
    channel_id TEXT PRIMARY KEY,
    opener_id TEXT NOT NULL,
    claimed_by TEXT,
    status TEXT NOT NULL DEFAULT 'open',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    closed_at TEXT
  );

  CREATE TABLE IF NOT EXISTS staff_records (
    id INTEGER PRIMARY KEY,
    record_type TEXT NOT NULL,
    member_id TEXT NOT NULL,
    actor_id TEXT NOT NULL,
    reason TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    revoked_at TEXT
  );

  CREATE TABLE IF NOT EXISTS callsigns (
    member_id TEXT PRIMARY KEY,
    callsign TEXT NOT NULL,
    assigned_by TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS application_types (
    name TEXT PRIMARY KEY,
    description TEXT NOT NULL,
    updated_by TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS moderator_applications (
    id INTEGER PRIMARY KEY,
    applicant_id TEXT NOT NULL,
    answers_json TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'denied')),
    acceptance_id TEXT,
    submitted_at TEXT NOT NULL DEFAULT (datetime('now')),
    reviewed_by TEXT,
    decision_reason TEXT,
    reviewed_at TEXT,
    review_message_id TEXT,
    review_page_message_ids TEXT
  );
  CREATE INDEX IF NOT EXISTS moderator_applications_applicant
    ON moderator_applications(applicant_id, status);

  CREATE TABLE IF NOT EXISTS moderator_application_drafts (
    applicant_id TEXT PRIMARY KEY,
    current_question INTEGER NOT NULL,
    answers_json TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS application_settings (
    setting TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  INSERT OR IGNORE INTO application_settings (setting, value) VALUES ('status', 'closed');

  CREATE TABLE IF NOT EXISTS staff_queue (
    member_id TEXT PRIMARY KEY,
    added_by TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS staff_shifts (
    id INTEGER PRIMARY KEY,
    member_id TEXT NOT NULL,
    clocked_in_at TEXT NOT NULL,
    clocked_out_at TEXT,
    ended_by TEXT,
    end_reason TEXT
  );
  CREATE UNIQUE INDEX IF NOT EXISTS staff_shifts_one_active_per_member
    ON staff_shifts(member_id) WHERE clocked_out_at IS NULL;
  CREATE INDEX IF NOT EXISTS staff_shifts_member_history
    ON staff_shifts(member_id, clocked_in_at DESC);

  CREATE TABLE IF NOT EXISTS giveaways (
    id INTEGER PRIMARY KEY,
    prize TEXT NOT NULL,
    created_by TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'open',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS loa_requests (
    id INTEGER PRIMARY KEY,
    member_id TEXT NOT NULL,
    reason TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    reviewed_by TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS session_polls (
    poll_id TEXT PRIMARY KEY,
    guild_id TEXT NOT NULL,
    channel_id TEXT NOT NULL,
    message_id TEXT NOT NULL UNIQUE,
    notification_role_id TEXT,
    threshold INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    ended_at TEXT,
    session_announcement_message_id TEXT,
    session_announcement_channel_id TEXT
  );

  CREATE TABLE IF NOT EXISTS session_votes (
    poll_id TEXT NOT NULL REFERENCES session_polls(poll_id) ON DELETE CASCADE,
    user_id TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (poll_id, user_id)
  );
`);

const moderatorApplicationColumns = database.prepare("PRAGMA table_info(moderator_applications)").all() as Array<{ name: string }>;
if (!moderatorApplicationColumns.some((column) => column.name === "acceptance_id")) {
  database.exec("ALTER TABLE moderator_applications ADD COLUMN acceptance_id TEXT");
}
database.exec(`
  CREATE UNIQUE INDEX IF NOT EXISTS moderator_applications_acceptance_id
    ON moderator_applications(acceptance_id)
    WHERE acceptance_id IS NOT NULL;
`);

const sessionPollColumns = database.prepare("PRAGMA table_info(session_polls)").all() as Array<{ name: string; notnull: number }>;
if (sessionPollColumns.find((column) => column.name === "notification_role_id")?.notnull === 1) {
  database.exec("PRAGMA foreign_keys = OFF");
  try {
    database.exec(`
      BEGIN IMMEDIATE;
      ALTER TABLE session_votes RENAME TO session_votes_legacy;
      ALTER TABLE session_polls RENAME TO session_polls_legacy;
      CREATE TABLE session_polls (
        poll_id TEXT PRIMARY KEY,
        guild_id TEXT NOT NULL,
        channel_id TEXT NOT NULL,
        message_id TEXT NOT NULL UNIQUE,
        notification_role_id TEXT,
        threshold INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'active',
        created_by TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        ended_at TEXT,
        session_announcement_message_id TEXT,
        session_announcement_channel_id TEXT
      );
      INSERT INTO session_polls
        (poll_id, guild_id, channel_id, message_id, notification_role_id, threshold, status, created_by, created_at, ended_at)
      SELECT poll_id, guild_id, channel_id, message_id, notification_role_id, threshold, status, created_by, created_at, ended_at
      FROM session_polls_legacy;
      CREATE TABLE session_votes (
        poll_id TEXT NOT NULL REFERENCES session_polls(poll_id) ON DELETE CASCADE,
        user_id TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY (poll_id, user_id)
      );
      INSERT INTO session_votes (poll_id, user_id, created_at)
      SELECT poll_id, user_id, created_at FROM session_votes_legacy;
      DROP TABLE session_votes_legacy;
      DROP TABLE session_polls_legacy;
      COMMIT;
    `);
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  } finally {
    database.exec("PRAGMA foreign_keys = ON");
  }
}

const migratedSessionPollColumns = database.prepare("PRAGMA table_info(session_polls)").all() as Array<{ name: string }>;
if (!migratedSessionPollColumns.some((column) => column.name === "session_announcement_message_id")) {
  database.exec("ALTER TABLE session_polls ADD COLUMN session_announcement_message_id TEXT");
}

const sessionAnnouncementChannelColumns = database.prepare("PRAGMA table_info(session_polls)").all() as Array<{ name: string }>;
if (!sessionAnnouncementChannelColumns.some((column) => column.name === "session_announcement_channel_id")) {
  database.exec("ALTER TABLE session_polls ADD COLUMN session_announcement_channel_id TEXT");
}

database.exec(`
  UPDATE session_polls
  SET session_announcement_channel_id = channel_id
  WHERE session_announcement_message_id IS NOT NULL
    AND session_announcement_message_id != 'sending'
    AND session_announcement_channel_id IS NULL;
  UPDATE session_polls SET threshold = 6 WHERE status = 'active';
  UPDATE session_polls
  SET status = 'reached', ended_at = COALESCE(ended_at, datetime('now'))
  WHERE status = 'active'
    AND (SELECT COUNT(*) FROM session_votes WHERE session_votes.poll_id = session_polls.poll_id) >= threshold;
`);

export interface EventRecord {
  eventType: string;
  guildId?: string | undefined;
  actorId?: string | undefined;
  subjectId?: string | undefined;
  details: string;
}

export function saveDiscordEvent(event: EventRecord): void {
  database.prepare(`
    INSERT INTO discord_events (event_type, guild_id, actor_id, subject_id, details)
    VALUES (?, ?, ?, ?, ?)
  `).run(
    event.eventType,
    event.guildId ?? null,
    event.actorId ?? null,
    event.subjectId ?? null,
    event.details.slice(0, 8000),
  );
}

export function saveGameEvent(eventType: string, is911: boolean, details: string): number {
  const result = database.prepare(`
    INSERT INTO game_events (event_type, is_911, details) VALUES (?, ?, ?)
  `).run(eventType, is911 ? 1 : 0, details.slice(0, 4000));
  return Number(result.lastInsertRowid);
}

export function listGameEvents(is911: boolean, limit = 10): Array<{ event_type: string; details: string; created_at: string }> {
  return database.prepare(`
    SELECT event_type, details, created_at
    FROM game_events
    WHERE is_911 = ?
    ORDER BY id DESC
    LIMIT ?
  `).all(is911 ? 1 : 0, limit) as Array<{ event_type: string; details: string; created_at: string }>;
}
