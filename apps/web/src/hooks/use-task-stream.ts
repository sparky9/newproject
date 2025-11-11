import { useEffect, useState, useRef } from 'react';
import { useAuth } from '@clerk/nextjs';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

export interface TaskProgress {
  phase?: 'initializing' | 'validating' | 'executing' | 'finalizing' | 'completed';
  percentage?: number;
  message?: string;
  metadata?: Record<string, unknown>;
}

export interface TaskStreamStatus {
  taskId: string;
  jobId: string;
  taskStatus: string;
  jobState: string;
  progress: number | TaskProgress;
  data?: unknown;
  timestamp: number;
  startedAt?: string | null;
  completedAt?: string | null;
  queueName?: string;
  result?: Record<string, unknown>;
  returnValue?: unknown;
  error?: string;
  failedReason?: string;
  attemptsMade?: number;
}

export interface UseTaskStreamResult {
  status: TaskStreamStatus | null;
  isConnected: boolean;
  isComplete: boolean;
  error: string | null;
  disconnect: () => void;
}

/**
 * React hook for streaming real-time task status updates via SSE
 *
 * @param taskId - The task ID to stream updates for (null to disable)
 * @returns Stream status and control functions
 *
 * @example
 * ```tsx
 * const { status, isConnected, isComplete, error } = useTaskStream({
 *   taskId,
 *   jobId,
 *   queueName,
 * });
 *
 * if (error) {
 *   return <div>Error: {error}</div>;
 * }
 *
 * if (!status) {
 *   return <div>Connecting...</div>;
 * }
 *
 * return (
 *   <div>
 *     <p>Status: {status.taskStatus}</p>
 *     <p>Progress: {typeof status.progress === 'object' ? status.progress.percentage : status.progress}%</p>
 *   </div>
 * );
 * ```
 */
interface TaskStreamConfig {
  taskId: string;
  jobId: string;
  queueName?: string;
}

export function useTaskStream(task: TaskStreamConfig | null): UseTaskStreamResult {
  const { getToken } = useAuth();
  const [status, setStatus] = useState<TaskStreamStatus | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [isComplete, setIsComplete] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);

  const disconnect = () => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
      setIsConnected(false);
    }
  };

  useEffect(() => {
    if (!task) {
      disconnect();
      setStatus(null);
      setIsComplete(false);
      setError(null);
      return;
    }

    let eventSource: EventSource | null = null;
    let isMounted = true;

    const setupEventSource = async () => {
      try {
        // Get auth token
        const token = await getToken();
        if (!token) {
          throw new Error('No authentication token available');
        }

        // Note: EventSource doesn't support custom headers directly
        // We'll need to pass the token via URL query parameter for SSE
  const url = new URL(`${API_URL}/tasks/${task.taskId}/stream`);
        url.searchParams.set('token', token);
        url.searchParams.set('jobId', task.jobId);
        if (task.queueName) {
          url.searchParams.set('queueName', task.queueName);
        }

        eventSource = new EventSource(url.toString());
        eventSourceRef.current = eventSource;

        // Connected event
        eventSource.addEventListener('connected', (event) => {
          if (!isMounted) return;
          const data = JSON.parse(event.data);
          setIsConnected(true);
          setError(null);
          console.log('SSE connected:', data);
        });

        // Progress event
        eventSource.addEventListener('progress', (event) => {
          if (!isMounted) return;
          const data: TaskStreamStatus = JSON.parse(event.data);
          setStatus(data);
          setError(null);
        });

        // Completed event
        eventSource.addEventListener('completed', (event) => {
          if (!isMounted) return;
          const data: TaskStreamStatus = JSON.parse(event.data);
          setStatus(data);
          setIsComplete(true);
          setError(null);
          disconnect();
        });

        // Failed event
        eventSource.addEventListener('failed', (event) => {
          if (!isMounted) return;
          const data: TaskStreamStatus = JSON.parse(event.data);
          setStatus(data);
          setError(data.failedReason || data.error || 'Task failed');
          setIsComplete(true);
          disconnect();
        });

        // Error event
        eventSource.addEventListener('error', (event: Event) => {
          if (!isMounted) return;

          // Check if it's a MessageEvent with data
          if ('data' in event && typeof event.data === 'string') {
            try {
              const data = JSON.parse(event.data);
              setError(data.message || 'Unknown error');
            } catch {
              setError('Failed to connect to task stream');
            }
          } else {
            // Generic connection error
            setError('Connection error');
          }

          setIsConnected(false);
          disconnect();
        });

        // Handle connection errors
        eventSource.onerror = () => {
          if (!isMounted) return;
          if (eventSource?.readyState === EventSource.CLOSED) {
            setIsConnected(false);
            if (!isComplete && !error) {
              setError('Connection closed unexpectedly');
            }
          }
        };

      } catch (err) {
        if (!isMounted) return;
        setError(err instanceof Error ? err.message : 'Failed to setup stream');
        setIsConnected(false);
      }
    };

    setupEventSource();

    return () => {
      isMounted = false;
      disconnect();
    };
  }, [task, getToken, isComplete, error]);

  return { status, isConnected, isComplete, error, disconnect };
}
