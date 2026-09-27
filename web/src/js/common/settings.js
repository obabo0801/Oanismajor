import api from "#common/api";
import { user } from "#shared/route";
import * as settings from "#shared/settings";

let value = settings.read({ notification: false });

const listeners = new Set();

export const subscribe = (listener) => {
  listeners.add(listener);

  return () => listeners.delete(listener);
};

export const read = () => value;
export const receive = (next) => {
  value = settings.read(next);
  listeners.forEach((listener) => listener(value));
};

export const allows = (mentioned, push = false) => settings.allows(value, mentioned, push);

export const load = async () => {
  const result = await api(`${user}/settings`);

  if (result.ok) receive(result.data);

  return result.ok;
};

export const save = async (key, enabled) => {
  const result = await api(`${user}/settings`, { method: "PATCH", data: { [key]: enabled } });

  if (result.ok) receive(result.data);

  return result.ok;
};
