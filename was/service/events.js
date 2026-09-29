import * as cluster from "#service/cluster";
import { publicId } from "../config/uid.js";
import { randomUUID } from "node:crypto";
import { all } from "../../db/index.js";
import * as media from "../config/media.js";

const clients = new Map();
const contexts = new WeakMap();
const tabs = new Map();
const idle = 10 * 60 * 1000;
const resume = 60_000;

const remotes = new Map();

const status = (session) => (Date.now() - session.active >= idle ? "away" : "online");

const write = (response, type, data = {}) => {
  if (response.writableEnded || response.destroyed) return;

  response.write(`event: ${type}\n`);
  response.write(`data: ${JSON.stringify(data)}\n\n`);
};

export const broadcast = (type, data, relay = true) => {
  if (relay) void cluster.emit("broadcast", { type, data });

  clients.forEach((item) => {
    item.responses.forEach((response) => write(response, type, data));
  });

  if (type === "profile-update") broadcast("online", undefined, false);
};

const local = () =>
  [...clients.values()].flatMap((item) =>
    [...item.responses]
      .filter((response) => !response.writableEnded && !response.destroyed)
      .map((response) => {
        const context = contexts.get(response);

        return {
          uid: context.uid,
          room: context.room || "",
          session: context.session,
          key: context.key,
          active: context.active,
          seen: context.seen,
          visible: context.visible,
          ip: context.ip,
          os: context.os,
          browser: context.browser,
          tab: { id: context.tab.id, order: context.tab.order }
        };
      })
  );

const records = () => [
  ...local(),
  ...[...remotes.values()]
    .filter((item) => Date.now() - item.time < 45000)
    .flatMap((item) => item.records)
];

const share = () => cluster.emit("presence", { node: cluster.id, records: local() });

export const connections = (uid) => records().filter((item) => item.uid === uid).length;
export const sessions = (uid) =>
  records()
    .filter((item) => item.uid === uid)
    .map((item) => ({
      session: item.tab.id,
      accessIp: item.ip,
      os: item.os || "",
      browser: item.browser || ""
    }));

const update = (uid, item) => {
  const value = state(uid);
  const count = connections(uid);

  void share();

  if (item.state === value && item.count === count) {
    return;
  }

  item.state = value;
  item.count = count;
  broadcast("presence", { id: publicId(uid), state: value, connections: count });
};

export function state(uid) {
  const items = records().filter((item) => item.uid === uid);

  return items.length
    ? items.some((item) => status(item) === "online")
      ? "online"
      : "away"
    : "offline";
}
export const viewing = (uid) =>
  records().some((item) => item.uid === uid && item.visible && Date.now() - item.seen < 90000);

export const touch = (uid, session, visible, active = true, relay = true) => {
  const item = clients.get(uid);

  if (!item) {
    if (relay && records().some((item) => item.uid === uid && item.session === session)) {
      void cluster.emit("touch", { uid, session, visible, active });
      return true;
    }
    return false;
  }

  for (const response of item.responses) {
    const context = contexts.get(response);

    if (context.session !== session) continue;

    context.seen = Date.now();

    if (typeof visible === "boolean") {
      context.visible = visible;
    }

    if (visible === false || active === false) {
      void share();
      return true;
    }

    context.active = Date.now();
    void share();
    if (context.state !== "online") {
      context.state = "online";
      update(uid, item);
      broadcast("online");
    }

    return true;
  }

  if (relay && records().some((entry) => entry.uid === uid && entry.session === session)) {
    void cluster.emit("touch", { uid, session, visible, active });
    return true;
  }
  return false;
};

export const list = async (room) => {
  const connected = records().filter((item) => room === undefined || item.room === room);
  const ids = [...new Set(connected.map((item) => item.uid))];
  const users = new Map();

  for (let start = 0; start < ids.length; start += 256) {
    const keys = ids.slice(start, start + 256);
    const rows = await all(
      `
        SELECT uid, id, name, avatar, role, verified
        FROM account.profile
        WHERE uid IN (${keys.map(() => "?").join(",")})
          AND NOT EXISTS (SELECT 1
          FROM moderation.block
          WHERE moderation.block.uid = account.profile.uid
            OR moderation.block.ip = account.profile.ip)
          AND NOT EXISTS (SELECT 1
          FROM moderation.sanction
          WHERE uid = account.profile.uid
            AND kicked > to_char((CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Seoul'),
            'YYYY-MM-DD HH24:MI:SS'))
      `,
      keys
    );

    for (const user of rows) users.set(user.uid, user);
  }

  const items = [];

  for (const context of connected) {
    const user = users.get(context.uid);

    if (!user) continue;

    items.push({
      session: context.tab.id,
      order: context.tab.order,
      id: user.id || publicId(context.uid),
      name: user.verified ? user.name || "" : "",
      verified: Boolean(user.verified),
      avatar: media.resolve(user.avatar),
      group: user.role < 0 ? "admin" : "user",
      state: status(context)
    });
  }

  return { items };
};

export const send = (uid, type, data, relay = true) => {
  if (relay) void cluster.emit("send", { uid, type, data });

  clients.get(uid)?.responses.forEach((response) => write(response, type, data));
};

