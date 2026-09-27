import * as dom from "#common/dom";
import * as rendition from "#shared/rendition";

const url = (value, size, automatic = false) =>
  rendition.source(value, size, location.origin, automatic);

export const thumb = (item) =>
  url(item.url || item.src, 160) || item.preview || item.url || item.src;

export const neighbor = (item) =>
  url(item.url || item.src, 640) || item.preview || item.url || item.src;

export const size = () => {
  if (dom.has("wearable")) return 640;

  const pixels =
    Math.min(window.innerWidth, window.innerHeight) * Math.min(window.devicePixelRatio || 1, 2);

  return rendition.sizes.slice(1).find((value) => value >= pixels) || 2560;
};

export function prepare(item, width = size()) {
  const resized = url(item.url, width, true);

  if (resized) {
    return {
      ...item,
      url: resized,
      preview: item.preview && item.preview !== item.url ? item.preview : thumb(item),
      resolve: undefined,
      cache: true
    };
  }

  const known = [item.size, item.width, item.height].every(Number.isFinite);
  const large =
    known &&
    rendition.large({
      bytes: item.size,
      width: item.width,
      height: item.height,
      pages: item.pages || 1
    });

  if ((large || !known) && (item.preview || item.resolve)) {
    return { ...item, url: item.preview || item.url, resolve: undefined, cache: true };
  }

  return { ...item, cache: true };
}
