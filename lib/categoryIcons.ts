// UI-only decoration for categories (kept out of the shared backend constants).
export const CATEGORY_ICON: Record<string, string> = {
  power_tools: "🪛",
  hand_tools: "🔨",
  garden: "🌿",
  kitchen: "🍳",
  camping: "⛺",
  cleaning: "🧽",
  sports: "🚲",
  other: "📦",
};

export function categoryIcon(value: string): string {
  return CATEGORY_ICON[value] ?? "📦";
}
