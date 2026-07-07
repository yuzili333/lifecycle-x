import { useCallback } from "react";
import { useToast } from "@astryxdesign/core/Toast";
import type { ShowToastFn, ToastOptions } from "@astryxdesign/core/Toast";

const DEFAULT_TOAST_AUTO_HIDE_DURATION = 5000;

export function useAppToast(): ShowToastFn {
  const toast = useToast();

  return useCallback(
    (options: ToastOptions) =>
      toast({
        isAutoHide: true,
        autoHideDuration: DEFAULT_TOAST_AUTO_HIDE_DURATION,
        ...options,
      }),
    [toast],
  );
}
