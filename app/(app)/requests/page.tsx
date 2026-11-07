"use client";

import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { LoanList } from "@/components/LoanList";
import { AsyncButton } from "@/components/ui";

export default function MyRequestsPage() {
  const loans = useQuery(api.loans.myRequests);
  const cancel = useMutation(api.loans.cancel);
  return (
    <>
      <div className="page-head">
        <div>
          <h1>My requests</h1>
          <p className="subtitle">Things you’ve asked to borrow.</p>
        </div>
      </div>
      <LoanList
        loans={loans}
        perspective="borrower"
        empty="You haven't asked to borrow anything yet."
        actions={(loan) =>
          loan.status === "pending" && (
            <AsyncButton variant="ghost" onClick={() => cancel({ loanId: loan._id })}>
              Cancel
            </AsyncButton>
          )
        }
      />
    </>
  );
}
