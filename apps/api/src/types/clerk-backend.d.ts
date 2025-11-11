declare module '@clerk/backend' {
  export interface ClerkJwtClaims {
    sub: string;
    sid?: string;
    [key: string]: unknown;
  }

  export interface VerifyTokenOptions {
    secretKey?: string;
    audience?: string | string[];
    authorizedParties?: string[];
    clockSkewInSeconds?: number;
  }

  export function verifyToken(token: string, options?: VerifyTokenOptions): Promise<ClerkJwtClaims>;
}
