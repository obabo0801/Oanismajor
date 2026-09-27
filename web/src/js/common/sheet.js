import layer from "#common/layer";

export default function sheet(options = {}) {
  return layer("sheet", { stage: "half", ...options });
}
