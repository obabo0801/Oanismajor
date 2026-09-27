import * as dom from "#common/dom";
import popover from "#common/popover";
import toast from "#common/toast";
import { preview } from "#common/chatting/image";

export default async function draw(anchor, send) {
  const root = dom.create("div");
  const canvas = dom.create("canvas");
  const context = canvas.getContext("2d");

  let pointer = null;

  if (!context) return;

  root.className = "chatting-draw";
  dom.set(root, "data-drag", "none");
  canvas.width = canvas.height = 1024;
  root.append(canvas);

  const release = () => {
    const id = pointer;

    pointer = null;
    if (id !== null && canvas.hasPointerCapture(id)) canvas.releasePointerCapture(id);
  };

  const clear = () => {
    release();
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.strokeStyle = context.fillStyle = "#181818";
    context.lineWidth = 6;
    context.lineCap = context.lineJoin = "round";
  };

  const point = (event) => {
    const rect = canvas.getBoundingClientRect();

    return [
      ((event.clientX - rect.left) / rect.width) * canvas.width,
      ((event.clientY - rect.top) / rect.height) * canvas.height
    ];
  };

  const move = (event) => {
    if (event.pointerId !== pointer) return;

    context.lineTo(...point(event));
    context.stroke();
  };

  const off = [
    dom.on(canvas, "pointerdown", (event) => {
      if (pointer !== null || event.button !== 0) return;

      pointer = event.pointerId;
      canvas.setPointerCapture(pointer);

      const [x, y] = point(event);

      context.beginPath();
      context.arc(x, y, context.lineWidth / 2, 0, Math.PI * 2);
      context.fill();
      context.beginPath();
      context.moveTo(x, y);
    }),
    dom.on(canvas, "pointermove", move),
    dom.on(canvas, "pointerup", (event) => {
      if (event.pointerId !== pointer) return;

      move(event);
      release();
    }),
    ...["pointercancel", "lostpointercapture"].map((type) =>
      dom.on(canvas, type, (event) => {
        if (event.pointerId === pointer) release();
      })
    )
  ];

  clear();
  try {
    const result = await popover({
      anchor,
      back: true,
      title: "chatting.tools.draw",
      content: root,
      direction: "→",
      actions: [
        { text: "image.reset", icon: "reload", close: false, run: clear },
        {
          text: "image.confirm",
          icon: "check",
          data: ["data-confirm"],
          run: () => {
            release();

            return new Promise((resolve) =>
              canvas.toBlob((blob) => {
                if (!blob) toast({ text: "image.loadError", type: "error" });

                resolve(blob || false);
              }, "image/png")
            );
          }
        }
      ]
    });

    if (result instanceof Blob) await preview(result, anchor, send);
  } finally {
    release();
    off.forEach((remove) => remove());
  }
}
