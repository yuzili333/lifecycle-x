import { resolveThemeTokens } from "@astryxdesign/core/theme";
import { neutralTheme } from "@astryxdesign/theme-neutral";
import type { ResolvedVisualizationTheme, VisualizationSpec, VisualizationThemeResolver } from "./types";

export const neutralLightVisualizationTheme = resolveAstryxNeutralVisualizationTheme("light");
export const neutralDarkVisualizationTheme = resolveAstryxNeutralVisualizationTheme("dark");

export function resolveAstryxNeutralVisualizationTheme(
  appearance: "light" | "dark",
  providedTokens?: Record<string, string>,
): ResolvedVisualizationTheme {
  const tokens = providedTokens ?? resolveThemeTokens(neutralTheme, { mode: appearance });
  const token = (name: string, fallbackName?: string) => tokens[name] || (fallbackName ? tokens[fallbackName] : "") || "currentColor";
  return {
    name: "astryx-neutral",
    mode: appearance,
    colors: {
      primary: [
        token("--color-accent"),
        token("--color-text-secondary"),
        token("--color-border-emphasized", "--color-border"),
        token("--color-text-disabled", "--color-text-secondary"),
        token("--color-text-primary"),
        token("--color-border"),
      ],
      positive: token("--color-success", "--color-text-green"),
      warning: token("--color-warning", "--color-text-yellow"),
      danger: token("--color-error", "--color-text-red"),
      neutral: [
        token("--color-background-body"),
        token("--color-background-surface"),
        token("--color-background-muted"),
        token("--color-text-secondary"),
        token("--color-text-primary"),
      ],
      textPrimary: token("--color-text-primary"),
      textSecondary: token("--color-text-secondary"),
      border: token("--color-border"),
      background: token("--color-background-surface"),
    },
    typography: {
      fontFamily: token("--font-family-body"),
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
}

export class DefaultVisualizationThemeResolver implements VisualizationThemeResolver {
  resolve(
    spec: VisualizationSpec,
    context?: { appearance?: "light" | "dark"; tokens?: Record<string, string> },
  ): ResolvedVisualizationTheme {
    const requestedMode = spec.theme?.mode;
    const appearance = requestedMode === "light" || requestedMode === "dark"
      ? requestedMode
      : context?.appearance ?? "dark";
    return resolveAstryxNeutralVisualizationTheme(appearance, context?.tokens);
  }
}
