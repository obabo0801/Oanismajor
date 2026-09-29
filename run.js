import { spawn } from "node:child_process";
import * as fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { BlockList, isIPv4 } from "node:net";

const directory = path.dirname(fileURLToPath(import.meta.url));

const config = JSON.parse(
  (await fs.readFile(path.join(directory, "servers.json"), "utf8")).replace(/^\uFEFF/, "")
);

try {
  Object.assign(config, JSON.parse(await fs.readFile(path.join(directory, "local.json"), "utf8")));
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}
const [action = "status", role, instance] = process.argv.slice(2);
const roles = ["db", "was", "web"];

try {
  const root = process.platform === "win32" || action === "dev" ? directory : config.root;

  process.loadEnvFile(path.join(root, ".env"));
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}

if (config.https) config.https = { host: process.env.HTTPS_HOST, email: process.env.HTTPS_EMAIL };

const execute = (
  command,
  args,
  capture = false,
  { encoding = "utf8", input, stream = false, ...options } = {}
) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: directory,
      stdio: [
        input === undefined ? (capture ? "ignore" : "inherit") : "pipe",
        capture || stream ? "pipe" : "inherit",
        capture || stream ? "pipe" : "inherit"
      ],
      ...options
    });

    let output = "";

    if (input !== undefined) child.stdin.end(input);

    if (capture || stream) {
      child.stdout.setEncoding(encoding);
      child.stderr.setEncoding(encoding);
      child.stdout.on("data", (value) => {
        if (stream) process.stdout.write(paint(value, "success"));
        else output += value;
      });

      child.stderr.on("data", (value) => {
        if (stream) process.stderr.write(paint(value, "error"));
        else output += value;
      });
    }

    child.on("error", reject);
    child.on("close", (code, signal) => {
      if (code === 0 || signal === "SIGINT") resolve(output.trim());
      else
        reject(
          new Error(
            `${command} exited with ${code ?? signal}${capture ? `: ${output.trim()}` : ""}`
          )
        );
    });
  });

const entries = (name) => [
  ...config[name].map((item) =>
    typeof item === "number"
      ? { name: String(item), port: item, unit: `${name}@${item}.service` }
      : { ...item, unit: `db@${item.name}.service` }
  ),
  ...(name === "web" && config.https
    ? [{ name: "https", port: 443, unit: "web@https.service", secure: true }]
    : [])
];

const selected = () =>
  (role ? [role] : roles).flatMap((name) =>
    entries(name)
      .filter((item) => !instance || item.name === instance || String(item.port) === instance)
      .map((item) => ({ ...item, role: name }))
  );

function validate() {
  if (role && !roles.includes(role)) throw new Error("Use was, web, or db");

  if (!/^(\/[\w.-]+)+$/.test(config.root) || !/^(\/[\w.-]+)+$/.test(config.node))
    throw new Error("Invalid runtime path");
  const ports = new Set();

  if (config.cluster) {
    const [network, prefix] = (config.cluster.network || "").split("/");
    const allowed = new BlockList();

    if (!isIPv4(config.cluster.address) || !isIPv4(network) || !/^\d+$/.test(prefix))
      throw new Error("Cluster requires an IPv4 address and private network");

    allowed.addSubnet(network, Number(prefix), "ipv4");
    if (!allowed.check(config.cluster.address, "ipv4"))
      throw new Error("Server address is outside the cluster network");
  }

  if (
    action === "setup" &&
    config.https &&
    (!config.https.host ||
      !config.https.email ||
      !/^[a-z0-9.-]+$/i.test(config.https.host) ||
      !/^[a-z0-9.+_-]+@[a-z0-9.-]+$/i.test(config.https.email))
  )
    throw new Error("Set HTTPS_HOST and HTTPS_EMAIL in .env");

  for (const name of roles)
    for (const item of entries(name)) {
      if (
        !Number.isInteger(item.port) ||
        (item.port < 1024 && !item.secure) ||
        item.port > 65535 ||
        ports.has(item.port)
      )
        throw new Error("Invalid or duplicate port");

      ports.add(item.port);
      if (
        name === "db" &&
        (!/^[a-z][a-z0-9-]*$/.test(item.name) ||
          !Number.isInteger(item.version) ||
          !["primary", "replica"].includes(item.role))
      )
        throw new Error("Invalid database instance");
    }
  if (!selected().length && action !== "watch") throw new Error("Unknown instance");
}

