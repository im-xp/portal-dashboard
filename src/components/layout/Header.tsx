'use client';

import { ReactNode } from 'react';
import { Badge } from '@/components/ui/badge';

interface HeaderProps {
  title: string;
  description?: string;
  eventName?: string;
  actions?: ReactNode;
}

export function Header({ title, description, eventName = 'The Portal at Iceland Eclipse', actions }: HeaderProps) {
  return (
    <div className="border-b border-zinc-200 bg-white px-4 md:px-8 py-4 md:py-6">
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0 flex-1">
          <h1 className="text-xl md:text-2xl font-bold tracking-tight text-zinc-900 truncate">{title}</h1>
          {description && (
            <p className="mt-1 text-xs md:text-sm text-zinc-500 line-clamp-2">{description}</p>
          )}
        </div>
        <div className="flex items-center gap-3 shrink-0">
          {actions}
          <Badge variant="outline" className="hidden sm:inline-flex bg-amber-50 text-amber-700 border-amber-200">
            {eventName}
          </Badge>
        </div>
      </div>
    </div>
  );
}

