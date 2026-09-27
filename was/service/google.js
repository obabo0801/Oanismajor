import * as db from "#db";
import * as google from "#config/google";
import * as consent from "#shared/consent";
import * as deletion from "#service/account";
import * as evidence from "#service/evidence";

export const verify = async (code, verifier, nonce, redirect) => {
  if (!google.redirects.includes(redirect)) throw new Error("Invalid Google redirect");
  const { tokens } = await google.client.getToken({
    code,
    codeVerifier: verifier,
    redirect_uri: redirect
  });

  const ticket = await google.client.verifyIdToken({
    idToken: tokens.id_token,
    audience: google.id
  });
  const user = ticket.getPayload();

  if (!user?.sub || user.nonce !== nonce || !user.email_verified)
    throw new Error("Invalid Google identity");

  return user;
};

export const connect = async (uid, account) => {
  let existing = await db.get(
    `
      SELECT uid, deletion
      FROM account.profile
      WHERE google = ?
    `,
    [account.sub]
  );

  if (existing?.deletion && existing.deletion <= Date.now()) {
    await deletion.finalize(existing.uid);
    existing = null;
  }

  if (existing) {
    if (!existing.deletion) await evidence.match(existing.uid, account.sub);

    await db.run(
      `
        UPDATE account.profile
        SET email = ?
        WHERE uid = ?
          AND deletion IS NULL
      `,
      [account.email, existing.uid]
    );

    return existing.uid;
  }

  const user = await db.get(
    `
      SELECT id, verified
      FROM account.profile
      WHERE uid = ?
    `,
    [uid]
  );

  if (!user || user.verified) throw new Error("Account cannot be linked");
  const initial = (account.name || "").trim().slice(0, 100);
  const used = await db.get(
    `
      SELECT 1
      FROM account.profile
      WHERE lower(name) = lower(?)
        AND uid <> ?
    `,
    [initial, uid]
  );
  const name = used ? `${initial} ${user.id.slice(0, 8)}` : initial || null;
  const picture =
    typeof account.picture === "string" &&
    /^https:\/\/[^/]+\.googleusercontent\.com\//.test(account.picture)
      ? account.picture
      : null;

  try {
    const result = await db.run(
      `
        UPDATE account.profile
        SET google = ?, email = ?, name = ?, avatar = ?, setup = 1,
          consent = ?, draft = NULL
        WHERE uid = ?
          AND NOT verified
          AND deletion IS NULL
          AND erased = 0
      `,
      [
        account.sub,
        account.email,
        name,
        picture,
        JSON.stringify({
          terms: consent.terms,
          privacy: consent.privacy,
          time: new Date().toISOString()
        }),
        uid
      ]
    );

    if (!result.changes) throw new Error("Account changed during login");

    await evidence.match(uid, account.sub);

    return uid;
  } catch (error) {
    if (error.code !== "23505") throw error;
    const linked = await db.get(
      `
        SELECT uid
        FROM account.profile
        WHERE google = ?
      `,
      [account.sub]
    );

    if (!linked) throw error;

    await evidence.match(linked.uid, account.sub);

    return linked.uid;
  }
};