async function setup() {
  await fs.mkdir("/etc/oanismajor", { recursive: true });

  const configure = async (file, value) => {
    let previous;

    try {
      previous = await fs.readFile(file, "utf8");
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    await fs.writeFile(file, value);
    try {
      await execute("/usr/sbin/nginx", ["-t", "-c", file]);
    } catch (error) {
      if (previous === undefined) await fs.rm(file, { force: true });
      else await fs.writeFile(file, previous);
      throw error;
    }
  };

  if (role !== "web") {
    let mount = "";

    if (
      config.cluster &&
      (config.was.length || config.cluster.storage?.split(":")[0] === config.cluster.address)
    ) {
      const storage = await import("./was/service/storage.js");

      mount = await storage.setup(config, execute);
    }

    if (config.was.length) {
      const privilege = await import("#config/privilege");

      await privilege.setup(config, execute);
    }

    for (const name of ["was", "web"]) {
      const template = await fs.readFile(path.join(directory, name, `${name}@.service`), "utf8");

      await fs.writeFile(
        `/etc/systemd/system/${name}@.service`,
        template
          .replaceAll("__ROOT__", config.root)
          .replaceAll("__NODE__", config.node)
          .replaceAll("__ADDRESS__", config.cluster?.address || "127.0.0.1")
          .replaceAll("__NETWORK__", config.cluster?.network || "")
          .replaceAll("__MOUNT__", mount)
      );
    }
    if (config.cluster) {
      const template = await fs.readFile(path.join(directory, "was/discovery.service"), "utf8");

      await fs.writeFile(
        "/etc/systemd/system/discovery.service",
        template.replaceAll("__ROOT__", config.root).replaceAll("__NODE__", config.node)
      );

      for (const name of ["was", "web"])
        try {
          await fs.writeFile(`/etc/oanismajor/${name}.conf`, "server 127.0.0.1:1 down;\n", {
            flag: "wx"
          });
        } catch (error) {
          if (error.code !== "EEXIST") throw error;
        }
    }
  }
  const template = await fs.readFile(path.join(directory, "web/nginx.conf"), "utf8");

  for (const port of config.web) {
    const file = `/etc/oanismajor/web-${port}.conf`;
    const value = template
      .replaceAll(
        "        listen 127.0.0.1:__PORT__;",
        config.cluster ? "        listen 127.0.0.1:__PORT__;" : ""
      )
      .replaceAll("__PORT__", port)
      .replaceAll("__ROOT__", config.root)
      .replaceAll("__ADDRESS__", config.cluster?.address || "127.0.0.1")
      .replaceAll(
        "__UPSTREAM__",
        config.cluster
          ? "        include /etc/oanismajor/was.conf;"
          : config.was.map((port) => `        server 127.0.0.1:${port};`).join("\n")
      );

    await configure(file, value);
  }
  if (config.https) {
    const template = await fs.readFile(path.join(directory, "web/https.conf"), "utf8");
    const file = "/etc/oanismajor/web-https.conf";

    try {
      const previous = await fs.readFile(file, "utf8");
      const host = previous.match(/acme_certificate\s+letsencrypt\s+([^;\s]+);/)?.[1];

      if (host && host !== config.https.host)
        throw new Error("HTTPS_HOST differs from the existing certificate. Keep the current host");
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }

    try {
      await fs.access("/var/lib/oanismajor/acme");
      if (!(await fs.readdir("/var/lib/oanismajor/acme")).length) {
        try {
          await fs.access(file);
          throw new Error("Existing ACME directory is empty. Restore certificates before setup");
        } catch (previous) {
          if (previous.code !== "ENOENT") throw previous;
        }
      }
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      try {
        await fs.access(file);
        throw new Error("Existing HTTPS state is missing. Restore ACME data before setup");
      } catch (previous) {
        if (previous.code !== "ENOENT") throw previous;
      }
      await fs.mkdir("/var/lib/oanismajor/acme", { recursive: true });
      await execute("chown", ["root:www-data", "/var/lib/oanismajor"]);
      await execute("chmod", ["710", "/var/lib/oanismajor"]);
      await execute("chown", ["www-data:www-data", "/var/lib/oanismajor/acme"]);
      await execute("chmod", ["700", "/var/lib/oanismajor/acme"]);
    }
    await configure(
      file,
      template
        .replaceAll("__HOST__", config.https.host)
        .replaceAll("__EMAIL__", config.https.email)
        .replaceAll(
          "__UPSTREAM__",
          config.cluster
            ? "        include /etc/oanismajor/web.conf;"
            : config.web.map((port) => `        server 127.0.0.1:${port};`).join("\n")
        )
    );
  }

  if (role === "web") return;
  for (const item of entries("db")) {
    const file = `/etc/postgresql/${item.version}/${item.name}/postgresql.conf`;

    if (item.role === "replica") {
      const replica = await import("./db/replica.js");

      await replica.setup(item, execute);
    }

    await fs.readFile(file);
    if (config.cluster) {
      const database = await import("./db/replica.js");

      await database.configure(config, item, execute);
    }

    const template = await fs.readFile(path.join(directory, "db/db@.service"), "utf8");

    await fs.writeFile(
      `/etc/systemd/system/db@${item.name}.service`,
      template.replaceAll("__VERSION__", item.version)
    );
  }
  for (const name of roles) {
    const units = entries(name)
      .map((item) => item.unit)
      .join(" ");

    const after =
      name === "was" ? "db.service" : name === "web" ? "was.service" : "network-online.target";

    await fs.writeFile(
      `/etc/systemd/system/${name}.service`,
      `[Unit]\nDescription=oanismajor ${name.toUpperCase()} group\nWants=${units}\nAfter=${after} ${units}\n\n[Service]\nType=oneshot\nRemainAfterExit=yes\nExecStart=/usr/bin/true\n\n[Install]\nWantedBy=multi-user.target\n`
    );
  }
  await execute("systemctl", ["daemon-reload"]);

  for (const name of roles.filter((name) => !entries(name).length))
    await execute("systemctl", ["disable", `${name}.service`]);
  if (config.cluster) await execute("systemctl", ["enable", "discovery.service"]);

  console.log("Service configuration installed. Existing databases were preserved.");
}

function paint(value, tone = "mute") {
  if (!process.stdout.isTTY && process.env.OANISMAJOR_COLOR !== "1") return value;
  const colors = {
    success: "52;199;89",
    error: "255;69;58",
    focus: "55;121;255",
    mute: "110;110;110"
  };

  return `\x1b[38;2;${colors[tone]}m${value}\x1b[0m`;
}

async function locale() {
  const selected = process.env.OANISMAJOR_LANG || config.lang;
  const system =
    process.env.LC_ALL ||
    process.env.LC_MESSAGES ||
    process.env.LANG ||
    Intl.DateTimeFormat().resolvedOptions().locale;
  const language = ["ko", "en"].includes(selected) ? selected : /^ko/i.test(system) ? "ko" : "en";

  return JSON.parse(
    await fs.readFile(path.join(directory, "was/i18n", `${language}.json`), "utf8")
  );
}

async function status(offline = false) {
  const message = await locale();
  const rows = [];
  const address = config.cluster?.address || "127.0.0.1";
  const order = ["was", "web", "db"];
  const primary = config.cluster?.storage?.split(":")[0] || address;

  for (const item of selected().filter((item) => !item.secure)) {
    const output = offline
      ? "ActiveState=inactive\nMainPID=0"
      : await execute(
          "systemctl",
          ["show", item.unit, "--property=ActiveState,MainPID", "--no-pager"],
          true
        );
    const fields = Object.fromEntries(output.split("\n").map((line) => line.split("=")));

    let active = fields.ActiveState === "active" && Number(fields.MainPID) > 0;
    let state = fields.ActiveState || "inactive";

    if (active)
      try {
        await health(item);
      } catch {
        active = false;
        state = "maintenance";
      }

    if (!active && rows.some((row) => row.service === item.role)) continue;

    rows.push({
      service: item.role,
      state: active ? "active" : state,
      host: address,
      port: item.port,
      pid: active ? fields.MainPID : ""
    });
  }
  let unavailable = false;

  if (config.cluster) {
    const { Pool } = await import("pg");
    const { signature } = await import("./was/config/hash.js");
    const pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      connectionTimeoutMillis: 3000,
      statement_timeout: 3000
    });

    try {
      const result = await pool.query(
        `
        SELECT host(address) AS host, service, port, to_jsonb(s)->>'pid' AS pid
        FROM runtime.server AS s
        WHERE expires > now() AND signature = $1
      `,
        [signature()]
      );

      for (const item of result.rows) {
        if (item.host === address || !order.includes(item.service)) continue;

        if ((role && item.service !== role) || instance) continue;

        rows.push({ ...item, state: "active", pid: item.pid || "" });
      }
    } catch {
      unavailable = rows.some((row) =>
        ["active", "activating", "reloading", "maintenance"].includes(row.state)
      );
    } finally {
      await pool.end();
    }
  }

  if (rows.some((row) => row.host !== address && row.state === "active")) {
    for (let index = rows.length - 1; index >= 0; index--) {
      const row = rows[index];

      if (row.host === address && row.state === "inactive") rows.splice(index, 1);
    }
  }

  if (!rows.length) {
    console.log(message.inactive);
    return;
  }

  rows.sort(
    (a, b) =>
      order.indexOf(a.service) - order.indexOf(b.service) ||
      Number(b.host === primary) - Number(a.host === primary) ||
      a.host.localeCompare(b.host, "en", { numeric: true }) ||
      a.port - b.port
  );

  const counts = new Map();

  for (const row of rows)
    if (row.state === "active") counts.set(row.service, (counts.get(row.service) || 0) + 1);
  const numbers = new Map();
  const columns = message.columns;
  const values = rows.map((row) => {
    const number = (numbers.get(row.service) || 0) + 1;

    if (row.state === "active") numbers.set(row.service, number);
    return [
      row.service.toUpperCase() +
        (row.state === "active" && counts.get(row.service) > 1 ? number : ""),
      message.states[row.state] || message.states.unknown,
      row.state === "active" ? `${row.host}:${row.port}` : "",
      String(row.pid)
    ];
  });

  table(
    columns,
    values,
    rows.map((row) => row.state)
  );

  const connection = await import("./was/service/connection.js");
  const diagnostics = await connection.read({ offline });

  table(
    message.connection.columns,
    diagnostics.items.map((item) => [item.name, message.connection.states[item.state]]),
    diagnostics.items.map((item) =>
      ["valid", "authenticated", "configured", "connected"].includes(item.state)
        ? "active"
        : ["expiring", "rebuild"].includes(item.state)
          ? "maintenance"
          : ["unchecked", "disabled", "fallback"].includes(item.state)
            ? "unchecked"
            : "inactive"
    )
  );

  if (unavailable) {
    console.log(paint(message.unavailable, "error"));
    process.exitCode = 1;
  }
}

