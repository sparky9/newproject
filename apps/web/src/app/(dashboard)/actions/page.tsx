'use client';

import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '@clerk/nextjs';
import { createApiClient, type ApproveActionApprovalResponse } from '@/lib/api';
import type { ActionApproval, ActionApprovalAuditEvent } from '@ocsuite/types';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import {
  ClipboardList,
  Loader2,
  ShieldAlert,
  CheckCircle2,
  XCircle,
  RefreshCw,
} from 'lucide-react';

function RiskBadge({ level }: { level: 'low' | 'medium' | 'high' }) {
  const variant = level === 'low' ? 'success' : level === 'medium' ? 'warning' : 'error';
  return <Badge variant={variant}>{level.toUpperCase()}</Badge>;
}

function StatusBadge({ status }: { status: ActionApproval['status'] }) {
  const variant =
    status === 'executed'
      ? 'success'
      : status === 'failed'
        ? 'error'
        : status === 'approved' || status === 'executing'
          ? 'warning'
          : 'outline';

  return (
    <Badge variant={variant}>{status.replace(/_/g, ' ').toUpperCase()}</Badge>
  );
}

function formatDate(value?: string | null) {
  if (!value) return '—';
  return new Date(value).toLocaleString();
}

function summaryFromPayload(payload: Record<string, unknown>): string {
  const summary = payload.summary;
  if (typeof summary === 'string' && summary.trim().length > 0) {
    return summary;
  }

  const title = payload.title;
  if (typeof title === 'string' && title.trim().length > 0) {
    return title;
  }

  const capability = payload.capability;
  if (typeof capability === 'string') {
    return `Capability: ${capability}`;
  }

  return 'Action request';
}

function moduleDisplay(payload: Record<string, unknown>): string {
  const moduleSlug = payload.moduleSlug;
  const capability = payload.capability;
  if (typeof moduleSlug === 'string' && typeof capability === 'string') {
    return `${moduleSlug} · ${capability}`;
  }
  if (typeof moduleSlug === 'string') {
    return moduleSlug;
  }
  return '—';
}

function extractRiskReasons(log?: ActionApprovalAuditEvent[]): string[] {
  if (!log) return [];
  const submitted = log.find((event) => event.event === 'submitted');
  const metadata = submitted?.metadata;
  if (!metadata) return [];
  const reasons = metadata.riskReasons;
  return Array.isArray(reasons)
    ? reasons.filter((value): value is string => typeof value === 'string')
    : [];
}

