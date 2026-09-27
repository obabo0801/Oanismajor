export const initial = "c0e765ce-70f2-45eb-bf20-529111ddbe74";
export const states = ["active", "closed", "archived"];
export const valid = (value) =>
  typeof value === "string" && /^[\da-f]{8}(-[\da-f]{4}){3}-[\da-f]{12}$/i.test(value);
export const parse = (pathname) => /^\/rooms\/([\da-f-]{36})\/?$/i.exec(pathname)?.[1] || "";
