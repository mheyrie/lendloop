"use client";
// Copyright (c) 2026 Mheyrie. All rights reserved. Proprietary — see LICENSE.

import { useState, type ReactNode } from "react";
import { errorMessage, formatDate, timeAgo } from "@/lib/format";

export function AsyncButton({
  onClick,
  children,
  variant = "secondary",
  confirm,
}: {
  onClick: () => Promise<unknown>;
  children: ReactNode;
  variant?: "primary" | "secondary" | "danger" | "ghost";
  confirm?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <span className="async-btn">
      <button
        className={`btn btn-${variant}`}
        disabled={busy}
        onClick={async () => {
          if (confirm && !window.confirm(confirm)) return;
          setBusy(true);
          setError(null);
          try {
            await onClick();
          } catch (e) {
            setError(errorMessage(e));
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? "…" : children}
      </button>
      {error && <span className="error-text" role="alert">{error}</span>}
    </span>
  );
}

const STATUS_LABEL: Record<string, string> = {
  pending: "Pending",
  approved: "Approved",
  declined: "Declined",
  cancelled: "Cancelled",
  returned: "Returned",
  overdue: "Overdue",
};

export function StatusPill({ status, overdue }: { status: string; overdue?: boolean }) {
  const key = overdue ? "overdue" : status;
  return <span className={`pill pill-${key}`}>{STATUS_LABEL[key] ?? status}</span>;
}

type Availability =
  | { status: "available"; nextBooking: { startDate: string; endDate: string } | null }
  | { status: "on_loan"; until: string; overdue: boolean };

export function AvailabilityPill({ availability }: { availability: Availability }) {
  if (availability.status === "available") {
    return (
      <span className="pill pill-approved" title={availability.nextBooking ? `Booked from ${formatDate(availability.nextBooking.startDate)}` : undefined}>
        Available{availability.nextBooking ? ` · booked ${formatDate(availability.nextBooking.startDate)}` : ""}
      </span>
    );
  }
  return availability.overdue ? (
    <span className="pill pill-overdue">Overdue</span>
  ) : (
    <span className="pill pill-pending">On loan until {formatDate(availability.until)}</span>
  );
}

export function TrustedBadge() {
  return <span className="badge-trusted" title="Marked as a Trusted Lender by an admin">✓ Trusted Lender</span>;
}

type Activity = { kind: "notification" | "reminder"; status: "sent" | "failed"; occurredAt: number };

/** Bonus: latest automation activity for a loan, e.g. "Reminder sent 2 days ago". */
export function ActivityLine({ activity }: { activity: Activity[] }) {
  if (activity.length === 0) return null;
  return (
    <ul className="activity">
      {activity.map((a, i) => (
        <li key={i} className={a.status === "failed" ? "activity-failed" : undefined}>
          {a.kind === "reminder" ? "Reminder" : "Notification"} {a.status} {timeAgo(a.occurredAt)}
        </li>
      ))}
    </ul>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="empty">{children}</p>;
}

export function Loading() {
  return <p className="muted">Loading…</p>;
}
