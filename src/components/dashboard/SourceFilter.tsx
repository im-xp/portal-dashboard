'use client';

import { useState } from 'react';
import { useFilters } from '@/contexts/DashboardFilterContext';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ChevronDown, Check, Database, Ticket } from 'lucide-react';
import { cn } from '@/lib/utils';

export function SourceFilter() {
  const { filters, toggleEdgeos, toggleCity, toggleFever, popupCities, isLoading } = useFilters();
  const [edgeosOpen, setEdgeosOpen] = useState(false);

  if (isLoading) {
    return (
      <div className="flex gap-2">
        <div className="h-9 w-24 bg-zinc-100 animate-pulse rounded-md" />
        <div className="h-9 w-20 bg-zinc-100 animate-pulse rounded-md" />
      </div>
    );
  }

  const enabledCityCount = Object.values(filters.edgeos.cities).filter(Boolean).length;
  const totalCities = popupCities.length;

  return (
    <div className="flex gap-2 items-center">
      <div className="relative">
        <Button
          variant={filters.edgeos.enabled ? 'default' : 'outline'}
          size="sm"
          onClick={() => setEdgeosOpen(!edgeosOpen)}
          className="gap-1"
        >
          <Database className="h-3.5 w-3.5" />
          EdgeOS
          {filters.edgeos.enabled && totalCities > 0 && (
            <Badge variant="secondary" className="ml-1 px-1.5 py-0 text-xs">
              {enabledCityCount}/{totalCities}
            </Badge>
          )}
          <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', edgeosOpen && 'rotate-180')} />
        </Button>

        {edgeosOpen && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setEdgeosOpen(false)} />
            <div className="absolute top-full mt-1 left-0 z-50 bg-white border rounded-md shadow-lg min-w-[180px] py-1">
              <button
                className="w-full px-3 py-2 text-left text-sm hover:bg-zinc-50 flex items-center justify-between"
                onClick={() => {
                  toggleEdgeos(!filters.edgeos.enabled);
                }}
              >
                <span className="font-medium">All EdgeOS Data</span>
                {filters.edgeos.enabled && <Check className="h-4 w-4 text-emerald-600" />}
              </button>
              {popupCities.length > 0 && (
                <>
                  <div className="border-t my-1" />
                  <div className="px-3 py-1 text-xs text-zinc-500 uppercase tracking-wide">
                    Popup Cities
                  </div>
                  {popupCities.map((city) => (
                    <button
                      key={city.id}
                      className={cn(
                        'w-full px-3 py-2 text-left text-sm hover:bg-zinc-50 flex items-center justify-between',
                        !filters.edgeos.enabled && 'opacity-50'
                      )}
                      onClick={() => {
                        if (filters.edgeos.enabled) {
                          toggleCity(city.id, !filters.edgeos.cities[city.id]);
                        }
                      }}
                      disabled={!filters.edgeos.enabled}
                    >
                      <span>{city.name}</span>
                      {filters.edgeos.cities[city.id] && filters.edgeos.enabled && (
                        <Check className="h-4 w-4 text-emerald-600" />
                      )}
                    </button>
                  ))}
                </>
              )}
            </div>
          </>
        )}
      </div>

      <Button
        variant={filters.fever.enabled ? 'default' : 'outline'}
        size="sm"
        onClick={() => toggleFever(!filters.fever.enabled)}
        className="gap-1"
      >
        <Ticket className="h-3.5 w-3.5" />
        Fever
      </Button>
    </div>
  );
}
