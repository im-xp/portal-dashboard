'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useState } from 'react';
import { cn } from '@/lib/utils';
import { 
  LayoutDashboard, 
  Users, 
  Package, 
  FileText,
  RefreshCw 
} from 'lucide-react';
import { Button } from '@/components/ui/button';

const navigation = [
  { name: 'Overview', href: '/', icon: LayoutDashboard },
  { name: 'People', href: '/people', icon: Users },
  { name: 'Products', href: '/products', icon: Package },
  { name: 'Applications', href: '/applications', icon: FileText },
];

export function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const [isRefreshing, setIsRefreshing] = useState(false);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      await fetch('/api/refresh', { method: 'POST' });
      router.refresh();
    } catch (error) {
      console.error('Failed to refresh:', error);
    } finally {
      setIsRefreshing(false);
    }
  };

  return (
    <div className="hidden md:flex fixed top-0 left-0 h-screen w-64 flex-col bg-zinc-950 text-zinc-100">
      {/* Logo */}
      <div className="flex h-16 items-center gap-2 border-b border-zinc-800 px-6">
        <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-amber-400 to-orange-500" />
        <span className="font-semibold tracking-tight">The Portal Dashboard</span>
      </div>

      {/* Navigation */}
      <nav className="flex-1 space-y-1 px-3 py-4">
        {navigation.map((item) => {
          const isActive = pathname === item.href;
          return (
            <Link
              key={item.name}
              href={item.href}
              className={cn(
                'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                isActive
                  ? 'bg-zinc-800 text-white'
                  : 'text-zinc-400 hover:bg-zinc-800/50 hover:text-zinc-100'
              )}
            >
              <item.icon className="h-5 w-5" />
              {item.name}
            </Link>
          );
        })}
      </nav>

      {/* Footer */}
      <div className="border-t border-zinc-800 p-4">
        <Button
          variant="ghost"
          size="sm"
          className="w-full justify-start text-zinc-400 hover:text-zinc-100"
          onClick={handleRefresh}
          disabled={isRefreshing}
        >
          <RefreshCw className={cn("mr-2 h-4 w-4", isRefreshing && "animate-spin")} />
          {isRefreshing ? 'Refreshing...' : 'Refresh Data'}
        </Button>
        <p className="mt-2 text-xs text-zinc-600">
          Cached for 60s • Click to force refresh
        </p>
      </div>
    </div>
  );
}

