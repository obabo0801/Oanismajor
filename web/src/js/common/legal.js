import * as dom from "#common/dom";
import * as i18n from "#common/i18n";
import * as css from "#common/css";
import drawer from "#common/drawer";
import * as route from "#common/route";
import terms from "../../terms.html?raw";
import privacy from "../../privacy.html?raw";
import "../../css/legal.css";

export function bind(content, contact = () => location.assign("/settings/contact")) {
  const headings = [...content.querySelectorAll("h1, h2")];

  let frame;
  let title;
  let changes;

  const fit = () => {
    const unit = Number.parseFloat(getComputedStyle(dom.root).fontSize);
    const heading = content.closest("dialog")?.querySelector(".layer-title");

    if (heading && title !== heading) {
      title = heading;
      headings.push(title);
      changes.observe(title, { childList: true, characterData: true, subtree: true });
    }

    for (const heading of headings) {
      if (!heading.clientWidth) continue;

      css.set(heading, { "--heading-size": null });

      const size = Number.parseFloat(getComputedStyle(heading).fontSize);
      const width = heading.clientWidth;

      if (heading.scrollWidth > width) {
        css.set(heading, {
          "--heading-size": `${(size * (width - 1)) / heading.scrollWidth / unit}rem`
        });
      }
    }
  };

  const schedule = () => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(fit);
  };
  const resize = new ResizeObserver(schedule);

  changes = new MutationObserver(schedule);

  resize.observe(content);
  changes.observe(content, { childList: true, characterData: true, subtree: true });

  document.fonts.ready.then(schedule);
  dom.on(content, "click", async (event) => {
    const button = event.target.closest("button[data-contact]");

    if (!button) return;

    switch (dom.get(button, "data-contact")) {
      case "contact":
        await contact();
        break;
      case "mail":
        location.href = "mailto:obabo0801@gmail.com";
        break;
      case "discord":
        window.open("https://discord.com/users/1267965937785770069", "_blank", "noopener");

        break;
    }
  });

  return () => {
    resize.disconnect();
    changes.disconnect();
    cancelAnimationFrame(frame);
  };
}

export default async function legal(name) {
  const source = { terms, privacy }[name];

  if (!source) return false;
  const page = new DOMParser().parseFromString(source, "text/html");
  const content = page.querySelector(".legal");
  const sections = new Map(
    [...content.querySelectorAll("[id]")].map((element) => [element.id, element])
  );

  content.querySelector("h1")?.remove();
  content.querySelectorAll("[id]").forEach((element) => element.removeAttribute("id"));

  const clean = bind(content, async () => {
    const direct = await import("./chatting/direct.js");

    return direct.contact();
  });

  dom.on(content, "click", (event) => {
    const link = event.target.closest('a[href^="#"]');

    if (link) {
      event.preventDefault();
      sections.get(link.hash.slice(1))?.scrollIntoView({ block: "start" });
    }
  });

  i18n.preload(
    ...[...content.querySelectorAll("[data-i18n]")].map((element) => dom.get(element, "data-i18n"))
  );

  return drawer({
    route: [name, ""],
    title: `${name}.title`,
    content,
    back: true,
    side: "right",
    direction: "→"
  }).finally(clean);
}

for (const name of ["terms", "privacy"]) route.register(name, () => legal(name), "drawer");
