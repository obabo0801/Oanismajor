import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as crypto from "node:crypto";
import * as child from "node:child_process";
import * as storage from "../was/service/storage.js";

const root = path.resolve(import.meta.dirname, "..");
const read = async (file) => JSON.parse((await fs.readFile(file, "utf8")).replace(/^\uFEFF/, ""));
const local = await read(`${root}/local.json`);
const config = { ...(await read(`${root}/servers.json`)), ...local };

process.loadEnvFile(`${root}/.env`);

const node = config.db[0];
const peer = config.cluster.handoff?.peer;
const state = "/var/lib/oanismajor/handoff.json";
const fence = "/var/lib/oanismajor/fenced";
const data = `/var/lib/postgresql/${node.version}/${node.name}`;
const unit = `db@${node.name}.service`;
const mount = `${config.root}/storage`;
const copy = `${config.root}/replica/storage`;
const bin = `/usr/lib/postgresql/${node.version}/bin`;
const conf = `/etc/postgresql/${node.version}/${node.name}/conf.d/zz-cluster.conf`;
const execute = (command, args, capture = true, options = {}) =>
  new Promise((resolve, reject) => {
    const { input, ...rest } = options;
    const process = child.spawn(command, args, {
      cwd: "/",
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 120000,
      ...rest
    });

    let output = "";
    let error = "";

    process.stdout.on("data", (value) => {
      output += value;
    });

    process.stderr.on("data", (value) => {
      error += value;
    });

    process.stdin.on("error", () => {});
    process.stdin.end(input);
    process.on("error", reject);
    process.on("close", (code) =>
      code === 0
        ? resolve(output.trim())
        : reject(new Error(`${path.basename(command)}: ${error.trim() || code}`))
    );
  });
const system = (...args) => execute("systemctl", args);
const exists = (file) =>
  fs.access(file).then(
    () => true,
    (error) => {
      if (error.code === "ENOENT") return false;
      throw error;
    }
  );

const atomic = async (file, content, mode = 0o600) => {
  const temporary = `${file}.next`;
  const handle = await fs.open(temporary, "w", mode);

  try {
    await handle.writeFile(content);
    await handle.sync();
  } finally {
    await handle.close();
  }
  await fs.rename(temporary, file);

  const directory = await fs.open(path.dirname(file), "r");

  try {
    await directory.sync();
  } finally {
    await directory.close();
  }
};
const save = (value) => atomic(state, JSON.stringify(value) + "\n");
const query = (sql) =>
  execute(
    "runuser",
    [
      "-u",
      "postgres",
      "--",
      "psql",
      "-XAtq",
      "-p",
      String(node.port),
      "-d",
      "oanismajor",
      "-v",
      "ON_ERROR_STOP=1"
    ],
    true,
    { input: `SET statement_timeout='15s';\n${sql}` }
  );

const sign = (value) =>
  crypto
    .createHmac("sha256", process.env.COOKIE_SECRET)
    .update(JSON.stringify(value))
    .digest("hex");
const seal = (value) => ({ value, signature: sign(value) });
const verify = (ticket, kind) => {
  if (
    !ticket?.value ||
    !/^[a-f0-9]{64}$/.test(ticket.signature ?? "") ||
    !crypto.timingSafeEqual(
      Buffer.from(ticket.signature, "hex"),
      Buffer.from(sign(ticket.value), "hex")
    ) ||
    ticket.value.kind !== kind ||
    ticket.value.to !== config.cluster.address ||
    ticket.value.from !== peer.address
  )
    throw new Error("Invalid handoff proof");
  return ticket.value;
};

const pause = async () => {
  await system("stop", "discovery.service", ...config.was.map((port) => `was@${port}.service`));
  for (const name of ["replication", "storage-replica"]) {
    if (await exists(`/etc/systemd/system/${name}.timer`)) {
      await system("stop", `${name}.timer`, `${name}.service`);
    }
  }
};

const resume = async () => {
  await system("start", ...config.was.map((port) => `was@${port}.service`), "discovery.service");
};

