import * as dom from "#common/dom";

export default function accordion() {
  dom.on(document, "click", (event) => {
    const button = event.target.closest?.(".accordion-toggle");

    if (!button) {
      return;
    }

    const element = button.closest(".accordion");

    if (!element) {
      return;
    }

    const open = dom.get(element, "data-open") !== null;

    if (open) {
      dom.remove(element, "data-open");
    } else {
      dom.set(element, "data-open", "");
    }
  });
}
