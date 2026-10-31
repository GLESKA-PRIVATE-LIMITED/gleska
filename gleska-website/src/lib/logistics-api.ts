import apiClient from "@/lib/api";
import type { VehicleListing, VehicleRentalRequest } from "@/app/logistics/dashboard";

/** Server rows (migration 107). Money arrives as decimal strings or numbers; display only. */
interface ListingRow {
  id: string;
  user_id: string | null;
  category: string;
  vehicle_type: string;
  registration_number: string;
  make_model: string | null;
  model_year: number | null;
  capacity_tons: string | number | null;
  dimensions: string | null;
  fuel_type: string | null;
  ownership: string | null;
  location: string | null;
  service_area: string | null;
  available_from: string | null;
  available_until: string | null;
  price_amount: string | number | null;
  price_unit: VehicleListing["priceUnit"];
  driver_available: VehicleListing["driverAvailable"] | null;
  permitted_usage: string | null;
  contact_name: string | null;
  contact_phone: string | null;
  contact_email: string | null;
  notes: string | null;
  documents: Partial<VehicleListing["documents"]> | null;
  status: "ACTIVE" | "DISPATCHED" | "MAINTENANCE" | "ARCHIVED";
  created_at: string;
}

interface RequestRow {
  id: string;
  user_id: string | null;
  vehicle_ref: string | null;
  vehicle_title: string | null;
  vehicle_registration: string | null;
  category: string | null;
  source_location: string;
  destination_location: string;
  pickup_date: string | null;
  rental_duration: string | null;
  offered_price: string | number | null;
  price_unit: string | null;
  driver_required: boolean;
  cargo_type: string | null;
  instructions: string | null;
  status: "SUBMITTED" | "CONFIRMED" | "IN_TRANSIT" | "COMPLETED" | "CANCELLED";
  created_at: string;
}

const LISTING_STATUS: Record<ListingRow["status"], VehicleListing["status"]> = {
  ACTIVE: "Active Listing",
  DISPATCHED: "Dispatched",
  MAINTENANCE: "Under Maintenance",
  ARCHIVED: "Active Listing",
};
const LISTING_STATUS_CODE: Record<VehicleListing["status"], ListingRow["status"]> = {
  "Active Listing": "ACTIVE",
  Dispatched: "DISPATCHED",
  "Under Maintenance": "MAINTENANCE",
};
const REQUEST_STATUS: Record<RequestRow["status"], VehicleRentalRequest["status"]> = {
  SUBMITTED: "Request Submitted",
  CONFIRMED: "Confirmed",
  IN_TRANSIT: "In Transit",
  COMPLETED: "Completed",
  CANCELLED: "Request Submitted",
};
const REQUEST_STATUS_CODE: Record<VehicleRentalRequest["status"], RequestRow["status"]> = {
  "Request Submitted": "SUBMITTED",
  Confirmed: "CONFIRMED",
  "In Transit": "IN_TRANSIT",
  Completed: "COMPLETED",
};

const num = (v: string | number | null | undefined) => (v === null || v === undefined || v === "" ? 0 : Number(v));
const dateOnly = (v: string | null | undefined) => (v ? v.slice(0, 10) : "");
const optional = (v: string | null | undefined) => (v && v.trim() ? v : null);
const money = (v: number | null | undefined) => (v === null || v === undefined || Number.isNaN(v) ? null : v.toFixed(2));

export function listingFromRow(row: ListingRow, companyName: string): VehicleListing {
  return {
    id: row.id,
    userId: row.user_id ?? "",
    companyName,
    category: row.category,
    type: row.vehicle_type,
    registrationNumber: row.registration_number,
    makeModel: row.make_model ?? "",
    modelYear: row.model_year ?? 0,
    capacityTons: num(row.capacity_tons),
    dimensions: row.dimensions ?? "",
    fuelType: row.fuel_type ?? "",
    ownership: row.ownership ?? "",
    location: row.location ?? "",
    serviceArea: row.service_area ?? "",
    availableFrom: dateOnly(row.available_from),
    availableUntil: dateOnly(row.available_until),
    priceAmount: num(row.price_amount),
    priceUnit: row.price_unit,
    driverAvailable: row.driver_available ?? "On Request",
    permittedUsage: row.permitted_usage ?? "",
    contactName: row.contact_name ?? "",
    contactPhone: row.contact_phone ?? "",
    contactEmail: row.contact_email ?? "",
    notes: row.notes ?? "",
    documents: {
      rcAttached: Boolean(row.documents?.rcAttached),
      fitnessAttached: Boolean(row.documents?.fitnessAttached),
      insuranceAttached: Boolean(row.documents?.insuranceAttached),
      permitAttached: Boolean(row.documents?.permitAttached),
    },
    status: LISTING_STATUS[row.status],
    createdAt: dateOnly(row.created_at),
  };
}

