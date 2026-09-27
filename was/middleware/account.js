import { get } from "#db";

export default async (req, res, next) => {
  const user = await get(
    `
      SELECT 1
      FROM account.profile
      WHERE uid = ?
        AND verified
        AND deletion IS NULL
        AND erased = 0
    `,
    [req.uid]
  );

  if (!user) return res.status(403).end();

  next();
};
