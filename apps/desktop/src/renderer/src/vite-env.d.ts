/// <reference types="vite/client" />

import type { LifecycleXApi } from "../../preload";

declare global {
  interface ImportMetaEnv {
    readonly VITE_AUTH_API_URL?: string;
  }

  interface ImportMeta {
    readonly env: ImportMetaEnv;
  }

  interface Window {
    lifecycleX?: LifecycleXApi;
  }
}
