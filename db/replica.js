import * as fs from "node:fs/promises";
import { randomUUID } from "node:crypto";

export async function configure(config, item, execute) {
  const standby = config.cluster.sync ?? [];

  if (
    !Array.isArray(standby) ||
    standby.some((name) => typeof name !== "string" || !/^[a-z][a-z0-9-]*$/.test(name))
  )
    throw new Error("Invalid synchronous replica name");

  const root = `/etc/postgresql/${item.version}/${item.name}`;
  const data = `/var/lib/postgresql/${item.version}/${item.name}`;
  const current = await execute(
    "/usr/sbin/runuser",
    [
      "-u",
      "postgres",
      "--",
      `/usr/lib/postgresql/${item.version}/bin/postgres`,
      "-D",
      data,
      "-c",
      `config_file=${root}/postgresql.conf`,
      "-C",
      "listen_addresses"
    ],
    true
  );

  const addresses = [
    ...new Set([...current.split(",").map((value) => value.trim()), config.cluster.address])
  ];

  const dir = `${root}/conf.d`;
  const conf = `${dir}/zz-cluster.conf`;

  await fs.mkdir(dir, { recursive: true });
  await fs.chmod(dir, 0o755);
  await fs.writeFile(
    conf,
    [
      `listen_addresses = '${addresses.join(",")}'`,
      "max_slot_wal_keep_size = '1GB'",
      "synchronous_standby_names = ''",
      "synchronous_commit = on",
      ""
    ].join("\n")
  );

  await fs.chmod(conf, 0o644);

  const file = `${root}/pg_hba.conf`;

  let content = await fs.readFile(file, "utf8");

  const rules = [`hostssl oanismajor root ${config.cluster.network} scram-sha-256`];

  if (item.role === "primary" && process.env.REPLICATION_URL) {
    const url = new URL(process.env.REPLICATION_URL);
    const user = decodeURIComponent(url.username);
    const password = decodeURIComponent(url.password);

    if (!/^[a-z][a-z0-9_]*$/.test(user) || !password)
      throw new Error("REPLICATION_URL requires a user and password");

    rules.push(`hostssl replication ${user} ${config.cluster.network} scram-sha-256`);

    await execute(
      "/usr/sbin/runuser",
      [
        "-u",
        "postgres",
        "--",
        "psql",
        "-p",
        String(item.port),
        "-d",
        "postgres",
        "-X",
        "-q",
        "-v",
        "ON_ERROR_STOP=1"
      ],
      true,
      {
        input: `
        DO $$ BEGIN
          IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${user}') THEN
            CREATE ROLE "${user}";
          END IF;
        END $$;
        ALTER ROLE "${user}" WITH LOGIN REPLICATION PASSWORD '${password.replaceAll("'", "''")}';
      `
      }
    );
  }
  for (const rule of rules) if (!content.split(/\r?\n/).includes(rule)) content += `\n${rule}\n`;

  await fs.writeFile(file, content);
}

