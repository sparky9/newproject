# API Tests

This directory contains tests for the OC-Suite API server.

## Structure

```
tests/
├── integration/
│   └── smoke.test.ts       # Smoke tests for critical user journeys
├── utils/
│   └── test-helpers.ts     # Test utilities and helpers
├── setup.ts                # Global test setup
└── README.md              # This file
```

## Test Environment Behavior

- **Clerk Auth Mock** (`tests/setup.ts`)
  - Requests still need a `Bearer` token to pass `requireAuth`.
  - When the header is missing, the mock returns the same 401 payload as production (`AUTH_REQUIRED`).

- **Rate Limiting**
  - The chat rate limiter is wrapped with a no-op when `NODE_ENV === 'test'` so SSE tests do not depend on Redis timing.
  - The Redis stub emulates the `SCRIPT`/`EVALSHA` flow used by `rate-limit-redis`; unexpected commands will surface in test output instead of hanging.

- **Deterministic Chat SSE**
  - `/c-suite/ceo/chat` yields a canned response in test mode (one `chunk`, then `done`) to avoid external LLM calls.
  - SSE helpers consume the stream with `fetch` + `ReadableStream`, mirroring production behaviour.

- **Tenant IDs**
  - `TEST_TENANT_ID` / `TEST_USER_ID` power shared smoke paths.
  - Google Analytics tests use `test-tenant-google-analytics-…` to avoid unique-constraint conflicts with other suites.
  - Notifications tests rely on a different Clerk ID (`notifications-user-…`) so state remains isolated.

## Running Tests

### All Tests

```bash
# From project root
pnpm test

# From apps/api directory
pnpm test
```

### Watch Mode

```bash
pnpm test:watch
```

### With Coverage

```bash
pnpm test:coverage
```

### Specific Test File

```bash
pnpm vitest tests/integration/smoke.test.ts
```

## Prerequisites

Before running tests, ensure you have:

1. **PostgreSQL** running on `localhost:5432`

   ```bash
   docker-compose -f ../../docker-compose.dev.yml up -d postgres
   ```

2. **Redis** running on `localhost:6379`

   ```bash
   docker-compose -f ../../docker-compose.dev.yml up -d redis
   ```

3. **Environment variables** set in `.env.test`:

   ```bash
   DATABASE_URL=postgresql://postgres:postgres@localhost:5432/csuite_test
   REDIS_URL=redis://localhost:6379
   MASTER_ENCRYPTION_KEY=test-master-encryption-key-32-bytes-long!!
   CLERK_SECRET_KEY=test-clerk-secret-key
   CLERK_PUBLISHABLE_KEY=test-clerk-publishable-key
   ```

4. **Database migrations** applied:
   ```bash
   pnpm --filter @ocsuite/db db:push
   ```

## Writing Tests

### Integration Tests

Integration tests should test API endpoints with real database and queue interactions:

```typescript
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { createApp } from "../../src/app.js";
import {
  createTestTenant,
  createTestUser,
  cleanupTestData,
  TEST_TENANT_ID,
  TEST_USER_ID,
  generateMockJWT,
} from "../utils/test-helpers.js";

describe("My Feature", () => {
  let app: any;
  let authToken: string;

  beforeAll(async () => {
    await createTestTenant();
    await createTestUser();
    authToken = generateMockJWT();
    app = createApp();
  });

  afterAll(async () => {
    await cleanupTestData();
  });

  it("should work correctly", async () => {
    const response = await request(app)
      .post("/my-endpoint")
      .set("Authorization", `Bearer ${authToken}`)
      .set("X-Tenant-ID", TEST_TENANT_ID)
      .send({ data: "test" });

    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty("result");
  });
});
```

### Test Helpers

Use the provided test helpers for common operations:

```typescript
// Create test tenant
await createTestTenant();

// Create test user
await createTestUser();

// Generate mock JWT
const token = generateMockJWT();

// Clean up test data
await cleanupTestData();

// Wait for condition
await waitFor(async () => {
  const task = await db.task.findUnique({ where: { id: taskId } });
  return task?.status === "completed";
});

// Parse SSE data
const events = parseSSEData(response.text);
```

## Smoke Tests

The smoke tests (`tests/integration/smoke.test.ts`) verify critical user journeys:

1. **Health Check** - API is running and healthy
2. **Chat Endpoint** - SSE streaming works
3. **Task Execution** - Tasks can be created and executed
4. **Task Status** - Task status can be retrieved
5. **Connectors** - Connector listing works
6. **Error Handling** - Errors are handled gracefully

These tests ensure the core functionality works end-to-end.

## Troubleshooting

### Database connection errors

Ensure PostgreSQL is running:

```bash
docker ps | grep postgres
```

If not running:

```bash
docker-compose -f ../../docker-compose.dev.yml up -d postgres
```

### Redis connection errors

Ensure Redis is running:

```bash
docker ps | grep redis
```

If not running:

```bash
docker-compose -f ../../docker-compose.dev.yml up -d redis
```

### Authentication errors

The tests use mocked Clerk authentication. If you see auth errors, check that:

1. `tests/setup.ts` is being loaded (it's configured in `vitest.config.ts`)
2. The auth middleware mocks are working correctly

### Test data cleanup

If tests fail and leave behind test data:

```typescript
import { cleanupTestData } from "./utils/test-helpers.js";

// Run this manually or add to afterAll
await cleanupTestData();
```

### Timeouts

If tests timeout, increase the timeout in `vitest.config.ts`:

```typescript
export default defineConfig({
  test: {
    testTimeout: 30000, // 30 seconds
  },
});
```

## Best Practices

1. **Always clean up test data** in `afterAll` hooks
2. **Use descriptive test names** that explain what they test
3. **Test one thing per test** - keep tests focused
4. **Don't rely on test execution order** - tests should be independent
5. **Mock external services** - don't call real APIs in tests
6. **Use test helpers** - don't duplicate setup code
7. **Check both success and error cases**

## Resources

- [Vitest Documentation](https://vitest.dev/)
- [Supertest Documentation](https://github.com/ladjs/supertest)
- [Main Testing Guide](../../../TESTING.md)