function table(columns, values, states) {
  const width = (value) =>
    value.length +
    (value.match(/[\u1100-\u115f\u2e80-\ua4cf\uac00-\ud7a3\uff01-\uff60]/g)?.length || 0);

  const widths = columns.map((name, index) =>
    Math.max(width(name), ...values.map((row) => width(row[index])))
  );

  const border = (left, middle, right) =>
    console.log(paint(left + widths.map((width) => "─".repeat(width + 2)).join(middle) + right));

  const row = (values, state) => {
    const tone =
      state === "maintenance"
        ? "focus"
        : ["active", "reloading", "activating", "deactivating"].includes(state)
          ? "success"
          : state === "unchecked"
            ? "mute"
            : "error";

    console.log(
      paint("│ ") +
        values
          .map((value, index) => {
            const space = widths[index] - width(value);

            return paint(
              " ".repeat(Math.floor(space / 2)) + value + " ".repeat(Math.ceil(space / 2)),
              index === 1 && state ? tone : "mute"
            );
          })
          .join(paint(" │ ")) +
        paint(" │")
    );
  };

  border("┌", "┬", "┐");
  row(columns);
  border("├", "┼", "┤");
  values.forEach((value, index) => row(value, states[index]));
  border("└", "┴", "┘");
}

async function logs() {
  const units = selected().filter((item) => item.role !== "db");

  if (config.cluster && !role)
    units.push({ unit: "discovery.service" }, { unit: "storage.service" });
  const databases = selected().filter((item) => item.role === "db");
  const children = [];

  if (units.length)
    children.push(
      spawn(
        "journalctl",
        ["--follow", "--lines=50", "--no-pager", ...units.flatMap((item) => ["-u", item.unit])],
        { stdio: "inherit" }
      )
    );

  if (databases.length)
    children.push(
      spawn(
        "tail",
        [
          "-n",
          "50",
          "-F",
          ...databases.map(
            (item) => `/var/log/postgresql/postgresql-${item.version}-${item.name}.log`
          )
        ],
        { stdio: "inherit" }
      )
    );
  const stop = () => {
    for (const child of children) child.kill("SIGTERM");
  };

  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  await Promise.all(
    children.map(
      (child) =>
        new Promise((resolve, reject) => {
          child.on("error", (error) => {
            stop();
            reject(error);
          });

          child.on("exit", () => {
            stop();
            resolve();
          });
        })
    )
  );
}

