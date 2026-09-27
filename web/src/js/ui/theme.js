import * as dom from "#common/dom";
import * as theme from "#common/theme";

export default function select() {
  const value = theme.default();

  dom.all('select[name="theme"]').forEach((input) => {
    input.replaceChildren(
      ...theme.modes.map((mode) => {
        const option = dom.create("option");

        option.value = mode;
        option.textContent = mode;
        dom.set(option, "data-i18n", `theme.${mode}`);

        return option;
      })
    );

    input.value = value;
    dom.on(input, "change", () => theme.default(input.value));
  });
}
