"use client";

import React, { useEffect, useRef, useState } from "react";
import axios from "axios";
import { useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import {
  LogOut,
  Zap,
  User,
  MapPin,
  Clock,
  AlertCircle,
  Loader2,
} from "lucide-react";
import { toast } from "sonner";
import Link from "next/link";
import apiClient from "@/lib/api";

declare global {
  interface Window {
    google?: any;
  }
}

type AvailableJob = {
  job_id: string;
  title: string;
  salary: number;
  headcount: number;
  min_experience: number | null;
  employer_name: string;
  distance_km: number | null;
};

type RouteResponse = {
  job_id: string;
  origin: { latitude: number; longitude: number };
  destination: { latitude: number; longitude: number; name: string };
  route: {
    distance_meters: number;
    distance_km: number;
    duration_seconds: number;
    duration_minutes: number;
    encoded_polyline: string;
  };
};

function GoogleRouteMap({ route }: { route: RouteResponse }) {
  const mapRef = useRef<HTMLDivElement | null>(null);
  const [mapError, setMapError] = useState("");
  const mapApiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || "";

  useEffect(() => {
    if (!mapRef.current) return;

    const renderMap = () => {
      const googleMaps = window.google?.maps;
      if (!mapRef.current || !googleMaps) {
        setMapError("Map unavailable. Your route distance and ETA are still available. Please try again later.");
        return;
      }

      const origin = new googleMaps.LatLng(route.origin.latitude, route.origin.longitude);
      const destination = new googleMaps.LatLng(route.destination.latitude, route.destination.longitude);
      const bounds = new googleMaps.LatLngBounds();
      bounds.extend(origin);
      bounds.extend(destination);

      const map = new googleMaps.Map(mapRef.current, {
        center: origin,
        zoom: 14,
        mapTypeId: googleMaps.MapTypeId.ROADMAP,
        disableDefaultUI: false,
        zoomControl: true,
        mapTypeControl: true,
        streetViewControl: true,
      });

      const routePath = googleMaps.geometry?.encoding?.decodePath(route.route.encoded_polyline || "") || [origin, destination];
      if (routePath.length > 0) {
        const polyline = new googleMaps.Polyline({
          path: routePath,
          strokeColor: "#2563eb",
          strokeOpacity: 0.9,
          strokeWeight: 6,
          map,
        });
        polyline.setMap(map);
        routePath.forEach((point: { lat: () => number; lng: () => number }) => {
          bounds.extend(new googleMaps.LatLng(point.lat(), point.lng()));
        });
      }

      const workerMarker = new googleMaps.Marker({
        position: origin,
        map,
        title: "Your location",
        label: { text: "You", color: "#0f172a", fontSize: "12px", fontWeight: "700" },
        icon: {
          path: googleMaps.SymbolPath.CIRCLE,
          scale: 10,
          fillColor: "#22c55e",
          fillOpacity: 1,
          strokeColor: "#ffffff",
          strokeWeight: 2,
        },
      });
      workerMarker.setMap(map);

      const destinationMarker = new googleMaps.Marker({
        position: destination,
        map,
        title: route.destination.name,
        label: { text: "Site", color: "#0f172a", fontSize: "12px", fontWeight: "700" },
        icon: {
          path: googleMaps.SymbolPath.CIRCLE,
          scale: 10,
          fillColor: "#ef4444",
          fillOpacity: 1,
          strokeColor: "#ffffff",
          strokeWeight: 2,
        },
      });
      destinationMarker.setMap(map);

      map.fitBounds(bounds);
      map.panToBounds(bounds);
      const zoom = map.getZoom();
      if (typeof zoom === "number" && zoom > 18) {
        map.setZoom(18);
      }
    };

    if (!mapApiKey) {
      setMapError("Map unavailable. Your route distance and ETA are still available. Please try again later.");
      return;
    }

    if (window.google?.maps) {
      renderMap();
      return;
    }

    const existingScript = document.querySelector("script[data-google-maps]");
    if (existingScript) {
      existingScript.addEventListener("load", renderMap, { once: true });
      return;
    }

    const script = document.createElement("script");
    script.src = `https://maps.googleapis.com/maps/api/js?key=${mapApiKey}&libraries=geometry`;
    script.async = true;
    script.defer = true;
    script.dataset.googleMaps = "true";
    script.onload = renderMap;
    script.onerror = () => {
      setMapError("Map unavailable. Your route distance and ETA are still available. Please try again later.");
    };
    document.head.appendChild(script);
  }, [mapApiKey, route]);

  if (mapError) {
    return (
      <div className="mt-6 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/20 dark:text-amber-300">
        {mapError}
      </div>
    );
  }

  return <div ref={mapRef} className="mt-6 h-72 w-full overflow-hidden rounded-2xl border border-slate-200 bg-slate-100 dark:border-slate-700" />;
}

export default function WorkerDashboard() {
  const router = useRouter();
  const { user, isLoading, nextStep, logout } = useAuth();
  const [profile, setProfile] = React.useState<{ profile_completed: boolean; availability_status: string; expected_daily_wage?: number | null; latitude?: number | null; longitude?: number | null; address?: string | null }>({ profile_completed: false, availability_status: "OFFLINE" });
  const [availableJobs, setAvailableJobs] = React.useState<AvailableJob[]>([]);
  const [selectedJob, setSelectedJob] = React.useState<AvailableJob | null>(null);
  const [routeData, setRouteData] = React.useState<RouteResponse | null>(null);
  const [jobsLoading, setJobsLoading] = React.useState(false);
  const [jobsError, setJobsError] = React.useState("");
  const [routeError, setRouteError] = React.useState("");
  const [routeLoading, setRouteLoading] = React.useState(false);

  useEffect(() => {
    if (!user || user.role !== "WORKER") return;
    apiClient.get("/api/v1/workers/me").then((response) => {
      setProfile(response.data);
      if (response.data.latitude == null || response.data.longitude == null) {
        setJobsError("Add your location to your profile to see nearby jobs.");
        return;
      }
      setJobsLoading(true);
      return apiClient.get("/api/v1/workers/me/available-jobs").then((jobsResponse) => setAvailableJobs(jobsResponse.data.jobs || [])).catch(() => setJobsError("Unable to load nearby jobs right now. Please try again.")).finally(() => setJobsLoading(false));
    }).catch(() => setJobsError("Unable to load your profile right now."));
  }, [user]);

  useEffect(() => {
    if (!isLoading && !user) {
      router.push("/worker/auth");
    }

    // Redirect if next step is not DASHBOARD
    if (!isLoading && user && nextStep !== "DASHBOARD") {
      router.push(nextStep === "WORKER_PROFILE" ? "/worker/onboarding" : "/worker/auth");
    }
  }, [user, isLoading, nextStep, router]);

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#eef1fb] dark:bg-slate-950">
        <div className="flex flex-col items-center gap-4">
          <Loader2 size={40} className="animate-spin text-indigo-600" />
          <p className="text-slate-600 dark:text-slate-400">Loading your dashboard...</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return null;
  }

  const handleLogout = async () => {
    try {
      await logout();
      router.push("/");
      toast.success("Logged out successfully");
    } catch {
      toast.error("Logout failed");
    }
  };

  const handleViewRoute = async (job: AvailableJob) => {
    if (routeLoading) return;
    setSelectedJob(job);
    setRouteError("");
    setRouteLoading(true);
    try {
      const response = await apiClient.get(`/api/v1/workers/me/jobs/${job.job_id}/route`);
      setRouteData(response.data);
    } catch (error: unknown) {
      setRouteData(null);
      const detail = axios.isAxiosError(error) ? error.response?.data?.detail : undefined;
      setRouteError(detail || (error instanceof Error ? error.message : undefined) || "Unable to calculate the route right now. Please try again.");
    } finally {
      setRouteLoading(false);
    }
  };

  const openGoogleMapsRoute = () => {
    if (!routeData) return;
    const url = `https://www.google.com/maps/dir/?api=1&origin=${routeData.origin.latitude},${routeData.origin.longitude}&destination=${routeData.destination.latitude},${routeData.destination.longitude}&travelmode=driving`;
    window.open(url, "_blank", "noopener,noreferrer");
  };

  return (
    <div className="min-h-screen bg-[#eef1fb] font-sans text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      {/* Header */}
      <header className="border-b border-slate-200 bg-white/80 backdrop-blur dark:border-slate-800 dark:bg-slate-900/80">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
          <Link href="/" className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-linear-to-br from-blue-600 to-indigo-600">
              <Zap size={16} className="text-white" fill="currentColor" />
            </div>
            <span className="font-(--font-anton) text-lg uppercase text-slate-900 dark:text-white">
              GO LESKA
            </span>
          </Link>

          <button
            onClick={handleLogout}
            className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-600 transition hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300"
          >
            <LogOut size={16} />
            Logout
          </button>
        </div>
      </header>

      {/* Main Content */}
      <main className="mx-auto max-w-7xl px-6 py-12">
        {/* Welcome Card */}
        <div className="mb-8 rounded-3xl bg-linear-to-br from-amber-50 to-yellow-50 p-8 dark:from-amber-950/20 dark:to-yellow-950/20 border border-amber-200 dark:border-amber-800">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-300">
                Welcome back
              </p>
              <h1 className="font-(--font-anton) text-4xl uppercase text-slate-900 dark:text-white">
                {user.name}
              </h1>
              <p className="mt-2 text-lg text-amber-700 dark:text-amber-300">
                Ready to find your next job?
              </p>
            </div>
            <div className="flex h-24 w-24 items-center justify-center rounded-2xl bg-linear-to-br from-amber-400 to-yellow-500 shadow-lg">
              <User size={40} className="text-white" />
            </div>
          </div>
        </div>

        {/* Grid */}
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
          {/* Profile Completion Card */}
          <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <div className="mb-4 flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-indigo-50 dark:bg-indigo-950">
                <User size={20} className="text-indigo-600 dark:text-indigo-400" />
              </div>
              <h3 className="text-sm font-bold uppercase text-slate-600 dark:text-slate-400">
                Profile
              </h3>
            </div>
            <div className="space-y-4">
              <div>
                <div className="mb-2 flex items-center justify-between">
                  <p className="text-sm font-semibold text-slate-700 dark:text-slate-300">
                    Completion
                  </p>
                  <p className="text-sm font-bold text-indigo-600 dark:text-indigo-400">{profile.profile_completed ? "100%" : "0%"}</p>
                </div>
                <div className="h-2 rounded-full bg-slate-200 dark:bg-slate-700">
                  <div className={`h-full rounded-full bg-linear-to-r from-indigo-500 to-indigo-600 ${profile.profile_completed ? "w-full" : "w-0"}`}></div>
                </div>
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Add your trade, experience, and expected wage to improve matches
              </p>
              <Link
                href="/worker/profile"
                className="inline-block text-sm font-bold text-indigo-600 transition hover:text-indigo-700 dark:text-indigo-400"
              >
                Complete Profile →
              </Link>
            </div>
          </div>

          {/* Availability Card */}
          <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <div className="mb-4 flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-50 dark:bg-emerald-950">
                <Clock size={20} className="text-emerald-600 dark:text-emerald-400" />
              </div>
              <h3 className="text-sm font-bold uppercase text-slate-600 dark:text-slate-400">
                Availability
              </h3>
            </div>
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <div className="h-3 w-3 rounded-full bg-slate-400"></div>
                <p className="font-semibold text-slate-700 dark:text-slate-300">{profile.availability_status}</p>
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Set your availability to AVAILABLE to receive job pings
              </p>
              <button className="inline-block text-sm font-bold text-emerald-600 transition hover:text-emerald-700 dark:text-emerald-400">
                Go Online →
              </button>
            </div>
          </div>

          {/* Stats Card */}
          <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <div className="mb-4 flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-50 dark:bg-blue-950">
                <MapPin size={20} className="text-blue-600 dark:text-blue-400" />
              </div>
              <h3 className="text-sm font-bold uppercase text-slate-600 dark:text-slate-400">
                Your Stats
              </h3>
            </div>
            <div className="space-y-3">
              <div>
                <p className="text-xs font-semibold uppercase text-slate-500 dark:text-slate-400">
                  Jobs Accepted
                </p>
                <p className="text-2xl font-bold text-slate-900 dark:text-white">0</p>
              </div>
              <div>
                <p className="text-xs font-semibold uppercase text-slate-500 dark:text-slate-400">
                  Hourly Rate
                </p>
                <p className="text-xl font-bold text-slate-900 dark:text-white">{profile.expected_daily_wage ? `₹${profile.expected_daily_wage}/day` : "Not set"}</p>
              </div>
            </div>
          </div>
        </div>

        {/* Jobs Section */}
        <div className="mt-12">
          <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
            <h2 className="font-(--font-anton) text-2xl uppercase text-slate-900 dark:text-white">Jobs Near You</h2>
            {!profile.latitude || !profile.longitude ? <Link href="/worker/profile" className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2 text-sm font-bold text-white">Add Location</Link> : profile.address ? <p className="text-sm text-slate-600 dark:text-slate-400">Using {profile.address}</p> : null}
          </div>
          {jobsLoading ? (
            <div className="flex items-center justify-center rounded-2xl border border-slate-200 bg-white p-12 dark:border-slate-800 dark:bg-slate-900"><Loader2 className="animate-spin text-blue-600" /></div>
          ) : jobsError ? (
            <div className="rounded-2xl border border-rose-200 bg-rose-50 p-8 text-center text-sm text-rose-700 dark:border-rose-900 dark:bg-rose-950/20 dark:text-rose-300">{jobsError}</div>
          ) : availableJobs.length === 0 ? (
            <div className="rounded-2xl border-2 border-dashed border-slate-200 bg-slate-50 p-12 text-center dark:border-slate-700 dark:bg-slate-800"><AlertCircle size={40} className="mx-auto mb-4 text-slate-400" /><p className="text-lg font-semibold text-slate-600 dark:text-slate-400">No nearby jobs available</p><p className="mt-2 text-sm text-slate-500 dark:text-slate-400">Eligible SEARCHING jobs within 30 km will appear here.</p></div>
          ) : (
            <div className="grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
              <div className="grid gap-4 md:grid-cols-2">{availableJobs.map((job) => (
                <article key={job.job_id} className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <h3 className="font-bold text-slate-900 dark:text-white">{job.title}</h3>
                      <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{job.employer_name}</p>
                    </div>
                    <MapPin size={18} className="shrink-0 text-blue-600" />
                  </div>
                  <div className="mt-5 grid grid-cols-3 gap-3 text-sm">
                    <div>
                      <p className="text-xs text-slate-500">Pay</p>
                      <p className="font-bold">₹{job.salary}/day</p>
                    </div>
                    <div>
                      <p className="text-xs text-slate-500">Workers</p>
                      <p className="font-bold">{job.headcount}</p>
                    </div>
                    <div>
                      <p className="text-xs text-slate-500">Distance</p>
                      <p className="font-bold">{job.distance_km ?? "-"} km</p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleViewRoute(job)}
                    disabled={routeLoading}
                    className="mt-5 inline-flex items-center justify-center rounded-xl bg-blue-600 px-4 py-2 text-sm font-bold text-white transition hover:bg-blue-500 disabled:opacity-60"
                  >
                    {routeLoading && selectedJob?.job_id === job.job_id ? "Calculating best route..." : "View Route"}
                  </button>
                </article>
              ))}</div>

              <aside className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
                {selectedJob ? (
                  <>
                    <p className="text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">Selected Job</p>
                    <h3 className="mt-2 font-(--font-anton) text-2xl uppercase text-slate-900 dark:text-white">{selectedJob.title}</h3>
                    <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">{selectedJob.employer_name}</p>
                    <p className="mt-4 text-sm text-slate-500 dark:text-slate-400">₹{selectedJob.salary}/day</p>

                    {routeLoading ? (
                      <div className="mt-6 flex items-center gap-3 rounded-xl bg-blue-50 p-3 text-sm font-semibold text-blue-700 dark:bg-blue-950/30 dark:text-blue-300">
                        <Loader2 size={16} className="animate-spin" />
                        Calculating best route...
                      </div>
                    ) : routeError ? (
                      <div className="mt-6 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700 dark:border-rose-900 dark:bg-rose-950/20 dark:text-rose-300">{routeError}</div>
                    ) : routeData ? (
                      <div className="mt-6 space-y-4">
                        <div>
                          <p className="text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">Route</p>
                          <h4 className="mt-2 text-lg font-bold text-slate-900 dark:text-white">{routeData.destination.name}</h4>
                        </div>
                        <div className="grid gap-3 sm:grid-cols-2">
                          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-800">
                            <p className="text-xs text-slate-500 dark:text-slate-400">Road distance</p>
                            <p className="mt-1 text-lg font-bold text-slate-900 dark:text-white">{routeData.route.distance_km} km</p>
                          </div>
                          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-800">
                            <p className="text-xs text-slate-500 dark:text-slate-400">ETA</p>
                            <p className="mt-1 text-lg font-bold text-slate-900 dark:text-white">~{routeData.route.duration_minutes} min</p>
                          </div>
                        </div>
                        <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm dark:border-slate-700 dark:bg-slate-800">
                          <p className="text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">From</p>
                          <p className="mt-1 font-medium text-slate-700 dark:text-slate-200">Your current location</p>
                          <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">To</p>
                          <p className="font-medium text-slate-700 dark:text-slate-200">{routeData.destination.name}</p>
                        </div>
                        <button
                          type="button"
                          onClick={openGoogleMapsRoute}
                          className="inline-flex w-full items-center justify-center rounded-xl border border-blue-200 bg-white px-4 py-2 text-sm font-bold text-blue-700 transition hover:bg-blue-50 dark:border-blue-900 dark:bg-slate-900 dark:text-blue-300 dark:hover:bg-blue-950/30"
                        >
                          Open in Google Maps
                        </button>
                        <GoogleRouteMap route={routeData} />
                      </div>
                    ) : (
                      <div className="mt-6 rounded-xl border border-dashed border-slate-300 bg-slate-50 p-4 text-sm text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
                        Pick a job and click View Route to see the best road route.
                      </div>
                    )}
                  </>
                ) : (
                  <div className="flex h-full min-h-48 items-center justify-center rounded-2xl border border-dashed border-slate-300 bg-slate-50 text-center text-sm text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
                    Select a job to preview the route.
                  </div>
                )}
              </aside>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
