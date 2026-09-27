import init from "#src/init";
import * as i18n from "#common/i18n";
import * as dom from "#common/dom";
import { bind } from "#common/legal";

const loading = init();

bind(dom.query(".legal"));

const anchor = () => {
  let id;

  try {
    id = decodeURIComponent(location.hash.slice(1));
  } catch {
    return;
  }

  const target = document.getElementById(id);

  if (!target?.closest(".legal")) return;

  target.scrollIntoView({ block: "start" });
};

dom.on(window, "hashchange", anchor);
dom.on(dom.query(".legal"), "click", (event) => {
  const link = event.target.closest('a[href^="#"]');

  if (link?.hash === location.hash) anchor();
});

try {
  await i18n.translate();
  anchor();
} finally {
  loading.remove();
}
