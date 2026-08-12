export async function withSilenceWatchdog<T>(options: {
  run(pulse: () => void): Promise<T>;
  signal: AbortSignal;
  timeoutMs: number;
  timeoutMessage: string;
}): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let rejectTimeout: ((reason: Error) => void) | undefined;
  let active = true;
  const timeout = new Promise<never>((_resolve, reject) => {
    rejectTimeout = reject;
  });
  const pulse = () => {
    if (!active) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(
      () => rejectTimeout?.(new Error(options.timeoutMessage)),
      options.timeoutMs,
    );
  };
  const onAbort = () => {
    rejectTimeout?.(new DOMException("Transcription cancelled", "AbortError"));
  };
  options.signal.addEventListener("abort", onAbort, { once: true });
  options.signal.throwIfAborted();
  pulse();
  try {
    return await Promise.race([options.run(pulse), timeout]);
  } finally {
    active = false;
    if (timer) clearTimeout(timer);
    options.signal.removeEventListener("abort", onAbort);
  }
}
