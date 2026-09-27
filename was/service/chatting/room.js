import { randomUUID } from "node:crypto";
import * as db from "#db";
import * as role from "#shared/role";
import * as rules from "#shared/room";
import * as events from "#service/events";
import * as cluster from "#service/cluster";

const fail = (status) => {
  throw Object.assign(new Error("Room request rejected"), { status });
};

export const allowed = (user, room) =>
  Boolean(room && (room.state !== "archived" || role.staff(user?.role)));

export const visible = (user, table = "chatting.message") => `EXISTS (
  SELECT 1 FROM chatting.room r
  WHERE r.id = ${table}.room
    AND ${role.staff(user?.role) ? "TRUE" : "r.state <> 'archived'"}
)`;

export async function read(user, id, write = false) {
  if (!rules.valid(id)) fail(404);
  const room = await db.get(
    `
    SELECT id, name, info, state, time FROM chatting.room WHERE id = ?
  `,
    [id]
  );

  if (!allowed(user, room)) fail(404);

  if (write && room.state !== "active") fail(403);
  return room;
}

export async function message(user, id, current) {
  const row = await db.get(
    `
    SELECT room FROM chatting.message WHERE id = ?
  `,
    [id]
  );

  if (!row || (current && row.room !== current)) fail(404);
  return read(user, row.room);
}

export async function list(user, manage = false) {
  if (manage && !role.staff(user.role)) fail(403);
  return db.all(`
    SELECT id, name, info, state, time FROM chatting.room
    WHERE ${manage ? "TRUE" : "state <> 'archived'"}
    ORDER BY time, id
  `);
}

async function notify(id, relay = true) {
  if (relay) await cluster.emit("public-room", { id });

  await events.publish("public-room", async (client) => (client.room === id ? { id } : null));
}

export async function save(user, id, data) {
  if (!role.staff(user.role)) fail(403);
  const { name, info = "", state = "active" } = data || {};

  if (
    typeof name !== "string" ||
    !name.trim() ||
    name.trim().length > 80 ||
    typeof info !== "string" ||
    info.length > 1000 ||
    !rules.states.includes(state)
  )
    fail(400);

  if (id) await read(user, id);
  const key = id || randomUUID();

  await db.transaction(async () => {
    if (id)
      await db.run(
        `
      UPDATE chatting.room SET name = ?, info = ?, state = ? WHERE id = ?
    `,
        [name.trim(), info.trim(), state, key]
      );
    else
      await db.run(
        `
      INSERT INTO chatting.room (id, name, info, state) VALUES (?, ?, ?, ?)
    `,
        [key, name.trim(), info.trim(), state]
      );
  });

  await notify(key);
  return read(user, key);
}

export async function remove(user, id) {
  const room = await read(user, id);

  return save(user, id, { ...room, state: "archived" });
}

cluster.on("public-room", ({ id }) => notify(id, false));