export function requestFromRow(row: RequestRow, companyName: string): VehicleRentalRequest {
  return {
    id: row.id,
    userId: row.user_id ?? "",
    companyName,
    vehicleId: row.vehicle_ref ?? "",
    vehicleTitle: row.vehicle_title ?? "",
    vehicleReg: row.vehicle_registration ?? "",
    category: row.category ?? "",
    sourceLocation: row.source_location,
    destinationLocation: row.destination_location,
    pickupDate: dateOnly(row.pickup_date),
    rentalDuration: row.rental_duration ?? "",
    offeredPrice: num(row.offered_price),
    priceUnit: row.price_unit ?? "",
    driverRequired: row.driver_required,
    cargoType: row.cargo_type ?? "",
    instructions: row.instructions ?? "",
    status: REQUEST_STATUS[row.status],
    createdAt: dateOnly(row.created_at),
  };
}

export function listingPayload(v: VehicleListing) {
  return {
    category: v.category,
    vehicle_type: v.type,
    registration_number: v.registrationNumber,
    make_model: optional(v.makeModel),
    model_year: v.modelYear || null,
    capacity_tons: Number.isFinite(v.capacityTons) ? v.capacityTons.toFixed(2) : null,
    dimensions: optional(v.dimensions),
    fuel_type: optional(v.fuelType),
    ownership: optional(v.ownership),
    location: optional(v.location),
    service_area: optional(v.serviceArea),
    available_from: optional(v.availableFrom),
    available_until: optional(v.availableUntil),
    price_amount: money(v.priceAmount),
    price_unit: v.priceUnit,
    driver_available: v.driverAvailable,
    permitted_usage: optional(v.permittedUsage),
    contact_name: optional(v.contactName),
    contact_phone: optional(v.contactPhone),
    contact_email: optional(v.contactEmail),
    notes: optional(v.notes),
    documents: v.documents,
    status: LISTING_STATUS_CODE[v.status] ?? "ACTIVE",
  };
}

const PRICE_UNITS = ["per day", "per trip", "per km", "per ton"];

export function requestPayload(r: VehicleRentalRequest) {
  return {
    vehicle_ref: optional(r.vehicleId)?.slice(0, 100) ?? null,
    vehicle_title: optional(r.vehicleTitle),
    vehicle_registration: optional(r.vehicleReg),
    category: optional(r.category),
    source_location: r.sourceLocation,
    destination_location: r.destinationLocation,
    pickup_date: optional(r.pickupDate),
    rental_duration: optional(r.rentalDuration),
    offered_price: money(r.offeredPrice),
    price_unit: PRICE_UNITS.includes(r.priceUnit) ? r.priceUnit : null,
    driver_required: r.driverRequired,
    cargo_type: optional(r.cargoType),
    instructions: optional(r.instructions),
    status: REQUEST_STATUS_CODE[r.status] ?? "SUBMITTED",
  };
}

export const logisticsApi = {
  vehicles: () => apiClient.get<{ vehicles: ListingRow[] }>("/api/v1/logistics/vehicles").then((r) => r.data.vehicles),
  requests: () => apiClient.get<{ requests: RequestRow[] }>("/api/v1/logistics/rental-requests").then((r) => r.data.requests),
  createVehicle: (v: VehicleListing) =>
    apiClient.post<{ vehicle: ListingRow }>("/api/v1/logistics/vehicles", listingPayload(v)).then((r) => r.data.vehicle),
  createRequest: (q: VehicleRentalRequest) =>
    apiClient.post<{ request: RequestRow }>("/api/v1/logistics/rental-requests", requestPayload(q)).then((r) => r.data.request),
  importBrowserData: (listings: VehicleListing[], requests: VehicleRentalRequest[]) =>
    apiClient
      .post<{ imported_listings: number; imported_requests: number }>("/api/v1/logistics/import", {
        listings: listings.slice(0, 200).map(listingPayload),
        requests: requests.slice(0, 200).map(requestPayload),
      })
      .then((r) => r.data),
};
