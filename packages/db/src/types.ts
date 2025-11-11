/**
 * Type exports and utilities for @ocsuite/db
 *
 * This file provides type-safe utilities for working with Prisma models
 * and ensures consistency with @ocsuite/types package.
 */

import type { Prisma } from '@prisma/client';

/**
 * Utility type to get the return type of a Prisma model query
 */
export type PrismaModel<T extends keyof Prisma.TypeMap['model']> =
  Prisma.TypeMap['model'][T]['operations']['findMany']['result'];

/**
 * Utility type for creating a new record (without id, createdAt, updatedAt)
 */
export type CreateInput<T> = Omit<T, 'id' | 'createdAt' | 'updatedAt'>;

/**
 * Utility type for updating a record (without id, createdAt, updatedAt)
 */
export type UpdateInput<T> = Partial<Omit<T, 'id' | 'createdAt' | 'updatedAt'>>;

/**
 * Type guard to check if a field is defined
 */
export function isDefined<T>(value: T | null | undefined): value is T {
  return value !== null && value !== undefined;
}

/**
 * Type for pagination parameters
 */
export interface PaginationParams {
  take?: number;
  skip?: number;
  cursor?: string;
}

/**
 * Type for paginated results
 */
export interface PaginatedResult<T> {
  data: T[];
  hasMore: boolean;
  total?: number;
  cursor?: string;
}

/**
 * Type for sorting parameters
 */
export interface SortParams<T> {
  orderBy?: {
    [K in keyof T]?: 'asc' | 'desc';
  };
}

/**
 * Type for filtering parameters with tenant context
 */
export interface TenantFilterParams<T> {
  where?: Partial<T> & { tenantId?: string };
}

/**
 * Common query options for tenant-scoped queries
 */
export interface TenantQueryOptions<T> extends PaginationParams, SortParams<T> {
  include?: Record<string, boolean>;
  select?: Record<string, boolean>;
}
