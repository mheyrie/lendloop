"use client";
// Copyright (c) 2026 Mheyrie. All rights reserved. Proprietary — see LICENSE.

import { SignInButton, SignedIn, SignedOut } from "@clerk/nextjs";
import { useQuery } from "convex/react";
import { motion } from "motion/react";
import Link from "next/link";
import { useMemo } from "react";
import { api } from "@/convex/_generated/api";
import { CATEGORIES } from "@/convex/lib/constants";
import { MotionItem, MotionProvider, Stagger, fadeUp } from "@/components/motion";
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
    <MotionProvider>
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
        <Stagger className="hero-copy" gap={0.12}>
          <motion.p variants={fadeUp} className="eyebrow">A neighborhood tool-lending board</motion.p>
          <motion.h1 variants={fadeUp}>
            Borrow what you need.
            <br />
            <motion.em
              initial={{ opacity: 0, filter: "blur(6px)" }}
              animate={{ opacity: 1, filter: "blur(0px)" }}
              transition={{ delay: 0.45, duration: 0.6 }}
            >
              Lend what you don&apos;t.
            </motion.em>
          </motion.h1>
          <motion.p variants={fadeUp} className="lead">
            Most tools spend their lives in a garage. Share yours with the people on your street, and borrow the ladder you
            need once a year.
          </motion.p>
          <motion.div variants={fadeUp} whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }} style={{ display: "inline-block" }}>
            {cta}
          </motion.div>
        </Stagger>
        <motion.div
          className="hero-art"
          aria-hidden
          initial={{ scale: 0.8, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
        >
          {["🪛", "⛺", "🌿", "🍳", "🔨", "🚲"].map((e, i) => (
            <motion.span
              key={i}
              className={`tag tag-${i}`}
              initial={{ scale: 0, opacity: 0 }}
              animate={{ scale: 1, opacity: 1, y: [0, -8, 0] }}
              transition={{
                scale: { type: "spring", stiffness: 260, damping: 14, delay: 0.3 + i * 0.08 },
                opacity: { delay: 0.3 + i * 0.08 },
                y: { duration: 5 + i * 0.4, repeat: Infinity, ease: "easeInOut", delay: 1 + i * 0.3 },
              }}
              whileHover={{ scale: 1.15, rotate: 0 }}
              drag
              dragSnapToOrigin
            >
              {e}
            </motion.span>
          ))}
        </motion.div>
      </section>

      <Stagger className="steps" inView gap={0.1}>
        {STEPS.map((s) => (
          <MotionItem key={s.n} className="step" whileHover={{ y: -4 }}>
            <span className="step-n">{s.n}</span>
            <h3>{s.title}</h3>
            <p>{s.text}</p>
          </MotionItem>
        ))}
      </Stagger>

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
          <Stagger className="category-columns" inView gap={0.07}>
            {grouped.map((g) => (
              <MotionItem key={g.value} className="category-group" whileHover={{ y: -3 }}>
                <h3>
                  <span className="cat-icon" aria-hidden>{categoryIcon(g.value)}</span> {g.label}
                </h3>
                <ul>
                  {g.tools.map((t) => (
                    <li key={t._id}>{t.name}</li>
                  ))}
                </ul>
              </MotionItem>
            ))}
          </Stagger>
        )}
      </section>

      <footer className="public-foot">
        <span>LendLoop · designed &amp; built by <strong>Mheyrie</strong> · © 2026 All rights reserved</span>
      </footer>
    </div>
    </MotionProvider>
  );
}
