import * as context from "#common/chatting/current";
import api from "#common/api";

const wait = (delay, signal) =>
  new Promise((resolve) => {
    if (signal?.aborted) return resolve(false);
    let timer;

    const finish = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", finish);
      resolve(!signal?.aborted);
    };

    timer = setTimeout(finish, delay);

    signal?.addEventListener("abort", finish, { once: true });
  });

async function complete(path, id, options) {
  const deadline = Date.now() + 20 * 60_000;

  let delay = 2000;

  while (Date.now() < deadline) {
    if (!(await wait(delay, options.signal))) return { ok: false, status: 0, data: null };

    if (navigator.onLine === false) continue;
    const result = await api(`${path}?upload=${encodeURIComponent(id)}`, {
      cache: "no-store",
      credentials: options.credentials,
      signal: AbortSignal.any([options.signal, AbortSignal.timeout(15_000)].filter(Boolean))
    });

    if (options.signal?.aborted) return { ok: false, status: 0, data: null };

    if (result.status === 202 && result.data?.pending === true) {
      delay = 2000;
      continue;
    }

    if (result.ok) {
      if (result.data?.failed === true)
        return { ok: false, status: result.data.status, data: { code: result.data.code } };

      if (typeof result.data?.token !== "string")
        return { ok: false, status: 502, data: { code: "invalid" } };

      return result;
    }

    if (result.status && result.status < 500 && result.status !== 429) return result;

    delay = result.status === 429 ? 60_000 : Math.min(10_000, delay * 2);
  }

  return { ok: false, status: 408, data: { code: "timeout" } };
}

export default async function upload(path, value, options = {}) {
  const file = value instanceof Blob ? value : value?.file;
  const edit = value instanceof Blob ? null : value?.edit;

  if (!(file instanceof Blob) || !file.size) {
    return { ok: false, status: 0, data: null };
  }

  if (path.endsWith("/audio") && file.caption) {
    options = {
      ...options,
      headers: { ...options.headers, "X-Audio-Text": encodeURIComponent(file.caption) }
    };
  }

  const size = 3 * 1024 * 1024;

  if (path.endsWith("/file") && file.size > size && !options.chunk) {
    const id = crypto.randomUUID();

    let result;

    for (let offset = 0; offset < file.size; offset += size) {
      for (let attempt = 0; attempt < 3; attempt++) {
        if (options.signal?.aborted) return { ok: false, status: 0, data: null };

        result = await upload(path, file.slice(offset, offset + size), {
          ...options,
          chunk: true,
          headers: {
            ...options.headers,
            "X-Upload-Id": id,
            "X-Upload-Offset": String(offset),
            "X-Upload-Size": String(file.size),
            "X-Upload-Wait": "1"
          },
          progress: (loaded) => options.progress?.(offset + loaded, file.size)
        });

        if (
          result.ok ||
          options.signal?.aborted ||
          (result.status && result.status < 500 && result.status !== 409) ||
          (result.status === 409 && result.data?.code && result.data.code !== "busy")
        )
          break;

        if (attempt < 2 && !(await wait(1000 * 2 ** attempt, options.signal)))
          return { ok: false, status: 0, data: null };
      }

      if (result.status === 202 && result.data?.pending === true)
        return complete(path, id, options);

      if (!result.ok) return result;
    }

    return result;
  }

  if (options.progress) {
    return new Promise((resolve) => {
      const request = new XMLHttpRequest();
      const signal = options.signal;
      const cancel = () => request.abort();

      let settled = false;

      const finish = (result) => {
        if (settled) return;

        settled = true;
        signal?.removeEventListener("abort", cancel);
        resolve(result);
      };
      const failed = () => finish({ ok: false, status: 0, data: null });

      if (signal?.aborted) return failed();

      request.open(options.method || "POST", `/api${path}`);
      request.responseType = "json";
      if (options.chunk) request.timeout = 60_000;

      request.withCredentials = options.credentials === "include";
      for (const [name, value] of Object.entries({
        "Content-Type": file.type || "application/octet-stream",
        ...context.headers(),
        ...(edit ? { "X-Image-Edit": JSON.stringify(edit) } : {}),
        ...options.headers
      }))
        request.setRequestHeader(name, value);
      request.upload.onprogress = (event) => {
        if (event.lengthComputable) options.progress(event.loaded, event.total);
      };

      request.onload = () =>
        finish({
          ok: request.status >= 200 && request.status < 300,
          status: request.status,
          data: request.response
        });

      request.onerror = failed;
      request.onabort = failed;
      request.ontimeout = failed;
      signal?.addEventListener("abort", cancel, { once: true });
      try {
        request.send(file);
      } catch {
        failed();
      }
    });
  }

  try {
    const response = await fetch(`/api${path}`, {
      ...options,
      method: options.method || "POST",
      headers: {
        "Content-Type": file.type || "application/octet-stream",
        ...context.headers(),
        ...(edit ? { "X-Image-Edit": JSON.stringify(edit) } : {}),
        ...options.headers
      },
      body: file
    });

    const json = response.headers.get("content-type")?.includes("application/json");
    const data = json ? await response.json() : null;

    return { ok: response.ok, status: response.status, data };
  } catch {
    return { ok: false, status: 0, data: null };
  }
}
