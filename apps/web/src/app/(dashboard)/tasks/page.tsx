'use client';

import { useState } from 'react';
import { useAuth } from '@clerk/nextjs';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { useTaskStream, TaskStreamStatus } from '@/hooks/use-task-stream';
import { useToast } from '@/hooks/use-toast';
import {
  Play,
  CheckCircle2,
  XCircle,
  Clock,
  Loader2,
  AlertCircle,
} from 'lucide-react';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';


interface TaskExecutionResult {
  taskId: string;
  jobId: string;
  queueName: string;
  status: string;
  taskType: string;
  enqueuedAt: string;
}

interface RunningTaskEntry {
  taskId: string;
  jobId: string;
  queueName: string;
}

interface TaskDemo {
  id: string;
  type: string;
  name: string;
  description: string;
  payload: Record<string, unknown>;
}

const DEMO_TASKS: TaskDemo[] = [
  {
    id: 'ai-analysis',
    type: 'ai-analysis',
    name: 'AI Analysis Task',
    description: 'Runs an AI analysis with mock recommendations',
    payload: { type: 'ai-analysis' },
  },
  {
    id: 'data-sync',
    type: 'data-sync',
    name: 'Data Sync Task',
    description: 'Syncs data from connected sources',
    payload: { type: 'data-sync' },
  },
  {
    id: 'report-generation',
    type: 'report-generation',
    name: 'Report Generation',
    description: 'Generates a business report',
    payload: { type: 'report-generation' },
  },
];

function TaskStatusBadge({ status }: { status: string }) {
  const statusConfig: Record<string, { variant: 'default' | 'secondary' | 'success' | 'warning' | 'destructive'; icon: any }> = {
    pending: { variant: 'secondary', icon: Clock },
    running: { variant: 'warning', icon: Loader2 },
    completed: { variant: 'success', icon: CheckCircle2 },
    failed: { variant: 'destructive', icon: XCircle },
    waiting: { variant: 'secondary', icon: Clock },
    active: { variant: 'warning', icon: Loader2 },
    queued: { variant: 'secondary', icon: Clock },
  };

  const config = statusConfig[status] || statusConfig.pending;
  const Icon = config.icon;

  return (
    <Badge variant={config.variant} className="gap-1">
      <Icon className={`h-3 w-3 ${status === 'running' || status === 'active' ? 'animate-spin' : ''}`} />
      {status}
    </Badge>
  );
}

function TaskProgress({ status }: { status: TaskStreamStatus | null }) {
  if (!status) return null;

  const progress = typeof status.progress === 'object' && status.progress.percentage
    ? status.progress.percentage
    : typeof status.progress === 'number'
    ? status.progress
    : 0;

  const message = typeof status.progress === 'object' && status.progress.message
    ? status.progress.message
    : 'Processing...';

  const phase = typeof status.progress === 'object' && status.progress.phase
    ? status.progress.phase
    : null;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-sm">
        <span className="text-muted-foreground">{message}</span>
        <span className="font-medium">{Math.round(progress)}%</span>
      </div>
      <Progress value={progress} className="h-2" />
      {phase && (
        <p className="text-xs text-muted-foreground">
          Phase: <span className="font-medium capitalize">{phase}</span>
        </p>
      )}
    </div>
  );
}

