// Copyright (c) 2026 Mheyrie. All rights reserved. Proprietary — see LICENSE.
import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

// UX-level gate only. Real authorization is enforced in every Convex function.
const isProtected = createRouteMatcher(["/tools(.*)", "/listings(.*)", "/requests(.*)", "/incoming(.*)", "/admin(.*)"]);

export default clerkMiddleware(async (auth, req) => {
  if (isProtected(req)) await auth.protect();
});

export const config = {
  matcher: ["/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)", "/(api|trpc)(.*)"],
};
