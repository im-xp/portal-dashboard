'use client';

import { Badge } from '@/components/ui/badge';

interface HeaderProps {
  title: string;
  description?: string;
  eventName?: string;
}

export function Header({ title, description, eventName = 'The Portal at Iceland Eclipse' }: HeaderProps) {
  return (
    <div className="border-b border-zinc-200 bg-white px-8 py-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-zinc-900">{title}</h1>
          {description && (
            <p className="mt-1 text-sm text-zinc-500">{description}</p>
          )}
        </div>
        <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-200">
          {eventName}
        </Badge>
      </div>
    </div>
  );
}

