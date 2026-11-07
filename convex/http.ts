import { httpRouter } from "convex/server";
import { internal } from "./_generated/api";
import { httpAction } from "./_generated/server";
import { todayUTC } from "./lib/dates";
import { verifySignature } from "./lib/hmac";

/**
 * Machine-to-machine endpoints for n8n (served on https://<deployment>.convex.site).
 * Every request must carry a valid HMAC signature made with LENDLOOP_API_SECRET.
 * This is a different secret from the one Convex uses to sign outgoing webhooks,
 * so leaking one direction doesn't compromise the other.
 */

const MAX_BODY_BYTES = 8 * 1024;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

/** Returns an error Response, or null when the request is authentic. */
async function authenticate(request: Request, body: string): Promise<Response | null> {
  const secret = process.env.LENDLOOP_API_SECRET;
  if (!secret) {
    console.error("LENDLOOP_API_SECRET is not configured");
    return json({ error: "not_configured" }, 503);
  }
  const { pathname } = new URL(request.url);
  const result = await verifySignature({
    secret,
    method: request.method,
    path: pathname,
    body,
    timestamp: request.headers.get("x-lendloop-timestamp"),
    signature: request.headers.get("x-lendloop-signature"),
  });
  if (!result.ok) {
    console.warn(`Rejected ${request.method} ${pathname}: ${result.reason}`);
    return json({ error: "unauthorized" }, 401); // don't tell the caller *why*
  }
  return null;
}

async function readBody(request: Request): Promise<string | Response> {
  const body = await request.text();
  if (body.length > MAX_BODY_BYTES) return json({ error: "payload_too_large" }, 413);
  return body;
}

function parseJson(body: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(body);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

const str = (v: unknown, max = 500) => (typeof v === "string" && v.length > 0 && v.length <= max ? v : undefined);

const http = httpRouter();

http.route({
  path: "/n8n/overdue-loans",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    const denied = await authenticate(request, "");
    if (denied) return denied;
    const today = todayUTC();
    const loans = await ctx.runQuery(internal.automation.overdueLoans, { today });
    return json({ date: today, count: loans.length, loans });
  }),
});

http.route({
  path: "/n8n/automation-events",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const body = await readBody(request);
    if (body instanceof Response) return body;
    const denied = await authenticate(request, body);
    if (denied) return denied;

    const data = parseJson(body);
    const idempotencyKey = str(data?.idempotencyKey, 200);
    const loanId = str(data?.loanId, 64);
    const kind = data?.kind;
    const status = data?.status;
    if (!idempotencyKey || !loanId || (kind !== "notification" && kind !== "reminder") || (status !== "sent" && status !== "failed")) {
      return json({ error: "invalid_payload" }, 400);
    }

    const { result } = await ctx.runMutation(internal.automation.recordEvent, {
      idempotencyKey,
      loanId,
      kind,
      status,
      channel: str(data?.channel, 40),
      detail: str(data?.detail, 300),
    });
    if (result === "unknown_loan") return json({ error: "unknown_loan" }, 404);
    // 200 for both created and duplicate: retries are expected and harmless.
    return json({ ok: true, result });
  }),
});

http.route({
  path: "/n8n/workflow-errors",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const body = await readBody(request);
    if (body instanceof Response) return body;
    const denied = await authenticate(request, body);
    if (denied) return denied;

    const data = parseJson(body);
    const executionId = str(data?.executionId, 64);
    const workflowName = str(data?.workflowName, 120);
    const message = str(data?.message, 1000);
    if (!executionId || !workflowName || !message) return json({ error: "invalid_payload" }, 400);

    const { result } = await ctx.runMutation(internal.automation.recordWorkflowError, {
      executionId,
      workflowName,
      message,
      lastNode: str(data?.lastNode, 120),
    });
    return json({ ok: true, result });
  }),
});

export default http;
