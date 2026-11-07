// Copyright (c) 2026 Mheyrie. All rights reserved. Proprietary — see LICENSE.
import { v } from "convex/values";

export const categoryValidator = v.union(
  v.literal("power_tools"),
  v.literal("hand_tools"),
  v.literal("garden"),
  v.literal("kitchen"),
  v.literal("camping"),
  v.literal("cleaning"),
  v.literal("sports"),
  v.literal("other"),
);

export const conditionValidator = v.union(
  v.literal("like_new"),
  v.literal("good"),
  v.literal("fair"),
  v.literal("worn"),
);

export const loanStatusValidator = v.union(
  v.literal("pending"),
  v.literal("approved"),
  v.literal("declined"),
  v.literal("cancelled"),
  v.literal("returned"),
);

export const roleValidator = v.union(v.literal("admin"), v.literal("user"));

/** Events Convex emits to n8n. One per loan state transition. */
export const loanEventTypeValidator = v.union(
  v.literal("loan.requested"),
  v.literal("loan.approved"),
  v.literal("loan.declined"),
  v.literal("loan.cancelled"),
  v.literal("loan.returned"),
);

export const automationKindValidator = v.union(
  v.literal("notification"),
  v.literal("reminder"),
);

export const automationStatusValidator = v.union(
  v.literal("sent"),
  v.literal("failed"),
);
