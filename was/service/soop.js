import * as config from "#config/soop";
import * as db from "#db";
import * as consent from "#shared/consent";
import * as deletion from "#service/account";
import * as evidence from "#service/evidence";

const fail = () => {
  throw new Error("SOOP authentication failed");
};

async function request(path, data) {
  if (!config.enabled) fail();
  try {
    const response = await fetch(`https://openapi.sooplive.com/${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: new URLSearchParams(data),
      redirect: "error",
      signal: AbortSignal.timeout(10000)
    });

    if (!response.ok) fail();
    return await response.json();
  } catch {
    fail();
  }
}

async function token(data) {
  const value = await request("auth/token", {
    client_id: config.id,
    client_secret: config.secret,
    ...data
  });

  if (!value || typeof value !== "object") fail();
  const scopes = typeof value.scope === "string" ? value.scope.split(/\s+/) : [];

  if (
    typeof value.access_token !== "string" ||
    !value.access_token ||
    typeof value.refresh_token !== "string" ||
    !value.refresh_token ||
    typeof value.token_type !== "string" ||
    value.token_type.toLowerCase() !== "bearer" ||
    !Number.isSafeInteger(value.expires_in) ||
    value.expires_in <= 0 ||
    !config.scope.split(" ").every((scope) => scopes.includes(scope))
  )
    fail();

  return {
    access: value.access_token,
    refresh: value.refresh_token,
    expires: Date.now() + value.expires_in * 1000
  };
}

export const refresh = (value) => {
  if (typeof value !== "string" || !value) fail();
  return token({ grant_type: "refresh_token", refresh_token: value });
};

export function picture(value) {
  if (typeof value !== "string" || !value) return null;
  try {
    const url = new URL(value.startsWith("//") ? `https:${value}` : value);

    return url.protocol === "https:" &&
      url.hostname === "profile.img.sooplive.com" &&
      !url.username &&
      !url.password &&
      !url.port
      ? url.href
      : null;
  } catch {
    return null;
  }
}

export async function verify(code, redirect) {
  if (!config.redirects.includes(redirect) || typeof code !== "string" || !code) fail();
  const credentials = await token({
    grant_type: "authorization_code",
    code,
    redirect_uri: redirect
  });
  const data = { access_token: credentials.access };
  const identity = await request("validate/live/status", data);
  const profile = await request("user/stationinfo", data);
  const id = identity?.data?.user_id;

  if (
    identity?.result !== 1 ||
    profile?.result !== 1 ||
    typeof id !== "string" ||
    !/^[a-zA-Z0-9_-]{1,100}$/.test(id) ||
    typeof profile.data?.user_nick !== "string" ||
    !profile.data.user_nick.trim()
  )
    fail();

  return {
    id,
    name: profile.data.user_nick.trim().slice(0, 100),
    avatar: picture(profile.data.profile_image)
  };
}

export async function connect(uid, account, link = false) {
  let existing = await db.get(
    `
      SELECT uid, deletion
      FROM account.profile
      WHERE soop = ?
    `,
    [account.id]
  );

  if (existing?.deletion && existing.deletion <= Date.now()) {
    await deletion.finalize(existing.uid);
    existing = null;
  }

  const selected = await db.transaction(async () => {
    const current = await db.get(
      `
        SELECT id, verified, soop, deletion, erased
        FROM account.profile
        WHERE uid = ?
      `,
      [uid]
    );

    if (!current || current.deletion || current.erased || (link && !current.verified)) fail();
    const owner = await db.get(
      `
        SELECT uid
        FROM account.profile
        WHERE soop = ?
      `,
      [account.id]
    );

    if (owner) {
      if (link && owner.uid !== uid) fail();
      return owner.uid;
    }

    if (current.soop || (current.verified && !link)) fail();

    if (link) {
      await db.run(
        `
        UPDATE account.profile
        SET soop = ?
        WHERE uid = ?
      `,
        [account.id, uid]
      );
    } else {
      const used = await db.get(
        `
          SELECT 1
          FROM account.profile
          WHERE lower(name) = lower(?) AND uid <> ?
        `,
        [account.name, uid]
      );
      const name = used ? `${account.name.slice(0, 90)} ${current.id.slice(0, 8)}` : account.name;

      await db.run(
        `
          UPDATE account.profile
          SET soop = ?, name = ?, avatar = ?, setup = 1, consent = ?, draft = NULL
          WHERE uid = ?
        `,
        [
          account.id,
          name,
          account.avatar,
          JSON.stringify({
            terms: consent.terms,
            privacy: consent.privacy,
            time: new Date().toISOString()
          }),
          uid
        ]
      );
    }
    return uid;
  });

  if (!existing?.deletion) await evidence.match(selected, account.id, "soop");
  return selected;
}
