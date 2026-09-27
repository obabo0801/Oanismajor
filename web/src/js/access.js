import * as storage from "#common/storage";
import { user } from "#shared/route";

import api from "#common/api";
import device from "#common/device";
import * as events from "#common/events";

const show = async (name) => {
  const header = name === "offline" ? "X-PWA-Cache" : `X-${name}`;

  const response = await fetch(`/${name}`, { headers: { Accept: "text/html", [header]: "true" } });
  const html = await response.text();

  document.open();
  document.write(html);
  document.close();
};

const failure = (response) => {
  if (response.status === 503) {
    return "maint";
  }

  if (response.ok) {
    return "";
  }

  return response.status === 0 ? "offline" : "error";
};

export default async function access(navigate = true, name) {
  const path =
    name && location.pathname === "/"
      ? `/${name.replace(/^\/+/, "")}`
      : decodeURI(`${location.pathname}${location.search}`);

  const navigation = performance.getEntriesByType("navigation")[0];
  const status = navigation?.responseStatus ?? 0;
  const key = `access:${path}`;
  const now = Date.now();

  let recent = false;

  try {
    const last = Number(storage.get(key, null, "session"));

    recent = now - last < 60_000;
  } catch {}

  const wearable = device().wearable;
  const headers = { "X-Wearable": String(wearable) };
  const response = await api(user, { headers, method: "POST", data: { path, result: status } });

  if (response.status === 403) {
    if (navigate) {
      if (import.meta.env.DEV) {
        location.replace("/block");
      } else {
        await show("block");
      }
    }

    return false;
  }

  const firstError = failure(response);

  if (firstError) {
    if (navigate) {
      await show(firstError);
    }

    return false;
  }

  const query = new URLSearchParams({
    path,
    result: status,
    ...(name && { name }),
    ...(recent && { recent: "true" })
  });

  const session = await api(`${user}?${query}`, { headers });
  const sessionError = failure(session);

  if (sessionError) {
    if (navigate) {
      await show(sessionError);
    }

    return false;
  }

  try {
    storage.set(key, now, "session");
  } catch {}

  if (!session.data?.valid) {
    if (navigate) {
      await show("denied");
    }

    return false;
  }

  await events.start();

  return true;
}