async function health(item) {
  if (item.role === "db")
    await execute("/usr/bin/pg_isready", ["-h", "127.0.0.1", "-p", String(item.port)], true);
  else if (item.secure) {
    await execute(
      "curl",
      [
        "--fail",
        "--silent",
        "--show-error",
        "--noproxy",
        "*",
        "--connect-timeout",
        "2",
        "--max-time",
        "5",
        "--resolve",
        `${config.https.host}:443:127.0.0.1`,
        "--output",
        "/dev/null",
        `https://${config.https.host}/`
      ],
      true
    );
  } else {
    const address = `http://${config.cluster?.address || "127.0.0.1"}:${item.port}${config.cluster ? "/_health" : "/"}`;

    const response = await fetch(address, { signal: AbortSignal.timeout(1000) });

    await response.body?.cancel();
    if (!response.ok) throw new Error("Not ready");
  }
}

async function ready(name) {
  for (const item of selected().filter((item) => item.role === name)) {
    const deadline = Date.now() + 60000;

    let available = false;

    while (Date.now() < deadline) {
      try {
        await health(item);

        available = true;
        break;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
    }
    if (!available) throw new Error(`${name} ${item.name} did not become ready; inspect its logs`);
  }
}

async function journal(units, task) {
  const since = `@${Date.now() / 1000}`;
  const args = [
    "--since",
    since,
    "--output=json",
    "--no-pager",
    ...units.flatMap((unit) => ["-u", unit])
  ];
  const seen = new Set();
  const show = (line) => {
    if (!line.trim()) return;
    let entry;

    try {
      entry = JSON.parse(line);
    } catch {
      return;
    }
    if (seen.has(entry.__CURSOR)) return;

    seen.add(entry.__CURSOR);

    const tone = Number(entry.PRIORITY) <= 3 ? "error" : "success";
    const unit = entry._SYSTEMD_UNIT || entry.UNIT || "";
    const message = typeof entry.MESSAGE === "string" ? entry.MESSAGE : "";

    for (const text of message.split(/\r?\n/)) {
      if (text) process.stdout.write(paint(`${unit} ${text}`, tone) + "\r\n");
    }
  };
  const child = spawn("journalctl", ["--follow", ...args], { stdio: ["ignore", "pipe", "pipe"] });

  let pending = "";

  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (value) => {
    const lines = (pending + value).split("\n");

    pending = lines.pop();
    lines.forEach(show);
  });

  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (value) => process.stderr.write(paint(value, "error")));

  const closed = new Promise((resolve) => {
    child.on("error", (error) => {
      console.error(paint(error.message, "error"));
      resolve();
    });

    child.on("close", resolve);
  });

  try {
    await task();
  } finally {
    child.kill("SIGTERM");
    await closed;
    show(pending);
    try {
      const output = await execute("journalctl", args, true);

      output.split("\n").forEach(show);
    } catch (error) {
      console.error(paint(error.message, "error"));
    }
  }
}

