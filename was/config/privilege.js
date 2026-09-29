import * as fs from "node:fs/promises";

const file = "/etc/systemd/system/was@.service.d/identity.conf";

export const setup = () => fs.rm(file, { force: true });
