/// <reference types="vite/client" />
// Copyright (c) 2026 Mheyrie. All rights reserved. Proprietary — see LICENSE.
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "../convex/_generated/api";
import schema from "../convex/schema";
import { signRequest, verifySignature } from "../convex/lib/hmac";
import { todayUTC } from "../convex/lib/dates";

const modules = import.meta.glob("../convex/**/!(*.*.*)*.*s");

function addDays(iso: string, n: number) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

async function setup() {
  const t = convexTest(schema, modules);
  const alice = t.withIdentity({ subject: "alice", name: "Alice Lender", email: "alice@example.com" });
  const bob = t.withIdentity({ subject: "bob", name: "Bob Borrower", email: "bob@example.com" });
  const carol = t.withIdentity({ subject: "carol", name: "Carol Other", email: "carol@example.com" });
  const admin = t.withIdentity({ subject: "admin", name: "Ada Admin", email: "admin@example.com" });
  for (const u of [alice, bob, carol, admin]) await u.mutation(api.users.store, {});
  await t.mutation(internal.users.setRole, { email: "admin@example.com", role: "admin" });

  const toolId = await alice.mutation(api.tools.create, {
    name: "Cordless drill",
    category: "power_tools",
    condition: "good",
    description: "Secret garage code is 1234", // must never leak into webhooks
  });
  return { t, alice, bob, carol, admin, toolId };
}

const today = todayUTC();

// Keep scheduled webhook deliveries queued instead of firing after a test finishes.
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("role-based access control", () => {
  test("anonymous callers can only see the public list (name + category)", async () => {
    const { t } = await setup();
    const publicList = await t.query(api.tools.listPublic, {});
    expect(publicList).toHaveLength(1);
    expect(Object.keys(publicList[0]).sort()).toEqual(["_id", "category", "name"]);
    await expect(t.query(api.tools.browse, {})).rejects.toThrow(/sign in/i);
  });

  test("users can only edit and delete their own listings", async () => {
    const { bob, toolId } = await setup();
    await expect(
      bob.mutation(api.tools.update, { toolId, name: "Mine now", category: "garden", condition: "worn", description: "" }),
    ).rejects.toThrow(/own listings/);
    await expect(bob.mutation(api.tools.remove, { toolId })).rejects.toThrow(/own listings/);
  });

  test("admins can remove any listing; users cannot use admin functions", async () => {
    const { admin, bob, toolId, t } = await setup();
    await expect(bob.query(api.loans.all, {})).rejects.toThrow(/Admins only/);
    const users = await admin.query(api.users.listForAdmin, {});
    const bobId = users.find((u) => u.email === "bob@example.com")!._id;
    await expect(bob.mutation(api.users.setTrustedLender, { userId: bobId, trusted: true })).rejects.toThrow(/Admins only/);

    await admin.mutation(api.tools.remove, { toolId });
    expect(await t.query(api.tools.listPublic, {})).toHaveLength(0);
  });

  test("re-syncing a profile never changes the role", async () => {
    const { bob } = await setup();
    await bob.mutation(api.users.store, {});
    expect((await bob.query(api.users.me, {}))?.role).toBe("user");
  });

  test("only the lender can approve, only the borrower can cancel", async () => {
    const { alice, bob, carol, toolId } = await setup();
    const loanId = await bob.mutation(api.loans.request, { toolId, startDate: today, endDate: addDays(today, 2) });
    await expect(carol.mutation(api.loans.approve, { loanId })).rejects.toThrow(/owner/);
    await expect(bob.mutation(api.loans.approve, { loanId })).rejects.toThrow(/owner/);
    await expect(carol.mutation(api.loans.cancel, { loanId })).rejects.toThrow(/your own/);
    await alice.mutation(api.loans.approve, { loanId });
    await expect(bob.mutation(api.loans.markReturned, { loanId })).rejects.toThrow(/owner/);
    await alice.mutation(api.loans.markReturned, { loanId });
    expect((await bob.query(api.loans.myRequests, {}))[0].status).toBe("returned");
  });
});

