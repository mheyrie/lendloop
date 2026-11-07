// Copyright (c) 2026 Mheyrie. All rights reserved. Proprietary — see LICENSE.
// Shared between the Convex backend and the Next.js UI.

export const CATEGORIES = [
  { value: "power_tools", label: "Power tools" },
  { value: "hand_tools", label: "Hand tools" },
  { value: "garden", label: "Garden" },
  { value: "kitchen", label: "Kitchen" },
  { value: "camping", label: "Camping" },
  { value: "cleaning", label: "Cleaning" },
  { value: "sports", label: "Sports & outdoors" },
  { value: "other", label: "Other" },
] as const;

export const CONDITIONS = [
  { value: "like_new", label: "Like new" },
  { value: "good", label: "Good" },
  { value: "fair", label: "Fair" },
  { value: "worn", label: "Well used" },
] as const;

export type Category = (typeof CATEGORIES)[number]["value"];
export type Condition = (typeof CONDITIONS)[number]["value"];
export type LoanStatus = "pending" | "approved" | "declined" | "cancelled" | "returned";
export type Role = "admin" | "user";

export const LIMITS = {
  toolName: 80,
  toolDescription: 500,
  requestMessage: 300,
  maxLoanDays: 30,
  maxAdvanceBookingDays: 180,
} as const;

export function categoryLabel(value: string): string {
  return CATEGORIES.find((c) => c.value === value)?.label ?? value;
}

export function conditionLabel(value: string): string {
  return CONDITIONS.find((c) => c.value === value)?.label ?? value;
}
