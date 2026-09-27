import * as dom from "#common/dom";
import limit from "#shared/upload";
import edit from "#common/image";
import * as i18n from "#common/i18n";
import init from "#src/init";
import * as profile from "#common/profile";

i18n.preload(
  "image.phone",
  "image.phoneGuide",
  "image.select",
  "image.sent",
  "image.sizeError",
  "image.invalid",
  "image.uploadError"
);

const loading = init();

const root = dom.query(".image-link");

const button = dom.query("[data-select]", root);

const input = dom.query("[data-input]", root);

const status = dom.query("[data-status]", root);

const state = (key) => {
  status.textContent = i18n.message(key) || key;
  dom.set(status, "data-i18n", key);
};

try {
  await i18n.translate();

  const query = new URLSearchParams(location.search);

  const token = query.get("token")?.trim();

  if (!token) {
    button.disabled = true;
    state("image.invalid");
  } else {
    dom.on(button, "click", () => {
      input.click();
    });

    dom.on(input, "change", async () => {
      const file = input.files?.[0];

      input.value = "";

      if (!file) {
        return;
      }

      if (file.size > limit) {
        state("image.sizeError");

        return;
      }

      const image = await edit(file, { anchor: button, shape: "circle", width: 512, height: 512 });

      if (!image) {
        return;
      }

      button.disabled = true;

      const result = await profile.uploadLink(token, image);

      if (result.ok) {
        state("image.sent");

        return;
      }

      button.disabled = false;

      state(
        result.status === 404
          ? "image.invalid"
          : result.status === 413
            ? "image.sizeError"
            : "image.uploadError"
      );
    });
  }
} finally {
  loading.remove();
}