export async function setup(item, execute) {
  const directory = `/var/lib/postgresql/${item.version}/${item.name}`;
  const configuration = `/etc/postgresql/${item.version}/${item.name}/postgresql.conf`;

  try {
    await fs.access(configuration);
    await fs.access(`${directory}/standby.signal`);
    return;
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  try {
    await fs.access(configuration);
    throw new Error("Existing primary database cannot be replaced with a replica");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  if (!process.env.REPLICATION_URL)
    throw new Error("REPLICATION_URL is required for a new replica");

  const url = new URL(process.env.REPLICATION_URL);

  if (!/^[a-z0-9.-]+$/i.test(url.hostname) || !/^\d+$/.test(url.port || "5432"))
    throw new Error("Invalid replication address");

  const user = decodeURIComponent(url.username);

  if (!/^[a-z][a-z0-9_]*$/.test(user)) throw new Error("Invalid replication user");

  const password = decodeURIComponent(url.password);

  if (/[\r\n]/.test(password)) throw new Error("Invalid replication password");

  const owner = Number(await execute("id", ["-u", "postgres"], true));
  const group = Number(await execute("id", ["-g", "postgres"], true));
  const passfile = `/var/lib/postgresql/.oanismajor-${item.name}.pass`;
  const escaped = password.replaceAll("\\", "\\\\").replaceAll(":", "\\:");

  await fs.writeFile(
    passfile,
    `${url.hostname}:${url.port || "5432"}:replication:${user}:${escaped}\n`,
    { mode: 0o600 }
  );

  await fs.chmod(passfile, 0o600);
  await fs.chown(passfile, owner, group);

  const staging = `${directory}.joining`;

  await fs.mkdir(staging, { mode: 0o700 });
  await fs.chown(staging, owner, group);

  const connection = `host=${url.hostname} port=${url.port || "5432"} user=${user} passfile=${passfile} sslmode=require connect_timeout=5 application_name=${item.name}`;

  await execute("/usr/sbin/runuser", [
    "-u",
    "postgres",
    "--",
    `/usr/lib/postgresql/${item.version}/bin/pg_basebackup`,
    "--dbname",
    connection,
    "--pgdata",
    staging,
    "--wal-method=stream",
    "--no-password",
    "--no-clean",
    "--write-recovery-conf",
    "--create-slot",
    "--slot",
    `oanismajor${randomUUID().replaceAll("-", "")}`
  ]);

  await execute("/usr/bin/pg_createcluster", [
    String(item.version),
    item.name,
    "--port",
    String(item.port),
    "--start-conf=manual"
  ]);

  await fs.rename(directory, `${directory}.initial-${Date.now()}`);
  await fs.rename(staging, directory);

  const auto = await fs.readFile(`${directory}/postgresql.auto.conf`, "utf8");

  if (!auto.includes("primary_conninfo"))
    throw new Error("Replication connection was not recorded");
}

export function watch(config, execute) {
  const targets = config.db.filter((item) => item.role === "primary");
  const applied = new Map();

  let stopped = false;
  let timer;
  let pending;
  let identity;

  const query = async (item, sql) => {
    identity ??= Promise.all([
      execute("id", ["-u", "postgres"], true),
      execute("id", ["-g", "postgres"], true)
    ]).catch((error) => {
      identity = undefined;
      throw error;
    });

    const [uid, gid] = (await identity).map(Number);

    if (![uid, gid].every((value) => Number.isInteger(value) && value > 0))
      throw new Error("Invalid postgres identity");

    return execute(
      "/usr/bin/psql",
      ["-X", "-q", "-A", "-t", "-p", String(item.port), "-d", "postgres", "-v", "ON_ERROR_STOP=1"],
      true,
      {
        uid,
        gid,
        cwd: "/",
        timeout: 5000,
        env: { PATH: "/usr/bin:/bin", LANG: "C.UTF-8", PGCONNECT_TIMEOUT: "3" },
        input: `SET statement_timeout = '3s';\n${sql}`
      }
    );
  };

  const update = async (item) => {
    const output = await query(
      item,
      `
      SELECT json_build_object(
        'recovery', pg_is_in_recovery(),
        'current', current_setting('synchronous_standby_names'),
        'nodes', COALESCE((
          SELECT json_agg(application_name ORDER BY application_name)
          FROM pg_stat_replication
          WHERE state = 'streaming'
            AND reply_time > clock_timestamp() - interval '20 seconds'
            AND (flush_lsn >= pg_current_wal_flush_lsn() OR sync_state IN ('sync', 'quorum'))
        ), '[]'::json)
      );
    `
    );
    const state = JSON.parse(output);

    if (state.recovery) return;

    const names = [...new Set(state.nodes)].filter(
      (name) =>
        /^[a-z][a-z0-9-]*$/.test(name) &&
        (!config.cluster.sync?.length || config.cluster.sync.includes(name))
    );
    const value = names.length ? `FIRST 1 (${names.map((name) => `"${name}"`).join(", ")})` : "";
    const file = `/etc/postgresql/${item.version}/${item.name}/conf.d/zz-cluster.conf`;
    const previous = await fs.readFile(file, "utf8");
    const setting = `synchronous_standby_names = '${value}'`;
    const content = /^synchronous_standby_names\s*=.*$/m.test(previous)
      ? previous.replace(/^synchronous_standby_names\s*=.*$/m, setting)
      : `${previous}\n${setting}\n`;

    if (content !== previous) {
      await fs.writeFile(`${file}.next`, content, { mode: 0o644 });
      await fs.chmod(`${file}.next`, 0o644);
      await fs.rename(`${file}.next`, file);
    }

    if (content !== previous || state.current !== value) {
      await query(item, "SELECT pg_reload_conf();");
      return;
    }

    if (applied.get(item.name) !== value) {
      applied.set(item.name, value);
      console.log(`db ${item.name}: ${value ? `sync ${names.join(", ")}` : "standalone"}`);
    }
  };

  const tick = () => {
    pending = Promise.all(
      targets.map((item) =>
        update(item).catch((error) => {
          console.error(`Database replication check failed: ${item.name}: ${error.message}`);
        })
      )
    ).finally(() => {
      if (!stopped) timer = setTimeout(tick, 3000);
    });
  };

  if (targets.length) tick();

  return async () => {
    stopped = true;
    clearTimeout(timer);
    await pending;
  };
}
