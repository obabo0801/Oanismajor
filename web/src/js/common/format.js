const units = ["B", "KB", "MB", "GB", "TB"];

export default function format(bytes = 0) {
  let size = Number(bytes);

  if (!Number.isFinite(size) || size <= 0) {
    return "0 B";
  }

  let unit = 0;

  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }

  const value = Math.round(size * 100) / 100;

  return `${value} ${units[unit]}`;
}
