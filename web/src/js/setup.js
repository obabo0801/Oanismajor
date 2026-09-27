import * as profile from "#common/profile";
import * as navigation from "#common/login/history";

export default async function setup(ready) {
  const result = await profile.read("me", { fresh: true });

  if (!result.ok) {
    return false;
  }

  if (!navigation.start(result.data)) return false;

  ready?.();

  return true;
}
