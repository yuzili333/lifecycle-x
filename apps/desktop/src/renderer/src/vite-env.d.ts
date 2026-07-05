/// <reference types="vite/client" />

import type { LifecycleXApi } from "../../preload";

declare global {
  interface Window {
    lifecycleX: LifecycleXApi;
  }
}
