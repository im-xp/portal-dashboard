'use client';

import { useState, useEffect, useMemo } from 'react';
import { Header } from '@/components/layout/Header';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { FileText, Users, Clock, CheckCircle } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { cn } from '@/lib/utils';
import type { DashboardData, PopupCity } from '@/lib/types';

export default function ApplicationsPage() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [cities, setCities] = useState<PopupCity[]>([]);
  const [selectedCityId, setSelectedCityId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchData() {
      setLoading(true);
      try {
        const [dashboardRes, citiesRes] = await Promise.all([
          fetch('/api/dashboard').then(r => { if (!r.ok) throw new Error(`Dashboard API ${r.status}`); return r.json(); }),
          fetch('/api/popup-cities').then(r => { if (!r.ok) throw new Error(`Popup cities API ${r.status}`); return r.json(); }),
        ]);
        setData(dashboardRes);
        setCities(citiesRes);
      } catch (error) {
        console.error('Failed to fetch data:', error);
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, []);

  const filteredApplications = useMemo(() => {
    if (!data) return [];
    const apps = selectedCityId
      ? data.applications.filter(app => app.popup_city_id === selectedCityId)
      : data.applications;
    return [...apps].sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );
  }, [data, selectedCityId]);

  const filteredMetrics = useMemo(() => {
    if (!data) return null;
    if (!selectedCityId) return data.metrics;

    const apps = data.applications.filter(app => app.popup_city_id === selectedCityId);
    const applicationsByStatus: Record<string, number> = {};
    apps.forEach(app => {
      applicationsByStatus[app.status] = (applicationsByStatus[app.status] || 0) + 1;
    });

    const paidAttendees = apps.reduce((sum, app) => {
      return sum + app.attendeesList.filter(att => att.purchasedProducts.length > 0).length;
    }, 0);

    return {
      ...data.metrics,
      totalApplications: apps.length,
      applicationsByStatus,
      paidAttendees,
    };
  }, [data, selectedCityId]);

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'accepted':
        return 'bg-emerald-50 text-emerald-700 border-emerald-200';
      case 'rejected':
        return 'bg-red-50 text-red-700 border-red-200';
      case 'in review':
        return 'bg-amber-50 text-amber-700 border-amber-200';
      default:
        return '';
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col">
        <Header
          title="Applications"
          description="Track application pipeline and status"
        />
        <div className="p-4 md:p-8">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4 md:gap-4 mb-6">
            {[1, 2, 3, 4].map(i => (
              <div key={i} className="h-24 bg-zinc-100 animate-pulse rounded-lg" />
            ))}
          </div>
          <div className="h-96 bg-zinc-100 animate-pulse rounded-lg" />
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col">
      <Header
        title="Applications"
        description="Track application pipeline and status"
      />

      <div className="p-4 md:p-8">
        {/* City Filter */}
        <div className="flex flex-wrap gap-2 mb-6">
          <button
            onClick={() => setSelectedCityId(null)}
            className={cn(
              'px-3 py-1.5 rounded-full text-sm font-medium transition-colors',
              selectedCityId === null
                ? 'bg-zinc-900 text-white'
                : 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200'
            )}
          >
            All Cities
          </button>
          {cities.map(city => (
            <button
              key={city.id}
              onClick={() => setSelectedCityId(city.id)}
              className={cn(
                'px-3 py-1.5 rounded-full text-sm font-medium transition-colors',
                selectedCityId === city.id
                  ? 'bg-zinc-900 text-white'
                  : 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200'
              )}
            >
              {city.name}
            </button>
          ))}
        </div>

        {/* Status Summary */}
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4 md:gap-4 mb-6 md:mb-8">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-1 md:pb-2">
              <CardTitle className="text-xs md:text-sm font-medium text-zinc-500">Total</CardTitle>
              <FileText className="h-4 w-4 md:h-5 md:w-5 text-zinc-400" />
            </CardHeader>
            <CardContent className="pt-0">
              <div className="text-2xl md:text-3xl font-bold">{filteredMetrics?.totalApplications || 0}</div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-1 md:pb-2">
              <CardTitle className="text-xs md:text-sm font-medium text-zinc-500">Accepted</CardTitle>
              <CheckCircle className="h-4 w-4 md:h-5 md:w-5 text-emerald-500" />
            </CardHeader>
            <CardContent className="pt-0">
              <div className="text-2xl md:text-3xl font-bold text-emerald-600">
                {filteredMetrics?.applicationsByStatus['accepted'] || 0}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-1 md:pb-2">
              <CardTitle className="text-xs md:text-sm font-medium text-zinc-500">In Review</CardTitle>
              <Clock className="h-4 w-4 md:h-5 md:w-5 text-amber-500" />
            </CardHeader>
            <CardContent className="pt-0">
              <div className="text-2xl md:text-3xl font-bold text-amber-600">
                {filteredMetrics?.applicationsByStatus['in review'] || 0}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-1 md:pb-2">
              <CardTitle className="text-xs md:text-sm font-medium text-zinc-500">Purchases</CardTitle>
              <Users className="h-4 w-4 md:h-5 md:w-5 text-zinc-400" />
            </CardHeader>
            <CardContent className="pt-0">
              <div className="text-2xl md:text-3xl font-bold">{filteredMetrics?.paidAttendees || 0}</div>
            </CardContent>
          </Card>
        </div>

        {/* Applications Table */}
        <Card>
          <CardHeader className="pb-3 md:pb-6">
            <CardTitle className="text-base md:text-lg">
              {selectedCityId
                ? `Applications (${cities.find(c => c.id === selectedCityId)?.name})`
                : 'All Applications'}
            </CardTitle>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Applicant</TableHead>
                  <TableHead className="hidden md:table-cell">Email</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Attendees</TableHead>
                  <TableHead className="hidden md:table-cell">Products</TableHead>
                  <TableHead className="hidden md:table-cell">Submitted</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredApplications.map((app) => {
                  const totalProducts = app.attendeesList.reduce(
                    (sum, att) => sum + att.purchasedProducts.length,
                    0
                  );
                  const hasPaid = totalProducts > 0;

                  return (
                    <TableRow key={app.id}>
                      <TableCell className="max-w-[140px] md:max-w-none">
                        <div className="flex items-center gap-2 md:gap-3">
                          <div className="hidden md:flex h-9 w-9 shrink-0 rounded-full bg-gradient-to-br from-zinc-200 to-zinc-300 items-center justify-center text-sm font-medium">
                            {app.first_name[0]}{app.last_name[0]}
                          </div>
                          <div className="min-w-0">
                            <p className="font-medium text-sm md:text-base truncate">{app.first_name} {app.last_name}</p>
                            {app.telegram && (
                              <p className="hidden md:block text-xs text-zinc-500">@{app.telegram}</p>
                            )}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="hidden md:table-cell text-zinc-500">{app.email}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className={`capitalize text-[10px] md:text-xs ${getStatusColor(app.status)}`}>
                          {app.status}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1 text-sm">
                          <Users className="h-3 w-3 md:h-4 md:w-4 text-zinc-400" />
                          <span>{app.attendeesList.length}</span>
                        </div>
                      </TableCell>
                      <TableCell className="hidden md:table-cell">
                        {hasPaid ? (
                          <Badge variant="outline" className="bg-emerald-50 text-emerald-700 border-emerald-200">
                            {totalProducts} item{totalProducts !== 1 ? 's' : ''}
                          </Badge>
                        ) : (
                          <span className="text-zinc-400">—</span>
                        )}
                      </TableCell>
                      <TableCell className="hidden md:table-cell text-zinc-500 text-sm">
                        {app.submitted_at
                          ? formatDistanceToNow(new Date(app.submitted_at), { addSuffix: true })
                          : 'Not submitted'}
                      </TableCell>
                    </TableRow>
                  );
                })}
                {filteredApplications.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center text-zinc-400 py-8">
                      No applications found
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