async function available(command) {
  const result = [];

  for (const name of ["was", "web", "db"]) {
    const items = selected().filter((item) => item.role === name);

    if (!items.length) continue;
    const output = await execute(
      "systemctl",
      ["show", ...items.map((item) => item.unit), "--property=ActiveState", "--value"],
      true
    );
    const states = output.trim().split(/\s+/);

    if (
      command === "start"
        ? states.some((state) => !["active", "activating", "reloading"].includes(state))
        : states.some((state) => !["inactive", "failed"].includes(state))
    )
      result.push(name);
  }
  return result;
}

async function uninstall() {
  const directory = "/etc/systemd/system";
  const units = [];

  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    if (!entry.isFile() || !/\.(service|timer|mount)$/.test(entry.name)) continue;
    const file = path.join(directory, entry.name);

    if (/^Description=oanismajor /m.test(await fs.readFile(file, "utf8"))) units.push(entry.name);
  }
  if (!units.length) return;
  const active = units.filter((unit) => !unit.includes("@."));

  if (active.length)
    await execute("systemctl", ["disable", "--now", ...active], false, { stream: true });
  for (const unit of units) await fs.unlink(path.join(directory, unit));
  await execute("systemctl", ["daemon-reload"]);
}

async function operate() {
  if (action === "setup") return setup();

  if (action === "uninstall") return uninstall();

  if (["starting", "stopping"].includes(action)) {
    const names = await available(action === "starting" ? "start" : "stop");

    if (names.length) console.log(names.join("\n"));
    return;
  }

  if (action === "watch") {
    const { start } = await import("./was/service/discovery.js");

    return start(config, execute, selected());
  }

  if (action === "status") return status();

  if (action === "logs") return logs();

  if (action === "check") {
    for (const name of role ? [role] : roles) await ready(name);
    return;
  }

  if (!["start", "stop", "restart"].includes(action)) throw new Error("Unknown command");

  const eligible = action === "restart" ? roles : await available(action);
  const ordered = (role ? [role] : roles.filter((name) => entries(name).length)).filter((name) =>
    eligible.includes(name)
  );

  if (!ordered.length) return;

  if (config.cluster && action !== "stop")
    await execute("systemctl", ["start", "discovery.service"]);

  if (action === "stop") ordered.reverse();
  for (const name of ordered) {
    const units = instance ? selected().map((item) => item.unit) : [`${name}.service`];

    if (action === "stop") {
      const targets = [
        ...new Set([
          ...units,
          ...selected()
            .filter((item) => item.role === name)
            .map((item) => item.unit)
        ])
      ];

      const state = await execute(
        "systemctl",
        ["show", ...targets, "--property=ActiveState", "--value", "--no-pager"],
        true
      );

      if (
        state
          .split(/\s+/)
          .filter(Boolean)
          .every((value) => value === "inactive")
      ) {
        continue;
      }
    }

    const watched = [
      ...new Set([
        ...units,
        ...selected()
          .filter((item) => item.role === name)
          .map((item) => item.unit)
      ])
    ];

    await journal(watched, async () => {
      if (action === "start") await execute("systemctl", ["enable", ...units]);

      await execute("systemctl", [action, ...units], false, { stream: true });
      if (name === "web" && action === "start")
        await execute("systemctl", [
          "reload",
          ...selected()
            .filter((item) => item.role === name)
            .map((item) => item.unit)
        ]);

      if (action !== "stop") await ready(name);
    });
  }
  if (config.cluster && action === "stop" && !role)
    await execute("systemctl", ["stop", "discovery.service"]);
}

