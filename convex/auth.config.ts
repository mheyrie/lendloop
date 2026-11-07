// Copyright (c) 2026 Mheyrie. All rights reserved. Proprietary — see LICENSE.
// Convex verifies Clerk-issued JWTs (Clerk JWT template named "convex").
export default {
  providers: [
    {
      domain: process.env.CLERK_JWT_ISSUER_DOMAIN,
      applicationID: "convex",
    },
  ],
};