const identity = async () =>
  JSON.parse(
    await query(`
  SELECT json_build_object('system', system_identifier::text,
    'recovery', pg_is_in_recovery(),
    'lsn', CASE WHEN pg_is_in_recovery() THEN pg_last_wal_replay_lsn()
      ELSE pg_current_wal_flush_lsn() END)
  FROM pg_control_system();
`)
  );

const wait = async (check) => {
  for (let index = 0; index < 60; index++) {
    if (await check()) return;

    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error("Handoff synchronization timeout");
};

const role = async (primary) => {
  const host = primary ? config.cluster.address : peer.address;
  const port = primary ? node.port : peer.port;

  local.db[0].role = primary ? "primary" : "replica";
  local.cluster.storage = `${host}:${config.root}/storage`;
  local.cluster.sync = primary ? [peer.name] : [];
  Object.assign(config, local);
  if (primary) {
    const file = `/etc/postgresql/${node.version}/${node.name}/pg_hba.conf`;
    const user = decodeURIComponent(new URL(process.env.REPLICATION_URL).username);

    if (!/^[a-z][a-z0-9_]*$/.test(user)) throw new Error("Invalid database user");
    let content = await fs.readFile(file, "utf8");

    for (const database of ["replication", "oanismajor"]) {
      const rule = `hostssl ${database} ${user} ${config.cluster.network} scram-sha-256`;

      if (!content.split(/\r?\n/).includes(rule)) content += `\n${rule}\n`;
    }
    await atomic(file, content, 0o640);
    await execute("chown", ["postgres:postgres", file]);
    await query(`
      GRANT EXECUTE ON FUNCTION pg_catalog.pg_ls_dir(text, boolean, boolean) TO "${user}";
      GRANT EXECUTE ON FUNCTION pg_catalog.pg_stat_file(text, boolean) TO "${user}";
      GRANT EXECUTE ON FUNCTION pg_catalog.pg_read_binary_file(text) TO "${user}";
      GRANT EXECUTE ON FUNCTION pg_catalog.pg_read_binary_file(text, bigint, bigint, boolean) TO "${user}";
      SELECT pg_reload_conf();
    `);
  }
  for (const directory of [root, config.cluster.handoff.source]) {
    if (!directory || (directory === root && directory !== config.root)) continue;
    const settings = await read(`${directory}/local.json`);

    settings.db[0].role = local.db[0].role;
    settings.cluster.storage = local.cluster.storage;
    settings.cluster.sync = local.cluster.sync;
    await atomic(`${directory}/local.json`, JSON.stringify(settings, null, 2) + "\n");

    let content = await fs.readFile(`${directory}/.env`, "utf8");

    for (const name of ["DATABASE_URL", "REPLICATION_URL"]) {
      const url = new URL(process.env[name]);

      url.hostname = host;
      url.port = String(port);
      content = content.replace(new RegExp(`^${name}=.*$`, "m"), `${name}=${url.href}`);
    }
    await atomic(`${directory}/.env`, content);
  }
};

const release = async () => {
  await fs.unlink(fence);
  await execute("sync", ["-f", path.dirname(fence)]);
};

async function operate(action, ticket) {
  if (
    !peer ||
    config.db.length !== 1 ||
    !process.env.COOKIE_SECRET ||
    !/^[a-z][a-z0-9-]*$/.test(peer.name) ||
    !/^100\.[\d.]+$/.test(peer.address)
  )
    throw new Error("Handoff configuration required");

  if (action === "inspect") {
    return {
      ...(await identity()),
      address: config.cluster.address,
      fenced: await exists(fence),
      state: (await exists(state)) ? await read(state) : null
    };
  }

  if (action === "prepare") {
    const current = await identity();

    if (!current.recovery || (await exists(fence))) throw new Error("Standby required");

    if (
      (await query(`
      SELECT EXISTS (SELECT 1 FROM pg_stat_wal_receiver WHERE status = 'streaming')
        AND pg_last_wal_replay_lsn() >= pg_last_wal_receive_lsn();
    `)) !== "t"
    )
      throw new Error("Standby synchronization pending");

    if ((await execute("findmnt", ["-rn", "-M", mount, "-o", "FSTYPE"])) !== "nfs4")
      throw new Error("Shared storage mount required");
    const previous = (await exists(state)) ? await read(state) : null;

    if (previous?.phase === "prepared") return previous.ticket;

    if (previous && !["joined", "promoted"].includes(previous.phase))
      throw new Error("Another handoff is pending");

    await execute("test", ["-x", "/usr/sbin/exportfs"]);
    await pause();

    const prepared = {
      kind: "prepared",
      id: crypto.randomUUID(),
      system: current.system,
      from: config.cluster.address,
      to: peer.address
    };
    const proof = seal(prepared);

    await save({ phase: "prepared", ...prepared, ticket: proof });
    return proof;
  }

  if (action === "freeze") {
    const prepared = verify(ticket, "prepared");
    const previous = (await exists(state)) ? await read(state) : null;

    if (previous?.phase === "frozen" && previous.id === prepared.id) return previous.ticket;

    if (previous?.phase !== "freezing" || previous.id !== prepared.id) {
      const current = await identity();

      if (current.recovery || current.system !== prepared.system || (await exists(fence)))
        throw new Error("Primary identity mismatch");

      await pause();
      await query("CHECKPOINT;");
      await save({ phase: "freezing", id: prepared.id });
    }

    await atomic(fence, prepared.id + "\n");
    await system("stop", unit);

    const control = await execute(
      "runuser",
      ["-u", "postgres", "--", `${bin}/pg_controldata`, data],
      true,
      { env: { ...process.env, LC_ALL: "C" } }
    );

    if (!/^Database cluster state:\s+shut down$/m.test(control))
      throw new Error("Primary shutdown not confirmed");
    const lsn = control.match(/^Latest checkpoint location:\s+([A-F0-9]+\/[A-F0-9]+)$/m)?.[1];

    if (!lsn) throw new Error("Shutdown checkpoint unavailable");
    const proof = seal({
      kind: "frozen",
      id: prepared.id,
      system: prepared.system,
      lsn,
      from: config.cluster.address,
      to: peer.address
    });

    await save({ phase: "frozen", id: prepared.id, ticket: proof });
    return proof;
  }

  if (action === "promote") {
    const frozen = verify(ticket, "frozen");
    const previous = await read(state);

    if (previous.phase === "promoted" && previous.id === frozen.id) {
      await resume();
      return previous.ticket;
    }

    if (previous.id !== frozen.id || !["prepared", "promoting"].includes(previous.phase))
      throw new Error("Handoff transaction mismatch");
    const current = await identity();

    if (current.system !== frozen.system || !/^[A-F0-9]+\/[A-F0-9]+$/.test(frozen.lsn))
      throw new Error("Database identity mismatch");

    if (current.recovery) {
      await wait(
        async () =>
          (await query(`SELECT pg_last_wal_replay_lsn() >= '${frozen.lsn}'::pg_lsn;`)) === "t"
      );

      if (previous.phase === "prepared") {
        await execute("rsync", ["-a", "--delete-delay", `${mount}/`, `${copy}/`]);
        await execute("sync", ["-f", copy]);
        await save({ ...previous, phase: "promoting", ticket });
      }
      const mounted = await execute("findmnt", ["-rn", "-M", mount]).catch(() => "");

      if (mounted) {
        const name = await execute("systemd-escape", ["--path", "--suffix=mount", mount]);

        await system("disable", "--now", name);
        await fs.unlink(`/etc/systemd/system/${name}`);
        await system("daemon-reload");
      }

      if (await exists(copy)) {
        if (await exists(mount)) {
          if ((await fs.readdir(mount)).length) throw new Error("Storage target is not empty");

          await fs.rename(mount, `${mount}.empty-${frozen.id}`);
        }

        await fs.rename(copy, mount);
        await execute("sync", ["-f", config.root]);
      }

      if (!(await exists(mount))) throw new Error("Local storage unavailable");
      const content = (await fs.readFile(conf, "utf8")).replace(
        /^synchronous_standby_names\s*=.*$/m,
        "synchronous_standby_names = ''"
      );

      await atomic(conf, content, 0o644);
      await query("SELECT pg_reload_conf(); SELECT pg_promote(true, 30);");
    }

    await role(true);
    await storage.setup(config, execute);

    const proof = seal({
      kind: "promoted",
      id: frozen.id,
      system: frozen.system,
      from: config.cluster.address,
      to: peer.address
    });

    await save({ phase: "promoted", id: frozen.id, ticket: proof });
    await resume();
    return proof;
  }

  if (action === "rejoin") {
    const promoted = verify(ticket, "promoted");
    const previous = await read(state);

    if (previous.phase === "joined" && previous.id === promoted.id) {
      await resume();
      return { joined: true };
    }

    if (previous.id !== promoted.id || !["frozen", "joining"].includes(previous.phase))
      throw new Error("Frozen primary required");

    await pause();
    await system("stop", unit);
    await save({ ...previous, phase: "joining", ticket });

    const url = new URL(process.env.REPLICATION_URL);
    const pass = `/var/lib/postgresql/.oanismajor-${node.name}-handoff.pass`;
    const user = decodeURIComponent(url.username);
    const password = decodeURIComponent(url.password)
      .replaceAll("\\", "\\\\")
      .replaceAll(":", "\\:");

    if (!/^[a-z][a-z0-9_]*$/.test(user)) throw new Error("Invalid database user");

    await atomic(pass, `${peer.address}:${peer.port}:*:${user}:${password}\n`);
    await execute("chown", ["postgres:postgres", pass]);

    const connection = `host=${peer.address} port=${peer.port} user=${user} dbname=oanismajor passfile=${pass} sslmode=require connect_timeout=5`;

    await execute("runuser", [
      "-u",
      "postgres",
      "--",
      `${bin}/pg_rewind`,
      `--target-pgdata=${data}`,
      `--source-server=${connection}`
    ]);

    await atomic(
      `${data}/postgresql.auto.conf`,
      `primary_conninfo = '${connection} application_name=${node.name}'\nrecovery_target_timeline = 'latest'\n`
    );

    await atomic(`${data}/standby.signal`, "");
    await execute("chown", [
      "postgres:postgres",
      `${data}/postgresql.auto.conf`,
      `${data}/standby.signal`
    ]);

    await role(false);
    if (!(await exists(copy))) {
      await system("stop", "storage.service");
      if (await exists("/etc/exports.d/oanismajor.exports")) {
        await fs.unlink("/etc/exports.d/oanismajor.exports");
        await execute("exportfs", ["-ra"]);
      }

      await fs.mkdir(path.dirname(copy), { recursive: true });
      await fs.rename(mount, copy);
      await fs.mkdir(mount);
    }

    await storage.setup(config, execute);
    await release();
    await system("start", unit);
    await wait(async () => (await identity()).recovery);
    await save({ phase: "joined", id: promoted.id });
    await resume();
    return { joined: true };
  }
  throw new Error("Invalid handoff action");
}

try {
  await fs.mkdir(path.dirname(state), { recursive: true, mode: 0o700 });
  if (process.env.OANISMAJOR_HANDOFF_LOCK !== "1") {
    const process = child.spawn(
      "nsenter",
      [
        "--mount=/proc/1/ns/mnt",
        "--",
        "flock",
        "-n",
        "/run/lock/oanismajor-handoff.lock",
        globalThis.process.execPath,
        import.meta.filename,
        globalThis.process.argv[2]
      ],
      { stdio: "inherit", env: { ...globalThis.process.env, OANISMAJOR_HANDOFF_LOCK: "1" } }
    );

    const code = await new Promise((resolve, reject) => {
      process.on("error", reject);
      process.on("close", resolve);
    });

    globalThis.process.exit(code ?? 1);
  }

  if (!/^[A-Za-z0-9+/=]{1,22000}$/.test(process.argv[2] ?? ""))
    throw new Error("Invalid handoff request");
  const input = Buffer.from(process.argv[2], "base64").toString("utf8");
  const request = JSON.parse(input);

  console.log(JSON.stringify(await operate(request.action, request.ticket)));
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
