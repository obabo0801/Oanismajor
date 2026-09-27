import * as fs from "node:fs/promises";
import { BlockList, isIPv4 } from "node:net";

export async function setup(config, execute) {
  if (!config.cluster?.storage) throw new Error("cluster.storage is required");

  const [host, source] = config.cluster.storage.split(":");
  const [subnet, prefix] = config.cluster.network.split("/");
  const network = new BlockList();

  network.addSubnet(subnet, Number(prefix), "ipv4");
  if (!isIPv4(host) || !network.check(host, "ipv4") || !/^(\/[\w.-]+)+$/.test(source))
    throw new Error("Invalid shared storage address");

  const target = `${config.root}/storage`;
  const primary = host === config.cluster.address;
  const gateway = async () => {
    const template = await fs.readFile(new URL("../../web/storage.conf", import.meta.url), "utf8");

    const value = template
      .replaceAll("__ADDRESS__", primary ? host : "127.0.0.2")
      .replaceAll("__NETWORK__", primary ? config.cluster.network : "127.0.0.0/8")
      .replaceAll("__UPSTREAM__", primary ? "127.0.0.2:20490" : `${host}:2049`);

    await fs.writeFile("/etc/oanismajor/storage.conf", value);
    await fs.writeFile(
      "/etc/systemd/system/storage.service",
      (await fs.readFile(new URL("../../web/storage.service", import.meta.url), "utf8")).replaceAll(
        "__DEPENDENCY__",
        primary ? "Requires=nfs-server.service\nAfter=nfs-server.service" : ""
      )
    );

    await execute("/usr/sbin/nginx", ["-t", "-c", "/etc/oanismajor/storage.conf"]);

    await execute("systemctl", ["daemon-reload"]);
    await execute("systemctl", ["enable", "storage.service"]);
    await execute("systemctl", ["reload-or-restart", "storage.service"]);
  };

  let changed = false;

  for (const suffix of ["timer", "service"]) {
    const name = `storage-replica.${suffix}`;
    const file = `/etc/systemd/system/${name}`;

    try {
      await fs.access(file);
    } catch (error) {
      if (error.code === "ENOENT") continue;
      throw error;
    }
    await execute("systemctl", ["disable", "--now", name]);
    await fs.unlink(file);
    changed = true;
  }
  if (changed) await execute("systemctl", ["daemon-reload"]);

  await fs.mkdir(target, { recursive: true });
  if (primary) {
    if (source !== target) throw new Error("Local storage must match the project storage path");

    await execute("test", ["-x", "/usr/sbin/exportfs"], true);
    await fs.mkdir("/etc/exports.d", { recursive: true });
    await fs.mkdir("/etc/nfs.conf.d", { recursive: true });
    await fs.writeFile(
      "/etc/exports.d/oanismajor.exports",
      `${target} 127.0.0.0/8(rw,sync,no_subtree_check,no_root_squash,insecure)\n`
    );

    await fs.writeFile(
      "/etc/nfs.conf.d/oanismajor.conf",
      "[nfsd]\nhost=127.0.0.2\nport=20490\nvers3=n\nvers4=y\nudp=n\n"
    );

    await execute("systemctl", ["enable", "--now", "nfs-server.service"]);
    await execute("/usr/sbin/exportfs", ["-ra"]);
    await gateway();

    try {
      await fs.readFile("/etc/systemd/system/replication.timer");
      await execute("systemctl", ["disable", "--now", "replication.timer", "replication.service"]);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }

    return "";
  }

  let mounted = "";

  try {
    mounted = await execute("findmnt", ["-rn", "-M", target, "-o", "SOURCE"], true);
  } catch {}
  if (mounted && mounted !== `127.0.0.2:${source}`)
    throw new Error("A different storage source is already mounted");

  if (!mounted && (await fs.readdir(target)).length)
    throw new Error("Move or back up local storage before mounting the shared directory");

  const unit = await execute("systemd-escape", ["--path", "--suffix=mount", target], true);
  const file = `/etc/systemd/system/${unit}`;
  const value = `[Unit]\nDescription=oanismajor shared storage\nRequires=storage.service\nAfter=storage.service\n\n[Mount]\nWhat=127.0.0.2:${source}\nWhere=${target}\nType=nfs4\nOptions=rw,hard,vers=4.2,_netdev\nTimeoutSec=30\n\n[Install]\nWantedBy=multi-user.target\n`;

  try {
    const previous = await fs.readFile(file, "utf8");

    if (mounted && previous !== value)
      throw new Error("Stop WAS and unmount storage before changing it");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  if (mounted) {
    const previous = await fs.readFile("/etc/oanismajor/storage.conf", "utf8");

    if (!previous.includes(`proxy_pass ${host}:2049;`))
      throw new Error("Unmount shared storage before changing its server");
  }

  const replica = `${config.root}/replica/storage`;

  await fs.mkdir(replica, { recursive: true });
  await gateway();
  await fs.writeFile(file, value);
  await fs.writeFile(
    "/etc/systemd/system/replication.service",
    (await fs.readFile(new URL("../../web/replication/storage.service", import.meta.url), "utf8"))
      .replaceAll("__SOURCE__", target)
      .replaceAll("__TARGET__", replica)
  );

  await fs.writeFile(
    "/etc/systemd/system/replication.timer",
    await fs.readFile(new URL("../../web/replication/storage.timer", import.meta.url), "utf8")
  );

  await execute("systemctl", ["daemon-reload"]);
  await execute("systemctl", ["enable", "--now", unit]);
  await execute("systemctl", ["start", "replication.service"]);
  await execute("systemctl", ["enable", "--now", "replication.timer"]);
  return `RequiresMountsFor=${target}`;
}
