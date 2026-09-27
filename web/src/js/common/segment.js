import * as dom from "#common/dom";

let resizeId;

const resize = () => {
  clearTimeout(resizeId);
  dom.set(dom.root, "data-resize", "");

  resizeId = setTimeout(() => {
    dom.remove(dom.root, "data-resize");
  }, 120);
};

export default function segment() {
  dom.on(window, "resize", resize);
  dom.on(window.visualViewport, "resize", resize);

  dom.on(document, "click", (event) => {
    const button = event.target.closest?.(".segment button:enabled");

    if (!button) {
      return;
    }

    const container = button.closest(".segment");
    const selected = dom.query("button[data-selected]", container);

    if (selected === button) {
      return;
    }

    dom.remove(selected, "data-selected");
    dom.set(button, "data-selected", "");
  });
}
