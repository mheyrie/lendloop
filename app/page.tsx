"use client";

import { SignInButton, SignedIn, SignedOut } from "@clerk/nextjs";
import { useQuery } from "convex/react";
import Link from "next/link";
import { useMemo } from "react";
import { api } from "@/convex/_generated/api";
import { CATEGORIES } from "@/convex/lib/constants";
import { Empty, Loading } from "@/components/ui";
import { categoryIcon } from "@/lib/categoryIcons";

const STEPS = [
  { n: "1", title: "List what you own", text: "Add the drill, tent or stand mixer you rarely use. Takes 30 seconds." },
  { n: "2", title: "Request what you need", text: "Pick dates, add a note. The owner gets notified right away." },
  { n: "3", title: "Borrow, return, repeat", text: "Friendly reminders keep things moving if a return slips." },
];

export default function PublicHome() {
  const tools = useQuery(api.tools.listPublic);

  const grouped = useMemo(() => {
    if (!tools) return [];
    return CATEGORIES.map((c) => ({ ...c, tools: tools.filter((t) => t.category === c.value) })).filter((g) => g.tools.length > 0);
  }, [tools]);

  const cta = (
    <>
      <SignedOut>
        <SignInButton mode="modal" forceRedirectUrl="/tools">
          <button className="btn btn-primary btn-lg">Sign in to lend or borrow</button>
        </SignInButton>
      </SignedOut>
      <SignedIn>
        <Link href="/tools" className="btn btn-primary btn-lg">Go to the board →</Link>
      </SignedIn>
    </>
  );

  return (
    <div className="public">
      <header className="public-top">
        <Link href="/" className="brand">
          <span className="logo" aria-hidden>↻</span> LendLoop
        </Link>
        <SignedOut>
          <SignInButton mode="modal" forceRedirectUrl="/tools">
            <button className="btn btn-ghost">Sign in</button>
          </SignInButton>
        </SignedOut>
      </header>

      <section className="hero">
        <div className="hero-copy">
          <p className="eyebrow">A neighborhood tool-lending board</p>
          <h1>
            Borrow what you need.
            <br />
            <em>Lend what you don&apos;t.</em>
          </h1>
          <p className="lead">
            Most tools spend their lives in a garage. Share yours with the people on your street, and borrow the ladder you
            need once a year.
          </p>
          {cta}
        </div>
        <div className="hero-art" aria-hidden>
          {["🪛", "⛺", "🌿", "🍳", "🔨", "🚲"].map((e, i) => (
            <span key={i} className={`tag tag-${i}`}>{e}</span>
          ))}
        </div>
      </section>

      <section className="steps">
        {STEPS.map((s) => (
          <div key={s.n} className="step">
            <span className="step-n">{s.n}</span>
            <h3>{s.title}</h3>
            <p>{s.text}</p>
          </div>
        ))}
      </section>

      <section className="public-list">
        <div className="section-head">
          <h2>Available right now</h2>
          {tools && <span className="count">{tools.length} tools</span>}
        </div>
        {tools === undefined ? (
          <Loading />
        ) : tools.length === 0 ? (
          <Empty>Nothing listed yet. Be the first to lend something.</Empty>
        ) : (
          <div className="category-columns">
            {grouped.map((g) => (
              <div key={g.value} className="category-group">
                <h3>
                  <span className="cat-icon" aria-hidden>{categoryIcon(g.value)}</span> {g.label}
                </h3>
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

      <footer className="public-foot">
        <span>LendLoop · built for neighbors</span>
      </footer>
    </div>
  );
}