function RunningTask({ task }: { task: RunningTaskEntry }) {
  const { status, isConnected, isComplete, error, disconnect } = useTaskStream(task);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-lg">Task #{task.taskId.slice(0, 8)}...</CardTitle>
            <CardDescription>
              {isConnected ? 'Streaming updates...' : 'Connecting...'}
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            {status && <TaskStatusBadge status={status.taskStatus} />}
            <Button
              variant="ghost"
              size="sm"
              onClick={disconnect}
              disabled={isComplete}
            >
              {isComplete ? 'Done' : 'Stop Watching'}
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {error ? (
          <div className="flex items-start gap-2 p-3 bg-destructive/10 text-destructive rounded-md">
            <AlertCircle className="h-5 w-5 mt-0.5 flex-shrink-0" />
            <div className="flex-1 text-sm">
              <p className="font-medium">Error</p>
              <p className="text-xs mt-1">{error}</p>
            </div>
          </div>
        ) : (
          <>
            {status && <TaskProgress status={status} />}

            {status && (
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <p className="text-muted-foreground">Job State</p>
                  <p className="font-medium">{status.jobState}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Task Status</p>
                  <p className="font-medium">{status.taskStatus}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Queue</p>
                  <p className="font-medium text-xs">{status?.queueName ?? task.queueName}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Job ID</p>
                  <p className="font-medium text-xs break-all">{task.jobId}</p>
                </div>
                {status.startedAt && (
                  <div>
                    <p className="text-muted-foreground">Started At</p>
                    <p className="font-medium text-xs">
                      {new Date(status.startedAt).toLocaleTimeString()}
                    </p>
                  </div>
                )}
                {status.completedAt && (
                  <div>
                    <p className="text-muted-foreground">Completed At</p>
                    <p className="font-medium text-xs">
                      {new Date(status.completedAt).toLocaleTimeString()}
                    </p>
                  </div>
                )}
              </div>
            )}

            {isComplete && status?.result && (
              <div className="p-3 bg-muted rounded-md">
                <p className="text-sm font-medium mb-2">Result</p>
                <pre className="text-xs overflow-auto max-h-40">
                  {JSON.stringify(status.result, null, 2)}
                </pre>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

export default function TasksPage() {
  const { getToken } = useAuth();
  const { toast } = useToast();
  const [runningTasks, setRunningTasks] = useState<RunningTaskEntry[]>([]);
  const [executingTask, setExecutingTask] = useState<string | null>(null);

  const executeTask = async (task: TaskDemo) => {
    setExecutingTask(task.id);

    try {
      const token = await getToken();
      if (!token) {
        throw new Error('No authentication token available');
      }

  const response = await fetch(`${API_URL}/tasks/execute`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          taskType: task.type,
          payload: task.payload,
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'Failed to execute task');
      }

      const result: TaskExecutionResult = await response.json();

      toast({
        title: 'Task Started',
        description: `Task ${task.name} has been queued for execution`,
      });

      // Add to running tasks
      setRunningTasks((prev) => {
        if (prev.some((entry) => entry.taskId === result.taskId)) {
          return prev;
        }

        return [
          ...prev,
          {
            taskId: result.taskId,
            jobId: result.jobId,
            queueName: result.queueName,
          },
        ];
      });
    } catch (error) {
      toast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to execute task',
        variant: 'destructive',
      });
    } finally {
      setExecutingTask(null);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Tasks</h1>
        <p className="text-muted-foreground">
          Execute and monitor tasks with real-time status updates
        </p>
      </div>

      {/* Demo Tasks */}
      <Card>
        <CardHeader>
          <CardTitle>Demo Tasks</CardTitle>
          <CardDescription>
            Execute sample tasks to see real-time progress updates via Server-Sent Events
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-3">
            {DEMO_TASKS.map((task) => (
              <Card key={task.id} className="border-2">
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">{task.name}</CardTitle>
                  <CardDescription className="text-xs">
                    {task.description}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <Button
                    onClick={() => executeTask(task)}
                    disabled={executingTask === task.id}
                    className="w-full"
                    size="sm"
                  >
                    {executingTask === task.id ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Starting...
                      </>
                    ) : (
                      <>
                        <Play className="mr-2 h-4 w-4" />
                        Execute Task
                      </>
                    )}
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Running Tasks */}
      {runningTasks.length > 0 && (
        <div className="space-y-4">
          <h2 className="text-xl font-semibold">Running Tasks</h2>
          <div className="space-y-4">
            {runningTasks.map((task) => (
              <RunningTask key={task.taskId} task={task} />
            ))}
          </div>
        </div>
      )}

      {/* Empty State */}
      {runningTasks.length === 0 && (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Clock className="h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold mb-2">No Running Tasks</h3>
            <p className="text-sm text-muted-foreground text-center max-w-md">
              Execute a demo task above to see real-time progress updates streamed from the server
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
