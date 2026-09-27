import layer from "#common/layer";

export default function drawer(options = {}) {
  const side = options.side === "right" ? "right" : "left";

  return layer("drawer", { ...options, side });
}
