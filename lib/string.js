export default function string(value, other = "") {
  return typeof value === "string" ? value : other;
}
