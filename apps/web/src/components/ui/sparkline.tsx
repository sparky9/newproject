import { cn } from '@/lib/utils';

interface SparklineProps {
  values: number[];
  width?: number;
  height?: number;
  strokeWidth?: number;
  stroke?: string;
  fill?: string;
  className?: string;
}

export function Sparkline({
  values,
  width = 120,
  height = 40,
  strokeWidth = 2,
  stroke = 'hsl(var(--primary))',
  fill = 'transparent',
  className,
}: SparklineProps) {
  if (!values.length) {
    return (
      <div
        className={cn('h-10 w-full rounded bg-muted', className)}
        aria-hidden="true"
      />
    );
  }

  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const horizontalPadding = strokeWidth;
  const verticalPadding = strokeWidth;

  const points = values
    .map((value, index) => {
      const x =
        values.length === 1
          ? width / 2
          : (index / (values.length - 1)) * (width - horizontalPadding * 2) + horizontalPadding;
      const normalized = (value - min) / range;
      const y = height - normalized * (height - verticalPadding * 2) - verticalPadding;
      return `${x},${Number.isFinite(y) ? y : height / 2}`;
    })
    .join(' ');

  const areaPath = (() => {
    if (values.length < 2) {
      const x = width / 2;
      const y = height / 2;
      return `M ${x} ${height} L ${x} ${y} L ${x} ${height} Z`;
    }

    const pathPoints = values.map((value, index) => {
      const x =
        (index / (values.length - 1)) * (width - horizontalPadding * 2) + horizontalPadding;
      const normalized = (value - min) / range;
      const y = height - normalized * (height - verticalPadding * 2) - verticalPadding;
      return `${Number.isFinite(x) ? x : 0} ${Number.isFinite(y) ? y : height / 2}`;
    });

    return [
      `M ${horizontalPadding} ${height - verticalPadding}`,
      ...pathPoints.map((point) => `L ${point}`),
      `L ${width - horizontalPadding} ${height - verticalPadding}`,
      'Z',
    ].join(' ');
  })();

  return (
    <svg
      className={cn('overflow-visible', className)}
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-hidden="true"
    >
      <path d={areaPath} fill={fill} opacity={fill === 'transparent' ? 0 : 0.15} />
      <polyline
        fill="none"
        stroke={stroke}
        strokeWidth={strokeWidth}
        strokeLinejoin="round"
        strokeLinecap="round"
        points={points}
      />
    </svg>
  );
}
