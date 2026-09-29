import { GoogleAuth } from "google-auth-library";

export default async function create(Type, mode) {
  const key = process.env.GOOGLE_APPLICATION_CREDENTIALS?.trim();

  if (mode === "json" && !key)
    throw new Error("GOOGLE_APPLICATION_CREDENTIALS is required for json mode");

  const auth = new GoogleAuth({ ...(key && { keyFilename: key }), scopes: Type.scopes });

  await auth.getClient();

  const client = new Type({ auth });

  try {
    await client.initialize();
    return client;
  } catch (error) {
    try {
      await client.close();
    } catch {}

    throw error;
  }
}
