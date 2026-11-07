// Copyright (c) 2026 Mheyrie. All rights reserved. Proprietary — see LICENSE.
import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";
import { daysBetween } from "./lib/dates";
import { firstName } from "./lib/outbox";
import { automationKindValidator, automationStatusValidator } from "./lib/validators";

/** Key used for the once-per-day overdue reminder of a loan. */
export function reminderKey(loanId: string, date: string) {
  return `reminder:${loanId}:${date}`;
}

/**
 * Overdue = approved (not returned) and past its end date.
 * Loans that already got a successful reminder today are excluded, so re-running the
 * daily workflow (manual re-run, n8n retry) doesn't spam borrowers.
 * Returns only what the reminder needs.
 */
export const overdueLoans = internalQuery({
  args: { today: v.string() },
  handler: async (ctx, { today }) => {
    const loans = await ctx.db
      .query("loans")
      .withIndex("by_status_endDate", (q) => q.eq("status", "approved").lt("endDate", today))
      .take(500);

    const result = [];
    for (const loan of loans) {
      const key = reminderKey(loan._id, today);
      const already = await ctx.db
        .query("automationEvents")
        .withIndex("by_key", (q) => q.eq("idempotencyKey", key))
        .unique();
      if (already?.status === "sent") continue;

      const [borrower, tool] = await Promise.all([ctx.db.get(loan.borrowerId), ctx.db.get(loan.toolId)]);
      if (!borrower || !tool) continue;
      result.push({
        loanId: loan._id,
        reminderKey: key,
        borrower: { firstName: firstName(borrower.name), email: borrower.email },
        toolName: tool.name,
        endDate: loan.endDate,
        daysOverdue: daysBetween(loan.endDate, today),
      });
    }
    return result;
  },
});

/**
 * Idempotent write-back from n8n. One row per idempotencyKey:
 * - first call inserts,
 * - repeated calls update attempts/status but never create a second row,
 * - a `sent` row is final and never downgraded to `failed` by a late retry.
 */
export const recordEvent = internalMutation({
  args: {
    idempotencyKey: v.string(),
    loanId: v.string(),
    kind: automationKindValidator,
    status: automationStatusValidator,
    channel: v.optional(v.string()),
    detail: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const loanId = ctx.db.normalizeId("loans", args.loanId);
    if (!loanId || !(await ctx.db.get(loanId))) return { result: "unknown_loan" as const };

    const existing = await ctx.db
      .query("automationEvents")
      .withIndex("by_key", (q) => q.eq("idempotencyKey", args.idempotencyKey))
      .unique();

    if (existing) {
      if (existing.status === "sent") return { result: "duplicate" as const };
      await ctx.db.patch(existing._id, {
        status: args.status,
        channel: args.channel,
        detail: args.detail,
        occurredAt: Date.now(),
        attempts: existing.attempts + 1,
      });
      return { result: "updated" as const };
    }

    await ctx.db.insert("automationEvents", {
      idempotencyKey: args.idempotencyKey,
      loanId,
      kind: args.kind,
      status: args.status,
      channel: args.channel,
      detail: args.detail,
      occurredAt: Date.now(),
      attempts: 1,
    });
    return { result: "created" as const };
  },
});

export const recordWorkflowError = internalMutation({
  args: {
    executionId: v.string(),
    workflowName: v.string(),
    lastNode: v.optional(v.string()),
    message: v.string(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("workflowErrors")
      .withIndex("by_executionId", (q) => q.eq("executionId", args.executionId))
      .unique();
    if (existing) return { result: "duplicate" as const };
    await ctx.db.insert("workflowErrors", { ...args, occurredAt: Date.now() });
    return { result: "created" as const };
  },
});
