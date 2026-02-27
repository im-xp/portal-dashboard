'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { useState } from 'react';
import { cn } from '@/lib/utils';
import {
  LayoutDashboard,
  Users,
  Package,
  FileText,
  RefreshCw,
  Mail,
  HandHeart,
  type LucideIcon,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { UserMenu } from './UserMenu';
import type { UserRole } from '@/lib/auth';

interface NavItem {
  name: string;
  href: string;
  icon: LucideIcon;
  roles?: UserRole[];
}

const navigation: NavItem[] = [
  { name: 'Overview', href: '/', icon: LayoutDashboard, roles: ['admin'] },
  { name: 'People', href: '/people', icon: Users, roles: ['admin'] },
  { name: 'Products', href: '/products', icon: Package, roles: ['admin'] },
  { name: 'Applications', href: '/applications', icon: FileText, roles: ['admin'] },
  { name: 'Volunteers', href: '/volunteers', icon: HandHeart },
  { name: 'Email Queue', href: '/email-queue', icon: Mail, roles: ['admin'] },
];

export function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const { data: session, status } = useSession();
  const [isRefreshing, setIsRefreshing] = useState(false);

  if (status !== 'authenticated' || pathname?.startsWith('/auth')) {
    return null;
  }

  const role = session?.user?.role || 'admin';
  const visibleNav = navigation.filter(item => !item.roles || item.roles.includes(role));

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
        {visibleNav.map((item) => {
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
      <div className="border-t border-zinc-800 py-4">
        <UserMenu variant="sidebar" />
        <div className="px-4 mt-4">
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
    </div>
  );
}
