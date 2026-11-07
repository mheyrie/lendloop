"use client";
// Copyright (c) 2026 Mheyrie. All rights reserved. Proprietary — see LICENSE.

import { UserButton } from "@clerk/nextjs";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { AnimatePresence, motion } from "motion/react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { api } from "@/convex/_generated/api";
import { MotionProvider } from "@/components/motion";
import { Loading } from "@/components/ui";

const NAV = [
  { href: "/tools", label: "Browse" },
  { href: "/listings", label: "My listings" },
  { href: "/requests", label: "My requests" },
  { href: "/incoming", label: "Incoming" },
];

/** Upserts the Convex user from the verified Clerk token before rendering the app. */
function EnsureUser({ children }: { children: ReactNode }) {
  const { isAuthenticated, isLoading } = useConvexAuth();
  const store = useMutation(api.users.store);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!isAuthenticated) return;
    store()
      .then(() => setReady(true))
      .catch(() => setFailed(true));
  }, [isAuthenticated, store]);

  if (failed) return <p className="error-text">Couldn&apos;t load your profile. Refresh to try again.</p>;
  if (!isLoading && !isAuthenticated) {
    return <p className="error-text">Signed in, but the backend didn&apos;t accept your session. Check the Clerk &ldquo;convex&rdquo; JWT template.</p>;
  }
  if (!ready) return <Loading />;
  return <>{children}</>;
}

function Nav() {
  const pathname = usePathname();
  const me = useQuery(api.users.me);
  const incoming = useQuery(api.loans.incoming, me ? {} : "skip");
  const pending = incoming?.filter((l) => l.status === "pending").length ?? 0;
  const links = me?.role === "admin" ? [...NAV, { href: "/admin", label: "Admin" }] : NAV;
  return (
    <header className="topbar">
      <Link href="/" className="brand">
        <span className="logo" aria-hidden>↻</span> LendLoop
      </Link>
      <nav>
        {links.map((l) => (
          <Link key={l.href} href={l.href} className={pathname.startsWith(l.href) ? "active" : undefined}>
            {pathname.startsWith(l.href) && (
              <motion.span layoutId="nav-active" className="nav-pill" transition={{ type: "spring", stiffness: 450, damping: 36 }} />
            )}
            <span className="nav-label">{l.label}</span>
            <AnimatePresence>
              {l.href === "/incoming" && pending > 0 && (
                <motion.span
                  key={pending}
                  className="nav-badge"
                  aria-label={`${pending} pending`}
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  exit={{ scale: 0 }}
                  transition={{ type: "spring", stiffness: 600, damping: 20 }}
                >
                  {pending}
                </motion.span>
              )}
            </AnimatePresence>
          </Link>
        ))}
      </nav>
      <UserButton />
    </header>
  );
}

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <MotionProvider>
      <Nav />
      <main className="container">
        <EnsureUser>{children}</EnsureUser>
      </main>
      <footer className="app-foot">LendLoop · © 2026 Mheyrie</footer>
    </MotionProvider>
  );
}
