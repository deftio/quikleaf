/**
 * Mock for @tauri-apps/api/event
 *
 * Provides an in-browser event bus so that mock invoke("llm_chat_stream")
 * can fire "llm-chunk" and "llm-done" events to registered listen() handlers.
 */

type Handler = (event: { payload: any }) => void;

interface EventBus {
  listeners: Map<string, Set<Handler>>;
  emit: (eventName: string, payload: any) => void;
}

function getEventBus(): EventBus {
  const w = window as any;
  if (!w.__E2E_EVENTS__) {
    const listeners = new Map<string, Set<Handler>>();
    w.__E2E_EVENTS__ = {
      listeners,
      emit(eventName: string, payload: any) {
        const set = listeners.get(eventName);
        if (set) {
          for (const fn of set) {
            try {
              fn({ payload });
            } catch (e) {
              console.error(`[e2e-event] handler error for "${eventName}":`, e);
            }
          }
        }
      },
    };
  }
  return w.__E2E_EVENTS__;
}

// Initialize the event bus immediately on import
getEventBus();

export type UnlistenFn = () => void;

export async function listen<T = any>(
  eventName: string,
  handler: (event: { payload: T }) => void
): Promise<UnlistenFn> {
  const bus = getEventBus();
  if (!bus.listeners.has(eventName)) {
    bus.listeners.set(eventName, new Set());
  }
  bus.listeners.get(eventName)!.add(handler as Handler);
  return () => {
    bus.listeners.get(eventName)?.delete(handler as Handler);
  };
}

export async function emit(eventName: string, payload?: any): Promise<void> {
  getEventBus().emit(eventName, payload);
}
