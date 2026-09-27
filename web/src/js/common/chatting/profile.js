import * as dom from "#common/dom";
import * as profile from "#common/profile";
import avatar from "#common/avatar";
import show from "#common/profile/view";
import * as names from "#common/profile/name";

export default function create(target, options) {
  const root = dom.create("div");
  const picture = avatar(options.avatar, "button");
  const name = dom.create("button");
  const id = options.own ? "me" : options.id;

  root.className = "chatting-profile";
  picture.root.classList.add("chatting-avatar");
  picture.root.tabIndex = -1;
  name.type = "button";
  name.className = "chatting-name";

  dom.set(picture.root, "data-response", "");
  dom.set(name, "data-response", "");
  root.append(picture.root);

  const render = (user) => {
    name.textContent = names.label(user);
    picture.set(user.avatar || options.avatar || "");

    target.toggleAttribute("data-direct-blocked", Boolean(user.directBlocked));

    if (name.textContent && !name.isConnected) {
      root.append(name);
    } else if (!name.textContent) {
      name.remove();
    }
  };

  const open = (anchor) =>
    show(anchor, target, {
      ...options,
      time: "",
      ...(id ? profile.value(id) : null),
      context: "chatting"
    }).catch(() => {});

  render(options);
  dom.on(picture.root, "click", () => open(picture.root));
  dom.on(name, "click", () => open(name));

  if (id) {
    profile.bind(root, id, render);
    profile.read(id).catch(() => {});
  }

  return root;
}
