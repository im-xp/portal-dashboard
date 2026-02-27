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
  Mail,
  RefreshCw,
  Menu,
  X,
  HandHeart,
  type LucideIcon,
} from 'lucide-react';
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
  { name: 'Email', href: '/email-queue', icon: Mail, roles: ['admin'] },
];

export function MobileNav() {
  const pathname = usePathname();
  const router = useRouter();
  const { data: session, status } = useSession();
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

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
    <>
      {/* Top header bar - mobile only */}
      <div className="md:hidden fixed top-0 left-0 right-0 z-50 flex h-14 items-center justify-between bg-zinc-950 px-4">
        <div className="flex items-center gap-2">
          <div className="h-7 w-7 rounded-lg bg-gradient-to-br from-amber-400 to-orange-500" />
          <span className="font-semibold text-sm text-zinc-100 tracking-tight">The Portal</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleRefresh}
            disabled={isRefreshing}
            className="p-2 text-zinc-400 hover:text-zinc-100 transition-colors"
          >
            <RefreshCw className={cn("h-5 w-5", isRefreshing && "animate-spin")} />
          </button>
          <button
            onClick={() => setMenuOpen(!menuOpen)}
            className="p-2 text-zinc-400 hover:text-zinc-100 transition-colors"
          >
            {menuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>
      </div>

      {/* Slide-down menu */}
      {menuOpen && (
        <div className="md:hidden fixed top-14 left-0 right-0 z-40 bg-zinc-950 border-b border-zinc-800 py-2">
          {visibleNav.map((item) => {
            const isActive = pathname === item.href;
            return (
              <Link
                key={item.name}
                href={item.href}
                onClick={() => setMenuOpen(false)}
                className={cn(
                  'flex items-center gap-3 px-4 py-3 text-sm font-medium transition-colors',
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
          <div className="border-t border-zinc-800 mt-2 pt-2">
            <UserMenu variant="mobile" />
          </div>
        </div>
      )}

      {/* Bottom navigation bar */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-50 flex h-16 items-center justify-around bg-zinc-950 border-t border-zinc-800 px-2 pb-safe">
        {visibleNav.map((item) => {
          const isActive = pathname === item.href;
          return (
            <Link
              key={item.name}
              href={item.href}
              className={cn(
                'flex flex-col items-center justify-center gap-1 px-3 py-2 rounded-lg transition-colors min-w-[64px]',
                isActive
                  ? 'text-amber-400'
                  : 'text-zinc-500 hover:text-zinc-300'
              )}
            >
              <item.icon className="h-5 w-5" />
              <span className="text-[10px] font-medium">{item.name}</span>
            </Link>
          );
        })}
      </nav>

      {/* Overlay when menu is open */}
      {menuOpen && (
        <div
          className="md:hidden fixed inset-0 z-30 bg-black/50"
          onClick={() => setMenuOpen(false)}
        />
      )}
    </>
  );
}
