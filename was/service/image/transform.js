import sharp from "sharp";
import { bounds } from "#shared/image";

const maxFrames = 120;

export const maxPixels = 64_000_000;

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

export const transform = async (data, value, quality) => {
  let width = clamp(Math.round(Number(value?.width) || 512), 64, 1024);
  let height = clamp(Math.round(Number(value?.height) || 512), 64, 1024);

  const angle = (((Number(value?.angle) || 0) % 360) + 360) % 360;
  const shape = ["circle", "original"].includes(value?.shape) ? value.shape : "square";
  const scale = clamp(Number(value?.scale) || 1, 1, 3);
  const offsetX = clamp(Number(value?.x) || 0, -1, 1);
  const offsetY = clamp(Number(value?.y) || 0, -1, 1);
  const input = { animated: true, failOn: "error", limitInputPixels: maxPixels };
  const metadata = await sharp(data, input).metadata();
  const pages = metadata.pages || 1;
  const pageHeight = metadata.pageHeight || metadata.height;
  const pixels = metadata.width * pageHeight * pages;

  if (
    !metadata.width ||
    !pageHeight ||
    pages > maxFrames ||
    pixels > maxPixels ||
    width * height * pages > maxPixels
  ) {
    return null;
  }

  const decoded = await sharp(data, input)
    .autoOrient()
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const sourceWidth = decoded.info.width;
  const sourceHeight = Math.round(decoded.info.height / pages);

  if (shape === "original") {
    const rotated = bounds(sourceWidth, sourceHeight, angle);
    const ratio = Math.min(1, 1024 / Math.max(rotated.width, rotated.height));

    width = Math.max(1, Math.round(rotated.width * ratio));
    height = Math.max(1, Math.round(rotated.height * ratio));
    if (width * height * pages > maxPixels) return null;
  }

  const radians = (angle * Math.PI) / 180;
  const horizontal = Math.abs(Math.cos(radians));
  const vertical = Math.abs(Math.sin(radians));
  const rotated = bounds(sourceWidth, sourceHeight, angle);
  const cover =
    shape === "original"
      ? Math.max(width / rotated.width, height / rotated.height)
      : shape === "circle"
        ? Math.max(width / sourceWidth, height / sourceHeight)
        : Math.max(
            (width * horizontal + height * vertical) / sourceWidth,
            (width * vertical + height * horizontal) / sourceHeight
          );
  const zoom = cover * scale;
  const resizedWidth = Math.ceil(sourceWidth * zoom);
  const resizedHeight = Math.ceil(sourceHeight * zoom);

  if (
    (resizedWidth * horizontal + resizedHeight * vertical) *
      (resizedWidth * vertical + resizedHeight * horizontal) *
      pages >
    maxPixels
  )
    return null;
  const stride = sourceWidth * sourceHeight * decoded.info.channels;
  const frames = [];

  for (let index = 0; index < pages; index += 1) {
    const frame = decoded.data.subarray(index * stride, (index + 1) * stride);

    const rotated = await sharp(frame, {
      raw: { width: sourceWidth, height: sourceHeight, channels: decoded.info.channels }
    })
      .resize(resizedWidth, resizedHeight, { fit: "fill" })
      .rotate(angle, { background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    const left = clamp(
      Math.round((rotated.info.width - width) / 2 - offsetX * width),
      0,
      rotated.info.width - width
    );

    const top = clamp(
      Math.round((rotated.info.height - height) / 2 - offsetY * height),
      0,
      rotated.info.height - height
    );

    frames.push(
      await sharp(rotated.data, {
        raw: {
          width: rotated.info.width,
          height: rotated.info.height,
          channels: rotated.info.channels
        }
      })
        .extract({ left, top, width, height })
        .raw()
        .toBuffer()
    );
  }

  const animation =
    pages > 1
      ? { loop: metadata.loop ?? 0, ...(metadata.delay ? { delay: metadata.delay } : {}) }
      : {};

  return sharp(Buffer.concat(frames), {
    raw: { width, height: height * pages, pageHeight: height, channels: 4 }
  })
    .webp({ quality, ...animation })
    .toBuffer();
};
