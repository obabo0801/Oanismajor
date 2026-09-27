import * as role from "#shared/role";
import { get } from "#db";
import uid from "#config/uid";

const find = async (req) => {
  const id = uid(req);

  if (!id) {
    return null;
  }

  return get(
    `
      SELECT uid, role
      FROM account.profile
      WHERE uid = ?
    `,
    [id]
  );
};

export const allowed = async (req) => role.staff((await find(req))?.role);

export default async function admin(req, res, next) {
  const user = await find(req);

  if (!role.staff(user?.role)) {
    return res.status(403).end();
  }

  req.user = user;
  next();
}
