import { signature } from "#config/hash";
import * as fs from "node:fs/promises";
import { BlockList, isIPv4 } from "node:net";
import { Pool } from "pg";
import * as schema from "#db/schema";
import * as replica from "#db/replica";

export async function start(config, execute, entries) {
  if (!config.cluster || !process.env.DATABASE_URL)
    throw new Error("Cluster configuration and DATABASE_URL are required");

  const address = config.cluster.address;
  const stamp = signature();
  const network = new BlockList();
  const [subnet, prefix] = config.cluster.network.split("/");

  network.addSubnet(subnet, Number(prefix), "ipv4");

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 2,
    connectionTimeoutMillis: 5000,
    statement_timeout: 5000,
    options: "-c synchronous_commit=local"
  });

  pool.on("error", () => console.error("Discovery database disconnected"));

  const client = await pool.connect();

  try {
    await client.query(`
      BEGIN
    `);

    await client.query(`
      SELECT pg_advisory_xact_lock(734100)
    `);

    await schema.prepare(
      {
        get: async (sql, values) => (await client.query(sql, values)).rows[0],
        exec: (sql) => client.query(sql)
      },
      schema.registry
    );

    await client.query(`
      COMMIT
    `);
  } catch (error) {
    await client.query(`
      ROLLBACK
    `);

    throw error;
  } finally {
    client.release();
  }

  let stopped = false;
  let timer;
  let pending;

  const applied = new Map();
  const replication = replica.watch(config, execute);

  const active = async (unit) =>
    (await execute("systemctl", ["show", unit, "--property=ActiveState", "--value"], true)) ===
    "active";

  const healthy = async (item) => {
    if (item.service === "db") return true;

    try {
      const response = await fetch(`http://${item.address}:${item.port}/_health`, {
        signal: AbortSignal.timeout(2000),
        redirect: "error"
      });

      await response.body?.cancel();
      return (
        response.status === 204 &&
        (item.service === "web" || response.headers.get("x-oanismajor-server") === stamp)
      );
    } catch {
      return false;
    }
  };

  const install = async (name, nodes) => {
    const targets = entries.filter(
      (item) => item.role === "web" && (name === "web" ? item.secure : !item.secure)
    );

    if (!targets.length) return;

    const file = `/etc/oanismajor/${name}.conf`;
    const previous = await fs.readFile(file, "utf8");
    const value = nodes.length
      ? nodes
          .map((item) => `server ${item.address}:${item.port} max_fails=1 fail_timeout=5s;`)
          .sort()
          .join("\n") + "\n"
      : "server 127.0.0.1:1 down;\n";

    if (previous === value && applied.get(name) === value) return;

    await fs.writeFile(`${file}.next`, value);
    await fs.rename(`${file}.next`, file);
    try {
      for (const item of targets)
        await execute(
          "/usr/sbin/nginx",
          ["-t", "-c", `/etc/oanismajor/web-${item.name}.conf`],
          true
        );
    } catch (error) {
      await fs.writeFile(`${file}.next`, previous);
      await fs.rename(`${file}.next`, file);
      throw error;
    }
    for (const item of targets)
      if (await active(item.unit)) await execute("systemctl", ["reload", item.unit], true);

    applied.set(name, value);

    console.log(
      `${name}: ${nodes.map((item) => `${item.address}:${item.port}`).join(", ") || "none"}`
    );
  };

  const update = async () => {
    await Promise.all(
      entries
        .filter((item) => !item.secure)
        .map(async (item) => {
          const node = { address, service: item.role, port: item.port };

          let ready = await active(item.unit);

          if (ready && item.role === "db")
            try {
              await execute(
                "/usr/bin/pg_isready",
                ["-h", "127.0.0.1", "-p", String(item.port)],
                true
              );
            } catch {
              ready = false;
            }

          if (ready) ready = await healthy(node);

          const pid = ready
            ? Number(
                await execute(
                  "systemctl",
                  ["show", item.unit, "--property=MainPID", "--value"],
                  true
                )
              )
            : 0;

          ready = ready && Number.isInteger(pid) && pid > 0;

          if (ready)
            await pool.query(
              `
            INSERT INTO runtime.server (address, service, port, signature, expires, pid)
            VALUES ($1, $2, $3, $4, now() + interval '30 seconds', $5)
            ON CONFLICT (address, service, port) DO UPDATE
            SET signature = EXCLUDED.signature, expires = EXCLUDED.expires, pid = EXCLUDED.pid
          `,
              [address, item.role, item.port, stamp, pid]
            );
          else
            await pool.query(
              `
            DELETE FROM runtime.server
            WHERE address = $1 AND service = $2 AND port = $3
          `,
              [address, item.role, item.port]
            );
        })
    );

    await pool.query(`
      DELETE FROM runtime.server
      WHERE expires <= now()
    `);

    const { rows } = await pool.query(
      `
        SELECT host(address) AS address, service, port
        FROM runtime.server
        WHERE expires > now() AND signature = $1
      `,
      [stamp]
    );
    const nodes = [];

    for (let offset = 0; offset < rows.length; offset += 8) {
      await Promise.all(
        rows.slice(offset, offset + 8).map(async (item) => {
          if (
            isIPv4(item.address) &&
            network.check(item.address, "ipv4") &&
            ["was", "web"].includes(item.service) &&
            Number.isInteger(item.port) &&
            item.port >= 1024 &&
            item.port <= 65535 &&
            (await healthy(item))
          )
            nodes.push(item);
        })
      );
    }

    for (const name of ["was", "web"])
      await install(
        name,
        nodes.filter((item) => item.service === name)
      );
  };

  const tick = () => {
    pending = update()
      .catch((error) => console.error(`Discovery update failed: ${error.code || error.message}`))
      .finally(() => {
        if (!stopped) timer = setTimeout(tick, 5000);
      });
  };

  const stop = async () => {
    if (stopped) return;

    stopped = true;
    clearTimeout(timer);
    await replication();
    await pending;
    try {
      await pool.query(
        `
          DELETE FROM runtime.server
          WHERE address = $1 AND signature = $2
        `,
        [address, stamp]
      );
    } finally {
      await pool.end();
    }
  };

  process.on("SIGTERM", () => stop().catch(() => process.exit(1)));
  process.on("SIGINT", () => stop().catch(() => process.exit(1)));
  tick();
}
