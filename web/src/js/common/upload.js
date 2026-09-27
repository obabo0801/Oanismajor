import * as context from "./chatting/current.js";

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
        result = await upload(path, file.slice(offset, offset + size), {
          ...options,
          chunk: true,
          headers: {
            ...options.headers,
            "X-Upload-Id": id,
            "X-Upload-Offset": String(offset),
            "X-Upload-Size": String(file.size)
          },
          progress: (loaded) => options.progress?.(offset + loaded, file.size)
        });

        if (
          result.ok ||
          options.signal?.aborted ||
          (result.status && result.status < 500 && result.status !== 409)
        )
          break;
      }
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
