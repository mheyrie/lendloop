"use client";
// Copyright (c) 2026 Mheyrie. All rights reserved. Proprietary — see LICENSE.

import { useMutation, useQuery } from "convex/react";
import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { CATEGORIES, LIMITS, categoryLabel, conditionLabel, type Category } from "@/convex/lib/constants";
import { AvailabilityPill, Empty, Loading, StatusPill, TrustedBadge } from "@/components/ui";
import { rowMotion } from "@/components/motion";
import { categoryIcon } from "@/lib/categoryIcons";
import { errorMessage, formatRange, todayISO } from "@/lib/format";

export default function BrowsePage() {
  const [category, setCategory] = useState<Category | undefined>();
  const tools = useQuery(api.tools.browse, { category });

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Browse tools</h1>
          <p className="subtitle">Everything your neighbors are happy to lend.</p>
        </div>
      </div>
      <div className="chips" role="group" aria-label="Filter by category">
        {[{ value: undefined, label: "All" }, ...CATEGORIES].map((c) => {
          const on = category === c.value;
          return (
            <motion.button key={c.label} className={`chip ${on ? "chip-on" : ""}`} onClick={() => setCategory(c.value)} whileTap={{ scale: 0.94 }}>
              {on && <motion.span layoutId="chip-active" className="chip-bg" transition={{ type: "spring", stiffness: 500, damping: 38 }} />}
              <span className="chip-label">
                {c.value && <span aria-hidden>{categoryIcon(c.value)}</span>} {c.label}
              </span>
            </motion.button>
          );
        })}
      </div>

      {tools === undefined ? (
        <Loading />
      ) : tools.length === 0 ? (
        <Empty>No tools in this category yet.</Empty>
      ) : (
        <motion.div className="grid" layout>
          <AnimatePresence mode="popLayout" initial={true}>
          {tools.map((t, i) => (
            <motion.article
              key={t._id}
              className="card"
              {...rowMotion}
              transition={{ type: "spring", stiffness: 380, damping: 32, delay: Math.min(i * 0.035, 0.3) }}
              whileHover={{ y: -4 }}
            >
              <div className="card-head">
                <span className="icon-tile" aria-hidden>{categoryIcon(t.category)}</span>
                <AvailabilityPill availability={t.availability} />
              </div>
              <h3>{t.name}</h3>
              <p className="meta">
                {categoryLabel(t.category)} · {conditionLabel(t.condition)}
              </p>
              {t.description && <p className="desc">{t.description}</p>}
              <p className="meta">
                {t.isMine ? "Your listing" : <>Lent by {t.owner.firstName}</>} {t.owner.trustedLender && <TrustedBadge />}
              </p>
              {!t.isMine &&
                (t.myOpenRequest ? (
                  <p className="meta">
                    You requested {formatRange(t.myOpenRequest.startDate, t.myOpenRequest.endDate)}{" "}
                    <StatusPill status={t.myOpenRequest.status} />
                  </p>
                ) : (
                  <RequestForm toolId={t._id} />
                ))}
            </motion.article>
          ))}
          </AnimatePresence>
        </motion.div>
      )}
    </>
  );
}

function RequestForm({ toolId }: { toolId: Id<"tools"> }) {
  const request = useMutation(api.loans.request);
  const [open, setOpen] = useState(false);
  const [startDate, setStart] = useState(todayISO());
  const [endDate, setEnd] = useState(todayISO());
  const [message, setMessage] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  return (
    <AnimatePresence mode="wait" initial={false}>
      {!open ? (
        <motion.button
          key="cta"
          className="btn btn-primary card-cta"
          onClick={() => setOpen(true)}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          whileTap={{ scale: 0.96 }}
        >
          Request to borrow
        </motion.button>
      ) : (
    <motion.form
      key="form"
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: "auto" }}
      exit={{ opacity: 0, height: 0 }}
      style={{ overflow: "hidden" }}
      className="request-form"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        try {
          await request({ toolId, startDate, endDate, message: message || undefined });
          setOpen(false);
        } catch (err) {
          setError(errorMessage(err));
        } finally {
          setBusy(false);
        }
      }}
    >
      <div className="row">
        <label>
          From
          <input type="date" required min={todayISO()} value={startDate} onChange={(e) => { setStart(e.target.value); if (endDate < e.target.value) setEnd(e.target.value); }} />
        </label>
        <label>
          To
          <input type="date" required min={startDate} value={endDate} onChange={(e) => setEnd(e.target.value)} />
        </label>
      </div>
      <label>
        Note to the lender (optional)
        <input type="text" maxLength={LIMITS.requestMessage} value={message} onChange={(e) => setMessage(e.target.value)} placeholder="e.g. Just need it for a weekend project" />
      </label>
      <AnimatePresence>
        {error && (
          <motion.p className="error-text" role="alert" initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: [6, -4, 2, 0] }} exit={{ opacity: 0 }}>
            {error}
          </motion.p>
        )}
      </AnimatePresence>
      <div className="row">
        <button className="btn btn-primary" disabled={busy}>{busy ? "Sending…" : "Send request"}</button>
        <button type="button" className="btn btn-ghost" onClick={() => setOpen(false)}>Cancel</button>
      </div>
    </motion.form>
      )}
    </AnimatePresence>
  );
}
