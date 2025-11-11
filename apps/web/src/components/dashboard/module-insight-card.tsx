import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import type { ModuleInsight } from '@ocsuite/types';
import { AlertCircle, CheckCircle2, Info, TrendingUp } from 'lucide-react';
import { cn } from '@/lib/utils';

interface ModuleInsightCardProps {
  insight: ModuleInsight;
  className?: string;
  onViewDetails?: () => void;
}

export function ModuleInsightCard({
  insight,
  className,
  onViewDetails,
}: ModuleInsightCardProps) {
  const severityConfig = {
    info: {
      icon: Info,
      variant: 'default' as const,
      bgColor: 'bg-blue-50 dark:bg-blue-950/20',
      borderColor: 'border-blue-200 dark:border-blue-800',
    },
    warning: {
      icon: AlertCircle,
      variant: 'warning' as const,
      bgColor: 'bg-yellow-50 dark:bg-yellow-950/20',
      borderColor: 'border-yellow-200 dark:border-yellow-800',
    },
    critical: {
      icon: AlertCircle,
      variant: 'destructive' as const,
      bgColor: 'bg-red-50 dark:bg-red-950/20',
      borderColor: 'border-red-200 dark:border-red-800',
    },
  };

  const config = severityConfig[insight.severity];
  const SeverityIcon = config.icon;

  return (
    <Card className={cn('overflow-hidden', className)}>
      <CardHeader className={cn('pb-3', config.bgColor, config.borderColor, 'border-b')}>
        <div className="flex items-start justify-between">
          <div className="flex items-start gap-3 flex-1">
            <SeverityIcon className="h-5 w-5 mt-0.5 flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <CardTitle className="text-base capitalize">
                  {insight.moduleSlug.replace(/-/g, ' ')}
                </CardTitle>
                <Badge variant={config.variant} className="text-xs">
                  {insight.severity}
                </Badge>
              </div>
              <p className="text-sm text-muted-foreground">
                {new Date(insight.createdAt).toLocaleDateString()}
              </p>
            </div>
          </div>
          {insight.score !== null && (
            <div className="flex items-center gap-1 ml-2 flex-shrink-0">
              <TrendingUp className="h-4 w-4 text-muted-foreground" />
              <span className="text-lg font-bold">{insight.score}</span>
              <span className="text-xs text-muted-foreground">/100</span>
            </div>
          )}
        </div>
      </CardHeader>

      <CardContent className="pt-4 space-y-4">
        {/* Summary */}
        <div>
          <p className="text-sm">{insight.summary}</p>
        </div>

        {/* Highlights */}
        {insight.highlights && insight.highlights.length > 0 && (
          <div>
            <h4 className="text-xs font-semibold text-muted-foreground mb-2 uppercase">
              Key Highlights
            </h4>
            <ul className="space-y-1.5">
              {insight.highlights.slice(0, 3).map((highlight, idx) => (
                <li key={idx} className="text-sm flex items-start gap-2">
                  <CheckCircle2 className="h-3.5 w-3.5 mt-0.5 text-green-600 flex-shrink-0" />
                  <span className="flex-1">{highlight}</span>
                </li>
              ))}
            </ul>
            {insight.highlights.length > 3 && (
              <p className="text-xs text-muted-foreground mt-2">
                +{insight.highlights.length - 3} more highlights
              </p>
            )}
          </div>
        )}

        {/* Action Items */}
        {insight.actionItems && insight.actionItems.length > 0 && (
          <div>
            <h4 className="text-xs font-semibold text-muted-foreground mb-2 uppercase">
              Recommended Actions
            </h4>
            <div className="space-y-2">
              {insight.actionItems.slice(0, 2).map((action, idx) => (
                <div
                  key={idx}
                  className="flex items-start gap-2 p-2 bg-muted rounded text-sm"
                >
                  <Badge
                    variant={
                      action.priority === 'high'
                        ? 'destructive'
                        : action.priority === 'medium'
                        ? 'default'
                        : 'secondary'
                    }
                    className="text-xs mt-0.5"
                  >
                    {action.priority}
                  </Badge>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium">{action.title}</p>
                    {action.description && (
                      <p className="text-xs text-muted-foreground mt-1">
                        {action.description}
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </div>
            {insight.actionItems.length > 2 && (
              <p className="text-xs text-muted-foreground mt-2">
                +{insight.actionItems.length - 2} more actions
              </p>
            )}
          </div>
        )}

        {/* View Details Button */}
        {onViewDetails && (
          <div className="pt-2">
            <Button
              variant="outline"
              size="sm"
              onClick={onViewDetails}
              className="w-full"
            >
              View Full Details
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
