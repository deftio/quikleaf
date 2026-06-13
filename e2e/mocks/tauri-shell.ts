/**
 * Mock for @tauri-apps/plugin-shell
 *
 * open(url) records to window.__E2E__.shellOpened[]
 */

function getE2E(): any {
  const w = window as any;
  if (!w.__E2E__) w.__E2E__ = {};
  if (!w.__E2E__.shellOpened) w.__E2E__.shellOpened = [];
  return w.__E2E__;
}

export async function open(url: string): Promise<void> {
  getE2E().shellOpened.push(url);
}
