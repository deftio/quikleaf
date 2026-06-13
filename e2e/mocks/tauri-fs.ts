/**
 * Mock for @tauri-apps/plugin-fs
 *
 * readTextFile / writeTextFile backed by window.__E2E__.fsStore (in-memory map).
 */

function getE2E(): any {
  const w = window as any;
  if (!w.__E2E__) w.__E2E__ = {};
  if (!w.__E2E__.fsStore) w.__E2E__.fsStore = {};
  return w.__E2E__;
}

export async function readTextFile(path: string): Promise<string> {
  const store = getE2E().fsStore;
  if (path in store) return store[path];
  throw new Error(`File not found: ${path}`);
}

export async function writeTextFile(path: string, content: string): Promise<void> {
  getE2E().fsStore[path] = content;
}
