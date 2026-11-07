"use client";
// Copyright (c) 2026 Mheyrie. All rights reserved. Proprietary — see LICENSE.

import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { LoanList } from "@/components/LoanList";
import { AsyncButton } from "@/components/ui";

export default function IncomingPage() {
  const loans = useQuery(api.loans.incoming);
  const approve = useMutation(api.loans.approve);
  const decline = useMutation(api.loans.decline);
  const markReturned = useMutation(api.loans.markReturned);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Incoming requests</h1>
          <p className="subtitle">Neighbors who’d like to borrow your tools.</p>
        </div>
      </div>
      <LoanList
        loans={loans}
        perspective="lender"
        empty="No one has asked to borrow your tools yet."
        actions={(loan) => (
          <>
            {loan.status === "pending" && (
              <>
                <AsyncButton variant="primary" onClick={() => approve({ loanId: loan._id })}>Approve</AsyncButton>
                <AsyncButton variant="ghost" onClick={() => decline({ loanId: loan._id })}>Decline</AsyncButton>
              </>
            )}
            {loan.status === "approved" && (
              <AsyncButton onClick={() => markReturned({ loanId: loan._id })}>Mark returned</AsyncButton>
            )}
          </>
        )}
      />
    </>
  );
}
