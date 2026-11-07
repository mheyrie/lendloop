import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { appError, requireAdmin, requireViewer, type Viewer } from "./lib/auth";
import { approvedLoansForTool } from "./lib/availability";
import { LIMITS } from "./lib/constants";
import { daysBetween, isValidISODate, rangesOverlap, todayUTC } from "./lib/dates";
import { enqueueLoanEvent, firstName } from "./lib/outbox";
import { loanStatusValidator } from "./lib/validators";

// ---------- read model ----------

async function recentActivity(ctx: QueryCtx, loanId: Id<"loans">) {
  const events = await ctx.db
    .query("automationEvents")
    .withIndex("by_loan", (q) => q.eq("loanId", loanId))
    .order("desc")
    .take(3);
  return events.map((e) => ({ kind: e.kind, status: e.status, channel: e.channel ?? null, occurredAt: e.occurredAt }));
}

/** Shapes a loan for the UI. Counterparts are identified by first name only. */
async function toLoanView(ctx: QueryCtx, loan: Doc<"loans">, today: string) {
  const [tool, lender, borrower] = await Promise.all([
    ctx.db.get(loan.toolId),
    ctx.db.get(loan.lenderId),
    ctx.db.get(loan.borrowerId),
  ]);
  return {
    _id: loan._id,
    status: loan.status,
    startDate: loan.startDate,
    endDate: loan.endDate,
    message: loan.message ?? null,
    createdAt: loan.createdAt,
    returnedAt: loan.returnedAt ?? null,
    overdue: loan.status === "approved" && loan.endDate < today,
    tool: tool ? { _id: tool._id, name: tool.name, category: tool.category, removed: tool.removedAt !== undefined } : null,
    lender: { firstName: lender ? firstName(lender.name) : "Neighbor", trustedLender: lender?.trustedLender ?? false },
    borrower: { firstName: borrower ? firstName(borrower.name) : "Neighbor" },
    activity: await recentActivity(ctx, loan._id),
  };
}

export const myRequests = query({
  args: {},
  handler: async (ctx) => {
    const viewer = await requireViewer(ctx);
    const today = todayUTC();
    const loans = await ctx.db
      .query("loans")
      .withIndex("by_borrower", (q) => q.eq("borrowerId", viewer._id))
      .order("desc")
      .take(200);
    return await Promise.all(loans.map((l) => toLoanView(ctx, l, today)));
  },
});

export const incoming = query({
  args: {},
  handler: async (ctx) => {
    const viewer = await requireViewer(ctx);
    const today = todayUTC();
    const loans = await ctx.db
      .query("loans")
      .withIndex("by_lender", (q) => q.eq("lenderId", viewer._id))
      .order("desc")
      .take(200);
    return await Promise.all(loans.map((l) => toLoanView(ctx, l, today)));
  },
});

export const all = query({
  args: { status: v.optional(loanStatusValidator) },
  handler: async (ctx, { status }) => {
    await requireAdmin(ctx);
    const today = todayUTC();
    const loans = await ctx.db.query("loans").order("desc").take(500);
    return await Promise.all(
      loans.filter((l) => !status || l.status === status).map((l) => toLoanView(ctx, l, today)),
    );
  },
});

// ---------- commands ----------

async function loadLoan(ctx: MutationCtx, loanId: Id<"loans">) {
  const loan = await ctx.db.get(loanId);
  if (!loan) throw appError("NOT_FOUND", "Request not found.");
  return loan;
}

function assertLender(loan: Doc<"loans">, viewer: Viewer) {
  if (loan.lenderId !== viewer._id) throw appError("FORBIDDEN", "Only the tool's owner can do that.");
}

function assertStatus(loan: Doc<"loans">, expected: Doc<"loans">["status"]) {
  if (loan.status !== expected) throw appError("CONFLICT", `This request is already ${loan.status}.`);
}

async function transition(
  ctx: MutationCtx,
  loan: Doc<"loans">,
  status: "approved" | "declined" | "cancelled" | "returned",
  actor: Viewer,
  notify: Id<"users">,
  extra: Partial<Doc<"loans">> = {},
) {
  const now = Date.now();
  await ctx.db.patch(loan._id, { status, updatedAt: now, ...extra });
  const updated = (await ctx.db.get(loan._id))!;
  await enqueueLoanEvent(ctx, `loan.${status}` as const, updated, notify, actor);
}

