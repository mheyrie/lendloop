"use client";

import { useMutation, useQuery } from "convex/react";
import { useState } from "react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { CATEGORIES, CONDITIONS, LIMITS, categoryLabel, conditionLabel, type Category, type Condition } from "@/convex/lib/constants";
import { AsyncButton, AvailabilityPill, Empty, Loading } from "@/components/ui";
import { categoryIcon } from "@/lib/categoryIcons";
import { errorMessage } from "@/lib/format";

type Draft = { name: string; category: Category; condition: Condition; description: string };
const EMPTY: Draft = { name: "", category: "power_tools", condition: "good", description: "" };

export default function MyListingsPage() {
  const tools = useQuery(api.tools.mine);
  const remove = useMutation(api.tools.remove);
  const [editing, setEditing] = useState<{ id?: Id<"tools">; draft: Draft } | null>(null);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>My listings</h1>
          <p className="subtitle">Tools you’re offering to the neighborhood.</p>
        </div>
        {!editing && (
          <button className="btn btn-primary" onClick={() => setEditing({ draft: EMPTY })}>
            + List a tool
          </button>
        )}
      </div>

      {editing && <ToolForm key={editing.id ?? "new"} toolId={editing.id} initial={editing.draft} onDone={() => setEditing(null)} />}

      {tools === undefined ? (
        <Loading />
      ) : tools.length === 0 ? (
        <Empty>You haven&apos;t listed anything yet.</Empty>
      ) : (
        <div className="list">
          {tools.map((t) => (
            <div key={t._id} className="list-row">
              <span className="icon-tile" aria-hidden>{categoryIcon(t.category)}</span>
              <div className="grow">
                <strong>{t.name}</strong>
                <p className="meta">
                  {categoryLabel(t.category)} · {conditionLabel(t.condition)}
                  {t.pendingRequests > 0 && <> · <a href="/incoming">{t.pendingRequests} pending request{t.pendingRequests > 1 ? "s" : ""}</a></>}
                </p>
              </div>
              <AvailabilityPill availability={t.availability} />
              <button
                className="btn btn-ghost"
                onClick={() => setEditing({ id: t._id, draft: { name: t.name, category: t.category, condition: t.condition, description: t.description } })}
              >
                Edit
              </button>
              <AsyncButton variant="danger" confirm={`Delete "${t.name}"? Open requests will be cancelled.`} onClick={() => remove({ toolId: t._id })}>
                Delete
              </AsyncButton>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

function ToolForm({ toolId, initial, onDone }: { toolId?: Id<"tools">; initial: Draft; onDone: () => void }) {
  const create = useMutation(api.tools.create);
  const update = useMutation(api.tools.update);
  const [draft, setDraft] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft((d) => ({ ...d, [k]: v }));

  return (
    <form
      className="card form"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        try {
          if (toolId) await update({ toolId, ...draft });
          else await create(draft);
          onDone();
        } catch (err) {
          setError(errorMessage(err));
        } finally {
          setBusy(false);
        }
      }}
    >
      <h3>{toolId ? "Edit listing" : "List a tool"}</h3>
      <label>
        Name
        <input required minLength={2} maxLength={LIMITS.toolName} value={draft.name} onChange={(e) => set("name", e.target.value)} placeholder="e.g. Cordless drill" />
      </label>
      <div className="row">
        <label>
          Category
          <select value={draft.category} onChange={(e) => set("category", e.target.value as Category)}>
            {CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
          </select>
        </label>
        <label>
          Condition
          <select value={draft.condition} onChange={(e) => set("condition", e.target.value as Condition)}>
            {CONDITIONS.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
          </select>
        </label>
      </div>
      <label>
        Short description
        <textarea rows={3} maxLength={LIMITS.toolDescription} value={draft.description} onChange={(e) => set("description", e.target.value)} placeholder="What's included, any quirks…" />
      </label>
      {error && <p className="error-text" role="alert">{error}</p>}
      <div className="row">
        <button className="btn btn-primary" disabled={busy}>{busy ? "Saving…" : toolId ? "Save changes" : "Publish listing"}</button>
        <button type="button" className="btn btn-ghost" onClick={onDone}>Cancel</button>
      </div>
    </form>
  );
}
