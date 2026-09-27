import { parse } from "#shared/room";

export const room =
  parse(location.pathname) ||
  parse(new URL(history.state?.navigation?.base || "/", location.origin).pathname);
export const headers = () => (room ? { "X-Chatting-Room": room } : {});
