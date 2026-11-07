import { ConvexError } from "convex/values";

export function errorMessage(e: unknown): string {
  if (e instanceof ConvexError) {
    const data = e.data as { message?: string } | string;
    return typeof data === "string" ? data : (data?.message ?? "Something went wrong.");
  }
  return "Something went wrong. Please try again.";
}

export function timeAgo(ms: number, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - ms) / 1000));
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  return d === 1 ? "yesterday" : `${d} days ago`;
}

export function formatDate(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" });
}

export function formatRange(start: string, end: string): string {
  return start === end ? formatDate(start) : `${formatDate(start)} – ${formatDate(end)}`;
}

export function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}
