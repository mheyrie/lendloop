// Copyright (c) 2026 Mheyrie. All rights reserved. Proprietary — see LICENSE.
import type { Infer } from "convex/values";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import type { loanEventTypeValidator } from "./validators";

export type LoanEventType = Infer<typeof loanEventTypeValidator>;

export function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] || "Neighbor";
}

/**
 * Queue a signed webhook to n8n in the same transaction as the state change
 * (transactional outbox): if the mutation commits, the event is guaranteed to be
 * attempted; if it rolls back, nothing is sent.
 *
 * Data minimisation: the payload carries only what the notification needs —
 * recipient first name + email, tool name, dates and status. No descriptions,
 * no other user's contact details, no internal user IDs.
 */
export async function enqueueLoanEvent(
  ctx: MutationCtx,
  eventType: LoanEventType,
  loan: Doc<"loans">,
  recipientId: Id<"users">,
  actor: Doc<"users">,
) {
  const [tool, recipient] = await Promise.all([ctx.db.get(loan.toolId), ctx.db.get(recipientId)]);
  if (!tool || !recipient) return;

  // Deterministic, unique per transition; also used by n8n/Convex as an idempotency key.
  const eventId = `${eventType}:${loan._id}:${loan.updatedAt}`;
  const payload = JSON.stringify({
    eventId,
    eventType,
    occurredAt: new Date(loan.updatedAt).toISOString(),
    loan: { id: loan._id, status: loan.status, startDate: loan.startDate, endDate: loan.endDate },
    toolName: tool.name,
    recipient: { firstName: firstName(recipient.name), email: recipient.email },
    actorFirstName: firstName(actor.name),
  });

  const deliveryId = await ctx.db.insert("webhookDeliveries", {
    eventId,
    eventType,
    loanId: loan._id,
    payload,
    status: "pending",
    attempts: 0,
    createdAt: Date.now(),
  });
  await ctx.scheduler.runAfter(0, internal.webhooks.deliver, { deliveryId });
}
