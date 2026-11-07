import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalAction, internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { appError, requireAdmin } from "./lib/auth";
import { signRequest } from "./lib/hmac";

/**
 * Delivery of outbox rows to n8n.
 * - Signed with N8N_WEBHOOK_SECRET (HMAC-SHA256, see lib/hmac.ts).
 * - Retries with exponential backoff; after MAX_ATTEMPTS the row is marked `failed`
 *   and surfaces in the admin "Automation health" panel, where it can be retried.
 * - n8n treats `eventId` as an idempotency key, so retries are safe.
 */

export const MAX_ATTEMPTS = 5;
const BACKOFF_MS = [10_000, 60_000, 5 * 60_000, 30 * 60_000];
const REQUEST_TIMEOUT_MS = 10_000;

export const getDelivery = internalQuery({
  args: { deliveryId: v.id("webhookDeliveries") },
  handler: (ctx, { deliveryId }) => ctx.db.get(deliveryId),
});

export const deliver = internalAction({
  args: { deliveryId: v.id("webhookDeliveries") },
  handler: async (ctx, { deliveryId }) => {
    const delivery = await ctx.runQuery(internal.webhooks.getDelivery, { deliveryId });
    if (!delivery || delivery.status === "delivered" || delivery.status === "failed") return;

    const url = process.env.N8N_LOAN_EVENTS_WEBHOOK_URL;
    const secret = process.env.N8N_WEBHOOK_SECRET;
    let error: string | undefined;

    if (!url || !secret) {
      error = "N8N_LOAN_EVENTS_WEBHOOK_URL or N8N_WEBHOOK_SECRET is not set";
    } else {
      try {
        const { timestamp, signature } = await signRequest(secret, "POST", new URL(url).pathname, delivery.payload);
        const res = await fetch(url, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-lendloop-timestamp": timestamp,
            "x-lendloop-signature": signature,
            "x-lendloop-event-id": delivery.eventId,
          },
          body: delivery.payload,
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
        if (!res.ok) error = `n8n responded HTTP ${res.status}`;
      } catch (e) {
        error = e instanceof Error ? e.message : String(e);
      }
    }

    await ctx.runMutation(internal.webhooks.recordAttempt, { deliveryId, error });
  },
});

export const recordAttempt = internalMutation({
  args: { deliveryId: v.id("webhookDeliveries"), error: v.optional(v.string()) },
  handler: async (ctx, { deliveryId, error }) => {
    const delivery = await ctx.db.get(deliveryId);
    if (!delivery) return;
    const attempts = delivery.attempts + 1;

    if (!error) {
      await ctx.db.patch(deliveryId, { status: "delivered", attempts, deliveredAt: Date.now(), lastError: undefined });
      return;
    }
    if (attempts >= MAX_ATTEMPTS) {
      console.error(`Webhook ${delivery.eventId} failed permanently after ${attempts} attempts: ${error}`);
      await ctx.db.patch(deliveryId, { status: "failed", attempts, lastError: error });
      return;
    }
    const base = BACKOFF_MS[Math.min(attempts - 1, BACKOFF_MS.length - 1)];
    const delay = base + Math.floor(Math.random() * base * 0.2); // jitter
    console.warn(`Webhook ${delivery.eventId} attempt ${attempts} failed (${error}); retrying in ${delay}ms`);
    await ctx.db.patch(deliveryId, { status: "retrying", attempts, lastError: error });
    await ctx.scheduler.runAfter(delay, internal.webhooks.deliver, { deliveryId });
  },
});

// ---------- admin visibility ----------

export const health = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    const [failed, retrying, errors] = await Promise.all([
      ctx.db.query("webhookDeliveries").withIndex("by_status", (q) => q.eq("status", "failed")).order("desc").take(50),
      ctx.db.query("webhookDeliveries").withIndex("by_status", (q) => q.eq("status", "retrying")).order("desc").take(50),
      ctx.db.query("workflowErrors").order("desc").take(20),
    ]);
    return {
      deliveries: [...retrying, ...failed].map((d) => ({
        _id: d._id,
        eventType: d.eventType,
        status: d.status,
        attempts: d.attempts,
        lastError: d.lastError ?? null,
        createdAt: d.createdAt,
      })),
      workflowErrors: errors.map((e) => ({
        _id: e._id,
        workflowName: e.workflowName,
        lastNode: e.lastNode ?? null,
        message: e.message,
        occurredAt: e.occurredAt,
      })),
    };
  },
});

export const retry = mutation({
  args: { deliveryId: v.id("webhookDeliveries") },
  handler: async (ctx, { deliveryId }) => {
    await requireAdmin(ctx);
    const delivery = await ctx.db.get(deliveryId);
    if (!delivery) throw appError("NOT_FOUND", "Delivery not found.");
    if (delivery.status !== "failed") throw appError("CONFLICT", "Only failed deliveries can be retried.");
    await ctx.db.patch(deliveryId, { status: "pending", attempts: 0 });
    await ctx.scheduler.runAfter(0, internal.webhooks.deliver, { deliveryId });
  },
});
