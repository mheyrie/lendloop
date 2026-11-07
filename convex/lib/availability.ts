import type { Doc, Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";

export type Availability =
  | { status: "available"; nextBooking: { startDate: string; endDate: string } | null }
  | { status: "on_loan"; until: string; overdue: boolean };

export async function approvedLoansForTool(ctx: QueryCtx, toolId: Id<"tools">): Promise<Doc<"loans">[]> {
  return await ctx.db
    .query("loans")
    .withIndex("by_tool_status", (q) => q.eq("toolId", toolId).eq("status", "approved"))
    .collect();
}

/** A tool is "on loan" if an approved, not-yet-returned loan has started. */
export async function toolAvailability(ctx: QueryCtx, toolId: Id<"tools">, today: string): Promise<Availability> {
  const approved = await approvedLoansForTool(ctx, toolId);
  const current = approved.find((l) => l.startDate <= today);
  if (current) {
    return { status: "on_loan", until: current.endDate, overdue: current.endDate < today };
  }
  const next = approved.sort((a, b) => a.startDate.localeCompare(b.startDate))[0];
  return {
    status: "available",
    nextBooking: next ? { startDate: next.startDate, endDate: next.endDate } : null,
  };
}
