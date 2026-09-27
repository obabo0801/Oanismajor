import { usage, user } from "#shared/route";

import format from "#common/format";
import api from "#common/api";
import * as storage from "#common/storage";
import * as sync from "#common/sync";

export const sizeCookie = async () => {
  const response = await api(`${user}${usage}`);

  return Number(response.data?.size) || 0;
};

export const sizeData = async () => {
  const storage = await navigator.storage?.estimate();

  return Number(storage?.usage) || 0;
};

export const sizeAll = async () => {
  const [cookie, data] = await Promise.all([sizeCookie(), sizeData()]);

  return { cookie: format(cookie), data: format(data), total: format(cookie + data) };
};

export const clearCookie = async () => {
  const response = await api(user, { method: "DELETE" });

  return response.ok;
};

export const clearData = async () => {
  const cache = async () => {
    if ("caches" in window) {
      await Promise.all([caches.delete("_offline"), caches.delete("offline")]);
    }

    return true;
  };

  const results = await Promise.allSettled([storage.clear(), cache(), sync.clear()]);

  return results.every((result) => result.status === "fulfilled" && result.value === true);
};

export default Object.freeze({ sizeCookie, sizeData, sizeAll, clearCookie, clearData });
