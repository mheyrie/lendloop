# Source of truth for n8n/workflows/*.json (keeps the embedded JS readable/reviewable).
# Usage: python3 n8n/generate_workflows.py n8n/workflows
import json, sys, os
out = sys.argv[1]

CFG = r"""
// Config: n8n Variables ($vars, n8n Cloud) first, then environment ($env, self-hosted).
function cfg(name) {
  try { if (typeof $vars !== 'undefined' && $vars[name]) return $vars[name]; } catch (e) {}
  try { if ($env[name]) return $env[name]; } catch (e) {}
  return undefined;
}
""".strip()

SIGN_HELPER = r"""
// HMAC-SHA256 request signing for calls to Convex (same scheme as convex/lib/hmac.ts).
// The secret lives in the n8n environment, never in this workflow JSON.
function signFor(method, path, body) {
  const crypto = require('crypto');
  const secret = cfg('LENDLOOP_API_SECRET');
  if (!secret) throw new Error('LENDLOOP_API_SECRET is not set (n8n Variable or env var)');
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const hex = crypto.createHmac('sha256', secret).update(`${timestamp}.${method}.${path}.${body}`).digest('hex');
  const base = cfg('LENDLOOP_CONVEX_SITE_URL');
  if (!base) throw new Error('LENDLOOP_CONVEX_SITE_URL is not set (n8n Variable or env var)');
  return { timestamp, signature: `v1=${hex}`, url: base.replace(/\/$/, '') + path };
}
""".strip()

RETRY_HELPER = r"""
// Retries with exponential backoff, then reports failure instead of throwing,
// so the outcome is always written back to Convex.
async function withRetry(fn, attempts = 3) {
  let lastError;
  for (let i = 0; i < attempts; i++) {
    try { return { ok: true, value: await fn(), attempts: i + 1 }; }
    catch (e) {
      lastError = e;
      if (i < attempts - 1) await new Promise((r) => setTimeout(r, 1000 * 2 ** i));
    }
  }
  return { ok: false, error: String(lastError?.message ?? lastError).slice(0, 200), attempts };
}
const maskEmail = (e) => String(e).replace(/^(.).*(@.*)$/, '$1***$2');
""".strip()

def code(name, js, pos, each=False, extra=None):
    js = CFG + "\n\n" + js
    n = {"parameters": {"jsCode": js}, "name": name, "type": "n8n-nodes-base.code", "typeVersion": 2, "position": pos, "id": name.lower().replace(" ", "-").replace("(", "").replace(")", "").replace("?", "")}
    if each: n["parameters"]["mode"] = "runOnceForEachItem"
    if extra: n.update(extra)
    return n

def http(name, method, path_expr, pos, body_expr=None):
    p = {
        "method": method,
        "url": "={{ $json.url }}",
        "sendHeaders": True,
        "headerParameters": {"parameters": [
            {"name": "x-lendloop-timestamp", "value": "={{ $json.timestamp }}"},
            {"name": "x-lendloop-signature", "value": "={{ $json.signature }}"},
        ]},
        "options": {"timeout": 10000},
    }
    if body_expr:
        p.update({"sendBody": True, "contentType": "raw", "rawContentType": "application/json", "body": body_expr})
    return {"parameters": p, "name": name, "type": "n8n-nodes-base.httpRequest", "typeVersion": 4.2, "position": pos,
            "id": name.lower().replace(" ", "-"), "retryOnFail": True, "maxTries": 5, "waitBetweenTries": 3000}

def if_true(name, expr, pos):
    return {"parameters": {"conditions": {"options": {"caseSensitive": True, "leftValue": "", "typeValidation": "strict"},
            "conditions": [{"id": name.lower().replace(" ", "-") + "-c", "leftValue": expr, "rightValue": "",
                            "operator": {"type": "boolean", "operation": "true", "singleValue": True}}],
            "combinator": "and"}, "options": {}},
            "name": name, "type": "n8n-nodes-base.if", "typeVersion": 2, "position": pos, "id": name.lower().replace(" ", "-").replace("?", "")}

def link(*pairs):
    c = {}
    for src, dsts in pairs:
        c[src] = {"main": [[{"node": d, "type": "main", "index": 0} for d in (branch if isinstance(branch, list) else [branch])] for branch in dsts]}
    return c

SETTINGS = {"executionOrder": "v1", "errorWorkflow": "LendLoopErrorHandler", "saveDataErrorExecution": "all", "saveDataSuccessExecution": "all", "timezone": "UTC"}

