'use client';

import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import type { FilterState, PopupCity } from '@/lib/types';

interface DashboardFilterContextValue {
  filters: FilterState;
  setFilters: (filters: FilterState) => void;
  toggleEdgeos: (enabled: boolean) => void;
  toggleCity: (cityId: number, enabled: boolean) => void;
  toggleFever: (enabled: boolean) => void;
  popupCities: PopupCity[];
  isLoading: boolean;
  getEnabledCityIds: () => number[];
}

const DashboardFilterContext = createContext<DashboardFilterContextValue | null>(null);

const STORAGE_KEY = 'dashboard-filters';

function getDefaultFilters(cities: PopupCity[]): FilterState {
  const cityStates: Record<number, boolean> = {};
  for (const city of cities) {
    cityStates[city.id] = true;
  }
  return {
    edgeos: { enabled: true, cities: cityStates },
    fever: { enabled: true },
  };
}

export function DashboardFilterProvider({ children }: { children: ReactNode }) {
  const [popupCities, setPopupCities] = useState<PopupCity[]>([]);
  const [filters, setFiltersState] = useState<FilterState>({
    edgeos: { enabled: true, cities: {} },
    fever: { enabled: true },
  });
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    async function init() {
      try {
        const res = await fetch('/api/popup-cities');
        const cities: PopupCity[] = await res.json();
        setPopupCities(cities);

        const stored = localStorage.getItem(STORAGE_KEY);
        if (stored) {
          try {
            const parsed = JSON.parse(stored) as FilterState;
            for (const city of cities) {
              if (parsed.edgeos.cities[city.id] === undefined) {
                parsed.edgeos.cities[city.id] = true;
              }
            }
            setFiltersState(parsed);
          } catch {
            setFiltersState(getDefaultFilters(cities));
          }
        } else {
          setFiltersState(getDefaultFilters(cities));
        }
      } catch (error) {
        console.error('Failed to load popup cities:', error);
      } finally {
        setIsLoading(false);
      }
    }
    init();
  }, []);

  const setFilters = (newFilters: FilterState) => {
    setFiltersState(newFilters);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(newFilters));
  };

  const toggleEdgeos = (enabled: boolean) => {
    setFilters({
      ...filters,
      edgeos: { ...filters.edgeos, enabled },
    });
  };

  const toggleCity = (cityId: number, enabled: boolean) => {
    setFilters({
      ...filters,
      edgeos: {
        ...filters.edgeos,
        cities: { ...filters.edgeos.cities, [cityId]: enabled },
      },
    });
  };

  const toggleFever = (enabled: boolean) => {
    setFilters({
      ...filters,
      fever: { ...filters.fever, enabled },
    });
  };

  const getEnabledCityIds = (): number[] => {
    if (!filters.edgeos.enabled) return [];
    return Object.entries(filters.edgeos.cities)
      .filter(([, enabled]) => enabled)
      .map(([id]) => parseInt(id, 10));
  };

  return (
    <DashboardFilterContext.Provider
      value={{
        filters,
        setFilters,
        toggleEdgeos,
        toggleCity,
        toggleFever,
        popupCities,
        isLoading,
        getEnabledCityIds,
      }}
    >
      {children}
    </DashboardFilterContext.Provider>
  );
}

export function useFilters() {
  const context = useContext(DashboardFilterContext);
  if (!context) {
    throw new Error('useFilters must be used within a DashboardFilterProvider');
  }
  return context;
}
