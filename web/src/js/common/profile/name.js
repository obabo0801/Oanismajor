import * as dom from "#common/dom";
import * as i18n from "#common/i18n";

i18n.preload("profile.anonymous", "profile.verified");

export const label = (user) =>
  user.name || i18n.message("profile.anonymous").replace("{id}", user.id?.slice(0, 8) || "");

export const mark = (element, verified) => {
  dom.query(".profile-verified", element)?.remove();
  if (!verified) return;
  const badge = dom.create("span");

  badge.className = "profile-verified";
  dom.set(badge, "data-icon", "check");
  dom.set(badge, "data-tooltip", "profile.verified");
  element.append(badge);
};
