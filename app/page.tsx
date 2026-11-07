"use client";

import { SignInButton, SignedIn, SignedOut } from "@clerk/nextjs";
import { useQuery } from "convex/react";
import Link from "next/link";
import { useMemo } from "react";
import { api } from "@/convex/_generated/api";
import { CATEGORIES, categoryLabel } from "@/convex/lib/constants";
import { Empty, Loading } from "@/components/ui";

export default function PublicHome() {
  const tools = useQuery(api.tools.listPublic);

  const grouped = useMemo(() => {
    if (!tools) return [];
    return CATEGORIES.map((c) => ({ ...c, tools: tools.filter((t) => t.category === c.value) })).filter((g) => g.tools.length > 0);
  }, [tools]);

  return (
    <main className="public">
      <header className="hero">
        <div className="brand">
          <span className="logo" aria-hidden>↻</span> LendLoop
        </div>
        <h1>Borrow what you need. Lend what you don&apos;t.</h1>
        <p className="muted">A tool-lending board for your neighborhood. List the drill gathering dust; borrow the ladder you need once a year.</p>
        <SignedOut>
          <SignInButton mode="modal" forceRedirectUrl="/tools">
            <button className="btn btn-primary btn-lg">Sign in to lend or borrow</button>
          </SignInButton>
        </SignedOut>
        <SignedIn>
          <Link href="/tools" className="btn btn-primary btn-lg">Go to the board →</Link>
        </SignedIn>
      </header>

      <section className="public-list">
        <h2>Available now {tools && <span className="count">{tools.length}</span>}</h2>
        {tools === undefined ? (
          <Loading />
        ) : tools.length === 0 ? (
          <Empty>Nothing listed yet — be the first to lend something.</Empty>
        ) : (
          <div className="category-columns">
            {grouped.map((g) => (
              <div key={g.value} className="category-group">
                <h3>{categoryLabel(g.value)}</h3>
                <ul>
                  {g.tools.map((t) => (
                    <li key={t._id}>{t.name}</li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
