import type { Theme } from "./types";

export interface ThemeMeta {
  id: Theme;
  name: string;
  /** Three swatch colors: app bg, surface, accent. */
  swatch: [string, string, string];
}

export const THEME_LIST: ThemeMeta[] = [
  { id: "dark", name: "Fily Dark", swatch: ["#1b1b1c", "#232324", "#5b8cff"] },
  { id: "light", name: "Fily Light", swatch: ["#f4f4f2", "#ffffff", "#2f6df6"] },
  { id: "dracula", name: "Dracula", swatch: ["#282a36", "#44475a", "#bd93f9"] },
  { id: "catppuccin-mocha", name: "Catppuccin Mocha", swatch: ["#1e1e2e", "#313244", "#cba6f7"] },
  { id: "catppuccin-latte", name: "Catppuccin Latte", swatch: ["#eff1f5", "#ffffff", "#8839ef"] },
  { id: "nord", name: "Nord", swatch: ["#2e3440", "#3b4252", "#88c0d0"] },
  { id: "gruvbox", name: "Gruvbox Dark", swatch: ["#282828", "#3c3836", "#fabd2f"] },
  { id: "tokyo-night", name: "Tokyo Night", swatch: ["#1a1b26", "#24283b", "#7aa2f7"] },
  { id: "one-dark", name: "One Dark", swatch: ["#282c34", "#2f343d", "#61afef"] },
];

export function themeName(id: Theme): string {
  return THEME_LIST.find((t) => t.id === id)?.name ?? id;
}
