import { key } from "#config/uid";
import * as session from "#service/session";

export default async (req, res, next) => {
  session.clear(req, res);

  const user = await session.read(req.signedCookies?.[key]);

  req.uid = user?.uid || "";

  next();
};
