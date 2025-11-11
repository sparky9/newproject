import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server';

const isPublicRoute = createRouteMatcher(['/','/api/webhooks/(.*)']);

export default clerkMiddleware((auth, req) => {
  if (isPublicRoute(req)) {
    return;
  }

  auth().protect({
    unauthenticatedUrl: `/sign-in?redirect_url=${encodeURIComponent(req.nextUrl.href)}`,
  });
});

export const config = {
  matcher: ['/((?!.+\\.[\\w]+$|_next).*)', '/', '/(api|trpc)(.*)'],
};
