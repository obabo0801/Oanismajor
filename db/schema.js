import { initial } from "../lib/room.js";

export async function prepare(client, sql) {
  const statements = [];

  for (const statement of sql.split(";").filter((value) => value.trim())) {
    const index = statement.match(/CREATE (?:UNIQUE )?INDEX IF NOT EXISTS (\w+)\s+ON (\w+)\./);
    const column = statement.match(/ALTER TABLE ([\w.]+) ADD COLUMN IF NOT EXISTS (\w+)/);
    const create = statement.match(/CREATE (SCHEMA|TABLE) IF NOT EXISTS ([\w.]+)/);

    if (create) {
      const lookup = create[1] === "SCHEMA" ? "to_regnamespace" : "to_regclass";
      const row = await client.get(`SELECT ${lookup}($1) AS object`, [create[2]]);

      if (row.object) continue;
    }

    if (index) {
      const row = await client.get("SELECT to_regclass($1) AS object", [`${index[2]}.${index[1]}`]);

      if (row.object) continue;
    }

    if (column) {
      const row = await client.get(
        `
          SELECT 1
          FROM pg_attribute
          WHERE attrelid = to_regclass($1) AND attname = $2 AND NOT attisdropped
        `,
        [column[1], column[2]]
      );

      if (row) continue;
    }

    statements.push(statement);
  }

  if (statements.length) await client.exec(statements.join(";"));
}

export const registry = `
  CREATE SCHEMA IF NOT EXISTS runtime;

  CREATE TABLE IF NOT EXISTS runtime.server (
    address INET NOT NULL,
    service TEXT NOT NULL CHECK (service IN ('was', 'web', 'db')),
    port INTEGER NOT NULL CHECK (port BETWEEN 1024 AND 65535),
    signature TEXT NOT NULL,
    expires TIMESTAMPTZ NOT NULL,
    pid INTEGER,
    PRIMARY KEY(address, service, port)
  );

  ALTER TABLE runtime.server ADD COLUMN IF NOT EXISTS pid INTEGER;
`;

