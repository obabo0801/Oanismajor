import { initializeApp } from "firebase-admin/app";
import { applicationDefault } from "firebase-admin/app";
import { getMessaging } from "firebase-admin/messaging";

const projectId = process.env.GOOGLE_CLOUD_PROJECT?.trim();

export const enabled = Boolean(projectId);

const errors = new Set([
  "messaging/invalid-registration-token",
  "messaging/registration-token-not-registered",
  "messaging/installation-id-not-registered"
]);

let client;

const connect = () => {
  const app = initializeApp({ credential: applicationDefault(), projectId });

  return getMessaging(app);
};

export const invalid = (error) => errors.has(error?.code);

export default async function send(fids, value) {
  if (!enabled || !fids.length) {
    return [];
  }

  client ||= connect();

  const { title, body, image, url } = value;
  const data = { title, body, image, url };
  const results = [];

  for (let index = 0; index < fids.length; index += 500) {
    const targets = fids.slice(index, index + 500);

    try {
      const response = await client.sendEachForMulticast({
        fids: targets,
        data,
        android: { priority: "high", ttl: 300_000 }
      });

      response.responses.forEach((result, offset) => {
        results.push({ fid: targets[offset], ...result });
      });
    } catch (error) {
      targets.forEach((fid) => {
        results.push({ fid, success: false, error });
      });
    }
  }

  return results;
}
