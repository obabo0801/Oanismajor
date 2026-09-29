import webpush from "web-push";
import { Agent } from "node:https";
import { ECDH } from "node:crypto";
import { resolve } from "#service/metadata";
import * as db from "#db";
import * as settings from "#shared/settings";

const key = process.env.VAPID_PUBLIC_KEY;
const secret = process.env.VAPID_PRIVATE_KEY;
const subject = process.env.VAPID_SUBJECT;

export const enabled = Boolean(key && secret && subject);

if (enabled) {
  webpush.setVapidDetails(subject, key, secret);
}

export { key };
export default webpush;

const invalid = () => {
  throw Object.assign(new Error("Invalid push subscription"), { status: 400 });
};

export const validate = (value) => {
  if (typeof value?.endpoint !== "string" || value.endpoint.length > 4096) invalid();

  let url;

  try {
    url = new URL(value.endpoint);
  } catch {
    invalid();
  }

  if (url.protocol !== "https:" || url.username || url.password || url.hash || url.port) invalid();

  const keys = {};

  for (const [name, length] of [
    ["auth", 16],
    ["p256dh", 65]
  ]) {
    const text = value.keys?.[name];

    if (typeof text !== "string" || !/^[A-Za-z0-9_-]+={0,2}$/.test(text) || text.length > 90)
      invalid();

    const data = Buffer.from(text, "base64url");

    if (data.length !== length || data.toString("base64url") !== text.replace(/=+$/, "")) invalid();

    if (name === "p256dh") {
      try {
        if (data[0] !== 4) invalid();

        ECDH.convertKey(data, "prime256v1");
      } catch {
        invalid();
      }
    }

    keys[name] = data.toString("base64url");
  }

  return { endpoint: url.href, keys };
};

export async function destination(value) {
  const subscription = validate(value);
  const result = await resolve(subscription.endpoint).catch((error) => {
    if (["Private URL", "Unsupported URL"].includes(error.message)) invalid();

    throw Object.assign(new Error("Push destination unavailable"), { status: 503 });
  });

  return { subscription, address: result.address };
}

export const send = async (rows, value) => {
  let sent = 0;
  let failed = 0;

  await Promise.all(
    rows.map(async (row) => {
      try {
        const target = await db.get(
          `
            SELECT push.web.active, push.web.connected, account.profile.settings
            FROM push.web
            JOIN account.profile ON account.profile.uid = push.web.uid
            WHERE endpoint = ?
              AND account.profile.deletion IS NULL
              AND account.profile.erased = 0
          `,
          [row.endpoint]
        );
        const options = settings.read(target?.settings);

        if (!target?.active || !target.connected || !options.notification || !options.web) return;

        const { subscription, address } = await destination(JSON.parse(row.data));
        const agent = new Agent({
          keepAlive: false,
          rejectUnauthorized: true,
          lookup: (_, options, done) =>
            done(
              null,
              options.all ? [{ address, family: 4 }] : address,
              options.all ? undefined : 4
            )
        });

        try {
          await webpush.sendNotification(subscription, JSON.stringify(value), {
            TTL: 300,
            timeout: 5000,
            agent
          });
        } finally {
          agent.destroy();
        }

        sent += 1;
      } catch (error) {
        if ([404, 410].includes(error.statusCode)) {
          await db.run(
            `
              DELETE
              FROM push.web
              WHERE endpoint = ?
            `,
            [row.endpoint]
          );

          return;
        }

        failed += 1;
      }
    })
  );

  return { sent, failed };
};
