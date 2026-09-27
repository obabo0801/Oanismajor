import connect from "#db/connect";

const database = connect("runtime");

export default function limit(scope, max, time = 60000) {
  return async (key) => {
    const row = await database.get(
      `
        INSERT INTO runtime.limiter(scope, key, count, expires)
        VALUES (?, ?, 1, clock_timestamp() + ?::interval)
        ON CONFLICT(scope, key)
        DO UPDATE SET count = CASE WHEN limiter.expires <= clock_timestamp() THEN 1 ELSE limiter.count + 1 END,
          expires = CASE WHEN limiter.expires <= clock_timestamp() THEN excluded.expires ELSE limiter.expires END
        RETURNING count
      `,
      [scope, String(key), `${time} milliseconds`]
    );

    return row.count <= max;
  };
}
