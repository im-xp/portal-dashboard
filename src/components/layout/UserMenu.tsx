'use client';

import { useSession, signOut } from 'next-auth/react';
import { LogOut } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface UserMenuProps {
  variant?: 'sidebar' | 'mobile';
}

export function UserMenu({ variant = 'sidebar' }: UserMenuProps) {
  const { data: session } = useSession();

  if (!session?.user) {
    return null;
  }

  const isMobile = variant === 'mobile';

  return (
    <div className={cn(
      'flex items-center gap-3',
      isMobile ? 'px-4 py-2' : 'px-4'
    )}>
      {session.user.image ? (
        <img
          src={session.user.image}
          alt=""
          className="h-8 w-8 rounded-full"
        />
      ) : (
        <div className="h-8 w-8 rounded-full bg-zinc-700 flex items-center justify-center">
          <span className="text-sm font-medium text-zinc-300">
            {session.user.email?.[0].toUpperCase()}
          </span>
        </div>
      )}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-zinc-100 truncate">
          {session.user.name || session.user.email?.split('@')[0]}
        </p>
        <p className="text-xs text-zinc-500 truncate">
          {session.user.email}
        </p>
      </div>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => signOut({ callbackUrl: '/auth/signin' })}
        className="text-zinc-400 hover:text-zinc-100 p-2"
      >
        <LogOut className="h-4 w-4" />
      </Button>
    </div>
  );
}