# ---------------- 1. Loan event notifications ----------------
verify_js = r"""
// Verify the HMAC signature Convex put on this webhook before trusting anything in it.
const crypto = require('crypto');
const secret = cfg('LENDLOOP_N8N_WEBHOOK_SECRET');
if (!secret) throw new Error('LENDLOOP_N8N_WEBHOOK_SECRET is not set (n8n Variable or env var)');

const item = $input.first();
const headers = item.json.headers || {};
const timestamp = headers['x-lendloop-timestamp'];
const signature = headers['x-lendloop-signature'];
// Must match the pathname of N8N_LOAN_EVENTS_WEBHOOK_URL configured in Convex.
const path = cfg('LENDLOOP_WEBHOOK_PATH') || '/webhook/lendloop-loan-events';

// Prefer the exact raw bytes; fall back to re-serialising the parsed body.
let raw;
if (item.binary && item.binary.data) {
  raw = (await this.helpers.getBinaryDataBuffer(0, 'data')).toString('utf8');
} else {
  raw = JSON.stringify(item.json.body);
}

let reason = null;
const now = Math.floor(Date.now() / 1000);
if (!timestamp || !signature) reason = 'missing signature headers';
else if (!/^\d+$/.test(timestamp) || Math.abs(now - Number(timestamp)) > 300) reason = 'timestamp outside tolerance';
else {
  const expected = Buffer.from('v1=' + crypto.createHmac('sha256', secret).update(`${timestamp}.POST.${path}.${raw}`).digest('hex'));
  const given = Buffer.from(String(signature));
  if (expected.length !== given.length || !crypto.timingSafeEqual(expected, given)) reason = 'signature mismatch';
}
if (reason) {
  console.warn(`[LendLoop] rejected webhook: ${reason}`);
  return [{ json: { valid: false } }];
}

// Data minimisation: keep only the fields the notification needs; drop headers etc.
const e = JSON.parse(raw);
return [{ json: {
  valid: true,
  eventId: e.eventId,
  eventType: e.eventType,
  loanId: e.loan.id,
  startDate: e.loan.startDate,
  endDate: e.loan.endDate,
  toolName: e.toolName,
  recipientFirstName: e.recipient.firstName,
  recipientEmail: e.recipient.email,
  actorFirstName: e.actorFirstName,
} }];
""".strip()

compose_js = r"""
const e = $input.first().json;
const range = e.startDate === e.endDate ? e.startDate : `${e.startDate} to ${e.endDate}`;
const templates = {
  'loan.requested': [`${e.actorFirstName} wants to borrow your ${e.toolName}`, `${e.actorFirstName} asked to borrow your ${e.toolName} (${range}). Approve or decline it under Incoming requests.`],
  'loan.approved':  [`Your request for ${e.toolName} was approved`, `${e.actorFirstName} approved your request for ${e.toolName} (${range}).`],
  'loan.declined':  [`Your request for ${e.toolName} was declined`, `Your request for ${e.toolName} (${range}) wasn't approved this time.`],
  'loan.cancelled': [`A request for ${e.toolName} was cancelled`, `The request for ${e.toolName} (${range}) was cancelled.`],
  'loan.returned':  [`${e.toolName} marked as returned`, `${e.actorFirstName} confirmed ${e.toolName} is back. Thanks for borrowing responsibly!`],
};
const t = templates[e.eventType];
if (!t) throw new Error(`Unknown event type: ${e.eventType}`);
return [{ json: { ...e, subject: t[0], text: `Hi ${e.recipientFirstName},\n\n${t[1]}\n\n— LendLoop` } }];
""".strip()

notify_js = RETRY_HELPER + "\n\n" + r"""
// MOCK notification channel: logs to the n8n container output.
// Replace the body of send() with a Send Email / Slack / Discord call (credentials in n8n) for real delivery.
const n = $input.first().json;
async function send() {
  if (cfg('LENDLOOP_SIMULATE_FAILURE') === 'true') throw new Error('Simulated notification provider outage');
  console.log(`[LendLoop notify] to=${maskEmail(n.recipientEmail)} subject="${n.subject}"`);
  return 'mock-log';
}
const r = await withRetry(send);
return [{ json: {
  eventId: n.eventId,
  loanId: n.loanId,
  status: r.ok ? 'sent' : 'failed',
  channel: r.ok ? r.value : 'mock-log',
  detail: r.ok ? `${n.eventType} after ${r.attempts} attempt(s)` : r.error,
} }];
""".strip()

sign_writeback_js = SIGN_HELPER + "\n\n" + r"""
const r = $input.first().json;
const body = JSON.stringify({
  idempotencyKey: `notification:${r.eventId}`, // same key on every retry -> one row in Convex
  loanId: r.loanId,
  kind: 'notification',
  status: r.status,
  channel: r.channel,
  detail: r.detail,
});
return [{ json: { ...signFor('POST', '/n8n/automation-events', body), body, status: r.status, detail: r.detail } }];
""".strip()

