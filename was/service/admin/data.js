import * as database from "#db/connect";

const schemas = {
  account: {
    profile: ["id", "name", "role", "date", "deletion", "erased"],
    file: ["file"],
    authority: ["memo", "time"],
    block: ["time"]
  },
  chatting: {
    room: ["id", "name", "info", "state", "time"],
    message: ["id", "room", "text", "image", "audio", "deleted", "time"],
    asset: ["kind", "url", "preview", "name", "size"]
  },
  messenger: {
    room: ["id", "name", "multiple", "closed"],
    member: ["room", "left", "reason", "pinned", "muted", "deputy"],
    message: ["id", "room", "text", "read", "deleted", "time"],
    receipt: ["message", "read"],
    asset: ["kind", "url", "preview", "name", "size"],
    conversation: ["pinned", "muted", "hidden"],
    contact: ["room", "assigned", "closed"]
  },
  moderation: {
    report: ["id", "type", "message", "text", "reason", "detail", "time"],
    block: ["reason", "time"],
    sanction: ["count", "muted", "notice", "kicked", "reason", "time"]
  },
  push: {
    web: ["id", "name", "device", "os", "browser", "active", "connected", "time"],
    fcm: ["device", "time"]
  },
  storage: {
    upload: ["file", "time"],
    tts: ["file", "text", "time"],
    stt: ["file", "text", "time"]
  },
  audit: {
    access: ["uid", "ip", "os", "browser", "path", "result", "time"],
    block: ["uid", "action", "reason", "actor", "handler", "time"],
    sanction: ["uid", "action", "reason", "actor", "handler", "time", "until"],
    notify: ["uid", "title", "body", "image", "url", "time"],
    tts: ["uid", "text", "voice", "type", "time"],
    stt: ["uid", "lang", "text", "pitch", "type", "time"]
  },
  evidence: {
    record: ["id", "subject", "kind", "reason", "time", "expires"],
    member: ["uid", "subject"]
  },
  runtime: {
    limiter: ["scope", "count", "expires"],
    link: ["type", "expires"],
    server: ["address", "service", "port", "expires"]
  }
};

const invalid = () => {
  throw Object.assign(new Error("Invalid database source"), { status: 400 });
};

export function catalogue({ source } = {}) {
  if (!source) return Object.keys(schemas).map((source) => ({ name: source, scope: { source } }));

  if (!Object.hasOwn(schemas, source)) invalid();
  return Object.keys(schemas[source]).map((table) => ({ table }));
}

export function read(table, { source }, run) {
  if (!Object.hasOwn(schemas, source) || !Object.hasOwn(schemas[source], table)) invalid();
  const order =
    source === "chatting" && table === "room"
      ? "time"
      : source === "runtime"
        ? "expires"
        : (source === "chatting" || source === "messenger") && table === "message"
          ? "seq"
          : source === "moderation" && table === "report"
            ? "seq"
            : "rowid";

  return database.read((connection) =>
    run(connection, `"${source}"."${table}"`, schemas[source][table], order)
  );
}