async function dev() {
  const storage = config.cluster?.storage?.split(":")[0];
  const media = storage && config.was[0] ? `http://${storage}:${config.was[0]}` : "";

  let data = process.env.DATA_DIRECTORY;

  if (!data && storage) {
    const target = `${config.root}/storage`;

    if (storage !== config.cluster.address) {
      const args = ["-rn", "-M", target, "-o", "FSTYPE"];
      const mounted =
        process.platform === "win32"
          ? await execute(
              "wsl",
              ["-d", config.distribution, "-u", "root", "--", "findmnt", ...args],
              true
            )
          : await execute("findmnt", args, true);

      if (!mounted.trim().startsWith("nfs")) throw new Error("Shared storage is not mounted");
    }

    data =
      process.platform === "win32"
        ? `\\\\wsl.localhost\\${config.distribution}${target.replaceAll("/", "\\")}`
        : target;

    await fs.access(data, fs.constants.W_OK);
  }
  const children = [
    spawn(process.execPath, [path.join(directory, "was/server.js")], {
      cwd: directory,
      stdio: "inherit",
      env: {
        ...process.env,
        NODE_ENV: "development",
        ...(data && { DEVELOPMENT_STORAGE: data }),
        DEVELOPMENT_MEDIA: media,
        HOST: "127.0.0.1",
        PORT: process.env.PORT || "3000"
      }
    }),
    spawn(
      process.execPath,
      [path.join(directory, "node_modules/vite/bin/vite.js"), "--config", "web/vite.config.js"],
      { cwd: directory, stdio: "inherit" }
    )
  ];

  let stopping = false;

  const stop = () => {
    if (stopping) return;

    stopping = true;
    for (const child of children) child.kill("SIGTERM");
  };

  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  for (const child of children)
    child.on("error", (error) => {
      console.error(paint(error.message, "error"));
      stop();
    });
  await Promise.all(
    children.map(
      (child) =>
        new Promise((resolve) =>
          child.on("exit", (code) => {
            stop();
            if (code) process.exitCode = code;

            resolve();
          })
        )
    )
  );
}

