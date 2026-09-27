const open = (name = "_sync") =>
  new Promise((resolve, reject) => {
    const request = indexedDB.open(name, 1);
    const store = name === "sync" ? "requests" : "_request";

    request.onupgradeneeded = () => {
      const database = request.result;

      if (!database.objectStoreNames.contains(store)) {
        database.createObjectStore(store, { keyPath: "id", autoIncrement: true });
      }
    };

    request.onsuccess = () => {
      resolve(request.result);
    };

    request.onerror = () => {
      reject(request.error);
    };
  });

const write = async (action, name = "_sync") => {
  const database = await open(name);
  const store = name === "sync" ? "requests" : "_request";

  return new Promise((resolve, reject) => {
    let finished = false;

    const finish = (error) => {
      if (finished) return;

      finished = true;
      database.close();
      if (error) reject(error);
      else resolve();
    };

    try {
      const transaction = database.transaction(store, "readwrite");
      const fail = () => finish(transaction.error || new Error("Request queue update failed"));

      transaction.oncomplete = () => finish();
      transaction.onerror = fail;
      transaction.onabort = fail;
      action(transaction.objectStore(store));
    } catch (error) {
      finish(error);
    }
  });
};

const save = (value) => write((store) => store.add(value));

export const clear = async () => {
  if (!("indexedDB" in window)) return true;

  try {
    await write((store) => store.clear());
    await write((store) => store.clear(), "sync");
    return true;
  } catch {
    return false;
  }
};

export default async function sync(path, { data, ...options } = {}) {
  const request = {
    url: `/api${path}`,
    options: {
      ...options,
      ...(data !== undefined && {
        headers: { "Content-Type": "application/json", ...options.headers },
        body: JSON.stringify(data)
      })
    }
  };

  try {
    const response = await fetch(request.url, request.options);

    if (response.ok || response.status < 500) {
      return response;
    }
  } catch {}

  await save(request);

  try {
    const registration = await navigator.serviceWorker?.getRegistration();

    if (registration?.active) {
      if ("sync" in registration) {
        try {
          await registration.sync.register("api-sync");
        } catch {
          registration.active.postMessage({ type: "sync" });
        }
      } else {
        registration.active.postMessage({ type: "sync" });
      }
    }
  } catch {}

  return null;
}
