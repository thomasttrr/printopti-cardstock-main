// Local-only safety net: keep the pasted schedule in this browser so a refresh, a
// crash, or an accidental tab-close doesn't destroy a long paste (a 149-row batch is
// a couple minutes of work to re-copy). Nothing is ever uploaded — this is
// `localStorage`, scoped to this origin on this one machine, and the "Clear paste"
// button erases it. Every call takes the storage object so it can be tested without
// a browser.

export const SCHEDULE_KEY = "printopti.schedule.v1";
// localStorage is typically ~5 MB per origin and stores UTF-16, so refuse to persist
// anything that could blow the quota. Real batches are tens of KB.
export const MAX_STORED_CHARS = 1024 * 1024;

// Why a save was skipped, so the UI can say something honest instead of silently
// pretending the paste is safe.
export const SAVE = {
  OK: "saved",
  EMPTY: "empty",
  TOO_LARGE: "too-large",
  UNAVAILABLE: "unavailable",
};

function usable(storage) {
  return (
    !!storage &&
    typeof storage.getItem === "function" &&
    typeof storage.setItem === "function" &&
    typeof storage.removeItem === "function"
  );
}

function forget(storage) {
  try {
    storage.removeItem(SCHEDULE_KEY);
  } catch (err) {
    // A storage that cannot be read cannot be cleared either; nothing to do.
  }
}

export function loadSchedule(storage) {
  if (!usable(storage)) return "";
  try {
    const text = storage.getItem(SCHEDULE_KEY);
    return typeof text === "string" ? text : "";
  } catch (err) {
    return "";
  }
}

// An empty paste clears the saved copy rather than storing "" — and so does an
// oversized one, because silently restoring yesterday's paste on the next refresh
// would look like a fresh batch.
export function saveSchedule(storage, text) {
  if (!usable(storage)) return SAVE.UNAVAILABLE;
  const value = typeof text === "string" ? text : "";
  if (!value.trim()) {
    forget(storage);
    return SAVE.EMPTY;
  }
  if (value.length > MAX_STORED_CHARS) {
    forget(storage);
    return SAVE.TOO_LARGE;
  }
  try {
    storage.setItem(SCHEDULE_KEY, value);
    return SAVE.OK;
  } catch (err) {
    return SAVE.UNAVAILABLE;
  }
}

export function clearSchedule(storage) {
  if (!usable(storage)) return;
  forget(storage);
}

// How many jobs a paste holds, for the "Saved locally · 149 jobs" note.
export function countJobs(text) {
  if (typeof text !== "string") return 0;
  let jobs = 0;
  for (const line of text.split("\n")) {
    if (/^\s*\d{7}\b/.test(line)) jobs += 1;
  }
  return jobs;
}
