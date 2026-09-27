export default function once() {
  const pending = new Set();

  return async (key, run) => {
    if (pending.has(key)) {
      return false;
    }

    pending.add(key);

    try {
      return await run();
    } finally {
      pending.delete(key);
    }
  };
}
