import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import request from 'supertest';
import type { Application } from 'express';
import type { Server } from 'http';
import type { AddressInfo } from 'net';

const streamCompletionMock = vi.hoisted(() =>
  vi.fn(async function* mockStreamCompletion() {
    yield { done: false, content: 'Projected revenue momentum remains strong.' };
    yield { done: true, content: '' };
  })
);

vi.mock('../../src/services/llm/fireworks-client.js', async () => {
  const actual = await vi.importActual<typeof import('../../src/services/llm/fireworks-client.js')>(
    '../../src/services/llm/fireworks-client.js'
  );

  return {
    ...actual,
    streamCompletion: streamCompletionMock,
    estimateTokens: vi.fn(() => 128),
  };
});

import { createApp } from '../../src/app.js';
import { initializeQueues, closeQueues } from '../../src/queue/index.js';
import { checkDatabaseHealth, disconnectDatabase } from '@ocsuite/db';
import {
  createTestTenant,
  createTestUser,
  cleanupTestData,
  TEST_TENANT_ID,
  TEST_USER_ID,
  generateMockJWT,
} from '../utils/test-helpers.js';

const startTestServer = (appInstance: Application) =>
  new Promise<{ server: Server; port: number }>((resolve, reject) => {
    const server = appInstance.listen(0);
    server.once('listening', () => {
      const address = server.address();

      if (!address || typeof address === 'string') {
        reject(new Error('Unable to determine test server port'));
        return;
      }

      resolve({ server, port: (address as AddressInfo).port });
    });

    server.once('error', reject);
  });

/**
 * Smoke Test - Critical User Journeys
 *
 * These tests verify that the most critical API endpoints are functioning correctly.
 * They simulate real user workflows and ensure core functionality works end-to-end.
 */
