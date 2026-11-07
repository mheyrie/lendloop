import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import {
  automationKindValidator,
  automationStatusValidator,
  categoryValidator,
  conditionValidator,
  loanEventTypeValidator,
  loanStatusValidator,
  roleValidator,
} from "./lib/validators";

export default defineSchema({
  /** Mirror of the Clerk user. Role lives here (server-side source of truth), not in client-editable metadata. */
  users: defineTable({
    tokenIdentifier: v.string(),
    name: v.string(),
    email: v.string(),
    role: roleValidator,
    trustedLender: v.boolean(),
    createdAt: v.number(),
  })
    .index("by_token", ["tokenIdentifier"])
    .index("by_email", ["email"]),

  tools: defineTable({
    ownerId: v.id("users"),
    name: v.string(),
    category: categoryValidator,
    condition: conditionValidator,
    description: v.string(),
    createdAt: v.number(),
    updatedAt: v.number(),
    // Soft delete keeps loan history intact.
    removedAt: v.optional(v.number()),
    removedBy: v.optional(v.id("users")),
  })
    .index("by_owner", ["ownerId"])
    .index("by_removedAt", ["removedAt"]),

  loans: defineTable({
    toolId: v.id("tools"),
    lenderId: v.id("users"),
    borrowerId: v.id("users"),
    startDate: v.string(), // YYYY-MM-DD (UTC calendar date)
    endDate: v.string(), // inclusive
    message: v.optional(v.string()),
    status: loanStatusValidator,
    createdAt: v.number(),
    updatedAt: v.number(),
    returnedAt: v.optional(v.number()),
  })
    .index("by_tool_status", ["toolId", "status"])
    .index("by_borrower", ["borrowerId"])
    .index("by_lender", ["lenderId"])
    .index("by_status_endDate", ["status", "endDate"]),

  /**
   * Transactional outbox for Convex -> n8n webhooks. Rows are written in the same
   * mutation as the state change, then delivered by a scheduled action with retries.
   */
  webhookDeliveries: defineTable({
    eventId: v.string(),
    eventType: loanEventTypeValidator,
    loanId: v.id("loans"),
    payload: v.string(), // exact JSON body that gets signed
    status: v.union(
      v.literal("pending"),
      v.literal("retrying"),
      v.literal("delivered"),
      v.literal("failed"),
    ),
    attempts: v.number(),
    lastError: v.optional(v.string()),
    createdAt: v.number(),
    deliveredAt: v.optional(v.number()),
  })
    .index("by_eventId", ["eventId"])
    .index("by_status", ["status"]),

  /** Write-backs from n8n. idempotencyKey is unique, so retried calls update instead of duplicating. */
  automationEvents: defineTable({
    idempotencyKey: v.string(),
    loanId: v.id("loans"),
    kind: automationKindValidator,
    status: automationStatusValidator,
    channel: v.optional(v.string()),
    detail: v.optional(v.string()),
    occurredAt: v.number(),
    attempts: v.number(),
  })
    .index("by_key", ["idempotencyKey"])
    .index("by_loan", ["loanId"]),

  /** Failed n8n executions reported by the error workflow, so failures are visible in the admin view. */
  workflowErrors: defineTable({
    executionId: v.string(),
    workflowName: v.string(),
    lastNode: v.optional(v.string()),
    message: v.string(),
    occurredAt: v.number(),
  }).index("by_executionId", ["executionId"]),
});
