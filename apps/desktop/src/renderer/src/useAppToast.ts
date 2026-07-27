import { useCallback } from "react";
import { useToast } from "@astryxdesign/core/Toast";
import type { ShowToastFn, ToastOptions } from "@astryxdesign/core/Toast";

const DEFAULT_TOAST_AUTO_HIDE_DURATION = 5000;
const TOAST_VIEWPORT_SELECTOR = '[role="region"][aria-label="Notifications"][popover="manual"]';

export function useAppToast(): ShowToastFn {
  const toast = useToast();

  return useCallback(
    (options: ToastOptions) => {
      const dismiss = toast({
        isAutoHide: true,
        autoHideDuration: DEFAULT_TOAST_AUTO_HIDE_DURATION,
        ...options,
      });
      promoteToastViewportAboveDialogs();
      return dismiss;
    },
    [toast],
  );
}

export function promoteToastViewportAboveDialogs(
  root: ParentNode | undefined = typeof document === "undefined" ? undefined : document,
) {
  const viewport = root?.querySelector<HTMLElement>(TOAST_VIEWPORT_SELECTOR);
  if (!viewport || typeof viewport.showPopover !== "function") return;

  try {
    viewport.hidePopover?.();
  } catch {
    // The viewport may already be outside the top layer.
  }

  try {
    viewport.showPopover();
  } catch {
    // Keep toast delivery non-blocking on runtimes without complete Popover API support.
  }
}
