import { profile as path } from "#shared/route";

import api from "#common/api";
import upload from "#common/upload";

const records = new Map();
const pending = new Map();
const latest = new Map();
const bindings = new Set();
const linkBindings = new Set();

let linked = "";
let generation = 0;
let sequence = 0;

const key = (id) => id || "me";

const notify = (id, user) => {
  for (const binding of bindings) {
    if (!binding.element.isConnected) {
      bindings.delete(binding);
    } else if (binding.id === id) {
      binding.render(user);
    }
  }
};

const remember = (id, user) => {
  if (!user?.id) {
    return user;
  }

  const value = { ...user };

  records.set(user.id, value);
  notify(user.id, value);

  if (id === "me" || value.self) {
    records.set("me", value);
    notify("me", value);
  }

  return value;
};

export const value = (id = "me") => records.get(key(id));

const discard = (target) => {
  const user = records.get(target);

  records.delete(target);
  if (!user) return;
  const { id, name, image, avatar, self, state, time } = user;
  const own = records.get("me")?.id === id || target === "me";
  const safe = { id, name, image, avatar, self, state, time, manage: false };

  records.delete(id);
  if (own) records.delete("me");

  notify(id, safe);
  if (own) notify("me", safe);
};

export const bind = (element, id, render) => {
  const binding = { element, id: key(id), render };
  const user = value(binding.id);

  bindings.add(binding);

  if (user) {
    render(user);
  }

  return () => bindings.delete(binding);
};

export const read = async (id = "me", options = {}) => {
  const target = key(id);

  if (!options.fresh && records.has(target)) {
    return { ok: true, status: 200, data: records.get(target) };
  }

  if (!options.fresh && pending.has(target)) {
    return pending.get(target);
  }

  const version = generation;
  const canonical = records.get(target)?.id || target;
  const entry = { order: ++sequence };

  latest.set(target, entry);
  latest.set(canonical, entry);

  const request = api(`${path}/${encodeURIComponent(target)}`).then((result) => {
    const current = [target, canonical, result.data?.id]
      .map((id) => latest.get(id))
      .filter(Boolean)
      .sort((a, b) => b.order - a.order)[0];

    if (version !== generation || current !== entry) {
      return current?.request || read(target);
    }

    if (!result.ok) {
      if ([403, 404].includes(result.status)) discard(target);

      return result;
    }

    latest.set(result.data?.id || canonical, entry);

    return { ...result, data: remember(target, result.data) };
  });

  entry.request = request;
  pending.set(target, request);

  try {
    return await request;
  } finally {
    if (pending.get(target) === request) {
      pending.delete(target);
    }
  }
};

export const presence = (id, state, connections) => {
  const target = key(id);
  const user = records.get(target);

  if (!user) {
    return;
  }

  remember(target, { ...user, state, connections });
};

export const receiveLink = (token) => {
  linked = typeof token === "string" ? token : "";

  linkBindings.forEach((listener) => {
    listener(linked);
  });
};

export const onLink = (listener) => {
  linkBindings.add(listener);

  return () => linkBindings.delete(listener);
};

export const clearLink = () => {
  linked = "";
};

export const linkImage = (token) => `/api${path}/image/link/` + encodeURIComponent(token);

export const checkName = (name) => api(`${path}/name?name=${encodeURIComponent(name)}`);

export const save = (data) => api(path, { method: "PATCH", data });

export const uploadAvatar = (file, token) =>
  upload(`${path}/image`, file, { headers: { "X-Profile-Draft": token } });

export const imageLink = () => api(`${path}/image/link`, { method: "POST" });

export const uploadLink = (token, file) =>
  upload(`${path}/image/link/${encodeURIComponent(token)}`, file);

export const block = (id, reason) =>
  api(`${path}/${encodeURIComponent(id)}/block`, { method: "POST", data: { reason } });

export const unblock = (id, reason) =>
  api(`${path}/${encodeURIComponent(id)}/block`, { method: "DELETE", data: { reason } });

export const authority = (id, data) =>
  api(`${path}/${encodeURIComponent(id)}/authority`, { method: "PATCH", data });

export const refresh = async (id) => {
  const result = await read(id, { fresh: true });

  if (!result.ok) discard(key(id));

  return result;
};

export const reset = () => {
  const ids = new Set([
    ...pending.keys(),
    ...[...bindings].filter(({ element }) => element.isConnected).map(({ id }) => id)
  ]);

  generation++;
  pending.clear();
  latest.clear();
  for (const target of [...records.keys()]) discard(target);

  return Promise.all([...ids].map((id) => read(id, { fresh: true })));
};

export const complete = async (consent, image = "keep", token) => {
  const result = await api(`${path}/complete`, { method: "POST", data: { consent, image, token } });

  if (result.ok) {
    const current = value();

    if (current?.id === result.data?.id) remember("me", { ...current, ...result.data });
    const refreshed = await read("me", { fresh: true });

    if (refreshed.ok) return { ...result, data: refreshed.data };
  }

  return result;
};

export const sanction = (id, action, reason) =>
  api(`${path}/${encodeURIComponent(id)}/sanction`, { method: "POST", data: { action, reason } });
