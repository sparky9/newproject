declare global {
  namespace Express {
    interface Request {
      // Clerk authentication
      auth?: {
        userId: string;
        sessionId: string;
        claims: Record<string, unknown>;
      };
      
      // Tenant context
      tenantId?: string;
      
      // User context
      clerkId?: string;
    }
  }
}

export {};
