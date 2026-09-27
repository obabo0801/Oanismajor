export default function retry(run, active = () => true) {
  let timer;
  let attempts = 0;

  const reset = () => {
    clearTimeout(timer);
    timer = undefined;
    attempts = 0;
  };

  return {
    reset,
    schedule() {
      if (timer) return;

      timer = setTimeout(
        () => {
          timer = undefined;
          if (active()) void run();
        },
        Math.min(30000, 2000 * 2 ** Math.min(attempts++, 4))
      );
    }
  };
}