export const request = mutation({
  args: {
    toolId: v.id("tools"),
    startDate: v.string(),
    endDate: v.string(),
    message: v.optional(v.string()),
  },
  handler: async (ctx, { toolId, startDate, endDate, message }) => {
    const viewer = await requireViewer(ctx);
    const tool = await ctx.db.get(toolId);
    if (!tool || tool.removedAt !== undefined) throw appError("NOT_FOUND", "This tool is no longer listed.");
    if (tool.ownerId === viewer._id) throw appError("INVALID", "You can't borrow your own tool.");

    const today = todayUTC();
    if (!isValidISODate(startDate) || !isValidISODate(endDate)) throw appError("INVALID", "Pick valid dates.");
    if (startDate < today) throw appError("INVALID", "Start date can't be in the past.");
    if (endDate < startDate) throw appError("INVALID", "End date must be on or after the start date.");
    if (daysBetween(startDate, endDate) + 1 > LIMITS.maxLoanDays) {
      throw appError("INVALID", `Loans can be at most ${LIMITS.maxLoanDays} days.`);
    }
    if (daysBetween(today, startDate) > LIMITS.maxAdvanceBookingDays) {
      throw appError("INVALID", `You can book at most ${LIMITS.maxAdvanceBookingDays} days ahead.`);
    }
    const note = message?.trim() || undefined;
    if (note && note.length > LIMITS.requestMessage) {
      throw appError("INVALID", `Message must be at most ${LIMITS.requestMessage} characters.`);
    }

    const mine = await ctx.db
      .query("loans")
      .withIndex("by_borrower", (q) => q.eq("borrowerId", viewer._id))
      .collect();
    if (mine.some((l) => l.toolId === toolId && (l.status === "pending" || l.status === "approved") && rangesOverlap(l.startDate, l.endDate, startDate, endDate))) {
      throw appError("CONFLICT", "You already have a request for this tool on those dates.");
    }
    const approved = await approvedLoansForTool(ctx, toolId);
    if (approved.some((l) => rangesOverlap(l.startDate, l.endDate, startDate, endDate))) {
      throw appError("CONFLICT", "That tool is already booked for some of those dates.");
    }

    const now = Date.now();
    const loanId = await ctx.db.insert("loans", {
      toolId,
      lenderId: tool.ownerId,
      borrowerId: viewer._id,
      startDate,
      endDate,
      message: note,
      status: "pending",
      createdAt: now,
      updatedAt: now,
    });
    await enqueueLoanEvent(ctx, "loan.requested", (await ctx.db.get(loanId))!, tool.ownerId, viewer);
    return loanId;
  },
});

export const approve = mutation({
  args: { loanId: v.id("loans") },
  handler: async (ctx, { loanId }) => {
    const viewer = await requireViewer(ctx);
    const loan = await loadLoan(ctx, loanId);
    assertLender(loan, viewer);
    assertStatus(loan, "pending");

    const tool = await ctx.db.get(loan.toolId);
    if (!tool || tool.removedAt !== undefined) throw appError("CONFLICT", "This listing was removed.");
    if (loan.endDate < todayUTC()) throw appError("CONFLICT", "These dates have already passed — decline instead.");

    const approved = await approvedLoansForTool(ctx, loan.toolId);
    if (approved.some((l) => rangesOverlap(l.startDate, l.endDate, loan.startDate, loan.endDate))) {
      throw appError("CONFLICT", "You've already approved another request for overlapping dates.");
    }

    await transition(ctx, loan, "approved", viewer, loan.borrowerId);

    // Auto-decline other pending requests that can no longer be honoured.
    const pending = await ctx.db
      .query("loans")
      .withIndex("by_tool_status", (q) => q.eq("toolId", loan.toolId).eq("status", "pending"))
      .collect();
    for (const other of pending) {
      if (rangesOverlap(other.startDate, other.endDate, loan.startDate, loan.endDate)) {
        await transition(ctx, other, "declined", viewer, other.borrowerId);
      }
    }
  },
});

export const decline = mutation({
  args: { loanId: v.id("loans") },
  handler: async (ctx, { loanId }) => {
    const viewer = await requireViewer(ctx);
    const loan = await loadLoan(ctx, loanId);
    assertLender(loan, viewer);
    assertStatus(loan, "pending");
    await transition(ctx, loan, "declined", viewer, loan.borrowerId);
  },
});

export const cancel = mutation({
  args: { loanId: v.id("loans") },
  handler: async (ctx, { loanId }) => {
    const viewer = await requireViewer(ctx);
    const loan = await loadLoan(ctx, loanId);
    if (loan.borrowerId !== viewer._id) throw appError("FORBIDDEN", "You can only cancel your own requests.");
    assertStatus(loan, "pending");
    await transition(ctx, loan, "cancelled", viewer, loan.lenderId);
  },
});

/** The lender confirms they got the tool back. */
export const markReturned = mutation({
  args: { loanId: v.id("loans") },
  handler: async (ctx, { loanId }) => {
    const viewer = await requireViewer(ctx);
    const loan = await loadLoan(ctx, loanId);
    assertLender(loan, viewer);
    assertStatus(loan, "approved");
    await transition(ctx, loan, "returned", viewer, loan.borrowerId, { returnedAt: Date.now() });
  },
});
