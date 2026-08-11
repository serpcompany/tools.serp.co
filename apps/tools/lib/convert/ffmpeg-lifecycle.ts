export type FfmpegLifecycleAdapter = Readonly<{
  writeFile(name: string, data: Uint8Array): Promise<unknown>;
  deleteFile(name: string): Promise<unknown>;
  on(event: "progress", handler: (event: { progress: number; time: number }) => void): void;
  off(event: "progress", handler: (event: { progress: number; time: number }) => void): void;
  terminate(): void;
}>;

export async function runFfmpegLifecycle<Result>(
  adapter: FfmpegLifecycleAdapter,
  options: Readonly<{
    inputs: readonly Readonly<{ name: string; data: Uint8Array }>[];
    cleanupFiles: readonly string[];
    signal?: AbortSignal;
    progress?: (event: { progress: number; time: number }) => void;
    onAbort?: () => void;
  }>,
  operation: () => Promise<Result>,
): Promise<Result> {
  const onAbort = () => (options.onAbort ?? (() => adapter.terminate()))();
  try {
    options.signal?.addEventListener("abort", onAbort, { once: true });
    if (options.signal?.aborted) {
      onAbort();
      options.signal.throwIfAborted();
    }
    if (options.progress) adapter.on("progress", options.progress);
    for (const input of options.inputs) {
      await adapter.writeFile(input.name, input.data);
      options.signal?.throwIfAborted();
    }
    return await operation();
  } finally {
    options.signal?.removeEventListener("abort", onAbort);
    if (options.progress) adapter.off("progress", options.progress);
    for (const name of new Set([
      ...options.inputs.map((input) => input.name),
      ...options.cleanupFiles,
    ])) {
      try {
        await adapter.deleteFile(name);
      } catch {
        // Best-effort cleanup must continue across independently missing files.
      }
    }
  }
}
