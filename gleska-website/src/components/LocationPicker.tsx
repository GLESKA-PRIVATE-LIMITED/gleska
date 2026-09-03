"use client";

import { useState } from "react";
import { CircleX, Loader2, MapPin, Search } from "lucide-react";
import apiClient from "@/lib/api";

export type LocationSelection = {
  address: string;
  locality?: string | null;
  city?: string | null;
  state?: string | null;
  pincode?: string | null;
  latitude: number;
  longitude: number;
  accuracy_m?: number;
  location_source: "SEARCH" | "MAP" | "PROFILE" | "GPS";
};

type LocationPickerProps = {
  value?: string;
  onSelect: (location: LocationSelection) => void;
  onQueryChange?: (query: string) => void;
  label?: string;
  placeholder?: string;
  onUseCurrentLocation?: () => Promise<LocationSelection>;
  error?: string;
};

export default function LocationPicker({ value = "", onSelect, onQueryChange, label, placeholder = "Search your area, city or pincode", onUseCurrentLocation, error }: LocationPickerProps) {
  const [query, setQuery] = useState(value);
  const [results, setResults] = useState<LocationSelection[]>([]);
  const [searching, setSearching] = useState(false);
  const [usingCurrent, setUsingCurrent] = useState(false);
  const [message, setMessage] = useState("");
  const [searchError, setSearchError] = useState(false);

  const search = async () => {
    if (query.trim().length < 2) {
      setResults([]);
      setMessage("Enter at least 2 characters to search.");
      setSearchError(false);
      return;
    }
    setSearching(true);
    setMessage("");
    setSearchError(false);
    try {
      const response = await apiClient.get("/api/v1/locations/search", { params: { q: query.trim() } });
      setResults((response.data.locations || []).map((location: LocationSelection) => ({ ...location, latitude: Number(location.latitude), longitude: Number(location.longitude), location_source: "SEARCH" })));
      if (!response.data.locations?.length) setMessage("No matching locations found. Try a nearby area, locality, city, or pincode.");
    } catch {
      setResults([]);
      setSearchError(true);
      setMessage("Couldn't search for that location. Please try again.");
    } finally {
      setSearching(false);
    }
  };

  const clearSearch = () => {
    setQuery("");
    setResults([]);
    setMessage("");
    setSearchError(false);
    onQueryChange?.("");
  };

  const handleUseCurrentLocation = async () => {
    if (!onUseCurrentLocation) return;
    setUsingCurrent(true);
    setMessage("");
    try {
      const location = await onUseCurrentLocation();
      void location;
    } catch {
      setMessage("Couldn't determine your current location. You can search for your location instead.");
    } finally {
      setUsingCurrent(false);
    }
  };

  return (
    <div className="space-y-3">
      {label && <label className="block text-xs font-bold uppercase tracking-wide text-slate-600 dark:text-slate-300">{label}</label>}
      <div className="flex gap-2">
        <div className="relative min-w-0 flex-1">
          <Search size={16} className="pointer-events-none absolute left-3 top-3.5 text-slate-400" />
          <input value={query} onChange={(event) => { setQuery(event.target.value); onQueryChange?.(event.target.value); setMessage(""); }} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void search(); } }} placeholder={placeholder} className="w-full rounded-xl border border-slate-300 py-3 pl-9 pr-10 text-sm outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 dark:border-slate-700 dark:bg-slate-800" />
          {query && <button type="button" onClick={clearSearch} title="Clear location search" aria-label="Clear location search" className="absolute right-2 top-2.5 rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-700 dark:hover:text-slate-200"><CircleX size={18} /></button>}
        </div>
        <button type="button" onClick={() => void search()} disabled={searching} className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-60">
          {searching ? <Loader2 size={16} className="animate-spin" /> : <Search size={16} />} Search
        </button>
      </div>
      {onUseCurrentLocation && (
        <button type="button" onClick={() => void handleUseCurrentLocation()} disabled={usingCurrent} className="inline-flex items-center gap-2 text-sm font-semibold text-blue-700 dark:text-blue-300">
          {usingCurrent ? <Loader2 size={16} className="animate-spin" /> : <MapPin size={16} />} Use my current location
        </button>
      )}
      {searching && <div className="flex items-center gap-2 text-sm text-slate-500"><Loader2 size={15} className="animate-spin" /> Searching locations...</div>}
      {!searching && results.length > 0 && (
        <div className="max-h-56 space-y-1 overflow-y-auto rounded-xl border border-slate-200 bg-white p-1 shadow-sm dark:border-slate-700 dark:bg-slate-900">
          {results.map((location) => (
            <button type="button" key={`${location.latitude}-${location.longitude}-${location.address}`} onClick={() => { onSelect(location); setQuery(location.address); setResults([]); }} className="flex w-full items-start gap-3 rounded-lg p-3 text-left text-sm transition hover:bg-blue-50 focus:bg-blue-50 focus:outline-none dark:hover:bg-slate-800 dark:focus:bg-slate-800">
              <MapPin size={17} className="mt-0.5 shrink-0 text-blue-600 dark:text-blue-400" />
              <span className="min-w-0"><span className="block font-semibold text-slate-900 dark:text-white">{location.locality || location.city || location.state || location.address}</span><span className="mt-1 block text-slate-500 dark:text-slate-400">{[location.city, location.state, location.pincode].filter(Boolean).join(", ") || location.address}</span><span className="mt-1 block truncate text-xs text-slate-400 dark:text-slate-500">{location.address}</span></span>
            </button>
          ))}
        </div>
      )}
      {!searching && message && <p className={`text-sm ${searchError ? "text-rose-600 dark:text-rose-400" : "text-amber-700 dark:text-amber-300"}`}>{message}</p>}
      {error && <p className="text-sm text-rose-600 dark:text-rose-400">{error}</p>}
    </div>
  );
}