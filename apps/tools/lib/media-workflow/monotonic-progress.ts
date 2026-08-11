export type MonotonicProgress = Readonly<{
  project(progress: number | undefined): number | undefined;
}>;

export function createMonotonicProgress(): MonotonicProgress {
  let last: number | undefined;
  return Object.freeze({
    project(progress) {
      if (progress === undefined || !Number.isFinite(progress)) return last;
      const normalized = Math.round(Math.min(100, Math.max(0, progress)));
      last = Math.max(last ?? 0, normalized);
      return last;
    },
  });
}
