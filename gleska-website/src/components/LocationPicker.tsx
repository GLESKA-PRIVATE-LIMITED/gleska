"use client";

import { useState } from "react";
import { Loader2, MapPin, Search } from "lucide-react";
import apiClient from "@/lib/api";

export type LocationSelection = {
  address: string;
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
  onUseCurrentLocation?: () => Promise<LocationSelection>;
  error?: string;
};

export default function LocationPicker({ value = "", onSelect, onUseCurrentLocation, error }: LocationPickerProps) {
  const [query, setQuery] = useState(value);
  const [results, setResults] = useState<LocationSelection[]>([]);
  const [searching, setSearching] = useState(false);
  const [usingCurrent, setUsingCurrent] = useState(false);
  const [message, setMessage] = useState("");

  const search = async () => {
    if (query.trim().length < 2) return;
    setSearching(true);
    setMessage("");
    try {
      const response = await apiClient.get("/api/v1/locations/search", { params: { q: query.trim() } });
      setResults((response.data.locations || []).map((location: LocationSelection) => ({ ...location, latitude: Number(location.latitude), longitude: Number(location.longitude), location_source: "SEARCH" })));
      if (!response.data.locations?.length) setMessage("No locations found. Try a nearby area, city, or pincode.");
    } catch {
      setResults([]);
      setMessage("Couldn't search for that location. Please try again.");
    } finally {
      setSearching(false);
    }
  };

  const useCurrent = async () => {
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
      <div className="flex gap-2">
        <div className="relative min-w-0 flex-1">
          <Search size={16} className="pointer-events-none absolute left-3 top-3.5 text-slate-400" />
          <input value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void search(); } }} placeholder="Search your area, city or pincode" className="w-full rounded-xl border border-slate-300 py-3 pl-9 pr-3 text-sm dark:border-slate-700 dark:bg-slate-800" />
        </div>
        <button type="button" onClick={() => void search()} disabled={searching} className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-60">
          {searching ? <Loader2 size={16} className="animate-spin" /> : <Search size={16} />} Search
        </button>
      </div>
      {onUseCurrentLocation && (
        <button type="button" onClick={() => void useCurrent()} disabled={usingCurrent} className="inline-flex items-center gap-2 text-sm font-semibold text-blue-700 dark:text-blue-300">
          {usingCurrent ? <Loader2 size={16} className="animate-spin" /> : <MapPin size={16} />} Use my current location
        </button>
      )}
      {results.length > 0 && (
        <div className="space-y-2">
          {results.map((location) => (
            <button type="button" key={`${location.latitude}-${location.longitude}-${location.address}`} onClick={() => { onSelect(location); setQuery(location.address); setResults([]); }} className="block w-full rounded-xl border border-slate-200 p-3 text-left text-sm hover:bg-blue-50 dark:border-slate-700 dark:hover:bg-slate-800">
              <span className="font-semibold text-slate-900 dark:text-white">{location.city || location.state || location.address}</span>
              <span className="mt-1 block text-slate-500 dark:text-slate-400">{location.address}</span>
            </button>
          ))}
        </div>
      )}
      {(message || error) && <p className="text-sm text-rose-600 dark:text-rose-400">{message || error}</p>}
    </div>
  );
}