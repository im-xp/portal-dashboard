'use client';

import { useState, useMemo } from 'react';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Search, Package, X, CheckCircle2, ShoppingCart, AlertCircle, Clock, CalendarClock } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ApplicationWithDetails, AttendeeWithProducts, JourneyStage } from '@/lib/types';
import { JourneyPipeline } from './JourneyPipeline';

interface PeopleTableProps {
  applications: ApplicationWithDetails[];
  attendees: AttendeeWithProducts[];
  journeyCounts: Record<JourneyStage, number>;
}

const journeyConfig: Record<JourneyStage, {
  label: string;
  icon: typeof CheckCircle2;
  className: string;
}> = {
  accepted: {
    label: 'Accepted',
    icon: Clock,
    className: 'bg-zinc-100 text-zinc-700 border-zinc-300',
  },
  in_cart: {
    label: 'In Cart',
    icon: ShoppingCart,
    className: 'bg-amber-50 text-amber-700 border-amber-300',
  },
  partial: {
    label: 'Partial',
    icon: AlertCircle,
    className: 'bg-orange-50 text-orange-700 border-orange-300',
  },
  confirmed: {
    label: 'Confirmed',
    icon: CheckCircle2,
    className: 'bg-emerald-50 text-emerald-700 border-emerald-300',
  },
};

