/**
 * Mock for @tauri-apps/plugin-dialog
 *
 * open() returns window.__E2E__.dialogResult (default: null)
 * save() returns window.__E2E__.saveResult (default: null)
 */

function getE2E(): any {
  const w = window as any;
  if (!w.__E2E__) w.__E2E__ = {};
  return w.__E2E__;
}

export async function open(_options?: any): Promise<string | string[] | null> {
  return getE2E().dialogResult ?? null;
}

export async function save(_options?: any): Promise<string | null> {
  return getE2E().saveResult ?? null;
}
