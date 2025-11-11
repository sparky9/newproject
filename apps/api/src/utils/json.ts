import { Prisma } from '@prisma/client';

function serializeArray(value: unknown[]): Prisma.JsonArray {
  return value.map((entry) => toJsonValue(entry)) as Prisma.JsonArray;
}

function serializeObject(value: Record<string, unknown>): Prisma.JsonObject {
  const result: Prisma.JsonObject = {};
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === 'undefined') {
      continue;
    }
    result[key] = toJsonValue(entry);
  }
  return result;
}

export function toJsonValue(value: unknown): Prisma.JsonValue {
  if (
    value === Prisma.DbNull ||
    value === Prisma.JsonNull ||
    value === Prisma.AnyNull
  ) {
    return value as Prisma.JsonValue;
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return value;
  }

  if (Array.isArray(value)) {
    return serializeArray(value);
  }

  if (typeof value === 'object' && value !== undefined) {
    return serializeObject(value as Record<string, unknown>);
  }

  return null;
}

export function toInputJson(value: unknown): Prisma.InputJsonValue {
  return toJsonValue(value) as Prisma.InputJsonValue;
}

export function toJsonObject(value: Record<string, unknown>): Prisma.JsonObject {
  return serializeObject(value);
}

export function parseJsonRecord(value: Prisma.JsonValue): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}
