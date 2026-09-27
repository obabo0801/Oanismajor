export const root = -2;
export const admin = -1;
export const user = 0;

export const staff = (value) => value === root || value === admin;
export const manages = (viewer, target) =>
  viewer?.uid !== target?.uid &&
  (viewer?.role === root
    ? target?.role === admin || target?.role === user
    : viewer?.role === admin && target?.role === user);
