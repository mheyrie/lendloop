"use client";
// Copyright (c) 2026 Mheyrie. All rights reserved. Proprietary — see LICENSE.

import type { FunctionReturnType } from "convex/server";
import { AnimatePresence, motion } from "motion/react";
import type { ReactNode } from "react";
import type { api } from "@/convex/_generated/api";
import { categoryLabel } from "@/convex/lib/constants";
import { categoryIcon } from "@/lib/categoryIcons";
import { formatRange } from "@/lib/format";
import { rowMotion } from "./motion";
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
      <AnimatePresence initial={true}>
      {loans.map((loan, i) => (
        <motion.div
          key={loan._id}
          className={`list-row${loan.overdue ? " row-alert" : ""}`}
          {...rowMotion}
          transition={{ type: "spring", stiffness: 380, damping: 32, delay: Math.min(i * 0.04, 0.3) }}
        >
          <span className="icon-tile" aria-hidden>{loan.tool ? categoryIcon(loan.tool.category) : "📦"}</span>
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
          <motion.span key={loan.status} initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}>
            <StatusPill status={loan.status} overdue={loan.overdue} />
          </motion.span>
          {actions?.(loan)}
        </motion.div>
      ))}
      </AnimatePresence>
    </div>
  );
}