export function PeopleTable({ applications, attendees, journeyCounts }: PeopleTableProps) {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [journeyFilter, setJourneyFilter] = useState<JourneyStage | 'all'>('all');
  const [selectedPerson, setSelectedPerson] = useState<AttendeeWithProducts | null>(null);

  // Get application status for each attendee
  const attendeesWithStatus = useMemo(() => {
    const appMap = new Map(applications.map(a => [a.id, a]));
    return attendees.map(att => ({
      ...att,
      application: appMap.get(att.application_id),
    }));
  }, [applications, attendees]);

  // Filter attendees
  const filteredAttendees = useMemo(() => {
    return attendeesWithStatus.filter(att => {
      // Search filter
      const searchLower = search.toLowerCase();
      const matchesSearch = !search || 
        att.name.toLowerCase().includes(searchLower) ||
        att.email.toLowerCase().includes(searchLower);

      // Application status filter
      const matchesStatus = statusFilter === 'all' || 
        att.application?.status === statusFilter;

      // Journey stage filter
      const matchesJourney = journeyFilter === 'all' ||
        att.journeyStage === journeyFilter;

      return matchesSearch && matchesStatus && matchesJourney;
    });
  }, [attendeesWithStatus, search, statusFilter, journeyFilter]);

  return (
    <div className="flex flex-col">
      {/* Journey Pipeline */}
      <JourneyPipeline 
        counts={journeyCounts}
        selectedStage={journeyFilter}
        onSelectStage={setJourneyFilter}
      />

      <div className="flex gap-6 flex-1 min-h-0">
        {/* Main Table */}
        <div className="flex-1 flex flex-col min-w-0">
          {/* Filters - stack on mobile */}
          <div className="flex flex-col sm:flex-row gap-2 sm:gap-4 mb-4">
            <div className="relative flex-1 sm:max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-400" />
              <Input
                placeholder="Search by name or email..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-10"
              />
            </div>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-full sm:w-40">
                <SelectValue placeholder="App Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Statuses</SelectItem>
                <SelectItem value="accepted">Accepted</SelectItem>
                <SelectItem value="in review">In Review</SelectItem>
                <SelectItem value="rejected">Rejected</SelectItem>
                <SelectItem value="draft">Draft</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Count */}
          <p className="text-sm text-zinc-500 mb-2">
            Showing {filteredAttendees.length} of {attendees.length} people
          </p>

          {/* Table - horizontal scroll on mobile */}
          <Card className="overflow-hidden">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader className="sticky top-0 bg-white">
                  <TableRow className="text-xs md:text-sm">
                    <TableHead>Name</TableHead>
                    <TableHead className="hidden md:table-cell">Email</TableHead>
                    <TableHead>Journey</TableHead>
                    <TableHead>Pass</TableHead>
                    <TableHead>Lodging</TableHead>
                    <TableHead className="hidden md:table-cell">Check-in Code</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredAttendees.map((person) => {
                    const config = journeyConfig[person.journeyStage];
                    const Icon = config.icon;
                    
                    return (
                      <TableRow 
                        key={person.id}
                        className="cursor-pointer hover:bg-zinc-50"
                        onClick={() => setSelectedPerson(person)}
                      >
                        <TableCell className="font-medium text-sm md:text-base max-w-[100px] md:max-w-none truncate">{person.name}</TableCell>
                        <TableCell className="hidden md:table-cell text-zinc-500">{person.email}</TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1">
                            <Badge variant="outline" className={cn('gap-1 text-[10px] md:text-xs', config.className)}>
                              <Icon className="h-3 w-3" />
                              <span className="hidden md:inline">{config.label}</span>
                            </Badge>
                            {person.installmentPlan && (
                              <Badge variant="outline" className="text-[10px] bg-amber-50 text-amber-600 border-amber-200 hidden md:inline-flex">
                                {person.installmentPlan.installmentsPaid}/{person.installmentPlan.installmentsTotal ?? '?'}
                              </Badge>
                            )}
                          </div>
                        </TableCell>
                        <TableCell>
                          {person.hasPass ? (
                            <CheckCircle2 className="h-4 w-4 md:h-5 md:w-5 text-emerald-500" />
                          ) : person.inCartProducts.some(p => p.category === 'month') ? (
                            <ShoppingCart className="h-4 w-4 md:h-5 md:w-5 text-amber-500" />
                          ) : (
                            <span className="text-zinc-300">—</span>
                          )}
                        </TableCell>
                        <TableCell>
                          {person.hasLodging ? (
                            <CheckCircle2 className="h-4 w-4 md:h-5 md:w-5 text-emerald-500" />
                          ) : person.inCartProducts.some(p => p.category === 'lodging') ? (
                            <ShoppingCart className="h-4 w-4 md:h-5 md:w-5 text-amber-500" />
                          ) : (
                            <span className="text-zinc-300">—</span>
                          )}
                        </TableCell>
                        <TableCell className="hidden md:table-cell">
                          <code className="text-xs bg-zinc-100 px-2 py-1 rounded">
                            {person.check_in_code || '—'}
                          </code>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                  {filteredAttendees.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center py-8 text-zinc-500">
                        No people found matching your filters
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </Card>
        </div>

        {/* Detail Panel - hidden on mobile */}
        {selectedPerson && (
          <Card className="hidden lg:block w-80 flex-shrink-0 overflow-auto">
            <CardHeader className="flex flex-row items-start justify-between">
              <div>
                <CardTitle className="text-lg">{selectedPerson.name}</CardTitle>
                <p className="text-sm text-zinc-500 mt-1">{selectedPerson.email}</p>
              </div>
              <button 
                onClick={() => setSelectedPerson(null)}
                className="text-zinc-400 hover:text-zinc-600"
              >
                <X className="h-5 w-5" />
              </button>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Journey Status */}
              <div>
                <p className="text-xs text-zinc-500 uppercase tracking-wide mb-2">Journey Status</p>
                <Badge variant="outline" className={cn('gap-1 text-sm', journeyConfig[selectedPerson.journeyStage].className)}>
                  {(() => {
                    const Icon = journeyConfig[selectedPerson.journeyStage].icon;
                    return <Icon className="h-4 w-4" />;
                  })()}
                  {journeyConfig[selectedPerson.journeyStage].label}
                </Badge>
                
                {/* What they need */}
                {selectedPerson.journeyStage !== 'confirmed' && (
                  <div className="mt-3 p-3 bg-zinc-50 rounded-lg">
                    <p className="text-xs font-medium text-zinc-600 mb-1">Needs to complete:</p>
                    <ul className="text-sm text-zinc-500 space-y-1">
                      {!selectedPerson.hasPass && (
                        <li className="flex items-center gap-2">
                          <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                          Purchase event pass
                        </li>
                      )}
                      {!selectedPerson.hasLodging && (
                        <li className="flex items-center gap-2">
                          <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                          Book lodging
                        </li>
                      )}
                    </ul>
                  </div>
                )}
              </div>

              <div>
                <p className="text-xs text-zinc-500 uppercase tracking-wide mb-1">Category</p>
                <Badge variant="outline" className="capitalize">{selectedPerson.category}</Badge>
              </div>
              
              <div>
                <p className="text-xs text-zinc-500 uppercase tracking-wide mb-1">Check-in Code</p>
                <code className="text-sm bg-zinc-100 px-2 py-1 rounded block">
                  {selectedPerson.check_in_code || 'Not assigned'}
                </code>
              </div>

              {/* Installment Plan */}
              {selectedPerson.installmentPlan && (
                <div>
                  <p className="text-xs text-zinc-500 uppercase tracking-wide mb-2">Payment Plan</p>
                  <div className="p-3 bg-amber-50 rounded-lg border border-amber-200">
                    <div className="flex items-center gap-2 mb-2">
                      <CalendarClock className="h-4 w-4 text-amber-600" />
                      <span className="text-sm font-medium text-amber-800">
                        Installment Plan
                      </span>
                    </div>
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-amber-700">Progress</span>
                      <span className="font-medium text-amber-800">
                        {selectedPerson.installmentPlan.installmentsPaid} / {selectedPerson.installmentPlan.installmentsTotal ?? '?'} paid
                      </span>
                    </div>
                    {selectedPerson.installmentPlan.installmentsTotal && (
                      <div className="mt-2 h-2 rounded-full bg-amber-100">
                        <div
                          className="h-2 rounded-full bg-amber-500 transition-all"
                          style={{
                            width: `${Math.round((selectedPerson.installmentPlan.installmentsPaid / selectedPerson.installmentPlan.installmentsTotal) * 100)}%`,
                          }}
                        />
                      </div>
                    )}
                    <div className="flex items-center justify-between text-sm mt-2">
                      <span className="text-amber-700">Total</span>
                      <span className="font-medium text-amber-800">
                        ${selectedPerson.installmentPlan.totalAmount.toLocaleString()}
                      </span>
                    </div>
                  </div>
                </div>
              )}

              {/* Sold Products */}
              <div>
                <p className="text-xs text-zinc-500 uppercase tracking-wide mb-2">
                  Purchased <span className="text-emerald-600">({selectedPerson.soldProducts.length})</span>
                </p>
                {selectedPerson.soldProducts.length > 0 ? (
                  <div className="space-y-2">
                    {selectedPerson.soldProducts.map((product, idx) => (
                      <div key={`sold-${product.id}-${idx}`} className="flex items-center justify-between text-sm">
                        <div className="flex items-center gap-2">
                          <Package className="h-4 w-4 text-emerald-500" />
                          <span>{product.name}</span>
                        </div>
                        <span className="text-emerald-600 font-medium">
                          ${product.price.toLocaleString()}
                        </span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-zinc-400">None</p>
                )}
              </div>

              {/* In Cart Products */}
              <div>
                <p className="text-xs text-zinc-500 uppercase tracking-wide mb-2">
                  In Cart <span className="text-amber-600">({selectedPerson.inCartProducts.length})</span>
                </p>
                {selectedPerson.inCartProducts.length > 0 ? (
                  <div className="space-y-2">
                    {selectedPerson.inCartProducts.map((product, idx) => (
                      <div key={`cart-${product.id}-${idx}`} className="flex items-center justify-between text-sm">
                        <div className="flex items-center gap-2">
                          <Package className="h-4 w-4 text-amber-500" />
                          <span>{product.name}</span>
                        </div>
                        <span className="text-amber-600 font-medium">
                          ${product.price.toLocaleString()}
                        </span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-zinc-400">None</p>
                )}
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
