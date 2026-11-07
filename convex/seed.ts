import { internalMutation } from "./_generated/server";

/**
 * Demo data so the public page isn't empty: `npx convex run seed:demo`.
 * Creates a couple of neighbor accounts that aren't backed by Clerk (they can't sign in).
 */
export const demo = internalMutation({
  args: {},
  handler: async (ctx) => {
    const existing = await ctx.db
      .query("users")
      .withIndex("by_token", (q) => q.eq("tokenIdentifier", "seed|sam"))
      .unique();
    if (existing) return "Already seeded";

    const now = Date.now();
    const sam = await ctx.db.insert("users", {
      tokenIdentifier: "seed|sam",
      name: "Sam Rivera",
      email: "sam@example.com",
      role: "user",
      trustedLender: true,
      createdAt: now,
    });
    const priya = await ctx.db.insert("users", {
      tokenIdentifier: "seed|priya",
      name: "Priya Shah",
      email: "priya@example.com",
      role: "user",
      trustedLender: false,
      createdAt: now,
    });

    const tools = [
      { ownerId: sam, name: "Cordless drill (18V)", category: "power_tools", condition: "good", description: "Two batteries and a basic bit set." },
      { ownerId: sam, name: "Extension ladder", category: "hand_tools", condition: "fair", description: "Reaches about 6m. Heavy — bring a friend." },
      { ownerId: sam, name: "Hedge trimmer", category: "garden", condition: "like_new", description: "Electric, comes with a 15m cable." },
      { ownerId: priya, name: "Stand mixer", category: "kitchen", condition: "good", description: "Dough hook, whisk and paddle included." },
      { ownerId: priya, name: "4-person tent", category: "camping", condition: "good", description: "Easy pop-up frame, rain fly included." },
      { ownerId: priya, name: "Carpet cleaner", category: "cleaning", condition: "worn", description: "Works great, a little noisy." },
    ] as const;
    for (const t of tools) {
      await ctx.db.insert("tools", { ...t, createdAt: now, updatedAt: now });
    }
    return `Seeded ${tools.length} tools`;
  },
});

/**
 * Creates an approved loan that ended 3 days ago, so the overdue-reminder workflow has work to do:
 * `npx convex run seed:overdueLoan`.
 */
export const overdueLoan = internalMutation({
  args: {},
  handler: async (ctx) => {
    const tool = await ctx.db.query("tools").withIndex("by_removedAt", (q) => q.eq("removedAt", undefined)).first();
    if (!tool) throw new Error("Run seed:demo first");
    const borrower = (await ctx.db.query("users").collect()).find((u) => u._id !== tool.ownerId);
    if (!borrower) throw new Error("Need a second user");
    const day = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);
    const now = Date.now();
    return await ctx.db.insert("loans", {
      toolId: tool._id,
      lenderId: tool.ownerId,
      borrowerId: borrower._id,
      startDate: day(6),
      endDate: day(3),
      status: "approved",
      createdAt: now,
      updatedAt: now,
    });
  },
});
