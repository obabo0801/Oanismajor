import * as fs from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import dotenv from "dotenv";
import pg from "pg";

const config = JSON.parse(await fs.readFile("servers.json", "utf8"));

Object.assign(config, JSON.parse(await fs.readFile("local.json", "utf8")));

const primary = config.db.find((item) => item.role === "primary");
const address = config.cluster.address;

const parse = (value) => {
  try {
    const url = new URL(value);

    if (!["postgres:", "postgresql:"].includes(url.protocol)) {
      throw new Error();
    }

    return url;
  } catch {
    throw new Error("Check the database URL in .env");
  }
};

let content = "";

try {
  content = await fs.readFile(".env", "utf8");
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}

const env = dotenv.parse(content);

const append = (name, value) => {
  env[name] = value;
  content += `\n${name}=${JSON.stringify(value)}\n`;
};

const execute = (command, args, input) => {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    input,
    stdio: input === undefined ? "inherit" : ["pipe", "pipe", "pipe"]
  });

  if (result.error || result.status !== 0) {
    throw new Error(`Command failed: ${command}`);
  }

  return result.stdout?.trim();
};

if (!primary && (!env.COOKIE_SECRET || !env.DATABASE_URL)) {
  throw new Error("Copy .env from the primary server");
}

if (!primary && process.env.OANISMAJOR_SEED === "yes") {
  for (const name of ["DATABASE_URL", "REPLICATION_URL"]) {
    if (!env[name]) continue;

    const connection = parse(env[name]);

    if (name === "DATABASE_URL") {
      connection.searchParams.set("sslmode", "no-verify");
    }

    content = content.replace(new RegExp(`^(?:export\\s+)?${name}\\s*=.*$`, "gm"), "");

    append(name, connection.toString());
  }
}

if (primary) {
  if (!env.COOKIE_SECRET) {
    append("COOKIE_SECRET", randomBytes(48).toString("hex"));
  }

  if (!env.DATABASE_URL) {
    append(
      "DATABASE_URL",
      `postgresql://root:${randomBytes(32).toString("hex")}@${address}:${primary.port}/oanismajor?sslmode=no-verify`
    );
  }

  if (!env.REPLICATION_URL) {
    append(
      "REPLICATION_URL",
      `postgresql://replicator:${randomBytes(32).toString("hex")}@${address}:${primary.port}/postgres`
    );
  }
}

const url = parse(env.DATABASE_URL);

if (url.username !== "root" || url.pathname !== "/oanismajor" || !url.password) {
  throw new Error("DATABASE_URL must use root with a password and the oanismajor database");
}

if (!primary && ["localhost", "127.0.0.1"].includes(url.hostname)) {
  throw new Error("DATABASE_URL in the production .env must use the primary server Tailscale IP");
}

if (config.db.some((item) => item.role === "replica") && !env.REPLICATION_URL) {
  throw new Error("DB replicas require REPLICATION_URL");
}

if (primary) {
  if (url.port !== String(primary.port)) {
    throw new Error("DATABASE_URL port does not match the primary DB configuration");
  }

  if (![address, "127.0.0.1", "localhost"].includes(url.hostname)) {
    throw new Error("DATABASE_URL must use the current primary server address");
  }

  try {
    await fs.access(`/etc/postgresql/${primary.version}/${primary.name}/postgresql.conf`);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;

    execute("pg_createcluster", [
      String(primary.version),
      primary.name,
      "--port",
      String(primary.port),
      "--start-conf=manual"
    ]);
  }

  const status = spawnSync("pg_ctlcluster", [String(primary.version), primary.name, "status"], {
    stdio: "ignore"
  });

  if (status.status !== 0) {
    execute("pg_ctlcluster", [String(primary.version), primary.name, "start"]);
  }
}

await fs.writeFile(".env", content, { mode: 0o600 });
await fs.chmod(".env", 0o600);

if (primary) {
  const args = [
    "-u",
    "postgres",
    "--",
    "psql",
    "-p",
    String(primary.port),
    "-d",
    "postgres",
    "-X",
    "-q",
    "-t",
    "-A",
    "-v",
    "ON_ERROR_STOP=1"
  ];

  const password = decodeURIComponent(url.password).replaceAll("'", "''");

  const role = execute(
    "runuser",
    args,
    `
    SELECT 1
    FROM pg_roles
    WHERE rolname = 'root';
  `
  );

  if (role !== "1") {
    execute("runuser", args, `CREATE ROLE root LOGIN PASSWORD '${password}';`);
  }

  const exists = execute(
    "runuser",
    args,
    `
    SELECT 1
    FROM pg_database
    WHERE datname = 'oanismajor';
  `
  );

  if (exists !== "1") {
    execute("runuser", [
      "-u",
      "postgres",
      "--",
      "createdb",
      "-p",
      String(primary.port),
      "--owner=root",
      "oanismajor"
    ]);
  }
}

const connection = new URL(url);

if (primary) {
  connection.hostname = "127.0.0.1";
}

const client = new pg.Client({
  connectionString: connection.toString(),
  connectionTimeoutMillis: 5000
});

try {
  await client.connect();
  await client.query("SELECT 1");
} catch {
  throw new Error(
    "Database connection failed. Check the production .env, Tailscale, and primary server"
  );
} finally {
  await client.end();
}

console.log("Environment and database verified.");
