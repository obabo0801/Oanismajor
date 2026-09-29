import * as fs from "node:fs/promises";
import path from "node:path";
import * as child from "node:child_process";
import { randomUUID } from "node:crypto";
import { parseEnv, isDeepStrictEqual } from "node:util";
import { fileURLToPath, pathToFileURL } from "node:url";

const excludes = [
  "node_modules",
  "storage",
  "replica",
  "dist",
  ".git",
  ".env",
  "local.json",
  ".config",
  ".codex*"
];
const copy = (source, target) => [
  "-a",
  "--checksum",
  "--delete",
  ...excludes.map((name) => `--exclude=${name}`),
  `${source}/`,
  `${target}/`
];
const read = async (file) => {
  try {
    return await fs.readFile(file);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
};

const atomic = async (file, value) => {
  const temporary = `${file}.${randomUUID()}.next`;

  await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o755 });
  await fs.chmod(path.dirname(file), 0o755);
  try {
    await fs.writeFile(temporary, value, { flag: "wx", mode: 0o644 });
    await fs.rename(temporary, file);
  } finally {
    await fs.rm(temporary, { force: true });
  }
};

export async function publish(source, target, backup) {
  const files = [];
  const walk = async (directory, base = "") => {
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      const relative = path.join(base, entry.name);

      if (entry.isSymbolicLink()) throw new Error("Symlink in build output");

      if (entry.isDirectory()) await walk(path.join(directory, entry.name), relative);
      else if (entry.isFile()) files.push(relative);
    }
  };

  await walk(source);

  const maps = files.filter((file) => /^\.[a-f0-9]{8}\.json$/.test(file));

  if (maps.length !== 1) throw new Error("Expected one build page map");
  const pages = JSON.parse(await fs.readFile(path.join(source, maps[0]), "utf8"));

  if (typeof pages.index !== "string") throw new Error("Build index is missing");
  for (const file of Object.values(pages)) {
    if (!/^[a-f0-9]{8}\.html$/.test(file) || !files.includes(file))
      throw new Error("Build page map points to a missing page");
  }

  const changed = [];
  const ordered = [...files.filter((file) => !maps.includes(file)), ...maps];

  try {
    for (const file of ordered) {
      const next = await fs.readFile(path.join(source, file));
      const previous = await read(path.join(target, file));

      if (previous?.equals(next)) continue;

      if (previous) await atomic(path.join(backup, file), previous);

      changed.push({ file, previous: Boolean(previous) });
      await atomic(path.join(target, file), next);
    }
  } catch (error) {
    await rollback(target, backup, changed);
    throw error;
  }

  return changed;
}

export async function rollback(target, backup, changes) {
  for (const entry of changes.slice().reverse()) {
    // Extra immutable assets can remain safely. Never erase something a tab may already reference.
    if (entry.previous)
      await atomic(path.join(target, entry.file), await fs.readFile(path.join(backup, entry.file)));
  }
}

