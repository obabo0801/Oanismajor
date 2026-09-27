import * as dom from "#common/dom";
import * as i18n from "#common/i18n";
import init from "#src/init";
import sound from "#common/sound";
import vibrate from "#common/vibrate";
import * as tts from "#common/tts";

import access from "#src/access";
import * as pwa from "#src/pwa";

const page = dom.query(".block");
const heading = dom.query("h1", page);
const action = dom.query("button", page);
const loading = init();

dom.on(action, "click", async () => {
  action.disabled = true;
  sound.play("click");
  vibrate.play("click");

  try {
    const allowed = await access(false, "block");

    if (allowed) {
      setTimeout(() => {
        location.reload();
      }, 150);

      return;
    }

    if (!tts.busy()) {
      const source = await tts.speak(heading.textContent, { type: "cache" }).catch(() => null);

      await tts.wait(source);
    }
  } finally {
    action.disabled = false;
  }
});

try {
  await Promise.all([access(false, "block"), i18n.translate(), pwa.load().catch(() => null)]);
} finally {
  page.hidden = false;
  loading.remove();
}
