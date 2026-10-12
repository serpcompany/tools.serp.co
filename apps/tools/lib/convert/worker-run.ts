// Runs one job in a new worker that is terminated when it answers, fails,
// or runs past a time limit (issue #265): Graphviz and pptx-glimpse lay out
// in workers so a file that takes too long can be stopped.

export type WorkerLike<Reply> = {
  postMessage: (message: unknown, transfer: Transferable[]) => void;
  terminate: () => void;
  onmessage: ((event: MessageEvent<Reply>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
};

export function runInWorker<Reply>(
  worker: WorkerLike<Reply>,
  message: unknown,
  { timeoutMs, timedOut, crashed, transfer = [] }: {
    timeoutMs: number;
    // The error when the job runs past `timeoutMs`, and when the worker fails.
    timedOut: () => Error;
    crashed: (event: ErrorEvent) => Error;
    transfer?: Transferable[];
  },
): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const finish = () => {
      clearTimeout(timer);
      worker.terminate();
    };
    const timer = setTimeout(() => {
      finish();
      reject(timedOut());
    }, timeoutMs);
    worker.onmessage = (event) => {
      finish();
      resolve(event.data);
    };
    worker.onerror = (event) => {
      finish();
      reject(crashed(event));
    };
    worker.postMessage(message, transfer);
  });
}
