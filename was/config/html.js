import hash from "#config/hash";

export const map = `.${hash(8, "pages", "")}.json`;
