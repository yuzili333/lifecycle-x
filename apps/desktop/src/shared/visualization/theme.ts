import type { ResolvedVisualizationTheme, VisualizationSpec, VisualizationThemeResolver } from "./types";

export const neutralDarkVisualizationTheme: ResolvedVisualizationTheme = {
  name: "astryx-neutral",
  mode: "dark",
  colors: {
    primary: ["#65d6d2", "#7aa2ff", "#b989ff", "#f4c96b", "#69df97", "#ff8e8e"],
    positive: "#69df97",
    warning: "#f4c96b",
    danger: "#ff8e8e",
    neutral: ["#0f1724", "#172033", "#253249", "#8ea0b8", "#e6edf6"],
    textPrimary: "#e6edf6",
    textSecondary: "#8ea0b8",
    border: "rgba(230, 237, 246, 0.14)",
    background: "#0f1724",
  },
  typography: {
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif",
    titleSize: 14,
    labelSize: 12,
    valueSize: 24,
    lineHeight: 1.5,
  },
  spacing: {
    xs: 4,
    sm: 8,
    md: 12,
    lg: 16,
  },
};

export class DefaultVisualizationThemeResolver implements VisualizationThemeResolver {
  resolve(_spec: VisualizationSpec): ResolvedVisualizationTheme {
    return neutralDarkVisualizationTheme;
  }
}
