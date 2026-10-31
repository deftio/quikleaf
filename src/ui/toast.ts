/**
 * Transient notifications built on `bw.makeToast()`.
 *
 * bitwrench expects toasts inside a positioned `.bw_bccl_toast_container`;
 * we create one lazily in the app root and append toasts to it.
 */
import bw from "bitwrench";
import type { TacoContent } from "bitwrench";
import { control, el } from "./taco";

const ROOT_ID = "toast-root";

function container(): HTMLElement {
  const existing = el(ROOT_ID);
  if (existing) return existing;
  return bw.append(control("app"), {
    t: "div",
    a: { id: ROOT_ID, class: "bw_bccl_toast_container bw_bccl_toast_bottom_right", "aria-live": "polite" },
  });
}

export type ToastVariant = "info" | "success" | "warning" | "danger";

export function notify(title: string, content: TacoContent, variant: ToastVariant = "info", delay = 6000): HTMLElement {
  return bw.append(
    container(),
    bw.makeToast({ title, content, variant, position: "bottom-right", autoDismiss: true, delay } as Parameters<typeof bw.makeToast>[0]),
  );
}
