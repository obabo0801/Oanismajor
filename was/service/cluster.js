import { Client } from "pg";
import { randomUUID } from "node:crypto";

export const id = randomUUID();
const handlers = new Map();
const parts = new Map();

let client;
let ready;
let stopped = false;
let queue = Promise.resolve();

export const on = (name, handler) => {
  if (!handlers.has(name)) handlers.set(name, new Set());

  handlers.get(name).add(handler);
};

const dispatch = (name, data) => {
  for (const handler of handlers.get(name) || [])
    Promise.resolve()
      .then(() => handler(data))
      .catch(() => console.error(`Cluster handler failed: ${name}`));
};

const receive = ({ payload }) => {
  try {
    const frame = JSON.parse(payload);

    if (frame.origin === id) return;
    let item = parts.get(frame.id);

    if (!item) {
      if (
        parts.size >= 256 ||
        !Number.isInteger(frame.total) ||
        frame.total < 1 ||
        frame.total > 2048
      )
        return;

      item = { origin: frame.origin, total: frame.total, chunks: new Map(), time: Date.now() };

      parts.set(frame.id, item);
    }

    if (
      item.origin !== frame.origin ||
      item.total !== frame.total ||
      frame.index < 0 ||
      frame.index >= item.total
    )
      return;

    item.chunks.set(frame.index, frame.data);
    if (item.chunks.size !== item.total) return;

    parts.delete(frame.id);

    const buffers = Array.from({ length: item.total }, (_, index) =>
      Buffer.from(item.chunks.get(index), "base64")
    );
    const message = JSON.parse(Buffer.concat(buffers).toString());

    dispatch(message.name, message.data);
  } catch {
    console.error("Invalid cluster event");
  }
};

export const start = () =>
  (ready ||= (async () => {
    const connection = new Client({
      connectionString: process.env.DATABASE_URL,
      application_name: `was:${process.env.PORT || 3000}`,
      connectionTimeoutMillis: 5000
    });

    connection.on("notification", receive);

    let failed = false;

    const reconnect = () => {
      if (failed || stopped) return;

      failed = true;
      client = undefined;
      ready = undefined;
      dispatch("reset");
      connection.end().catch(() => {});
      setTimeout(() => start().catch(() => {}), 1000).unref();
    };

    connection.on("error", reconnect);
    connection.on("end", reconnect);
    try {
      await connection.connect();
      await connection.query("LISTEN oanismajor_cluster");
      client = connection;
      dispatch("ready");
    } catch (error) {
      reconnect();
      throw error;
    }
  })());

export const emit = (name, data) => {
  const message = Buffer.from(JSON.stringify({ name, data }));
  const token = randomUUID();
  const total = Math.ceil(message.length / 4500);

  queue = queue
    .then(async () => {
      await start();
      if (!client) throw new Error("Cluster unavailable");
      for (let index = 0; index < total; index++) {
        const frame = {
          origin: id,
          id: token,
          index,
          total,
          data: message.subarray(index * 4500, (index + 1) * 4500).toString("base64")
        };

        await client.query(
          `
            SELECT pg_notify('oanismajor_cluster', $1)
          `,
          [JSON.stringify(frame)]
        );
      }
    })
    .catch(() => console.error("Cluster delivery failed"));

  return queue;
};

export const close = async () => {
  stopped = true;
  await queue;
  await client?.end();
};

setInterval(() => {
  for (const [key, item] of parts) if (Date.now() - item.time > 30000) parts.delete(key);
}, 10000).unref();
