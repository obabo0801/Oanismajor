const offline = "_offline";
const page = "/offline";
const prepare = async (locale, content) => {
  const response = await fetch(page, { cache: "no-store", headers: { "x-pwa-cache": "true" } });

  if (!response.ok) {
    throw new Error();
  }

  const html = await response.clone().text();
  const files = new Set(
    [...html.matchAll(/\b(?:src|href)=["']([^"']+)["']/g)]
      .map(([, file]) => new URL(file, self.location.origin))
      .filter((url) => url.origin === self.location.origin)
      .map((url) => `${url.pathname}${url.search}`)
  );

  if (locale && content) {
    const url = new URL(locale, self.location.origin);

    if (url.origin !== self.location.origin) {
      throw new Error();
    }

    const localeResponse = await fetch(url, { cache: "no-store" });

    if (!localeResponse.ok) {
      throw new Error();
    }

    const body = await localeResponse.json();
    const value = body?.[content];

    if (typeof value !== "string") {
      throw new Error();
    }

    const languages = JSON.parse(atob(value));
    const base = url.pathname.replace(/\/$/, "");

    files.add(base);
    Object.values(languages).forEach((file) => {
      files.add(`${base}/${file}`);
    });
  }

  const cache = await caches.open(offline);

  await cache.put(page, response);
  await cache.addAll([...files]);

  const keep = new Set([page, ...files]);
  const saved = await cache.keys();

  await Promise.all(
    saved.map((request) => {
      const url = new URL(request.url);
      const file = `${url.pathname}${url.search}`;

      return keep.has(file) ? true : cache.delete(request);
    })
  );
};

const openDatabase = (name = "_sync") =>
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

const requests = async (name = "_sync") => {
  const database = await openDatabase(name);
  const store = name === "sync" ? "requests" : "_request";

  return new Promise((resolve, reject) => {
    const transaction = database.transaction(store);
    const request = transaction.objectStore(store).getAll();

    transaction.oncomplete = () => {
      database.close();
      resolve(request.result.map((item) => ({ ...item, source: name })));
    };

    const fail = () => {
      const error = transaction.error || new Error();

      database.close();
      reject(error);
    };

    transaction.onerror = fail;
    transaction.onabort = fail;
  });
};

const removeRequest = async (id, name) => {
  const database = await openDatabase(name);
  const store = name === "sync" ? "requests" : "_request";

  return new Promise((resolve, reject) => {
    const transaction = database.transaction(store, "readwrite");

    transaction.objectStore(store).delete(id);
    transaction.oncomplete = () => {
      database.close();
      resolve();
    };

    const fail = () => {
      const error = transaction.error || new Error();

      database.close();
      reject(error);
    };

    transaction.onerror = fail;
    transaction.onabort = fail;
  });
};

const migrate = async () => {
  const queue = await requests("sync");

  if (!queue.length) return;

  const database = await openDatabase();

  try {
    await new Promise((resolve, reject) => {
      const transaction = database.transaction("_request", "readwrite");
      const store = transaction.objectStore("_request");

      for (const item of queue) {
        store.put({ id: `legacy:${item.id}`, url: item.url, options: item.options });
      }

      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error || new Error("Queue migration failed"));
    });
  } finally {
    database.close();
  }

  for (const item of queue) await removeRequest(item.id, "sync");
};

const fetchApi = async (request) => {
  const cache = await caches.open(offline);
  const saved = await cache.match(request);

  try {
    const response = await fetch(request);

    if (response.ok && saved) {
      await cache.put(request, response.clone());
    }

    if (response.status >= 500 && saved) {
      return saved;
    }

    return response;
  } catch {
    return saved || Response.error();
  }
};

let syncing;

const synchronize = () => {
  syncing ??= (async () => {
    const read = async () => {
      await migrate();

      const queue = await requests();
      const legacy = queue.filter((item) => typeof item.id === "string");

      legacy.sort((a, b) => Number(a.id.split(":")[1]) - Number(b.id.split(":")[1]));

      return [...legacy, ...queue.filter((item) => typeof item.id === "number")];
    };

    for (let queue = await read(); queue.length; queue = await read()) {
      for (const item of queue) {
        const response = await fetch(item.url, item.options);

        if (response.status < 500) {
          await removeRequest(item.id, item.source);
          continue;
        }

        throw new Error();
      }
    }
  })().finally(() => {
    syncing = undefined;
  });

  return syncing;
};

self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      if ((await caches.keys()).includes("offline")) {
        const previous = await caches.open("offline");
        const current = await caches.open(offline);

        for (const request of await previous.keys()) {
          if (await current.match(request)) continue;

          const response = await previous.match(request);

          if (response) await current.put(request, response);
        }

        await caches.delete("offline");
      }

      await migrate();
      await self.clients.claim();
    })()
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;

  if (request.method !== "GET") {
    return;
  }

  const url = new URL(request.url);

  if (url.origin !== self.location.origin) {
    return;
  }

  if (url.pathname === "/manifest.json") {
    event.respondWith(fetch(request, { cache: "no-store" }));

    return;
  }

  if (url.pathname === page) {
    event.respondWith(caches.match(page).then((response) => response || fetch(request)));

    return;
  }

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then(async (response) => {
          const down = [502, 503, 504].includes(response.status);

          if (!down) {
            return response;
          }

          return (await caches.match(page)) || response;
        })
        .catch(async () => (await caches.match(page)) || Response.error())
    );

    return;
  }

  if (url.pathname.startsWith("/api/")) {
    event.respondWith(request.cache === "no-store" ? fetch(request) : fetchApi(request));

    return;
  }

  event.respondWith(
    caches
      .match(request)
      .then((response) => response || fetch(request))
      .catch(() => new Response(null, { status: 503 }))
  );
});

self.addEventListener("sync", (event) => {
  if (event.tag === "api-sync") {
    event.waitUntil(synchronize());
  }
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "sync") {
    event.waitUntil(synchronize());
  }

  if (event.data?.type === "offline") {
    event.waitUntil(prepare(event.data.locale, event.data.content));
  }
});

const sendToast = async (data) => {
  const pages = await self.clients.matchAll({ type: "window", includeUncontrolled: true });

  pages.forEach((page) => {
    page.postMessage({ type: "notify", data });
  });
};

self.addEventListener("push", (event) => {
  let data = { title: "", body: "", image: "", url: "/" };

  if (event.data) {
    try {
      data = { ...data, ...event.data.json() };
    } catch {
      data.body = event.data.text();
    }
  }

  const { title, body, image, url, tag } = data;

  event.waitUntil(
    Promise.all([
      self.registration.showNotification(title, {
        body,
        icon: "/icons/192.png",
        ...(image && { image }),
        ...(tag && { tag }),
        data: { url }
      }),
      sendToast(data)
    ])
  );
});

const openPage = async (path) => {
  const target = new URL(path || "/", self.location.origin);

  if (target.origin !== self.location.origin) {
    target.href = self.location.origin;
  }

  if (target.searchParams.has("message")) {
    target.searchParams.set("push", "1");
  }

  const [client] = await self.clients.matchAll({ type: "window", includeUncontrolled: true });

  if (!client) {
    return self.clients.openWindow(target.href);
  }

  const moved = await client.navigate(target.href);

  return (moved || client).focus();
};

self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  event.waitUntil(openPage(event.notification.data?.url));
});
