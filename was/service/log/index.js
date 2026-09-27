import connect from "#db/connect";

const offset = 9 * 60 * 60 * 1000;

export const now = () => new Date(Date.now() + offset).toISOString().slice(0, 19).replace("T", " ");

export default function log() {
  const connection = connect("audit");

  return (query, params = []) => connection.run(query, params);
}
