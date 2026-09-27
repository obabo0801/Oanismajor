import * as dom from "#common/dom";
import limit from "#shared/upload";
import edit from "#common/image";
import * as i18n from "#common/i18n";
import * as profile from "#common/profile";
import avatar from "#common/avatar";
import sheet from "#common/sheet";
import toast from "#common/toast";
import once from "#common/once";

const portrait = (source, original = source) => {
  const root = dom.create("div");
  const media = avatar(source, "button");
  const mark = dom.create("span");

  root.className = "profile-avatar";
  mark.className = "profile-edit";

  dom.set(media.root, "data-tooltip", "image.select");
  dom.set(media.root, "data-response", "");
  dom.set(mark, "data-icon", "edit");

  root.append(media.root, mark);

  let pending;
  let url;
  let adjustment;
  let active = true;

  const opening = once();

  const adjust = async (file, anchor, previous) => {
    try {
      return await edit(file, { anchor, edit: previous, shape: "circle", width: 512, height: 512 });
    } catch {
      return null;
    }
  };

  const select = async () => {
    const panel = dom.create("div");
    const stage = avatar("", "button");
    const options = dom.create("div");
    const revise = once();

    stage.root.tabIndex = -1;
    dom.set(stage.root, "data-tooltip", "image.title");
    dom.set(stage.root, "data-response", "");

    panel.className = "image-select";
    options.className = "group";
    dom.set(options, "data-view", "grid");

    let draft = pending;
    let draftUrl = url;
    let temporary = false;
    let version = 0;
    let adjusting = false;
    let token;
    let opened = true;

    const show = () => {
      const value = draftUrl ?? source;

      stage.set(value, draft?.edit);
      stage.root.disabled = adjusting || !value;
      panel.dispatchEvent(new Event("input", { bubbles: true }));
    };

    const update = (result) => {
      if (temporary && draftUrl) {
        URL.revokeObjectURL(draftUrl);
      }

      draft = result;
      draftUrl = result ? URL.createObjectURL(result.file) : "";
      temporary = !!result;
      adjusting = false;
      token = undefined;
      version += 1;
      show();
    };

    dom.on(stage.root, "click", () => {
      revise(stage.root, async () => {
        if (stage.root.disabled || !(draftUrl ?? source)) {
          return;
        }

        const rev = ++version;
        const previous = draft?.edit;

        let file = draft?.file;

        adjusting = true;
        show();

        try {
          if (!file) {
            const response = await fetch(draftUrl ?? original);

            if (!response.ok) {
              throw new Error("image.loadError");
            }

            file = await response.blob();
          }

          if (rev !== version || !opened || !active) {
            return;
          }

          if (file.size > limit) {
            toast({ type: "error", title: "image.sizeError" });

            return;
          }

          const result = await adjust(file, stage.root, previous);

          if (result && rev === version && opened && active) {
            update(result);
          }
        } catch {
          if (rev === version && opened && active) {
            toast({ type: "error", title: "image.loadError" });
          }
        } finally {
          if (rev === version && opened && active) {
            adjusting = false;
            show();
          }
        }
      }).catch(() => {});
    });

    const offLink = profile.onLink(async (value) => {
      if (!token || token !== value || !opened || !active) return;

      const rev = ++version;

      adjusting = true;
      show();

      try {
        const response = await fetch(profile.linkImage(value));

        if (!response.ok) throw new Error("image.loadError");

        const file = await response.blob();

        if (rev !== version || !opened || !active) return;

        if (file.size > limit) {
          toast({ type: "error", title: "image.sizeError" });

          return;
        }

        update({ file });
      } catch {
        if (rev === version && opened && active) {
          toast({ type: "error", title: "image.loadError" });
        }
      } finally {
        if (rev === version && opened && active) {
          adjusting = false;
          show();
        }
      }
    });

    const choose = (icon, key, capture = false) => {
      const button = dom.create("button");
      const input = dom.create("input");

      button.type = "button";
      input.type = "file";
      input.accept = "image/jpeg,image/png,image/webp,image/gif";
      input.hidden = true;

      dom.set(button, "data-background", "");
      dom.set(button, "data-icon", `${icon} center`);
      dom.set(button, "data-color", "");
      dom.set(button, "data-circle", "");
      dom.set(button, "data-scale", "");
      dom.set(button, "data-tooltip", key);
      dom.set(button, "data-response", "");

      if (capture) {
        dom.set(input, "capture", "environment");
      }

      dom.on(button, "click", () => input.click());

      dom.on(input, "change", async () => {
        const file = input.files?.[0];

        input.value = "";

        if (!file) {
          return;
        }

        if (file.size > limit) {
          toast({ type: "error", title: "image.sizeError" });

          return;
        }

        const rev = ++version;

        token = undefined;
        adjusting = true;
        show();

        const result = await adjust(file, button);

        if (rev !== version || !opened || !active) return;

        if (result) {
          update(result);
        } else {
          adjusting = false;
          show();
        }
      });

      return { button, input };
    };

    const phone = () => {
      const button = dom.create("button");

      button.type = "button";
      dom.set(button, "data-background", "");
      dom.set(button, "data-icon", "phone center");
      dom.set(button, "data-color", "");
      dom.set(button, "data-circle", "");
      dom.set(button, "data-scale", "");
      dom.set(button, "data-tooltip", "image.phone");
      dom.set(button, "data-response", "");

      dom.on(button, "click", async () => {
        const rev = ++version;

        token = undefined;
        adjusting = false;
        show();

        const result = await profile.imageLink();

        if (!result.ok || rev !== version || !opened || !active) {
          return;
        }

        token = result.data.token;

        const url = new URL("/image", location.origin);

        url.searchParams.set("token", result.data.token);

        const { default: QRCode } = await import("qrcode");

        const content = dom.create("div");
        const code = dom.create("img");
        const guide = dom.create("p");

        content.className = "image-phone";
        code.className = "image-phone-code";
        code.alt = "";

        guide.textContent = i18n.message("image.scan") || "image.scan";
        dom.set(guide, "data-i18n", "image.scan");

        code.src = await QRCode.toDataURL(url.href, { width: 240, margin: 1 });

        if (rev !== version || !opened || !active) return;

        content.append(code, guide);

        let off;

        await sheet({
          route: ["actions", "phone"],
          title: "image.phone",
          content,
          direction: "↓",
          closing: (received) => {
            off?.();

            if (received === true || token !== result.data.token) return;

            token = undefined;
            version += 1;
            adjusting = false;
            if (opened && active) show();
          },
          ready: (_, close) => {
            off = profile.onLink((value) => {
              if (value === result.data.token) close(true);
            });
          },
          actions: [{ text: "image.cancel", icon: "close", data: ["data-neutral"] }]
        }).finally(() => off?.());
      });

      return { button };
    };

    const choices = dom.has("wearable")
      ? [phone()]
      : [
          ...(dom.has("mobile") ? [choose("camera", "image.camera", true)] : []),
          choose("image", "image.gallery")
        ];

    dom.set(options, "data-columns", String(choices.length));

    options.append(...choices.map(({ button }) => button));

    panel.append(stage.root, options, ...choices.map(({ input }) => input).filter(Boolean));

    show();

    let saved;

    try {
      saved = await sheet({
        route: ["actions", "avatar"],
        title: "image.select",
        content: panel,
        stage: "full",
        direction: "↓",
        closing: () => {
          opened = false;
          version += 1;
          offLink();
        },
        actions: [
          {
            text: "image.clear",
            icon: "delete",
            data: ["data-neutral"],
            close: false,
            run: () => {
              update(null);

              return false;
            }
          },
          {
            text: "image.save",
            icon: "check",
            value: true,
            disabled: () => adjusting,
            data: ["data-confirm"]
          }
        ]
      });
    } finally {
      opened = false;
      version += 1;
      offLink();

      if ((!saved || !active) && temporary && draftUrl) {
        URL.revokeObjectURL(draftUrl);
      }
    }

    if (!saved || !active) return;

    if (url && url !== draftUrl) {
      URL.revokeObjectURL(url);
    }

    pending = draft;
    url = draftUrl;

    if (pending !== undefined) {
      profile.clearLink();
    }

    adjustment = pending?.edit;
    media.set(url ?? source, adjustment);
    root.dispatchEvent(new Event("input", { bubbles: true }));
  };

  dom.on(media.root, "click", () => {
    if (active && !media.root.disabled) {
      opening(media.root, select).catch(() => {});
    }
  });

  return {
    root,
    preview: () => {
      const root = dom.create("div");
      const image = avatar();

      root.className = "profile-avatar";
      image.set(url ?? source, adjustment);
      root.append(image.root);

      return root;
    },
    file: () => pending,
    busy: (value) => {
      media.root.disabled = value;

      if (value) {
        dom.set(root, "data-loading", "");
      } else {
        dom.remove(root, "data-loading");
      }
    },
    destroy: () => {
      active = false;
      if (url) {
        URL.revokeObjectURL(url);
      }
    }
  };
};

export default portrait;
