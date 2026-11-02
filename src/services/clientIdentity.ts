const STORAGE_KEY = 'garage-watch.client-id.v1';
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function createClientId(): string | undefined {
  try {
    if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID();
    if (!globalThis.crypto?.getRandomValues) return undefined;
    const bytes = new Uint8Array(16);
    globalThis.crypto.getRandomValues(bytes);
    bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
    bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
    const hex = [...bytes].map((value) => value.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  } catch {
    return undefined;
  }
}

/** Keeps the ephemeral presence ID stable across reloads in the same browser tab. */
export function getOrCreateClientId(): string | undefined {
  let storage: Storage | undefined;
  try {
    storage = window.sessionStorage;
    const saved = storage.getItem(STORAGE_KEY);
    if (saved && UUID_PATTERN.test(saved)) return saved;
  } catch {
    // Presence can still work for this page load when session storage is unavailable.
  }

  const clientId = createClientId();
  if (!clientId) return undefined;
  try {
    (storage ?? window.sessionStorage).setItem(STORAGE_KEY, clientId);
  } catch {
    // The ID is not an authentication credential; retain it in memory for this page load.
  }
  return clientId;
}