export async function deploy(source, target) {
  if (process.platform !== "linux" || process.getuid() !== 0)
    throw new Error("Deployment must run in the server's root installer");

  source = await fs.realpath(source);
  target = await fs.realpath(target);
  if (source === target)
    throw new Error("Use a separate source checkout, not the live production directory");

  const json = async (file) => JSON.parse((await fs.readFile(file, "utf8")).replace(/^\uFEFF/, ""));
  const config = {
    ...(await json(`${target}/servers.json`)),
    ...(await json(`${target}/local.json`))
  };
  const requested = {
    ...(await json(`${source}/servers.json`)),
    ...(await json(`${source}/local.json`))
  };

  if (config.root !== target) throw new Error("Unexpected production root");
  for (const key of ["was", "web", "db", "https", "cluster", "root", "node"])
    if (!isDeepStrictEqual(config[key], requested[key]))
      throw new Error("Server configuration changed; use the installation workflow");

  const secret = await fs.readFile(`${target}/.env`);
  const env = { ...process.env, ...parseEnv(secret.toString("utf8").replace(/^\uFEFF/, "")) };

  env.PATH = `${path.dirname(config.node)}:${process.env.PATH || "/usr/bin:/bin"}`;

  const run = (command, args, capture = false, options = {}) =>
    new Promise((resolve, reject) => {
      const { input, ...rest } = options;
      const process = child.spawn(command, args, {
        cwd: target,
        env,
        stdio: [input === undefined ? "ignore" : "pipe", capture ? "pipe" : "inherit", "pipe"],
        ...rest
      });

      let output = "";
      let detail = "";

      if (capture)
        process.stdout.on("data", (value) => {
          output += value;
        });

      process.stderr.on("data", (value) => {
        detail = (detail + value).slice(-8192);
      });
      if (input !== undefined) {
        process.stdin.on("error", () => {});
        process.stdin.end(input);
      }

      process.once("error", reject);
      process.once("close", (code) =>
        code === 0
          ? resolve(output.trim())
          : reject(new Error(`${command} exited with ${code}${capture ? `: ${detail}` : ""}`))
      );
    });

  const stage = await fs.mkdtemp(path.join(path.dirname(target), ".oanismajor-release-"));
  const backup = await fs.mkdtemp(path.join(path.dirname(target), ".oanismajor-backup-"));
  const unit = "/etc/systemd/system/was@.service";
  const identity = "/etc/systemd/system/was@.service.d/identity.conf";
  const previous = await read(unit);
  const credentials = await read(identity);
  const active = [];

  let changed = [];
  let stopped = false;
  let modules = false;
  let copied = false;
  let installed = false;
  let success = false;

  try {
    console.log("Release: preparing isolated source and dependencies");
    await run("rsync", copy(source, stage));
    await fs.writeFile(`${stage}/.env`, secret, { mode: 0o600 });
    await fs.copyFile(`${target}/local.json`, `${stage}/local.json`);

    const npm = path.join(path.dirname(config.node), "npm");

    await run(npm, ["ci", "--prefer-offline", "--no-audit", "--no-fund"], false, { cwd: stage });
    await run(npm, ["run", "build"], false, { cwd: stage });
    if (!(await fs.readFile(`${target}/.env`)).equals(secret))
      throw new Error("Production environment changed during build; release not published");

    await run("rsync", copy(target, `${backup}/code`));
    if (previous) await fs.writeFile(`${backup}/was.service`, previous);

    if (credentials) await fs.writeFile(`${backup}/identity.conf`, credentials);

    for (const name of ["discovery.service", ...config.was.map((port) => `was@${port}.service`)]) {
      const state = await run(
        "systemctl",
        ["show", name, "--property=ActiveState", "--value"],
        true
      );

      if (["active", "activating", "reloading"].includes(state)) active.push(name);
    }

    console.log("Release: build complete; switching local WAS");
    stopped = true;
    if (active.length) await run("systemctl", ["stop", ...active]);

    copied = true;
    await run("rsync", copy(stage, target));

    if (await read(`${target}/node_modules/.package-lock.json`)) {
      await fs.rename(`${target}/node_modules`, `${backup}/node_modules`);
      modules = true;
    } else {
      const exists = await fs.stat(`${target}/node_modules`).then(
        () => true,
        (error) => {
          if (error.code === "ENOENT") return false;
          throw error;
        }
      );

      if (exists) {
        await fs.rename(`${target}/node_modules`, `${backup}/node_modules`);
        modules = true;
      }
    }

    await fs.rename(`${stage}/node_modules`, `${target}/node_modules`);
    installed = true;

    const privilege = await import(pathToFileURL(`${target}/was/config/privilege.js`).href);

    if (config.was.length) await privilege.setup(config, run);
    const template = await fs.readFile(`${target}/was/was@.service`, "utf8");
    const value = template
      .replaceAll("__ROOT__", target)
      .replaceAll("__NODE__", config.node)
      .replaceAll("__ADDRESS__", config.cluster?.address || "127.0.0.1")
      .replaceAll("__NETWORK__", config.cluster?.network || "")
      .replaceAll("__MOUNT__", `RequiresMountsFor=${target}/storage`);

    await atomic(unit, value);
    await run("systemctl", ["daemon-reload"]);
    if (active.length) await run("systemctl", ["start", ...active]);
    for (const port of config.was)
      if (active.includes(`was@${port}.service`))
        await run(config.node, [`${target}/run.js`, "check", "was", String(port)]);

    if (!(await fs.readFile(`${target}/.env`)).equals(secret))
      throw new Error("Production environment changed before publication");

    changed = await publish(`${stage}/web/dist`, `${target}/web/dist`, `${backup}/dist`);
    await fs.writeFile(
      `${backup}/release.json`,
      JSON.stringify({ source, target, time: Date.now(), active, changed }, null, 2)
    );
    success = true;
    console.log(`Release ready. Previous code retained at ${backup}`);
  } catch (error) {
    if (stopped) {
      try {
        if (active.length) await run("systemctl", ["stop", ...active]);

        await rollback(`${target}/web/dist`, `${backup}/dist`, changed);
        if (copied) await run("rsync", copy(`${backup}/code`, target));

        if (installed) await fs.rm(`${target}/node_modules`, { recursive: true, force: true });

        if (modules) await fs.rename(`${backup}/node_modules`, `${target}/node_modules`);

        if (previous) await atomic(unit, previous);
        else await fs.rm(unit, { force: true });

        if (credentials) await atomic(identity, credentials);
        else await fs.rm(identity, { force: true });

        await run("systemctl", ["daemon-reload"]);
        if (active.length) await run("systemctl", ["start", ...active]);
      } catch {
        throw new Error(
          `Release and automatic rollback failed. Previous code is preserved at ${backup}`
        );
      }
    }
    throw error;
  } finally {
    if (success || !stopped) await fs.rm(stage, { recursive: true, force: true });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (!process.argv[2] || !process.argv[3])
      throw new Error("Source and production root are required");

    await deploy(process.argv[2], process.argv[3]);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
