import React, { useEffect, useState } from "react";
import ReactDOM from "react-dom/client";
import { Theme } from "@astryxdesign/core";
import { LayerProvider } from "@astryxdesign/core/Layer";
import { neutralTheme } from "@astryxdesign/theme-neutral/built";
import App from "./App";

type AppThemeMode = "light" | "dark";

const APP_THEME_MODE_CACHE_KEY = "cycle-probe:theme-mode";
const APP_THEME_MODE_EVENT = "cycle-probe:theme-mode-change";

function isAppThemeMode(value: string | null): value is AppThemeMode {
  return value === "light" || value === "dark";
}

function readCachedAppThemeMode(): AppThemeMode {
  try {
    const cached = window.localStorage.getItem(APP_THEME_MODE_CACHE_KEY);
    return isAppThemeMode(cached) ? cached : "dark";
  } catch {
    return "dark";
  }
}

function ThemedApp() {
  const [themeMode, setThemeMode] = useState<AppThemeMode>(readCachedAppThemeMode);

  useEffect(() => {
    const handleThemeModeChange = (event: Event) => {
      const nextMode = (event as CustomEvent<AppThemeMode>).detail;
      if (isAppThemeMode(nextMode)) {
        setThemeMode(nextMode);
      }
    };

    window.addEventListener(APP_THEME_MODE_EVENT, handleThemeModeChange);
    return () => window.removeEventListener(APP_THEME_MODE_EVENT, handleThemeModeChange);
  }, []);

  return (
    <Theme theme={neutralTheme} mode={themeMode}>
      <LayerProvider toast={{ position: "bottomEnd", maxVisible: 3, inset: { bottom: 24, end: 24 } }}>
        <App />
      </LayerProvider>
    </Theme>
  );
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <ThemedApp />
  </React.StrictMode>,
);