wf1 = {
  "id": "LendLoopLoanEvents",
  "name": "LendLoop – Loan event notifications",
  "active": False,
  "settings": SETTINGS,
  "nodes": [
    {"parameters": {"httpMethod": "POST", "path": "lendloop-loan-events", "responseMode": "responseNode", "options": {"rawBody": True}},
     "name": "Loan event webhook", "type": "n8n-nodes-base.webhook", "typeVersion": 2, "position": [0, 300],
     "id": "loan-event-webhook", "webhookId": "5b2c3f0e-7f1a-4d7e-9a51-1e4d1009a001"},
    code("Verify signature", verify_js, [220, 300]),
    if_true("Signature valid?", "={{ $json.valid }}", [440, 300]),
    {"parameters": {"respondWith": "json", "responseBody": "={{ { \"error\": \"unauthorized\" } }}", "options": {"responseCode": 401}},
     "name": "Reject (401)", "type": "n8n-nodes-base.respondToWebhook", "typeVersion": 1.1, "position": [660, 480], "id": "reject-401"},
    code("Compose message", compose_js, [660, 200]),
    code("Send notification (mock)", notify_js, [880, 200]),
    code("Sign write-back", sign_writeback_js, [1100, 200]),
    http("Record in Convex", "POST", "/n8n/automation-events", [1320, 200], body_expr="={{ $json.body }}"),
    if_true("Notification sent?", "={{ $('Sign write-back').first().json.status === 'sent' }}", [1540, 200]),
    {"parameters": {"respondWith": "json", "responseBody": "={{ { \"ok\": true } }}", "options": {"responseCode": 200}},
     "name": "Ack (200)", "type": "n8n-nodes-base.respondToWebhook", "typeVersion": 1.1, "position": [1760, 100], "id": "ack-200"},
    {"parameters": {"respondWith": "json", "responseBody": "={{ { \"ok\": false } }}", "options": {"responseCode": 502}},
     "name": "Nack (502) – Convex will retry", "type": "n8n-nodes-base.respondToWebhook", "typeVersion": 1.1, "position": [1760, 300], "id": "nack-502"},
    {"parameters": {"errorMessage": "={{ 'Notification failed: ' + $('Sign write-back').first().json.detail }}"},
     "name": "Fail execution", "type": "n8n-nodes-base.stopAndError", "typeVersion": 1, "position": [1980, 300], "id": "fail-execution"},
  ],
  "connections": link(
    ("Loan event webhook", ["Verify signature"]),
    ("Verify signature", ["Signature valid?"]),
    ("Signature valid?", ["Compose message", "Reject (401)"]),
    ("Compose message", ["Send notification (mock)"]),
    ("Send notification (mock)", ["Sign write-back"]),
    ("Sign write-back", ["Record in Convex"]),
    ("Record in Convex", ["Notification sent?"]),
    ("Notification sent?", ["Ack (200)", "Nack (502) – Convex will retry"]),
    ("Nack (502) – Convex will retry", ["Fail execution"]),
  ),
}

# ---------------- 2. Overdue reminders ----------------
sign_get_js = SIGN_HELPER + "\n\nreturn [{ json: signFor('GET', '/n8n/overdue-loans', '') }];"

split_js = r"""
// One item per overdue loan. Convex already excludes loans reminded today.
const res = $input.first().json;
if (!Array.isArray(res.loans)) throw new Error('Unexpected response from /n8n/overdue-loans');
console.log(`[LendLoop reminders] ${res.count} overdue loan(s) for ${res.date}`);
return res.loans.map((l) => ({ json: l }));
""".strip()

remind_js = RETRY_HELPER + "\n\n" + r"""
// MOCK reminder channel (logs). Swap send() for an email/Slack node in production.
const results = [];
for (const item of $input.all()) {
  const l = item.json;
  const text = `Hi ${l.borrower.firstName}, a friendly nudge: ${l.toolName} was due back on ${l.endDate} ` +
    `(${l.daysOverdue} day${l.daysOverdue === 1 ? '' : 's'} ago). Please return it or message the lender.`;
  const r = await withRetry(async () => {
    if (cfg('LENDLOOP_SIMULATE_FAILURE') === 'true') throw new Error('Simulated reminder provider outage');
    console.log(`[LendLoop reminder] to=${maskEmail(l.borrower.email)} loan=${l.loanId} text="${text}"`);
    return 'mock-log';
  });
  results.push({ json: {
    loanId: l.loanId,
    reminderKey: l.reminderKey,
    status: r.ok ? 'sent' : 'failed',
    channel: 'mock-log',
    detail: r.ok ? `${l.daysOverdue} day(s) overdue` : r.error,
  } });
}
return results;
""".strip()

sign_rem_js = SIGN_HELPER + "\n\n" + r"""
return $input.all().map((item) => {
  const r = item.json;
  const body = JSON.stringify({
    idempotencyKey: r.reminderKey, // reminder:<loanId>:<date> — at most one reminder row per loan per day
    loanId: r.loanId,
    kind: 'reminder',
    status: r.status,
    channel: r.channel,
    detail: r.detail,
  });
  return { json: { ...signFor('POST', '/n8n/automation-events', body), body, status: r.status } };
});
""".strip()