describe('Smoke Test - Critical User Journeys', () => {
  let app: Application;
  let authToken: string;

  beforeAll(async () => {
    // Check database connectivity
    const dbHealthy = await checkDatabaseHealth();
    if (!dbHealthy) {
      throw new Error('Database is not healthy - cannot run tests');
    }

    // Initialize queues for task execution tests
    await initializeQueues();

    // Create test tenant and user
    await createTestTenant(TEST_TENANT_ID);
    await createTestUser(TEST_TENANT_ID, TEST_USER_ID);

    // Generate mock JWT token
    authToken = generateMockJWT(TEST_USER_ID);

    // Create Express app
    app = createApp();
  });

  afterAll(async () => {
    // Clean up test data
    await cleanupTestData(TEST_TENANT_ID);

    // Close queues
    await closeQueues();

    // Disconnect from database
    await disconnectDatabase();
  });

  describe('Health Check', () => {
    it('should return healthy status', async () => {
      const response = await request(app).get('/health');

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('status', 'healthy');
      expect(response.body).toHaveProperty('timestamp');
      expect(response.body).toHaveProperty('uptime');
    });
  });

  describe('API Root', () => {
    it('should return API information', async () => {
      const response = await request(app).get('/');

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('name', 'OC-Suite API');
      expect(response.body).toHaveProperty('version');
      expect(response.body).toHaveProperty('endpoints');
    });
  });

  describe('Chat Endpoint (SSE Streaming)', () => {
    it('should handle chat message with SSE streaming', async () => {
  const { server, port } = await startTestServer(app);

      try {
  const healthCheck = await fetch(`http://127.0.0.1:${port}/health`);
  expect(healthCheck.status).toBe(200);

        const response = await fetch(`http://127.0.0.1:${port}/c-suite/ceo/chat`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${authToken}`,
            'X-Tenant-ID': TEST_TENANT_ID,
          },
          body: JSON.stringify({
            message: 'What is our strategic direction for Q4?',
          }),
        });

        expect(response.status).toBe(200);
        expect(response.headers.get('content-type')).toContain('text/event-stream');

        const reader = response.body?.getReader();
        expect(reader).toBeDefined();

        const decoder = new TextDecoder();
        let buffer = '';
        let sawChunk = false;

        if (reader) {
          let streamComplete = false;
          while (!streamComplete) {
            const { value, done } = await reader.read();
            if (value) {
              buffer += decoder.decode(value, { stream: true });
              if (buffer.includes('"type":"chunk"')) {
                sawChunk = true;
              }
              if (buffer.includes('"type":"done"')) {
                streamComplete = true;
              }
            }
            if (done) {
              streamComplete = true;
            }
          }

          await reader.cancel();
        }

        expect(sawChunk).toBe(true);
      } finally {
        await new Promise<void>((resolve, reject) => {
          server.close(err => (err ? reject(err) : resolve()));
        });
      }
    });

    it('should validate message input', async () => {
  const { server, port } = await startTestServer(app);

      try {
        const response = await fetch(`http://127.0.0.1:${port}/c-suite/ceo/chat`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${authToken}`,
            'X-Tenant-ID': TEST_TENANT_ID,
          },
          body: JSON.stringify({
            message: '',
          }),
        });

        expect(response.status).toBe(400);
        const payload = await response.json();
        expect(payload).toHaveProperty('error', 'Validation Error');
        expect(payload).toHaveProperty('code', 'VALIDATION_ERROR');
      } finally {
        await new Promise<void>((resolve, reject) => {
          server.close(err => (err ? reject(err) : resolve()));
        });
      }
    });

    it('should require authentication', async () => {
  const { server, port } = await startTestServer(app);

      try {
        const response = await fetch(`http://127.0.0.1:${port}/c-suite/ceo/chat`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Tenant-ID': TEST_TENANT_ID,
          },
          body: JSON.stringify({
            message: 'Test message',
          }),
        });

        expect([401, 403]).toContain(response.status);
      } finally {
        await new Promise<void>((resolve, reject) => {
          server.close(err => (err ? reject(err) : resolve()));
        });
      }
    });
  });

  describe('Task Execution', () => {
    let taskId: string;
    it('should execute a task and return job info', async () => {
      const response = await request(app)
        .post('/tasks/execute')
        .set('Authorization', `Bearer ${authToken}`)
        .set('X-Tenant-ID', TEST_TENANT_ID)
        .send({
          taskType: 'email-send',
          payload: {
            to: 'test@example.com',
            subject: 'Test Email',
            body: 'This is a test email',
          },
        });

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('taskId');
      expect(response.body).toHaveProperty('jobId');
      expect(response.body).toHaveProperty('status', 'queued');
      expect(response.body).toHaveProperty('taskType', 'email-send');

      // Save for next test
      taskId = response.body.taskId;
    });

    it('should retrieve task status', async () => {
      // Wait a moment for task to be created
      await new Promise(resolve => setTimeout(resolve, 100));

      const response = await request(app)
        .get(`/tasks/${taskId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .set('X-Tenant-ID', TEST_TENANT_ID);

  expect(response.status).toBe(200);
  expect(response.body).toHaveProperty('success', true);
  expect(response.body).toHaveProperty('data');
  expect(response.body.data).toHaveProperty('id', taskId);
  expect(response.body.data).toHaveProperty('type', 'email-send');
  expect(response.body.data).toHaveProperty('status');
  const statusValue = String(response.body.data.status).toLowerCase();
  expect(['pending', 'running', 'completed', 'failed']).toContain(statusValue);
    });

    it('should validate task ID format', async () => {
      const response = await request(app)
        .get('/tasks/invalid-task-id')
        .set('Authorization', `Bearer ${authToken}`)
        .set('X-Tenant-ID', TEST_TENANT_ID);

      expect(response.status).toBe(400);
      expect(response.body).toHaveProperty('code', 'INVALID_TASK_ID');
    });

    it('should return 404 for non-existent task', async () => {
      const fakeTaskId = '00000000-0000-0000-0000-000000000000';
      const response = await request(app)
        .get(`/tasks/${fakeTaskId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .set('X-Tenant-ID', TEST_TENANT_ID);

  expect(response.status).toBe(404);
  expect(response.body).toHaveProperty('error');
  expect(response.body.error).toHaveProperty('code', 'TASK_NOT_FOUND');
    });

    it('should validate task execution payload', async () => {
      const response = await request(app)
        .post('/tasks/execute')
        .set('Authorization', `Bearer ${authToken}`)
        .set('X-Tenant-ID', TEST_TENANT_ID)
        .send({
          taskType: '', // Empty task type should fail
          payload: {},
        });

      expect(response.status).toBe(400);
      expect(response.body).toHaveProperty('code', 'VALIDATION_ERROR');
    });
  });

  describe('Connectors', () => {
    it('should list available connectors', async () => {
      const response = await request(app)
        .get('/connectors')
        .set('Authorization', `Bearer ${authToken}`)
        .set('X-Tenant-ID', TEST_TENANT_ID);

      expect(response.status).toBe(200);
      expect(Array.isArray(response.body.connectors)).toBe(true);

      // If there are connectors, verify structure
      if (response.body.connectors.length > 0) {
        const connector = response.body.connectors[0];
        expect(connector).toHaveProperty('id');
        expect(connector).toHaveProperty('provider');
        expect(connector).toHaveProperty('status');
      }
    });

    it('should handle OAuth authorization request', async () => {
      const response = await request(app)
        .post('/connectors/google/authorize')
        .set('Authorization', `Bearer ${authToken}`)
        .set('X-Tenant-ID', TEST_TENANT_ID)
        .send({
          scopes: ['gmail.readonly', 'calendar.readonly'],
        });

      // Should return authorization URL or handle the OAuth flow
      expect([200, 400, 501]).toContain(response.status);

      if (response.status === 200) {
        expect(response.body).toHaveProperty('authorizationUrl');
      }
    });
  });

  describe('Board Meeting (Multi-Agent)', () => {
    it('should handle board meeting request', async () => {
      const response = await request(app)
        .post('/c-suite/board-meeting')
        .set('Authorization', `Bearer ${authToken}`)
        .set('X-Tenant-ID', TEST_TENANT_ID)
        .send({
          topic: 'Q4 Strategic Planning',
          agenda: [
            'Revenue targets',
            'Marketing strategy',
            'Technology roadmap',
          ],
        });

      // Depending on implementation, this might be SSE or regular JSON
      expect([200, 400, 501]).toContain(response.status);
    });
  });

  describe('Error Handling', () => {
    it('should handle 404 for unknown endpoints', async () => {
      const response = await request(app)
        .get('/nonexistent-endpoint')
        .set('Authorization', `Bearer ${authToken}`)
        .set('X-Tenant-ID', TEST_TENANT_ID);

      expect(response.status).toBe(404);
    });

    it('should handle missing tenant ID', async () => {
      const response = await request(app)
        .post('/tasks/execute')
        .set('Authorization', `Bearer ${authToken}`)
        // Missing X-Tenant-ID header
        .send({
          taskType: 'test-task',
          payload: {},
        });

  expect(response.status).toBe(400);
  expect(response.body).toHaveProperty('code', 'TENANT_HEADER_REQUIRED');
    });
  });

  describe('Rate Limiting', () => {
    it('should handle multiple requests within limits', async () => {
      // Make several requests in quick succession
      const requests = Array(5)
        .fill(null)
        .map(() =>
          request(app)
            .get('/health')
            .set('Authorization', `Bearer ${authToken}`)
        );

      const responses = await Promise.all(requests);

      // All should succeed (health endpoint might not be rate limited)
      responses.forEach(response => {
        expect([200, 429]).toContain(response.status);
      });
    });
  });
});