export const disconnect = (uid, session, relay = true) => {
  if (relay) void cluster.emit("disconnect", { uid, session });
  const item = clients.get(uid);

  if (!item) return;

  if (session !== undefined) {
    for (const response of item.responses) {
      const context = contexts.get(response);

      if (context?.session !== session) continue;

      context.close();
      response.destroy();

      return;
    }

    return;
  }

  const responses = [...item.responses];

  item.responses.clear();
  clients.delete(uid);

  for (const [key, tab] of tabs) {
    if (tab.uid === uid) tabs.delete(key);
  }

  for (const response of responses) {
    contexts.delete(response);

    if (!response.writableEnded && !response.destroyed) response.end();
  }

  update(uid, item);
  broadcast("online");
};

export const publish = async (type, resolve) => {
  const deliveries = [];

  clients.forEach((item) =>
    item.responses.forEach((response) => {
      deliveries.push(
        (async () => {
          const data = await resolve(contexts.get(response));

          if (data && item.responses.has(response)) write(response, type, data);
        })()
      );
    })
  );

  await Promise.allSettled(deliveries);
};

export const connect = (user, response) => {
  const key = `${user.uid}:${user.tab || randomUUID()}`;

  let tab = tabs.get(key);

  if (!tab || (!tab.response && tab.expires <= Date.now())) {
    tab = { uid: user.uid, id: user.tab || randomUUID(), order: Date.now() };
    tabs.set(key, tab);
  }

  const context = {
    ...user,
    key,
    tab,
    session: randomUUID(),
    active: Date.now(),
    seen: Date.now(),
    state: "online"
  };

  contexts.set(response, context);
  void cluster.emit("replace", { key, session: context.session });

  const item = clients.get(user.uid) ?? { responses: new Set(), state: "offline" };

  const previous = tab.response;

  if (previous) {
    item.responses.delete(previous);
    contexts.delete(previous);
    if (!previous.writableEnded && !previous.destroyed) previous.end();
  }

  tab.response = response;
  tab.expires = 0;
  item.responses.add(response);
  clients.set(user.uid, item);

  let closed = false;

  const close = () => {
    if (closed) {
      return;
    }

    closed = true;
    contexts.delete(response);
    if (!item.responses.delete(response)) return;

    if (tab.response === response) {
      tab.response = null;
      tab.expires = Date.now() + resume;
    }

    update(user.uid, item);
    if (!item.responses.size) clients.delete(user.uid);

    broadcast("online");
  };

  context.close = close;

  response.once?.("close", close);
  response.once?.("error", close);
  write(response, "ready", { session: context.session, admin: user.role < 0 });
  update(user.uid, item);
  broadcast("online");

  return close;
};

const timer = setInterval(() => {
  let changed = false;

  for (const [key, tab] of tabs) {
    if (!tab.response && tab.expires <= Date.now()) tabs.delete(key);
  }

  clients.forEach((item, uid) => {
    for (const response of item.responses) {
      const context = contexts.get(response);

      if (!context) continue;

      if (response.writableEnded || response.destroyed || Date.now() - context.seen >= 90_000) {
        context.close();

        if (!response.destroyed) response.destroy();

        continue;
      }

      const next = status(context);

      if (context.state === next) continue;

      context.state = next;
      changed = true;
    }

    update(uid, item);
  });

  if (changed) broadcast("online");
}, 30_000);

timer.unref?.();

export const shutdown = () => {
  for (const uid of [...clients.keys()]) disconnect(uid, undefined, false);
};

cluster.on("broadcast", ({ type, data }) => broadcast(type, data, false));
cluster.on("send", ({ uid, type, data }) => send(uid, type, data, false));
cluster.on("disconnect", ({ uid, session }) => disconnect(uid, session, false));
cluster.on("touch", ({ uid, session, visible, active }) =>
  touch(uid, session, visible, active, false)
);

cluster.on("replace", ({ key, session }) => {
  for (const item of clients.values())
    for (const response of [...item.responses]) {
      const context = contexts.get(response);

      if (context?.key === key && context.session !== session) {
        context.close();
        response.end();
      }
    }
});

cluster.on("presence", ({ node, records: connected }) => {
  const users = new Set(
    [...(remotes.get(node)?.records || []), ...connected].map((item) => item.uid)
  );

  remotes.set(node, { records: connected, time: Date.now() });
  for (const uid of users)
    broadcast(
      "presence",
      { id: publicId(uid), state: state(uid), connections: connections(uid) },
      false
    );
  broadcast("online", undefined, false);
});

cluster.on("hello", share);
cluster.on("ready", () => {
  void share();
  void cluster.emit("hello", {});
});

cluster.on("reset", () => {
  remotes.clear();
  for (const uid of [...clients.keys()]) disconnect(uid, undefined, false);
});

setInterval(() => {
  for (const [node, item] of remotes)
    if (Date.now() - item.time >= 45000) {
      remotes.delete(node);
      for (const uid of new Set(item.records.map((entry) => entry.uid)))
        broadcast(
          "presence",
          { id: publicId(uid), state: state(uid), connections: connections(uid) },
          false
        );
      broadcast("online", undefined, false);
    }
  void share();
}, 15000).unref();
