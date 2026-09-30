/** Shared display helpers for the app UI. */
export const truncateAddr = (a?: string | null, lead = 6, tail = 4): string =>
  a ? `${a.slice(0, lead)}…${a.slice(-tail)}` : "";
