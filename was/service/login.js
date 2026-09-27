import * as db from "#db";
import * as session from "#service/session";
import * as deletion from "#service/account";
import * as events from "#service/events";

export const cookie = { ...session.cookie, maxAge: 10 * 60 * 1000 };
export const clear = { ...cookie, maxAge: undefined };
export const finish = (res, popup, result) =>
  res.redirect(
    popup
      ? `/?login=${result}&popup=1`
      : ["error", "unavailable", "unsupported"].includes(result)
        ? `/login?login=${result}`
        : result === "cancel"
          ? "/login"
          : result === "pending"
            ? "/?login=pending"
            : "/"
  );

export async function complete(req, res, uid) {
  const pending = await deletion.challenge(uid);

  if (pending) {
    res.cookie(session.recovery, pending, cookie);
    return "pending";
  }

  if (uid !== req.uid) {
    const previous = await db.get(
      `
        SELECT verified
        FROM account.profile
        WHERE uid = ?
      `,
      [req.uid]
    );

    if (previous && !previous.verified) await session.remember(res, req.uid, session.anonymous);
  }

  if (!(await session.remember(res, uid))) return "error";

  res.clearCookie(session.recovery, clear);
  events.broadcast("online");
  return "success";
}
