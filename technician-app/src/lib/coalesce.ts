/**
 * Trailing-edge debounce for event listeners that would otherwise fire a
 * network reload per event — e.g. the outbox emits one change notification per
 * persisted queue mutation, so a flush settling N items used to trigger N
 * sequential reloads. Wrapping the listener collapses a burst into one call
 * after `ms` of quiet.
 */

export function coalesce(
  fn: () => void,
  ms: number,
): { call: () => void; cancel: () => void } {
  let timer: ReturnType<typeof setTimeout> | null = null;
  return {
    call: () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        fn();
      }, ms);
    },
    cancel: () => {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
    },
  };
}
