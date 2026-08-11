export type BrowserRunLease = Readonly<{
  signal: AbortSignal;
  isCurrent(): boolean;
  finish(): boolean;
}>;

export type BrowserRunOwnership = Readonly<{
  begin(): BrowserRunLease;
  abort(reason?: unknown): void;
  isBusy(): boolean;
}>;

export function createBrowserRunOwnership(): BrowserRunOwnership {
  let current:
    | { controller: AbortController; lease: BrowserRunLease }
    | undefined;

  const createLease = (): BrowserRunLease => {
    const controller = new AbortController();
    const lease: BrowserRunLease = Object.freeze({
      signal: controller.signal,
      isCurrent: () => current?.lease === lease,
      finish() {
        if (current?.lease !== lease) return false;
        current = undefined;
        return true;
      },
    });
    current = { controller, lease };
    return lease;
  };

  return Object.freeze({
    begin() {
      if (current) throw new Error("A browser media run is already active");
      return createLease();
    },
    abort(reason = "Browser media run aborted") {
      const active = current;
      current = undefined;
      active?.controller.abort(reason);
    },
    isBusy: () => current !== undefined,
  });
}
