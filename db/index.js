import { AsyncLocalStorage } from "node:async_hooks";
import { setTimeout as delay } from "node:timers/promises";
import connect, * as database from "#db/connect";
import schema, { prepare } from "#db/schema";

const connection = connect();
const context = new AsyncLocalStorage();

let setup;
let waiting = false;

while (!setup) {
  try {
    setup = await database.lease();
  } catch (error) {
    if (!database.unavailable(error)) throw error;

    if (!waiting) console.error("Database unavailable; waiting for connection");

    waiting = true;
    await delay(3000);
  }
}
if (waiting) console.log("Database connection restored");

try {
  await setup.exec(`
    BEGIN;
    SET LOCAL synchronous_commit = local;
    SELECT pg_advisory_xact_lock(734100);
  `);

  await prepare(setup, schema);
  await setup.exec(`
    COMMIT
  `);
} catch (error) {
  await setup.exec(`
    ROLLBACK
  `);

  throw error;
} finally {
  setup.release();
}

export const get = (...args) => (context.getStore() || connection).get(...args);
export const run = (...args) => (context.getStore() || connection).run(...args);
export const all = (...args) => (context.getStore() || connection).all(...args);
export const read = (work) =>
  context.getStore() ? work() : database.read((client) => context.run(client, work));
export const transaction = async (work) => {
  if (context.getStore()) return work();
  const client = await database.lease();

  try {
    await client.exec(`
      BEGIN;
      SELECT pg_advisory_xact_lock(734106);
    `);

    const result = await context.run(client, work);

    await client.exec(`
      SET LOCAL statement_timeout = 0
    `);

    await client.exec(`
      COMMIT
    `);

    return result;
  } catch (error) {
    await client.exec(`
      ROLLBACK
    `);

    throw error;
  } finally {
    client.release();
  }
};
