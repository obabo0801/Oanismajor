import webpush from "web-push";
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

        await webpush.sendNotification(JSON.parse(row.data), JSON.stringify(value), {
          TTL: 300,
          timeout: 5000
        });

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
