"use client";

import type { FunctionReturnType } from "convex/server";
import type { ReactNode } from "react";
import type { api } from "@/convex/_generated/api";
import { categoryLabel } from "@/convex/lib/constants";
import { formatRange } from "@/lib/format";
import { ActivityLine, Empty, Loading, StatusPill, TrustedBadge } from "./ui";

export type LoanView = FunctionReturnType<typeof api.loans.myRequests>[number];

export function LoanList({
  loans,
  perspective,
  empty,
  actions,
}: {
  loans: LoanView[] | undefined;
  perspective: "borrower" | "lender" | "admin";
  empty: string;
  actions?: (loan: LoanView) => ReactNode;
}) {
  if (loans === undefined) return <Loading />;
  if (loans.length === 0) return <Empty>{empty}</Empty>;
  return (
    <div className="list">
      {loans.map((loan) => (
        <div key={loan._id} className="list-row">
          <div className="grow">
            <strong>{loan.tool?.name ?? "Removed tool"}</strong>
            {loan.tool?.removed && <span className="meta"> (listing removed)</span>}
            <p className="meta">
              {formatRange(loan.startDate, loan.endDate)}
              {loan.tool && <> · {categoryLabel(loan.tool.category)}</>}
              {perspective !== "lender" && (
                <> · from {loan.lender.firstName} {loan.lender.trustedLender && <TrustedBadge />}</>
              )}
              {perspective !== "borrower" && <> · borrower {loan.borrower.firstName}</>}
            </p>
            {loan.message && <p className="desc">&ldquo;{loan.message}&rdquo;</p>}
            <ActivityLine activity={loan.activity} />
          </div>
          <StatusPill status={loan.status} overdue={loan.overdue} />
          {actions?.(loan)}
        </div>
      ))}
    </div>
  );
}
