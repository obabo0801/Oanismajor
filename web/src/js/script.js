import * as dom from "#common/dom";
import * as i18n from "#common/i18n";
import * as emoji from "#common/emoji";
import init from "#src/init";
import * as settings from "#common/settings";
import rooms from "#common/chatting/room";
import * as route from "#common/route";

import access from "#src/access";
import * as pwa from "#src/pwa";
import setup from "#src/setup";
import header from "#src/header";
import footer from "#src/footer";
import * as login from "#common/login";
import * as direct from "#common/chatting/direct";

const app = dom.query(".app");
const loading = init();
const url = new URL(location.href);
const message = url.searchParams.get("message") || window.history.state?.message || "";

if (url.searchParams.has("message") || url.searchParams.get("push") === "1") {
  url.searchParams.delete("push");
  window.history.replaceState({ ...window.history.state, message }, "", url);
}

try {
  const allowed = await access();

  if (allowed) {
    await Promise.all([
      i18n.translate(),
      pwa.load().catch(() => null),
      emoji.load(),
      settings.load()
    ]);

    if (url.searchParams.get("popup") !== "1") {
      loading.remove();
      await login.pending();
    }

    if (await setup(() => loading.remove())) {
      app.hidden = false;
      header(app);
      footer(app);

      const chat = dom.query(".chatting", app);

      await rooms(chat, message);
      direct.listen(document);
      await route.restore();
    }
  }
} finally {
  loading.remove();
}
