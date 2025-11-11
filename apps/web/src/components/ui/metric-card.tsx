import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

interface MetricCardProps {
  title: string;
  value: string | number;
  change?: number;
  icon?: LucideIcon;
  iconColor?: string;
  className?: string;
}

export function MetricCard({
  title,
  value,
  change,
  icon: Icon,
  iconColor = 'text-blue-600',
  className,
}: MetricCardProps) {
  const changeColor = change
    ? change > 0
      ? 'text-green-600'
      : 'text-red-600'
    : '';

  return (
    <Card className={cn('hover:shadow-lg transition-shadow', className)}>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
        {Icon && <Icon className={cn('h-4 w-4', iconColor)} />}
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold">{value}</div>
        {change !== undefined && (
          <p className={cn('text-xs', changeColor)}>
            {change > 0 ? '+' : ''}
            {change}% from last month
          </p>
        )}
      </CardContent>
    </Card>
  );
}
