// Auto-saved editor drafts kept in the browser (IndexedDB), keyed by file name + size.
const DB = "actes-drafts", STORE = "drafts";

function open(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}

export const draftKey = (name: string, size: number) => `${name}::${size}`;

export async function saveDraft(key: string, value: unknown) {
  try {
    const db = await open();
    db.transaction(STORE, "readwrite").objectStore(STORE).put({ value, at: Date.now() }, key);
  } catch { /* storage unavailable */ }
}

export async function loadDraft<T>(key: string): Promise<T | null> {
  try {
    const db = await open();
    return await new Promise((res) => {
      const r = db.transaction(STORE).objectStore(STORE).get(key);
      r.onsuccess = () => res((r.result?.value as T) ?? null);
      r.onerror = () => res(null);
    });
  } catch { return null; }
}

export async function clearDraft(key: string) {
  try {
    const db = await open();
    db.transaction(STORE, "readwrite").objectStore(STORE).delete(key);
  } catch { /* ignore */ }
}