export default `
  CREATE SCHEMA IF NOT EXISTS account;

  CREATE TABLE IF NOT EXISTS account.block (
    rowid BIGINT GENERATED ALWAYS AS IDENTITY UNIQUE,
    uid TEXT NOT NULL,
    peer TEXT NOT NULL,
    time TEXT NOT NULL DEFAULT (to_char((CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Seoul'), 'YYYY-MM-DD HH24:MI:SS')),
    PRIMARY KEY(uid, peer)
  );

  CREATE TABLE IF NOT EXISTS account.profile (
    rowid BIGINT GENERATED ALWAYS AS IDENTITY UNIQUE,
    uid TEXT PRIMARY KEY,
    id TEXT,
    session TEXT,
    deletion BIGINT,
    recovery TEXT,
    expires BIGINT,
    erased INTEGER NOT NULL DEFAULT 0,
    name TEXT,
    email TEXT,
    google TEXT,
    settings TEXT CHECK (settings IS NULL OR (settings IS JSON)),
    renamed TEXT,
    image TEXT,
    avatar TEXT,
    consent TEXT,
    draft TEXT CHECK (draft IS NULL OR (draft IS JSON)),
    setup INTEGER NOT NULL DEFAULT 0
      CHECK (setup IN (0, 1)),
    role INTEGER NOT NULL DEFAULT 0
      CHECK (role IN (-2, -1, 0)),
    ip TEXT NOT NULL,
    initial TEXT,
    lang TEXT,
    date TEXT NOT NULL
      DEFAULT (to_char((CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Seoul'), 'YYYY-MM-DD HH24:MI:SS'))
  );

  ALTER TABLE account.profile ADD COLUMN IF NOT EXISTS soop TEXT;
  ALTER TABLE account.profile ADD COLUMN IF NOT EXISTS verified BOOLEAN
    GENERATED ALWAYS AS (google IS NOT NULL OR soop IS NOT NULL) STORED;
  CREATE UNIQUE INDEX IF NOT EXISTS usersoop ON account.profile (soop);

  CREATE TABLE IF NOT EXISTS account.file (
    rowid BIGINT GENERATED ALWAYS AS IDENTITY UNIQUE,
    uid TEXT NOT NULL,
    file TEXT NOT NULL,
    PRIMARY KEY(uid, file)
  );

  CREATE TABLE IF NOT EXISTS account.authority (
    rowid BIGINT GENERATED ALWAYS AS IDENTITY UNIQUE,
    uid TEXT PRIMARY KEY,
    memo TEXT,
    time TEXT,
    actor TEXT,
    handler TEXT
  );

  CREATE INDEX IF NOT EXISTS userip
    ON account.profile (ip);

  CREATE UNIQUE INDEX IF NOT EXISTS username
    ON account.profile (lower(name))
    WHERE name IS NOT NULL
      AND trim(name) <> '';

  CREATE UNIQUE INDEX IF NOT EXISTS userdraftname
    ON account.profile (lower(draft::jsonb ->> 'name'))
    WHERE draft IS NOT NULL;

  CREATE UNIQUE INDEX IF NOT EXISTS usergoogle ON account.profile (google);

  CREATE UNIQUE INDEX IF NOT EXISTS userid ON account.profile (id);

  CREATE UNIQUE INDEX IF NOT EXISTS usersession ON account.profile (session);

  CREATE SCHEMA IF NOT EXISTS chatting;

  CREATE TABLE IF NOT EXISTS chatting.room (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
    info TEXT NOT NULL DEFAULT '' CHECK (length(info) <= 1000),
    state TEXT NOT NULL DEFAULT 'active' CHECK (state IN ('active', 'closed', 'archived')),
    time TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  INSERT INTO chatting.room (id, name)
  VALUES ('${initial}', 'Oanismajor')
  ON CONFLICT DO NOTHING;

  CREATE TABLE IF NOT EXISTS chatting.asset (
    rowid BIGINT GENERATED ALWAYS AS IDENTITY UNIQUE,
    seq INTEGER NOT NULL,
    slot INTEGER NOT NULL,
    kind TEXT NOT NULL,
    url TEXT NOT NULL,
    preview TEXT,
    name TEXT,
    size INTEGER,
    PRIMARY KEY(seq, slot)
  );

  CREATE INDEX IF NOT EXISTS chattingassetkind
    ON chatting.asset(kind, seq DESC);

  CREATE TABLE IF NOT EXISTS chatting.message (
    seq BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
    id TEXT NOT NULL UNIQUE,
    uid TEXT NOT NULL,
    text TEXT NOT NULL,
    system TEXT,
    image TEXT,
    preview TEXT,
    audio TEXT,
    attachments TEXT,
    deleted TEXT,
    handler TEXT,
    time TEXT NOT NULL DEFAULT (to_char((CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Seoul'), 'YYYY-MM-DD HH24:MI:SS'))
  );

  ALTER TABLE chatting.message ADD COLUMN IF NOT EXISTS room UUID NOT NULL
    DEFAULT '${initial}' REFERENCES chatting.room(id);

  CREATE INDEX IF NOT EXISTS chattingroom ON chatting.message (room, seq);
  CREATE INDEX IF NOT EXISTS chattingtime ON chatting.message (time, seq);

  CREATE INDEX IF NOT EXISTS chattinguid ON chatting.message (uid, seq);

  CREATE SCHEMA IF NOT EXISTS messenger;

  CREATE TABLE IF NOT EXISTS messenger.asset (
    rowid BIGINT GENERATED ALWAYS AS IDENTITY UNIQUE,
    seq INTEGER NOT NULL,
    slot INTEGER NOT NULL,
    kind TEXT NOT NULL,
    url TEXT NOT NULL,
    preview TEXT,
    name TEXT,
    size INTEGER,
    PRIMARY KEY(seq, slot)
  );

  CREATE INDEX IF NOT EXISTS messageassetkind
    ON messenger.asset(kind, seq DESC);

  CREATE TABLE IF NOT EXISTS messenger.room (
    rowid BIGINT GENERATED ALWAYS AS IDENTITY UNIQUE,
    id TEXT PRIMARY KEY,
    first TEXT NOT NULL,
    second TEXT NOT NULL,
    closed TEXT,
    departed TEXT,
    multiple INTEGER NOT NULL DEFAULT 0,
    owner TEXT,
    name TEXT
  );

  CREATE TABLE IF NOT EXISTS messenger.contact (
    rowid BIGINT GENERATED ALWAYS AS IDENTITY UNIQUE,
    room TEXT PRIMARY KEY,
    uid TEXT NOT NULL,
    handler TEXT,
    assigned TEXT,
    closed TEXT
  );

  CREATE TABLE IF NOT EXISTS messenger.member (
    rowid BIGINT GENERATED ALWAYS AS IDENTITY UNIQUE,
    room TEXT NOT NULL,
    uid TEXT NOT NULL,
    "left" TEXT,
    reason TEXT,
    pinned INTEGER NOT NULL DEFAULT 0,
    muted INTEGER NOT NULL DEFAULT 0,
    deputy INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY(room, uid)
  );

  CREATE INDEX IF NOT EXISTS roommemberuser ON messenger.member(uid, room);

  CREATE TABLE IF NOT EXISTS messenger.receipt (
    rowid BIGINT GENERATED ALWAYS AS IDENTITY UNIQUE,
    message TEXT NOT NULL,
    uid TEXT NOT NULL,
    read TEXT,
    PRIMARY KEY(message, uid)
  );

  CREATE INDEX IF NOT EXISTS messagereceiptuser ON messenger.receipt(uid, message);

  CREATE TABLE IF NOT EXISTS messenger.conversation (
    rowid BIGINT GENERATED ALWAYS AS IDENTITY UNIQUE,
    uid TEXT NOT NULL,
    peer TEXT NOT NULL,
    pinned INTEGER NOT NULL DEFAULT 0,
    muted INTEGER NOT NULL DEFAULT 0,
    hidden INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY(uid, peer)
  );

  CREATE TABLE IF NOT EXISTS messenger.message (
    seq BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
    id TEXT NOT NULL UNIQUE,
    sender TEXT NOT NULL,
    recipient TEXT NOT NULL,
    room TEXT,
    system TEXT,
    text TEXT NOT NULL,
    read TEXT,
    deleted TEXT,
    attachments TEXT,
    audio TEXT,
    time TEXT NOT NULL DEFAULT (to_char((CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Seoul'), 'YYYY-MM-DD HH24:MI:SS'))
  );

  CREATE INDEX IF NOT EXISTS messagerecipient ON messenger.message(recipient, seq);

  CREATE INDEX IF NOT EXISTS messagesender ON messenger.message(sender, seq);

  CREATE SCHEMA IF NOT EXISTS moderation;

  CREATE TABLE IF NOT EXISTS moderation.report (
    seq BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
    id TEXT NOT NULL UNIQUE,
    type TEXT NOT NULL CHECK (type IN ('user', 'message')),
    reporter TEXT NOT NULL,
    target TEXT NOT NULL,
    message TEXT,
    text TEXT,
    reason TEXT NOT NULL,
    detail TEXT NOT NULL DEFAULT '',
    snapshot TEXT,
    time TEXT NOT NULL DEFAULT (to_char((CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Seoul'), 'YYYY-MM-DD HH24:MI:SS')),
    CHECK (reporter <> target),
    CHECK ((type = 'user' AND message IS NULL AND text IS NULL)
      OR (type = 'message' AND message IS NOT NULL AND text IS NOT NULL))
  );

  CREATE INDEX IF NOT EXISTS reporttarget ON moderation.report (target, seq);

  CREATE TABLE IF NOT EXISTS moderation.sanction (
    rowid BIGINT GENERATED ALWAYS AS IDENTITY UNIQUE,
    uid TEXT PRIMARY KEY,
    count INTEGER NOT NULL DEFAULT 0,
    muted TEXT,
    notice TEXT,
    kicked TEXT,
    reason TEXT,
    time TEXT
  );

  CREATE TABLE IF NOT EXISTS moderation.block (
    rowid BIGINT GENERATED ALWAYS AS IDENTITY UNIQUE,
    uid TEXT,
    ip TEXT,
    reason TEXT,
    actor TEXT,
    handler TEXT,
    log INTEGER NOT NULL DEFAULT 0
      CHECK (log IN (0, 1)),
    time TEXT NOT NULL
      DEFAULT (to_char((CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Seoul'), 'YYYY-MM-DD HH24:MI:SS'))
  );

  CREATE INDEX IF NOT EXISTS blockuid
    ON moderation.block (uid);

  CREATE INDEX IF NOT EXISTS blockip
    ON moderation.block (ip);

  CREATE SCHEMA IF NOT EXISTS push;

  CREATE TABLE IF NOT EXISTS push.web (
    rowid BIGINT GENERATED ALWAYS AS IDENTITY UNIQUE,
      registered TEXT DEFAULT (to_char(CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD HH24:MI:SS')),
      uid TEXT NOT NULL,
      id TEXT,
      name TEXT,
      device TEXT,
      os TEXT,
      browser TEXT,
      active INTEGER NOT NULL DEFAULT 1,
      connected INTEGER NOT NULL DEFAULT 1,
    endpoint TEXT PRIMARY KEY,
    data TEXT NOT NULL,
    time TEXT NOT NULL
      DEFAULT (to_char((CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Seoul'), 'YYYY-MM-DD HH24:MI:SS'))
  );

  CREATE TABLE IF NOT EXISTS push.fcm (
    rowid BIGINT GENERATED ALWAYS AS IDENTITY UNIQUE,
    registered TEXT DEFAULT (to_char(CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD HH24:MI:SS')),
    uid TEXT NOT NULL,
    fid TEXT PRIMARY KEY,
    device TEXT NOT NULL
      CHECK (device IN ('android', 'ios', 'wearable')),
    time TEXT NOT NULL
      DEFAULT (to_char((CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Seoul'), 'YYYY-MM-DD HH24:MI:SS'))
  );

  CREATE UNIQUE INDEX IF NOT EXISTS webid ON push.web (id);

  CREATE INDEX IF NOT EXISTS webuid
    ON push.web (uid);

  CREATE INDEX IF NOT EXISTS fcmuid
    ON push.fcm (uid);

  CREATE SCHEMA IF NOT EXISTS storage;

  CREATE TABLE IF NOT EXISTS storage.upload (
    rowid BIGINT GENERATED ALWAYS AS IDENTITY UNIQUE,
    file TEXT NOT NULL,
    uid TEXT NOT NULL,
    time TEXT NOT NULL DEFAULT (to_char((CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Seoul'), 'YYYY-MM-DD HH24:MI:SS')),
    PRIMARY KEY(file, uid)
  );

  CREATE INDEX IF NOT EXISTS uploaduid ON storage.upload (uid);

  CREATE TABLE IF NOT EXISTS storage.tts (
    rowid BIGINT GENERATED ALWAYS AS IDENTITY UNIQUE,
    file TEXT NOT NULL,
    uid TEXT NOT NULL,
    text TEXT NOT NULL,
    time TEXT NOT NULL
  );

  ALTER TABLE storage.tts ADD COLUMN IF NOT EXISTS voice TEXT;

  CREATE TABLE IF NOT EXISTS storage.stt (
    rowid BIGINT GENERATED ALWAYS AS IDENTITY UNIQUE,
    file TEXT NOT NULL,
    uid TEXT NOT NULL,
    text TEXT NOT NULL,
    time TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS ttsfile
    ON storage.tts (file);

  CREATE INDEX IF NOT EXISTS ttsuid
    ON storage.tts (uid);

  CREATE INDEX IF NOT EXISTS sttfile
    ON storage.stt (file);

  ALTER TABLE storage.stt ADD COLUMN IF NOT EXISTS cues JSONB;

  CREATE INDEX IF NOT EXISTS sttuid
    ON storage.stt (uid);

  CREATE SCHEMA IF NOT EXISTS audit;

  CREATE TABLE IF NOT EXISTS audit.access (
    rowid BIGINT GENERATED ALWAYS AS IDENTITY UNIQUE,
    uid TEXT,
    ip TEXT NOT NULL,
    os TEXT NOT NULL,
    browser TEXT NOT NULL,
    path TEXT NOT NULL,
    result INTEGER NOT NULL,
    time TEXT NOT NULL
      DEFAULT (to_char((CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Seoul'), 'YYYY-MM-DD HH24:MI:SS'))
  );

  CREATE INDEX IF NOT EXISTS accessuid
    ON audit.access (uid, time);

  CREATE TABLE IF NOT EXISTS audit.notify (
    rowid BIGINT GENERATED ALWAYS AS IDENTITY UNIQUE,
    uid TEXT NOT NULL,
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    image TEXT NOT NULL,
    url TEXT NOT NULL,
    time TEXT NOT NULL
      DEFAULT (to_char((CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Seoul'), 'YYYY-MM-DD HH24:MI:SS'))
  );

  CREATE INDEX IF NOT EXISTS notifyuid
    ON audit.notify (uid);

  CREATE TABLE IF NOT EXISTS audit.tts (
    rowid BIGINT GENERATED ALWAYS AS IDENTITY UNIQUE,
    uid TEXT NOT NULL,
    text TEXT NOT NULL,
    voice TEXT NOT NULL,
    type TEXT NOT NULL,
    time TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS ttsuid
    ON audit.tts (uid);

  CREATE TABLE IF NOT EXISTS audit.stt (
    rowid BIGINT GENERATED ALWAYS AS IDENTITY UNIQUE,
    uid TEXT NOT NULL,
    lang TEXT NOT NULL,
    text TEXT NOT NULL,
    pitch TEXT NOT NULL,
    type TEXT NOT NULL,
    time TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS sttuid
    ON audit.stt (uid);

  CREATE TABLE IF NOT EXISTS audit.block (
    rowid BIGINT GENERATED ALWAYS AS IDENTITY UNIQUE,
    uid TEXT NOT NULL,
    ip TEXT,
    action TEXT NOT NULL CHECK (action IN ('block', 'unblock')),
    reason TEXT,
    actor TEXT NOT NULL,
    handler TEXT NOT NULL,
    time TEXT NOT NULL,
    snapshot TEXT
  );

  CREATE INDEX IF NOT EXISTS blockuid ON audit.block (uid, time);

  CREATE TABLE IF NOT EXISTS audit.sanction (
    rowid BIGINT GENERATED ALWAYS AS IDENTITY UNIQUE,
    uid TEXT NOT NULL,
    action TEXT NOT NULL CHECK (action IN ('mute', 'kick', 'unkick')),
    reason TEXT NOT NULL,
    actor TEXT NOT NULL,
    handler TEXT NOT NULL,
    time TEXT NOT NULL,
    until TEXT,
    snapshot TEXT
  );

  CREATE INDEX IF NOT EXISTS sanctionuid ON audit.sanction (uid, time);

  CREATE SCHEMA IF NOT EXISTS evidence;

  CREATE TABLE IF NOT EXISTS evidence.record (
    rowid BIGINT GENERATED ALWAYS AS IDENTITY UNIQUE,
    id TEXT PRIMARY KEY,
    subject TEXT NOT NULL,
    kind TEXT NOT NULL,
    reason TEXT NOT NULL,
    time TEXT NOT NULL,
    expires BIGINT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS recordsubject ON evidence.record(subject, expires);

  CREATE TABLE IF NOT EXISTS evidence.member (
    rowid BIGINT GENERATED ALWAYS AS IDENTITY UNIQUE,
    uid TEXT PRIMARY KEY,
    subject TEXT NOT NULL
  );

  CREATE SCHEMA IF NOT EXISTS runtime;

  CREATE TABLE IF NOT EXISTS runtime.limiter (
    scope TEXT NOT NULL,
    key TEXT NOT NULL,
    count INTEGER NOT NULL,
    expires TIMESTAMPTZ NOT NULL,
    PRIMARY KEY(scope, key)
  );

  CREATE INDEX IF NOT EXISTS limiterexpires ON runtime.limiter(expires);

  CREATE TABLE IF NOT EXISTS runtime.link (
    token TEXT PRIMARY KEY,
    uid TEXT NOT NULL,
    file BYTEA,
    type TEXT,
    expires TIMESTAMPTZ NOT NULL
  );

  CREATE INDEX IF NOT EXISTS linkexpires ON runtime.link(expires);

  CREATE TABLE IF NOT EXISTS runtime.attachment (
    token TEXT PRIMARY KEY,
    uid TEXT NOT NULL,
    item JSONB NOT NULL,
    expires BIGINT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS attachmentexpires ON runtime.attachment(expires);
  CREATE INDEX IF NOT EXISTS attachmentuid ON runtime.attachment(uid);

  CREATE TABLE IF NOT EXISTS runtime.request (
    uid TEXT NOT NULL,
    scope TEXT NOT NULL,
    token TEXT NOT NULL,
    result JSONB NOT NULL,
    expires BIGINT NOT NULL,
    PRIMARY KEY (uid, scope, token)
  );

  CREATE INDEX IF NOT EXISTS requestexpires ON runtime.request(expires);

  ${registry}
`;
