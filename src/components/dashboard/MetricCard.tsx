import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';

interface MetricCardProps {
  title: string;
  value: string | number;
  subtitle?: string;
  icon?: React.ReactNode;
  trend?: {
    value: number;
    label: string;
  };
  className?: string;
}

export function MetricCard({ title, value, subtitle, icon, trend, className }: MetricCardProps) {
  return (
    <Card className={cn('relative overflow-hidden', className)}>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-1 md:pb-2">
        <CardTitle className="text-xs md:text-sm font-medium text-zinc-500 truncate pr-2">{title}</CardTitle>
        {icon && <div className="text-zinc-400 shrink-0 [&>svg]:h-4 [&>svg]:w-4 md:[&>svg]:h-5 md:[&>svg]:w-5">{icon}</div>}
      </CardHeader>
      <CardContent className="pt-0">
        <div className="text-xl md:text-3xl font-bold tracking-tight truncate">{value}</div>
        {subtitle && (
          <p className="mt-1 text-xs md:text-sm text-zinc-500 line-clamp-2">{subtitle}</p>
        )}
        {trend && (
          <p className={cn(
            'mt-1 text-xs',
            trend.value >= 0 ? 'text-emerald-600' : 'text-red-600'
          )}>
            {trend.value >= 0 ? '↑' : '↓'} {Math.abs(trend.value)}% {trend.label}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

