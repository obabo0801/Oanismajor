import * as route from "../../../lib/route.js";

import * as dom from "./common/dom.js";
import toast from "./common/toast.js";

export { notify } from "./common/push.js";
export { default as sync } from "./common/sync.js";

export async function load() {
  if (!import.meta.env.PROD || !("serviceWorker" in navigator)) {
    return;
  }

  await navigator.serviceWorker.register("/worker.js", { scope: "/" });

  const registration = await navigator.serviceWorker.ready;

  dom.on(navigator.serviceWorker, "message", (event) => {
    if (event.data?.type !== "notify" || document.visibilityState !== "visible") {
      return;
    }

    const { title, body, image, url, tag } = event.data.data;
    const options = { title, text: body, image, url, id: tag };

    toast({ type: "notify", ...options });
  });

  const cache = () => {
    registration.active?.postMessage({
      type: "offline",
      locale: `/api${route.i18n}`,
      content: route.content
    });
  };

  const standalone = matchMedia("(display-mode: standalone)").matches;

  if (navigator.standalone || standalone) {
    cache();
  }

  dom.on(window, "appinstalled", cache, { once: true });
  dom.on(window, "online", () => registration.active?.postMessage({ type: "sync" }));

  return registration;
}
