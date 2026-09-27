import "#config/env";
import { Pool, types } from "pg";
import { BlockList, isIPv4 } from "node:net";
import * as fs from "node:fs/promises";
import { signature } from "#config/hash";

types.setTypeParser(20, (value) => {
  const number = Number(value);

  if (!Number.isSafeInteger(number)) throw new RangeError("Database integer exceeds safe range");
  return number;
});

const pools = new Map();

export const unavailable = (error) =>
  [
    "ECONNREFUSED",
    "ECONNRESET",
    "ETIMEDOUT",
    "EHOSTUNREACH",
    "ENETUNREACH",
    "EAI_AGAIN",
    "57P01",
    "57P02",
    "57P03",
    "53300"
  ].includes(error?.code) ||
  [
    "Connection terminated",
    "Connection terminated unexpectedly",
    "Connection terminated due to connection timeout",
    "timeout exceeded when trying to connect"
  ].includes(error?.message);

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");

const pool = (schema) => {
  if (!["public", "audit", "evidence", "runtime"].includes(schema))
    throw new Error("Invalid database schema");

  if (!pools.has(schema)) {
    const connection = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 10,
      connectionTimeoutMillis: 5000,
      options: `-c search_path=${schema},public -c timezone=Asia/Seoul -c lock_timeout=5000 -c statement_timeout=30000${schema === "runtime" ? " -c synchronous_commit=local" : ""}`
    });

    connection.on("error", () => console.error("Database connection interrupted"));

    pools.set(schema, connection);
  }
  return pools.get(schema);
};

const statement = (query) => {
  let index = 0;

  return query.replace(/'(?:''|[^'])*'|"(?:""|[^"])*"|\?/g, (token) =>
    token === "?" ? `$${++index}` : token
  );
};

const wrap = (connection) => {
  const query = (sql, params = []) => connection.query(statement(sql), params);

  return {
    exec: (sql) => connection.query(sql),
    get: async (sql, params) => (await query(sql, params)).rows[0],
    all: async (sql, params) => (await query(sql, params)).rows,
    run: async (sql, params) => {
      const result = await query(sql, params);

      return { id: result.rows[0]?.seq, changes: result.rowCount };
    },
    release: () => connection.release()
  };
};

export const lease = async () => wrap(await pool("public").connect());
export const exclusive = async (key, work, wait = true) => {
  const client = await lease();

  let locked = false;

  try {
    const result = await client.get(
      `
        SELECT ${wait ? "pg_advisory_lock" : "pg_try_advisory_lock"}(hashtextextended(?, 0)) AS locked
      `,
      [key]
    );

    locked = wait || result.locked;
    if (locked) return await work();
  } finally {
    try {
      if (locked)
        await client.get(
          `
            SELECT pg_advisory_unlock(hashtextextended(?, 0))
          `,
          [key]
        );
    } finally {
      client.release();
    }
  }
};
const config = JSON.parse(await fs.readFile(new URL("../servers.json", import.meta.url), "utf8"));

try {
  Object.assign(
    config,
    JSON.parse(await fs.readFile(new URL("../local.json", import.meta.url), "utf8"))
  );
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}
const network = new BlockList();

if (config.cluster) {
  const [address, prefix] = config.cluster.network.split("/");

  network.addSubnet(address, Number(prefix), "ipv4");
}

const replicas = new Map();

let expires = 0;
let pending;
let cursor = 0;
let stopped = false;

const discover = async () => {
  if (stopped || !config.cluster) return;

  if (pending) return pending;

  if (Date.now() < expires) return;

  pending ||= (async () => {
    expires = Date.now() + 5000;
    try {
      const { rows } = await pool("public").query(
        `
        SELECT host(address) AS address, port
        FROM runtime.server
        WHERE service = 'db' AND expires > now() AND signature = $1
      `,
        [signature()]
      );
      const keys = new Set();

      for (const row of rows) {
        if (
          !isIPv4(row.address) ||
          !network.check(row.address, "ipv4") ||
          !Number.isInteger(row.port) ||
          row.port < 1024 ||
          row.port > 65535
        )
          continue;
        const primary = new URL(process.env.DATABASE_URL);
        const address = ["localhost", "127.0.0.1", "[::1]"].includes(primary.hostname)
          ? config.cluster.address
          : primary.hostname;

        if (row.address === address && row.port === Number(primary.port || 5432)) continue;
        const key = `${row.address}:${row.port}`;

        keys.add(key);
        if (replicas.has(key) || stopped) continue;
        const url = new URL(process.env.DATABASE_URL);

        url.hostname = row.address;
        url.port = String(row.port);
        if (!url.searchParams.has("sslmode")) url.searchParams.set("sslmode", "require");
        const connection = new Pool({
          connectionString: url.href,
          max: 4,
          connectionTimeoutMillis: 1000,
          statement_timeout: 30000,
          options:
            "-c search_path=public -c timezone=Asia/Seoul -c default_transaction_read_only=on"
        });
        const node = { connection, until: 0 };

        connection.on("error", () => {
          node.until = Date.now() + 15000;
        });

        replicas.set(key, node);
      }
      for (const [key, node] of replicas) {
        if (keys.has(key)) continue;

        replicas.delete(key);
        void node.connection.end().catch(() => {});
      }
    } catch {
      for (const node of replicas.values()) node.until = Date.now() + 5000;
    }
  })().finally(() => {
    pending = undefined;
  });

  await pending;
};

const snapshot = async (client, work) => {
  try {
    await client.query(`
      BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY
    `);

    const result = await work(wrap(client));

    await client.query(`
      COMMIT
    `);

    return result;
  } catch (error) {
    await client
      .query(
        `
      ROLLBACK
    `
      )
      .catch(() => {});

    throw error;
  } finally {
    client.release();
  }
};

export const read = async (work) => {
  await discover();

  const nodes = [...replicas.values()].filter(
    (node) =>
      node.until <= Date.now() &&
      !node.connection.waitingCount &&
      (node.connection.idleCount || node.connection.totalCount < 4)
  );
  const offset = nodes.length ? cursor++ % nodes.length : 0;

  for (let index = 0; index < nodes.length; index++) {
    const node = nodes[(offset + index) % nodes.length];

    let client;
    let querying = false;

    try {
      const {
        rows: [source]
      } = await pool("public").query(`
        SELECT pg_current_wal_lsn()::text AS position,
          system_identifier::text AS identity
        FROM pg_control_system()
      `);

      client = await node.connection.connect();

      const {
        rows: [state]
      } = await client.query({
        text: `
          SELECT pg_is_in_recovery() AS standby,
            pg_last_wal_replay_lsn() >= $1::pg_lsn AS ready,
            system_identifier::text = $2 AS matches
          FROM pg_control_system()
        `,
        values: [source.position, source.identity],
        query_timeout: 1000
      });

      if (state.standby && state.ready && state.matches) {
        const selected = client;

        client = undefined;
        querying = true;
        return await snapshot(selected, work);
      }

      node.until = Date.now() + (state.standby ? 1000 : 30000);
    } catch (error) {
      node.until = Date.now() + 15000;
      if (
        querying &&
        (error.status || !/^(08|40|53|57|58|ECONN|ETIMEDOUT|EPIPE)/.test(error.code || ""))
      )
        throw error;
    } finally {
      client?.release();
    }
  }
  return snapshot(await pool("public").connect(), work);
};

export const close = async () => {
  stopped = true;
  await pending;
  await Promise.all(
    [...pools.values(), ...[...replicas.values()].map((node) => node.connection)].map(
      (connection) => connection.end()
    )
  );
};
export default (schema = "public") => wrap(pool(schema));
