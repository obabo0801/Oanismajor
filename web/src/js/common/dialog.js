import layer from "#common/layer";

export default function dialog(options = {}) {
  return layer("dialog", {
    ...options,
    actions: options.actions?.map((item) => {
      const data = item.data || [];
      const tone =
        item.icon === "trash" || /(?:^|\.)(delete|remove|erase)(?:\.|$)/.test(item.text)
          ? "data-danger"
          : item.value === false || item.icon === "close" || /(?:^|\.)cancel$/.test(item.text)
            ? "data-neutral"
            : "data-confirm";

      return {
        ...item,
        data: data.some((value) =>
          ["data-danger", "data-neutral", "data-confirm", "data-success"].includes(value)
        )
          ? data
          : [...data, tone]
      };
    })
  });
}
