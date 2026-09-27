const ONE_YEAR = 31_536_000;

export const get = (key) => {
  const prefix = `${encodeURIComponent(key)}=`;
  const cookie = document.cookie.split("; ").find((item) => item.startsWith(prefix));

  return cookie ? decodeURIComponent(cookie.slice(prefix.length)) : null;
};

export const set = (key, value, maxAge = ONE_YEAR) => {
  const parts = [
    `${encodeURIComponent(key)}=${encodeURIComponent(value)}`,
    "Path=/",
    `Max-Age=${maxAge}`,
    "SameSite=Lax"
  ];

  if (location.protocol === "https:") {
    parts.push("Secure");
  }

  document.cookie = parts.join("; ");

  return value;
};

export const remove = (key) => {
  set(key, "", 0);
};

export const enabled = () => {
  const key = "8f3d21c7";
  const value = crypto.randomUUID();

  set(key, value, 60);

  const allowed = get(key) === value;

  remove(key);

  return allowed;
};
