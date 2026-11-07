"use client";

import { useMutation, useQuery } from "convex/react";
import { useState } from "react";
import { api } from "@/convex/_generated/api";
import type { LoanStatus } from "@/convex/lib/constants";
import { categoryLabel } from "@/convex/lib/constants";
import { LoanList } from "@/components/LoanList";
import { AsyncButton, AvailabilityPill, Empty, Loading, TrustedBadge } from "@/components/ui";
import { timeAgo } from "@/lib/format";

const TABS = ["Loans", "Listings", "Users", "Automation health"] as const;
type Tab = (typeof TABS)[number];

export default function AdminPage() {
  const me = useQuery(api.users.me);
  const [tab, setTab] = useState<Tab>("Loans");

  if (me === undefined) return <Loading />;
  // UI convenience only; every admin query/mutation re-checks the role server-side.
  if (me?.role !== "admin") return <Empty>This area is for admins.</Empty>;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Admin</h1>
          <p className="subtitle">Moderate listings, trust lenders, and watch the automations.</p>
        </div>
      </div>
      <div className="chips">
        {TABS.map((t) => (
          <button key={t} className={`chip ${tab === t ? "chip-on" : ""}`} onClick={() => setTab(t)}>{t}</button>
        ))}
      </div>
      {tab === "Loans" && <AllLoans />}
      {tab === "Listings" && <AllListings />}
      {tab === "Users" && <Users />}
      {tab === "Automation health" && <Health />}
    </>
  );
}

function AllLoans() {
  const [status, setStatus] = useState<LoanStatus | "">("");
  const loans = useQuery(api.loans.all, { status: status || undefined });
  return (
    <>
      <label className="inline">
        Status{" "}
        <select value={status} onChange={(e) => setStatus(e.target.value as LoanStatus | "")}>
          <option value="">All</option>
          {(["pending", "approved", "declined", "cancelled", "returned"] as const).map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </label>
      <LoanList loans={loans} perspective="admin" empty="No loans match." />
    </>
  );
}

function AllListings() {
  const tools = useQuery(api.tools.browse, {});
  const remove = useMutation(api.tools.remove);
  if (tools === undefined) return <Loading />;
  if (tools.length === 0) return <Empty>No listings.</Empty>;
  return (
    <div className="list">
      {tools.map((t) => (
        <div key={t._id} className="list-row">
          <div className="grow">
            <strong>{t.name}</strong>
            <p className="meta">{categoryLabel(t.category)} · by {t.owner.firstName} {t.owner.trustedLender && <TrustedBadge />}</p>
          </div>
          <AvailabilityPill availability={t.availability} />
          <AsyncButton variant="danger" confirm={`Remove "${t.name}" from LendLoop?`} onClick={() => remove({ toolId: t._id })}>
            Remove
          </AsyncButton>
        </div>
      ))}
    </div>
  );
}

function Users() {
  const users = useQuery(api.users.listForAdmin);
  const setTrusted = useMutation(api.users.setTrustedLender);
  if (users === undefined) return <Loading />;
  return (
    <div className="list">
      {users.map((u) => (
        <div key={u._id} className="list-row">
          <div className="grow">
            <strong>{u.name}</strong> {u.trustedLender && <TrustedBadge />}
            <p className="meta">{u.email} · {u.role} · {u.activeListings} listing{u.activeListings === 1 ? "" : "s"}</p>
          </div>
          <AsyncButton variant={u.trustedLender ? "ghost" : "secondary"} onClick={() => setTrusted({ userId: u._id, trusted: !u.trustedLender })}>
            {u.trustedLender ? "Remove trusted" : "Mark Trusted Lender"}
          </AsyncButton>
        </div>
      ))}
    </div>
  );
}

function Health() {
  const health = useQuery(api.webhooks.health);
  const retry = useMutation(api.webhooks.retry);
  if (health === undefined) return <Loading />;
  return (
    <>
      <h2>Outgoing webhooks needing attention</h2>
      {health.deliveries.length === 0 ? (
        <Empty>All webhook deliveries to n8n succeeded.</Empty>
      ) : (
        <div className="list">
          {health.deliveries.map((d) => (
            <div key={d._id} className="list-row">
              <div className="grow">
                <strong>{d.eventType}</strong>
                <p className="meta">{d.attempts} attempt{d.attempts === 1 ? "" : "s"} · {timeAgo(d.createdAt)} · {d.lastError}</p>
              </div>
              <span className={`pill pill-${d.status === "failed" ? "overdue" : "pending"}`}>{d.status}</span>
              {d.status === "failed" && <AsyncButton onClick={() => retry({ deliveryId: d._id })}>Retry</AsyncButton>}
            </div>
          ))}
        </div>
      )}
      <h2>Failed n8n executions</h2>
      {health.workflowErrors.length === 0 ? (
        <Empty>No workflow errors reported.</Empty>
      ) : (
        <div className="list">
          {health.workflowErrors.map((e) => (
            <div key={e._id} className="list-row">
              <div className="grow">
                <strong>{e.workflowName}</strong>
                <p className="meta">{timeAgo(e.occurredAt)}{e.lastNode && <> · at “{e.lastNode}”</>}</p>
                <p className="desc">{e.message}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