describe("loan rules", () => {
  test("cannot borrow your own tool or double-book", async () => {
    const { alice, bob, carol, toolId } = await setup();
    await expect(alice.mutation(api.loans.request, { toolId, startDate: today, endDate: today })).rejects.toThrow(/own tool/);

    const first = await bob.mutation(api.loans.request, { toolId, startDate: today, endDate: addDays(today, 3) });
    const competing = await carol.mutation(api.loans.request, { toolId, startDate: addDays(today, 2), endDate: addDays(today, 4) });
    await alice.mutation(api.loans.approve, { loanId: first });

    // The overlapping pending request is auto-declined.
    expect((await carol.query(api.loans.myRequests, {})).find((l) => l._id === competing)?.status).toBe("declined");
    await expect(
      carol.mutation(api.loans.request, { toolId, startDate: addDays(today, 1), endDate: addDays(today, 1) }),
    ).rejects.toThrow(/already booked/);
  });

  test("rejects past and over-long ranges", async () => {
    const { bob, toolId } = await setup();
    await expect(bob.mutation(api.loans.request, { toolId, startDate: addDays(today, -1), endDate: today })).rejects.toThrow(/past/);
    await expect(bob.mutation(api.loans.request, { toolId, startDate: today, endDate: addDays(today, 45) })).rejects.toThrow(/at most/);
  });
});

describe("n8n integration", () => {
  test("webhook payloads are minimal", async () => {
    const { bob, toolId, t } = await setup();
    await bob.mutation(api.loans.request, { toolId, startDate: today, endDate: today });
    const deliveries = await t.run((ctx) => ctx.db.query("webhookDeliveries").collect());
    expect(deliveries).toHaveLength(1);
    const payload = JSON.parse(deliveries[0].payload);
    expect(payload.eventType).toBe("loan.requested");
    expect(payload.recipient).toEqual({ firstName: "Alice", email: "alice@example.com" });
    expect(deliveries[0].payload).not.toContain("garage code");
    expect(deliveries[0].payload).not.toContain("bob@example.com");
  });

  test("automation write-backs are idempotent", async () => {
    const { bob, toolId, t } = await setup();
    const loanId = await bob.mutation(api.loans.request, { toolId, startDate: today, endDate: today });
    const args = { idempotencyKey: `reminder:${loanId}:${today}`, loanId, kind: "reminder" as const, status: "sent" as const };
    expect((await t.mutation(internal.automation.recordEvent, args)).result).toBe("created");
    expect((await t.mutation(internal.automation.recordEvent, args)).result).toBe("duplicate");
    // A late failure retry can't overwrite a success.
    expect((await t.mutation(internal.automation.recordEvent, { ...args, status: "failed" })).result).toBe("duplicate");
    const rows = await t.run((ctx) => ctx.db.query("automationEvents").collect());
    expect(rows).toHaveLength(1);
    expect((await bob.query(api.loans.myRequests, {}))[0].activity[0]).toMatchObject({ kind: "reminder", status: "sent" });
  });

  test("HTTP endpoints require a valid signature", async () => {
    const { t } = await setup();
    process.env.LENDLOOP_API_SECRET = "test-secret";

    expect((await t.fetch("/n8n/overdue-loans", { method: "GET" })).status).toBe(401);

    const forged = await signRequest("wrong-secret", "GET", "/n8n/overdue-loans", "");
    const bad = await t.fetch("/n8n/overdue-loans", {
      method: "GET",
      headers: { "x-lendloop-timestamp": forged.timestamp, "x-lendloop-signature": forged.signature },
    });
    expect(bad.status).toBe(401);

    const good = await signRequest("test-secret", "GET", "/n8n/overdue-loans", "");
    const ok = await t.fetch("/n8n/overdue-loans", {
      method: "GET",
      headers: { "x-lendloop-timestamp": good.timestamp, "x-lendloop-signature": good.signature },
    });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ count: 0, loans: [] });
  });
});

describe("hmac", () => {
  test("rejects tampered bodies, other paths and stale timestamps", async () => {
    const s = await signRequest("k", "POST", "/a", '{"x":1}');
    const base = { secret: "k", method: "POST", path: "/a", body: '{"x":1}', timestamp: s.timestamp, signature: s.signature };
    expect((await verifySignature(base)).ok).toBe(true);
    expect((await verifySignature({ ...base, body: '{"x":2}' })).ok).toBe(false);
    expect((await verifySignature({ ...base, path: "/b" })).ok).toBe(false);
    expect((await verifySignature({ ...base, nowMs: (Number(s.timestamp) + 301) * 1000 })).ok).toBe(false);
  });
});
