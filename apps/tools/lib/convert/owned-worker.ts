export function ownWorkerTermination(worker: Worker): Worker {
  let terminated = false;
  return new Proxy(worker, {
    get(target, property) {
      if (property === 'terminate') {
        return () => {
          if (terminated) return;
          terminated = true;
          target.terminate();
        };
      }
      const value = Reflect.get(target, property, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
    set(target, property, value) {
      return Reflect.set(target, property, value, target);
    },
  });
}
