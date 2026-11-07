// Copyright (c) 2026 Mheyrie. All rights reserved. Proprietary — see LICENSE.
import { ConvexError } from "convex/values";
import type { Doc } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";

/**
 * Every public query/mutation resolves the caller through these helpers.
 * Identity comes from the Clerk-issued JWT that Convex verifies (see auth.config.ts);
 * the role comes from our own users table, never from client input.
 */

export type Viewer = Doc<"users">;

export function appError(code: "UNAUTHENTICATED" | "FORBIDDEN" | "NOT_FOUND" | "INVALID" | "CONFLICT", message: string) {
  return new ConvexError({ code, message });
}

export async function getViewer(ctx: QueryCtx | MutationCtx): Promise<Viewer | null> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) return null;
  return await ctx.db
    .query("users")
    .withIndex("by_token", (q) => q.eq("tokenIdentifier", identity.tokenIdentifier))
    .unique();
}

export async function requireViewer(ctx: QueryCtx | MutationCtx): Promise<Viewer> {
  const viewer = await getViewer(ctx);
  if (!viewer) throw appError("UNAUTHENTICATED", "Please sign in to continue.");
  return viewer;
}

export async function requireAdmin(ctx: QueryCtx | MutationCtx): Promise<Viewer> {
  const viewer = await requireViewer(ctx);
  if (viewer.role !== "admin") throw appError("FORBIDDEN", "Admins only.");
  return viewer;
}

export function isAdmin(viewer: Viewer | null): boolean {
  return viewer?.role === "admin";
}
