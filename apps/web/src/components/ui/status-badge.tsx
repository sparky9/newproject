import { Badge } from '@/components/ui/badge';
import type { ConnectorStatus, TaskStatus } from '@ocsuite/types';

interface StatusBadgeProps {
  status: ConnectorStatus | TaskStatus;
  type: 'connector' | 'task';
}

export function StatusBadge({ status, type }: StatusBadgeProps) {
  const getVariant = () => {
    if (type === 'connector') {
      switch (status as ConnectorStatus) {
        case 'active':
          return 'success';
        case 'error':
          return 'error';
        case 'disconnected':
          return 'outline';
        case 'pending':
          return 'warning';
        default:
          return 'default';
      }
    } else {
      switch (status as TaskStatus) {
        case 'completed':
          return 'success';
        case 'running':
          return 'warning';
        case 'failed':
          return 'error';
        case 'pending':
          return 'outline';
        default:
          return 'default';
      }
    }
  };

  return (
    <Badge variant={getVariant()}>
      {status.charAt(0).toUpperCase() + status.slice(1)}
    </Badge>
  );
}
