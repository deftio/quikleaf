/**
 * Small helpers on top of bitwrench's TACO objects.
 *
 * bitwrench's `make*()` factories deliberately take a narrow prop set and
 * most of them have no `id` option. Our e2e tests, keyboard shortcuts and
 * status updates all address elements by id, so we merge attributes onto the
 * TACO a factory returns. A TACO is plain data, so this is the sanctioned way
 * to do it — no DOM is touched.
 */
import bw from "bitwrench";
import type { Taco, TacoAttributes, TacoContent } from "bitwrench";

/** Merge attributes (id, class, aria-*, handlers) into a TACO and return it. */
export function withAttrs(taco: Taco, attrs: TacoAttributes): Taco {
  const existing = taco.a ?? {};
  const merged: TacoAttributes = { ...existing, ...attrs };
  // Classes are additive: a factory's structural class must survive.
  if (existing.class && attrs.class) {
    merged.class = `${joinClass(existing.class)} ${joinClass(attrs.class)}`.trim();
  }
  taco.a = merged;
  return taco;
}

function joinClass(c: string | string[]): string {
  return Array.isArray(c) ? c.join(" ") : c;
}

/**
 * Props `bw.makeModal()` actually reads (bitwrench-bccl.js). The shipped
 * `ModalConfig` type lags the implementation (`closable` vs `closeButton`,
 * no `onClose`/`open`/`className`), so we keep an accurate local type and cast.
 */
export interface ModalProps {
  title?: string | Taco;
  content?: TacoContent;
  footer?: TacoContent;
  size?: "sm" | "lg" | "xl";
  closeButton?: boolean;
  closeLabel?: string;
  onClose?: () => void;
  open?: boolean;
  className?: string;
}

export function makeModal(props: ModalProps): Taco {
  return bw.makeModal(props as Parameters<typeof bw.makeModal>[0]);
}

/** The imperative handle `bw.makeModal()` installs on its root element. */
export interface ModalHandle {
  open(): void;
  close(): void;
}

export function modalHandle(el: HTMLElement | null): ModalHandle | null {
  const h = (el as any)?.bw as ModalHandle | undefined;
  return h && typeof h.open === "function" ? h : null;
}

/** True while any bitwrench modal (Settings, About) is showing. */
export function isModalOpen(): boolean {
  return document.querySelector(".bw_bccl_modal_show") !== null;
}

/**
 * Options `bw.syncChildren()` actually reads (bitwrench.js). The shipped type
 * says `{ key?: string }`, but the implementation wants a key function plus
 * `create`/`update` callbacks, so this wrapper carries the accurate type.
 */
export interface SyncOptions<T> {
  key: (item: T) => string;
  create: (item: T) => Taco;
  update?: (node: HTMLElement, item: T) => void;
}

export function syncChildren<T>(parent: HTMLElement, items: T[], opts: SyncOptions<T>): void {
  bw.syncChildren(parent, items as unknown as Taco[], opts as unknown as { key?: string });
}

/** `bw.patch` with a plain object sets attributes; the shipped type only admits content, hence this wrapper. */
export function patchAttrs(target: string | HTMLElement, attrs: Record<string, string>): void {
  bw.patch(target, attrs as unknown as TacoContent);
}

/** Resolve an element by id (or selector) through bitwrench. */
export function el<T extends HTMLElement = HTMLElement>(ref: string): T | null {
  return bw.el(ref) as T | null;
}

/** `bw.el` for form controls, throwing a clear error if the shell is not mounted. */
export function control<T extends HTMLElement>(id: string): T {
  const node = bw.el(id) as T | null;
  if (!node) throw new Error(`quikleaf: #${id} is not mounted`);
  return node;
}