summary_js = r"""
const all = $('Sign reminder write-backs').all().map((i) => i.json);
const failed = all.filter((r) => r.status === 'failed').length;
console.log(`[LendLoop reminders] done: ${all.length - failed} sent, ${failed} failed`);
return [{ json: { total: all.length, failed } }];
""".strip()

wf2 = {
  "id": "LendLoopOverdueReminders",
  "name": "LendLoop – Daily overdue reminders",
  "active": False,
  "settings": SETTINGS,
  "nodes": [
    {"parameters": {"rule": {"interval": [{"field": "cronExpression", "expression": "0 9 * * *"}]}},
     "name": "Every day 09:00 UTC", "type": "n8n-nodes-base.scheduleTrigger", "typeVersion": 1.2, "position": [0, 200], "id": "daily"},
    {"parameters": {}, "name": "Run now (testing)", "type": "n8n-nodes-base.manualTrigger", "typeVersion": 1, "position": [0, 400], "id": "manual"},
    code("Sign request", sign_get_js, [220, 300]),
    http("Fetch overdue loans", "GET", "/n8n/overdue-loans", [440, 300]),
    code("Split loans", split_js, [660, 300]),
    code("Send reminders (mock)", remind_js, [880, 300]),
    code("Sign reminder write-backs", sign_rem_js, [1100, 300]),
    http("Record reminder status", "POST", "/n8n/automation-events", [1320, 300], body_expr="={{ $json.body }}"),
    code("Summarize", summary_js, [1540, 300]),
    if_true("Any failures?", "={{ $json.failed > 0 }}", [1760, 300]),
    {"parameters": {"errorMessage": "={{ $json.failed + ' of ' + $json.total + ' reminders failed (status recorded in Convex)' }}"},
     "name": "Fail execution", "type": "n8n-nodes-base.stopAndError", "typeVersion": 1, "position": [1980, 200], "id": "fail-execution"},
  ],
  "connections": link(
    ("Every day 09:00 UTC", ["Sign request"]),
    ("Run now (testing)", ["Sign request"]),
    ("Sign request", ["Fetch overdue loans"]),
    ("Fetch overdue loans", ["Split loans"]),
    ("Split loans", ["Send reminders (mock)"]),
    ("Send reminders (mock)", ["Sign reminder write-backs"]),
    ("Sign reminder write-backs", ["Record reminder status"]),
    ("Record reminder status", ["Summarize"]),
    ("Summarize", ["Any failures?"]),
    ("Any failures?", ["Fail execution", []]),
  ),
}

# ---------------- 3. Error handler ----------------
error_js = SIGN_HELPER + "\n\n" + r"""
// Report any failed LendLoop execution to Convex so it shows up in Admin → Automation health.
// Strip email addresses from error text (data minimisation) and cap the length.
const d = $input.first().json;
const scrub = (s) => String(s ?? 'Unknown error').replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '[email]').slice(0, 1000);
const report = {
  executionId: String(d.execution?.id ?? `trigger-${Date.now()}`),
  workflowName: d.workflow?.name ?? 'unknown',
  lastNode: d.execution?.lastNodeExecuted,
  message: scrub(d.execution?.error?.message ?? d.trigger?.error?.message),
};
console.error(`[LendLoop ERROR] ${report.workflowName} (execution ${report.executionId}) at ${report.lastNode}: ${report.message}`);
const body = JSON.stringify(report);
return [{ json: { ...signFor('POST', '/n8n/workflow-errors', body), body } }];
""".strip()

wf3 = {
  "id": "LendLoopErrorHandler",
  "name": "LendLoop – Error handler",
  "active": False,
  "settings": {"executionOrder": "v1", "saveDataErrorExecution": "all", "saveDataSuccessExecution": "all"},
  "nodes": [
    {"parameters": {}, "name": "On workflow error", "type": "n8n-nodes-base.errorTrigger", "typeVersion": 1, "position": [0, 300], "id": "error-trigger"},
    code("Build error report", error_js, [220, 300]),
    http("Report to Convex", "POST", "/n8n/workflow-errors", [440, 300], body_expr="={{ $json.body }}"),
  ],
  "connections": link(
    ("On workflow error", ["Build error report"]),
    ("Build error report", ["Report to Convex"]),
  ),
}

for fname, wf in [("01-loan-event-notifications.json", wf1), ("02-overdue-reminders.json", wf2), ("03-error-handler.json", wf3)]:
    with open(os.path.join(out, fname), "w") as f:
        json.dump(wf, f, indent=2, ensure_ascii=False)
        f.write("\n")
print("ok")
