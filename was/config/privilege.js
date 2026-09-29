import * as fs from "node:fs/promises";
import path from "node:path";
import { parseEnv } from "node:util";

const number = 7341;
const name = "oanismajor";

export async function setup(config, execute) {
  if (process.platform !== "linux" || process.getuid() !== 0)
    throw new Error("Service identity setup requires the server's root installer");

  const root = await fs.realpath(config.root);
  const env = parseEnv((await fs.readFile(`${root}/.env`, "utf8")).replace(/^\uFEFF/, ""));
  const lookup = (kind, key) =>
    execute("getent", [kind, String(key)], true).then(
      (value) => value.split(":"),
      (error) => {
        if (/exited with 2(?:\D|$)|^getent: 2$/.test(error.message)) return null;
        throw error;
      }
    );

  for (const kind of ["group", "passwd"]) {
    const existing = await lookup(kind, name);
    const occupied = await lookup(kind, number);

    if ((existing && Number(existing[2]) !== number) || (occupied && occupied[0] !== name))
      throw new Error("Service UID/GID 7341 is occupied; no identity was replaced");

    if (!existing) {
      if (kind === "group") await execute("groupadd", ["--gid", String(number), name]);
      else
        await execute("useradd", [
          "--system",
          "--uid",
          String(number),
          "--gid",
          String(number),
          "--no-create-home",
          "--home-dir",
          "/nonexistent",
          "--shell",
          "/usr/sbin/nologin",
          name
        ]);
    }

    if (kind === "passwd" && existing && Number(existing[3]) !== number)
      throw new Error("Service account primary group is unexpected");
  }

  const data = `${root}/storage`;
  const primary =
    !config.cluster?.storage || config.cluster.storage.split(":")[0] === config.cluster.address;

  if (primary) {
    const stat = await fs.lstat(data);

    if (!stat.isDirectory() || stat.isSymbolicLink())
      throw new Error("Unexpected storage directory");

    await execute("chgrp", ["-R", "--no-dereference", String(number), data]);
    await execute("find", [
      "-P",
      data,
      "-xdev",
      "-type",
      "d",
      "-exec",
      "chmod",
      "g+rwx,g+s",
      "{}",
      "+"
    ]);
    await execute("find", ["-P", data, "-xdev", "-type", "f", "-exec", "chmod", "g+rw", "{}", "+"]);
  }

  await fs.chmod(root, 0o755);
  for (const file of [".env", "local.json"]) {
    await fs.chown(`${root}/${file}`, 0, number);
    await fs.chmod(`${root}/${file}`, 0o640);
  }

  // Code is readable but not writable by the service. Do not recursively change private configuration.
  for (const folder of ["was", "web", "lib", "db", "node_modules"]) {
    await execute("chmod", ["-R", "a+rX,go-w", `${root}/${folder}`]);
  }
  for (const file of ["package.json", "servers.json", "run.js"])
    await fs.chmod(`${root}/${file}`, 0o644);

  const dropin = "/etc/systemd/system/was@.service.d";
  const credential =
    env.GOOGLE_APPLICATION_CREDENTIALS ||
    path.join(
      env.CLOUDSDK_CONFIG || `${root}/.config/gcloud`,
      "application_default_credentials.json"
    );

  let content = "[Service]\n";

  try {
    const source = await fs.realpath(path.resolve(root, credential));

    if (!(await fs.stat(source)).isFile()) throw new Error("Google credential must be a file");
    const quoted = source.replaceAll("%", "%%").replaceAll("\\", "\\\\").replaceAll('"', '\\"');

    if (/[\r\n\0]/.test(quoted)) throw new Error("Invalid credential pathname");

    content += `LoadCredential="google.json:${quoted}"\nEnvironment=GOOGLE_APPLICATION_CREDENTIALS=%d/google.json\n`;
  } catch (error) {
    if (error.code !== "ENOENT" || env.GOOGLE_APPLICATION_CREDENTIALS) throw error;
  }

  await fs.mkdir(dropin, { recursive: true });
  await fs.writeFile(`${dropin}/identity.conf`, content, { mode: 0o644 });
  await execute("runuser", ["-u", name, "--", "test", "-r", `${root}/.env`]);
  await execute("runuser", ["-u", name, "--", "test", "-w", data]);
  for (const folder of ["upload", "stt", "tts", "log"]) {
    try {
      await fs.access(`${data}/${folder}`);
      await execute("runuser", ["-u", name, "--", "test", "-w", `${data}/${folder}`]);
    } catch (error) {
      if (error.code !== "ENOENT")
        throw new Error(
          "Storage permissions are not ready; update the storage-owning server first"
        );
    }
  }
}
