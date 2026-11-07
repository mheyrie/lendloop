import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { appError, isAdmin, requireViewer } from "./lib/auth";
import { approvedLoansForTool, toolAvailability } from "./lib/availability";
import { LIMITS } from "./lib/constants";
import { todayUTC } from "./lib/dates";
import { enqueueLoanEvent, firstName } from "./lib/outbox";
import { categoryValidator, conditionValidator } from "./lib/validators";

const toolInput = {
  name: v.string(),
  category: categoryValidator,
  condition: conditionValidator,
  description: v.string(),
};

function cleanToolInput(input: { name: string; description: string }) {
  const name = input.name.trim();
  const description = input.description.trim();
  if (name.length < 2 || name.length > LIMITS.toolName) {
    throw appError("INVALID", `Name must be 2–${LIMITS.toolName} characters.`);
  }
  if (description.length > LIMITS.toolDescription) {
    throw appError("INVALID", `Description must be at most ${LIMITS.toolDescription} characters.`);
  }
  return { name, description };
}

async function activeTools(ctx: QueryCtx) {
  return await ctx.db
    .query("tools")
    .withIndex("by_removedAt", (q) => q.eq("removedAt", undefined))
    .order("desc")
    .take(500);
}

/** Public, unauthenticated. Only name + category of tools available right now — no owner data. */
export const listPublic = query({
  args: {},
  handler: async (ctx) => {
    const today = todayUTC();
    const tools = await activeTools(ctx);
    const result: { _id: Id<"tools">; name: string; category: Doc<"tools">["category"] }[] = [];
    for (const t of tools) {
      const availability = await toolAvailability(ctx, t._id, today);
      if (availability.status === "available") result.push({ _id: t._id, name: t.name, category: t.category });
    }
    return result.sort((a, b) => a.name.localeCompare(b.name));
  },
});

/** Signed-in browse view: all active tools with availability, optionally filtered by category. */
export const browse = query({
  args: { category: v.optional(categoryValidator) },
  handler: async (ctx, { category }) => {
    const viewer = await requireViewer(ctx);
    const today = todayUTC();
    const tools = (await activeTools(ctx)).filter((t) => !category || t.category === category);
    const myOpenLoans = (
      await ctx.db
        .query("loans")
        .withIndex("by_borrower", (q) => q.eq("borrowerId", viewer._id))
        .collect()
    ).filter((l) => l.status === "pending" || l.status === "approved");

    return await Promise.all(
      tools.map(async (t) => {
        const owner = await ctx.db.get(t.ownerId);
        const myOpenRequest = myOpenLoans.find((l) => l.toolId === t._id);
        return {
          _id: t._id,
          name: t.name,
          category: t.category,
          condition: t.condition,
          description: t.description,
          // Neighbors see a first name and the trust badge only — never email.
          owner: { firstName: owner ? firstName(owner.name) : "Neighbor", trustedLender: owner?.trustedLender ?? false },
          isMine: t.ownerId === viewer._id,
          availability: await toolAvailability(ctx, t._id, today),
          myOpenRequest: myOpenRequest
            ? { status: myOpenRequest.status, startDate: myOpenRequest.startDate, endDate: myOpenRequest.endDate }
            : null,
        };
      }),
    );
  },
});

export const mine = query({
  args: {},
  handler: async (ctx) => {
    const viewer = await requireViewer(ctx);
    const today = todayUTC();
    const tools = await ctx.db
      .query("tools")
      .withIndex("by_owner", (q) => q.eq("ownerId", viewer._id))
      .order("desc")
      .collect();
    return await Promise.all(
      tools
        .filter((t) => t.removedAt === undefined)
        .map(async (t) => {
          const pending = await ctx.db
            .query("loans")
            .withIndex("by_tool_status", (q) => q.eq("toolId", t._id).eq("status", "pending"))
            .collect();
          return {
            _id: t._id,
            name: t.name,
            category: t.category,
            condition: t.condition,
            description: t.description,
            availability: await toolAvailability(ctx, t._id, today),
            pendingRequests: pending.length,
          };
        }),
    );
  },
});

export const create = mutation({
  args: toolInput,
  handler: async (ctx, args) => {
    const viewer = await requireViewer(ctx);
    const { name, description } = cleanToolInput(args);
    const now = Date.now();
    return await ctx.db.insert("tools", {
      ownerId: viewer._id,
      name,
      description,
      category: args.category,
      condition: args.condition,
      createdAt: now,
      updatedAt: now,
    });
  },
});

async function loadActiveTool(ctx: MutationCtx, toolId: Id<"tools">) {
  const tool = await ctx.db.get(toolId);
  if (!tool || tool.removedAt !== undefined) throw appError("NOT_FOUND", "Listing not found.");
  return tool;
}

export const update = mutation({
  args: { toolId: v.id("tools"), ...toolInput },
  handler: async (ctx, { toolId, ...args }) => {
    const viewer = await requireViewer(ctx);
    const tool = await loadActiveTool(ctx, toolId);
    // Ownership only — admins moderate by removing, not by rewriting someone's listing.
    if (tool.ownerId !== viewer._id) throw appError("FORBIDDEN", "You can only edit your own listings.");
    const { name, description } = cleanToolInput(args);
    await ctx.db.patch(toolId, {
      name,
      description,
      category: args.category,
      condition: args.condition,
      updatedAt: Date.now(),
    });
  },
});

/** Owners delete their own listing; admins can remove any listing (moderation). Soft delete. */
export const remove = mutation({
  args: { toolId: v.id("tools") },
  handler: async (ctx, { toolId }) => {
    const viewer = await requireViewer(ctx);
    const tool = await loadActiveTool(ctx, toolId);
    const isOwner = tool.ownerId === viewer._id;
    if (!isOwner && !isAdmin(viewer)) throw appError("FORBIDDEN", "You can only delete your own listings.");

    const today = todayUTC();
    const approved = await approvedLoansForTool(ctx, toolId);
    if (isOwner && !isAdmin(viewer) && approved.some((l) => l.startDate <= today)) {
      throw appError("CONFLICT", "This tool is currently on loan. Mark it returned before deleting.");
    }

    const now = Date.now();
    await ctx.db.patch(toolId, { removedAt: now, removedBy: viewer._id, updatedAt: now });

    // Close out open requests and let the borrowers know.
    const pending = await ctx.db
      .query("loans")
      .withIndex("by_tool_status", (q) => q.eq("toolId", toolId).eq("status", "pending"))
      .collect();
    for (const loan of [...pending, ...approved.filter((l) => l.startDate > today)]) {
      await ctx.db.patch(loan._id, { status: "cancelled", updatedAt: now });
      const updated = (await ctx.db.get(loan._id))!;
      await enqueueLoanEvent(ctx, "loan.cancelled", updated, loan.borrowerId, viewer);
    }
  },
});
