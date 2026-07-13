import type { ResolvedVisualizationTheme, VisualizationSpec, VisualizationThemeResolver } from "./types";

export const neutralDarkVisualizationTheme: ResolvedVisualizationTheme = {
  name: "astryx-neutral",
  mode: "dark",
  colors: {
    primary: ["#fafafa", "#d4d4d4", "#a3a3a3", "#737373", "#525252", "#404040"],
    positive: "#d4d4d4",
    warning: "#e5e5e5",
    danger: "#a3a3a3",
    neutral: ["#171717", "#262626", "#404040", "#a3a3a3", "#fafafa"],
    textPrimary: "#fafafa",
    textSecondary: "#a3a3a3",
    border: "rgba(250, 250, 250, 0.14)",
    background: "#171717",
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