try {
  validate();
  if (action === "dev") await dev();
  else if (process.platform === "win32") {
    const running =
      action === "status"
        ? await execute("wsl.exe", ["--list", "--running", "--quiet"], true, {
            encoding: "utf16le"
          })
        : null;

    if (running !== null && !running.split(/\r?\n/).includes(config.distribution)) {
      await status(true);
    } else {
      if (["start", "restart"].includes(action))
        await execute("powershell.exe", [
          "-NoProfile",
          "-Command",
          `if (Get-ScheduledTask -TaskName 'oanismajor ${config.distribution.replaceAll("'", "''")}' -ErrorAction SilentlyContinue) { Start-ScheduledTask -TaskName 'oanismajor ${config.distribution.replaceAll("'", "''")}' }`
        ]);

      await execute("wsl.exe", [
        "-d",
        config.distribution,
        "-u",
        "root",
        "--exec",
        config.node,
        `${config.root}/run.js`,
        ...process.argv.slice(2)
      ]);
    }
  } else {
    if (process.getuid() !== 0) throw new Error("Run this command with sudo");

    if (action === "setup" && process.env.OANISMAJOR_SETUP_LOCK !== "1") {
      await execute(
        "/usr/bin/flock",
        [
          "--nonblock",
          "/run/lock/oanismajor-setup.lock",
          process.execPath,
          import.meta.filename,
          ...process.argv.slice(2)
        ],
        false,
        { env: { ...process.env, OANISMAJOR_SETUP_LOCK: "1" } }
      );
    } else if (directory !== config.root) {
      await execute(config.node, [`${config.root}/run.js`, ...process.argv.slice(2)], false, {
        cwd: config.root
      });
    } else await operate();
  }
} catch (error) {
  console.error(paint(error.message, "error"));
  process.exitCode = 1;
}