export default function ActionsPage() {
  const { getToken } = useAuth();
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [approvals, setApprovals] = useState<ActionApproval[]>([]);
  const [selected, setSelected] = useState<ActionApproval | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [comment, setComment] = useState('');
  const [processing, setProcessing] = useState<'approve' | 'reject' | null>(null);

  useEffect(() => {
    loadApprovals();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadApprovals(options: { silent?: boolean } = {}) {
    if (!options.silent) {
      setLoading(true);
    }
    try {
      const api = createApiClient(getToken);
      const data = await api.getActionApprovals({ status: 'pending', limit: 50 });
      setApprovals(data);
    } catch (error) {
      console.error('Failed to load action approvals', error);
      toast({
        title: 'Failed to load approvals',
        description: 'Please try again shortly.',
        variant: 'destructive',
      });
    } finally {
      if (!options.silent) {
        setLoading(false);
      }
    }
  }

  async function refreshApprovals() {
    setRefreshing(true);
    try {
      await loadApprovals({ silent: true });
    } finally {
      setRefreshing(false);
    }
  }

  async function openApprovalDetails(approval: ActionApproval) {
    setDialogOpen(true);
    setComment('');
    setProcessing(null);
    setSelected(approval);

    try {
      const api = createApiClient(getToken);
      const detailed = await api.getActionApprovalAudit(approval.id);
      setSelected(detailed);
    } catch (error) {
      console.error('Failed to load approval audit log', error);
      toast({
        title: 'Unable to load details',
        description: 'Audit log could not be loaded. Please try again.',
        variant: 'destructive',
      });
    }
  }

  function closeDialog() {
    setDialogOpen(false);
    setSelected(null);
    setComment('');
    setProcessing(null);
  }

  async function handleApprove() {
    if (!selected) return;
    setProcessing('approve');
    try {
      const api = createApiClient(getToken);
      const response: ApproveActionApprovalResponse =
        await api.approveActionApproval(selected.id, comment || undefined);

      setApprovals((prev) => prev.filter((item) => item.id !== selected.id));
      toast({
        title: 'Action approved',
        description: `Execution job ${response.job.jobId} queued for processing.`,
      });
      closeDialog();
    } catch (error) {
      console.error('Approval failed', error);
      toast({
        title: 'Approval failed',
        description: 'Please try again or check the action state.',
        variant: 'destructive',
      });
      setProcessing(null);
    }
  }

  async function handleReject() {
    if (!selected) return;
    setProcessing('reject');
    try {
      const api = createApiClient(getToken);
      await api.rejectActionApproval(selected.id, comment || undefined);
      setApprovals((prev) => prev.filter((item) => item.id !== selected.id));
      toast({
        title: 'Action rejected',
        description: 'The submitter has been notified.',
      });
      closeDialog();
    } catch (error) {
      console.error('Rejection failed', error);
      toast({
        title: 'Rejection failed',
        description: 'Please try again or verify the approval state.',
        variant: 'destructive',
      });
      setProcessing(null);
    }
  }

  const auditLog = selected?.auditLog;
  const riskReasons = useMemo(
    () => extractRiskReasons(auditLog),
    [auditLog]
  );
  const submittedEvent = auditLog?.find((event) => event.event === 'submitted');
  const submittedAt = submittedEvent?.at ?? selected?.createdAt;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <ClipboardList className="h-7 w-7" />
            Action Approvals
          </h1>
          <p className="text-muted-foreground">
            Review AI-generated recommendations before they execute in your workspace.
          </p>
        </div>
        <Button variant="outline" onClick={refreshApprovals} disabled={refreshing}>
          <RefreshCw className={cn('h-4 w-4 mr-2', refreshing && 'animate-spin')} />
          Refresh
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Pending approvals</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : approvals.length === 0 ? (
            <div className="text-center py-16 space-y-2">
              <ShieldAlert className="h-8 w-8 text-muted-foreground mx-auto" />
              <p className="font-medium">No pending approvals</p>
              <p className="text-sm text-muted-foreground">
                Approved actions will appear here when modules request execution.
              </p>
            </div>
          ) : (
            <div className="overflow-hidden rounded-md border">
              <table className="w-full text-sm">
                <thead className="bg-muted/60 text-left">
                  <tr className="text-muted-foreground">
                    <th className="px-4 py-3 font-medium">Action</th>
                    <th className="px-4 py-3 font-medium">Module</th>
                    <th className="px-4 py-3 font-medium">Risk</th>
                    <th className="px-4 py-3 font-medium">Requested By</th>
                    <th className="px-4 py-3 font-medium">Submitted</th>
                    <th className="px-4 py-3 font-medium text-right">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {approvals.map((approval) => {
                    const payload = (approval.payload ?? {}) as Record<string, unknown>;
                    return (
                      <tr
                        key={approval.id}
                        className="border-t hover:bg-muted/40 cursor-pointer"
                        onClick={() => openApprovalDetails(approval)}
                      >
                        <td className="px-4 py-3">
                          <div className="font-medium text-foreground">
                            {summaryFromPayload(payload)}
                          </div>
                          <div className="text-xs text-muted-foreground truncate max-w-[320px]">
                            {payload.description && typeof payload.description === 'string'
                              ? payload.description
                              : 'Review requested execution payload'}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-muted-foreground">
                          {moduleDisplay(payload)}
                        </td>
                        <td className="px-4 py-3">
                          <RiskBadge level={approval.riskLevel} />
                        </td>
                        <td className="px-4 py-3 text-muted-foreground">
                          {approval.createdBy || 'System'}
                        </td>
                        <td className="px-4 py-3 text-muted-foreground">
                          {formatDate(approval.createdAt)}
                        </td>
                        <td className="px-4 py-3 pr-4 text-right">
                          <StatusBadge status={approval.status} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={(open) => !open && closeDialog()}>
        <DialogContent className="max-w-3xl">
          {selected ? (
            <div className="space-y-6">
              <DialogHeader>
                <DialogTitle className="flex items-center justify-between">
                  <span>Review Action</span>
                  <RiskBadge level={selected.riskLevel} />
                </DialogTitle>
                <DialogDescription>
                  Submitted {formatDate(submittedAt)} by {selected.createdBy || 'System'}
                </DialogDescription>
              </DialogHeader>

              <div className="grid gap-4 md:grid-cols-2">
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base">Summary</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2 text-sm text-muted-foreground">
                    <p>{summaryFromPayload((selected.payload ?? {}) as Record<string, unknown>)}</p>
                    <div className="space-y-1 text-xs">
                      <div><span className="font-medium text-foreground">Module:</span> {moduleDisplay((selected.payload ?? {}) as Record<string, unknown>)}</div>
                      <div><span className="font-medium text-foreground">Risk score:</span> {selected.riskScore}</div>
                    </div>
                    {riskReasons.length > 0 && (
                      <div className="pt-2">
                        <p className="text-xs uppercase text-muted-foreground mb-1">Risk factors</p>
                        <ul className="list-disc list-inside text-xs space-y-1">
                          {riskReasons.map((reason) => (
                            <li key={reason}>{reason}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base">Timeline</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3 text-xs text-muted-foreground">
                    {(auditLog ?? []).map((event) => (
                      <div key={`${event.event}-${event.at}`} className="flex items-start gap-2">
                        <div className="mt-1">
                          {event.event === 'submitted' ? (
                            <ClipboardList className="h-4 w-4" />
                          ) : event.event === 'approved' ? (
                            <CheckCircle2 className="h-4 w-4 text-green-500" />
                          ) : event.event === 'failed' ? (
                            <XCircle className="h-4 w-4 text-red-500" />
                          ) : (
                            <ShieldAlert className="h-4 w-4" />
                          )}
                        </div>
                        <div>
                          <div className="font-medium text-foreground capitalize">{event.event}</div>
                          <div>{formatDate(event.at)}</div>
                          {event.note && <div className="mt-1 text-foreground">“{event.note}”</div>}
                        </div>
                      </div>
                    ))}
                  </CardContent>
                </Card>
              </div>

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">Execution preview</CardTitle>
                </CardHeader>
                <CardContent>
                  <pre className="bg-muted rounded-md p-4 text-xs overflow-x-auto">
                    {JSON.stringify(selected.payload ?? {}, null, 2)}
                  </pre>
                </CardContent>
              </Card>

              <div className="space-y-2">
                <label htmlFor="approval-comment" className="text-sm font-medium text-foreground">
                  Optional comment
                </label>
                <textarea
                  id="approval-comment"
                  value={comment}
                  onChange={(event) => setComment(event.target.value)}
                  rows={3}
                  className="w-full rounded-md border bg-background p-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  placeholder="Add context for the requester (optional)"
                />
              </div>

              <div className="flex justify-end gap-3">
                <Button
                  variant="outline"
                  onClick={handleReject}
                  disabled={processing === 'reject'}
                >
                  {processing === 'reject' && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                  Reject
                </Button>
                <Button
                  onClick={handleApprove}
                  disabled={processing === 'approve'}
                >
                  {processing === 'approve' && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                  Approve &amp; Execute
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
