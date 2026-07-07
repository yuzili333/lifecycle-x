import React from "react";
import ReactDOM from "react-dom/client";
import { Theme } from "@astryxdesign/core";
import { LayerProvider } from "@astryxdesign/core/Layer";
import { neutralTheme } from "@astryxdesign/theme-neutral/built";
import App from "./App";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <Theme theme={neutralTheme}>
      <LayerProvider toast={{ position: "bottomEnd", maxVisible: 3, inset: { bottom: 24, end: 24 } }}>
        <App />
      </LayerProvider>
    </Theme>
  </React.StrictMode>,
);
