// Copyright (c) 2026 Mheyrie. All rights reserved. Proprietary — see LICENSE.
import { v } from "convex/values";
import { internalMutation, mutation, query } from "./_generated/server";
import { appError, getViewer, requireAdmin } from "./lib/auth";
import { roleValidator } from "./lib/validators";

/**
 * Called by the client after sign-in to upsert the caller's profile from the verified JWT.
 * Never touches role/trustedLender, so a user can't promote themselves.
 */
export const store = mutation({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw appError("UNAUTHENTICATED", "Please sign in to continue.");

    const email = identity.email ?? "";
    const name = identity.name ?? identity.givenName ?? (email.split("@")[0] || "Neighbor");

    const existing = await getViewer(ctx);
    if (existing) {
      if (existing.name !== name || existing.email !== email) {
        await ctx.db.patch(existing._id, { name, email });
      }
      return existing._id;
    }
    return await ctx.db.insert("users", {
      tokenIdentifier: identity.tokenIdentifier,
      name,
      email,
      role: "user",
      trustedLender: false,
      createdAt: Date.now(),
    });
  },
});

export const me = query({
  args: {},
  handler: async (ctx) => {
    const viewer = await getViewer(ctx);
    if (!viewer) return null;
    return { _id: viewer._id, name: viewer.name, role: viewer.role, trustedLender: viewer.trustedLender };
  },
});

export const listForAdmin = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    const users = await ctx.db.query("users").order("desc").take(500);
    return await Promise.all(
      users.map(async (u) => {
        const tools = await ctx.db
          .query("tools")
          .withIndex("by_owner", (q) => q.eq("ownerId", u._id))
          .collect();
        return {
          _id: u._id,
          name: u.name,
          email: u.email,
          role: u.role,
          trustedLender: u.trustedLender,
          activeListings: tools.filter((t) => t.removedAt === undefined).length,
        };
      }),
    );
  },
});

export const setTrustedLender = mutation({
  args: { userId: v.id("users"), trusted: v.boolean() },
  handler: async (ctx, { userId, trusted }) => {
    await requireAdmin(ctx);
    const user = await ctx.db.get(userId);
    if (!user) throw appError("NOT_FOUND", "User not found.");
    await ctx.db.patch(userId, { trustedLender: trusted });
  },
});

/**
 * Role changes are deliberately NOT exposed to clients. Promote an admin from the CLI:
 *   npx convex run users:setRole '{"email":"you@example.com","role":"admin"}'
 */
export const setRole = internalMutation({
  args: { email: v.string(), role: roleValidator },
  handler: async (ctx, { email, role }) => {
    const user = await ctx.db
      .query("users")
      .withIndex("by_email", (q) => q.eq("email", email))
      .unique();
    if (!user) throw new Error(`No user with email ${email}. Sign in once first.`);
    await ctx.db.patch(user._id, { role });
    return `${email} is now ${role}`;
  },
});
