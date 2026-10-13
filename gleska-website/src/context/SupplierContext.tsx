"use client";

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import type { FormEvent } from "react";
import { isAxiosError } from "axios";
import { useAuth } from "@/context/AuthContext";
import apiClient from "@/lib/api";
import {
  ProcurementPurchaseOrder,
  PurchaseOrderFulfillmentStatus,
  PurchaseOrderFulfillmentUpdate,
  SupplierQuotation,
  SupplierRFQ,
  ProcurementUnit,
  procurementApi,
} from "@/lib/procurement-api";

export type CompanyRole = "OWNER" | "ADMIN" | "MEMBER";
export type MembershipStatus = "ACTIVE" | "PENDING" | "REVOKED";
export type VerificationStatus =
  | "NOT_SUBMITTED"
  | "PENDING_REVIEW"
  | "VERIFIED"
  | "REJECTED"
  | "SUSPENDED";

export interface CompanyMembership {
  id: string;
  company_id: string;
  company_name: string;
  role: CompanyRole;
  status: MembershipStatus;
  created_at: string;
  operational_status?: SupplierCompany["operational_status"] | null;
  verification_status?: VerificationStatus | null;
}

export interface SupplierCompany {
  id: string;
  name: string;
  description: string | null;
  website: string | null;
  operational_status: "ACTIVE" | "SUSPENDED" | "ARCHIVED";
  verification_status: VerificationStatus;
  verification_reason: string | null;
  verification_submitted_at: string | null;
  verification_reviewed_at: string | null;
  role: CompanyRole;
  created_at: string;
  updated_at: string;
  registered_name?: string | null;
  registration_number?: string | null;
  contact_email?: string | null;
  contact_phone?: string | null;
  registered_address?: string | null;
}

export interface VerificationDocument {
  id: string;
  company_id: string;
  document_type: string;
  original_filename: string;
  mime_type: string;
  file_size_bytes: number;
  uploaded_at: string;
}

export interface SupplierMember {
  id: string;
  name: string | null;
  invited_email: string | null;
  role: CompanyRole;
  status: MembershipStatus;
  created_at: string;
}

export interface SupplierMaterialOffering {
  id: string;
  company_id: string;
  name: string;
  specification: string | null;
  unit: string;
  indicative_price: string | null;
  currency_code: string | null;
  minimum_order_quantity: string | null;
  is_available: boolean;
  service_coverage: string[];
  revision: number;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface SupplierOfferingDraft {
  name: string;
  specification: string;
  unit: string;
  indicative_price: string;
  currency_code: string;
  minimum_order_quantity: string;
  is_available: boolean;
  service_coverage: string;
}

export interface QuotationDraft {
  unit_price: string;
  currency: SupplierQuotation["currency"];
  quantity_offered: string;
  unit: ProcurementUnit;
  estimated_delivery_lead_time_days: string;
  quotation_valid_until: string;
  delivery_terms: string;
  notes: string;
}

export interface CompanyDraft {
  name: string;
  description: string;
  website: string;
  registered_name: string;
  registration_number: string;
  contact_email: string;
  contact_phone: string;
  registered_address: string;
}

export type SupplierCompanyProfileDraft = Pick<
  CompanyDraft,
  "name" | "description" | "website"
>;

export type SupplierCompanyPrivateProfileDraft = Pick<
  CompanyDraft,
  | "registered_name"
  | "registration_number"
  | "contact_email"
  | "contact_phone"
  | "registered_address"
>;

export type FulfillmentDraft = Omit<
  PurchaseOrderFulfillmentUpdate,
  "idempotency_key"
>;

export const quotationUnits: ProcurementUnit[] = [
  "MT",
  "Bags",
  "Pieces",
  "Kg",
  "Tons",
  "Meters",
  "Sq. ft",
  "Boxes",
  "Liters",
];

export function localDateString(value = new Date()): string {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function quotationDateDefault(): string {
  const value = new Date();
  value.setDate(value.getDate() + 30);
  return localDateString(value);
}

export function quotationDraftFrom(
  quotation: SupplierQuotation | null,
  rfq: SupplierRFQ,
): QuotationDraft {
  return {
    unit_price: quotation ? String(quotation.unit_price) : "",
    currency: quotation?.currency || "INR",
    quantity_offered: quotation
      ? String(quotation.quantity_offered)
      : String(rfq.quantity),
    unit:
      quotation?.unit ||
      (quotationUnits.includes(rfq.unit as ProcurementUnit)
        ? (rfq.unit as ProcurementUnit)
        : "MT"),
    estimated_delivery_lead_time_days: quotation
      ? String(quotation.estimated_delivery_lead_time_days)
      : "7",
    quotation_valid_until:
      quotation?.quotation_valid_until || quotationDateDefault(),
    delivery_terms: quotation?.delivery_terms || "",
    notes: quotation?.notes || "",
  };
}

export const emptyOfferingDraft: SupplierOfferingDraft = {
  name: "",
  specification: "",
  unit: "",
  indicative_price: "",
  currency_code: "",
  minimum_order_quantity: "",
  is_available: true,
  service_coverage: "",
};

export const emptyCompanyDraft: CompanyDraft = {
  name: "",
  description: "",
  website: "",
  registered_name: "",
  registration_number: "",
  contact_email: "",
  contact_phone: "",
  registered_address: "",
};

export function emptyFulfillmentDraft(
  order: ProcurementPurchaseOrder,
): FulfillmentDraft {
  const allowedStatus: PurchaseOrderFulfillmentStatus =
    order.status === "ACCEPTED" || order.status === "PREPARING"
      ? "PREPARING"
      : order.status === "DISPATCHED"
        ? "DISPATCHED"
        : order.status === "PARTIALLY_DELIVERED"
          ? "PARTIALLY_DELIVERED"
          : "PREPARING";
  return {
    status: allowedStatus,
    dispatched_quantity: "",
    delivered_quantity: "",
    unit: order.unit,
    dispatch_date: "",
    carrier: order.carrier || "",
    tracking_reference: order.tracking_reference || "",
    estimated_delivery_date:
      order.estimated_delivery_date &&
      order.estimated_delivery_date >= localDateString()
        ? order.estimated_delivery_date
        : "",
    delivery_date: "",
    delivery_notes: "",
  };
}

export function errorMessage(error: unknown): string {
  if (isAxiosError<{ detail?: unknown }>(error)) {
    const detail = error.response?.data?.detail;
    if (detail !== undefined && typeof detail !== "string") {
      return "Check the submitted fields and try again.";
    }
    const messages: Record<string, string> = {
      SUPPLIER_COMPANY_MEMBERSHIP_NOT_FOUND:
        "You do not have active membership in that supplier company.",
      SUPPLIER_COMPANY_MANAGEMENT_FORBIDDEN:
        "Only active company owners and admins can edit company details.",
      SUPPLIER_COMPANY_UPDATE_FAILED:
        "Company details could not be saved. Please retry.",
      SUPPLIER_COMPANY_PRIVATE_PROFILE_UPDATE_FAILED:
        "Private registration and contact details could not be saved. Please retry.",
      SUPPLIER_COMPANY_PRIVATE_PROFILE_NOT_FOUND:
        "The private company profile is unavailable. Contact GLESKA support before retrying.",
      SUPPLIER_COMPANY_PRIVATE_PROFILE_UPDATE_EMPTY:
        "Enter at least one private profile field before saving.",
      SUPPLIER_COMPANY_NOT_OPERATIONAL:
        "This supplier company is suspended or archived. Contact an authorized GLESKA administrator.",
      VERIFIED_EMAIL_REQUIRED_TO_ACCEPT_SUPPLIER_INVITATION:
        "Confirm your account email before accepting this invitation.",
      SUPPLIER_INVITATION_NOT_FOUND:
        "This invitation is no longer available for your verified account.",
      SUPPLIER_MEMBER_MANAGEMENT_FORBIDDEN:
        "Your company role does not allow member management.",
      SUPPLIER_OWNER_REQUIRED:
        "Only the current company owner can transfer ownership.",
      SUPPLIER_MEMBERSHIP_CONFLICT:
        "That account already has a company invitation or membership.",
      SUPPLIER_DOCUMENT_UPLOAD_NOT_ALLOWED:
        "Documents cannot be changed while this verification is under review.",
      SUPPLIER_DOCUMENT_UPLOAD_FAILED:
        "The verification document could not be uploaded. Check the file and connection, then retry.",
      SUPPLIER_DOCUMENT_LIST_FAILED:
        "Private verification documents could not be loaded. Retry to view the current records.",
      SUPPLIER_DOCUMENT_URL_FAILED:
        "A secure link for this private document could not be created. Please retry.",
      SUPPLIER_VERIFICATION_DOCUMENT_REQUIRED:
        "Upload at least one verification document before submitting.",
      SUPPLIER_VERIFICATION_SUBMISSION_FAILED:
        "Your verification request could not be submitted. Check your connection and retry; the status will remain unchanged unless submission succeeds.",
      SUPPLIER_VERIFICATION_SUBMISSION_NOT_ALLOWED:
        "This verification cannot be submitted in its current status.",
      SUPPLIER_VERIFICATION_SUBMISSION_FORBIDDEN:
        "Only an active company owner or admin can submit verification.",
      SUPPLIER_VERIFICATION_MANAGEMENT_FORBIDDEN:
        "Only active company owners and admins can manage verification documents.",
      SUPPLIER_DOCUMENT_SIZE_INVALID:
        "Choose a document no larger than 10 MB.",
      SUPPLIER_DOCUMENT_TYPE_INVALID:
        "Upload a PDF, JPEG, or PNG whose extension matches its file type.",
      SUPPLIER_DOCUMENT_CONTENT_INVALID:
        "The selected file does not match its declared file type.",
      SUPPLIER_OFFERING_MANAGEMENT_FORBIDDEN:
        "Only active company owners and admins can change material offerings.",
      SUPPLIER_OFFERING_WRITE_NOT_ALLOWED:
        "Only an active company owner or admin can change offerings for an operational company.",
      SUPPLIER_OFFERING_INVALID:
        "Check the material offering fields, including price and currency, and try again.",
      SUPPLIER_OFFERING_NOT_FOUND:
        "That material offering was not found in this company.",
      SUPPLIER_OFFERING_ARCHIVED:
        "That material offering is archived and cannot be edited.",
      SUPPLIER_OFFERING_STALE:
        "This material offering changed on the server. Refresh the list before editing it.",
      SUPPLIER_OFFERING_SCHEMA_UNAVAILABLE:
        "The supplier-offering schema is not visible to this API. Confirm migration 074 is applied to the configured Supabase project and refresh its schema cache if needed.",
      SUPPLIER_OFFERING_LIST_FAILED:
        "Material offerings could not be loaded. Please refresh and try again.",
      SUPPLIER_OFFERING_CREATE_FAILED:
        "The material offering could not be created.",
      SUPPLIER_OFFERING_UPDATE_FAILED:
        "The material offering could not be updated.",
      SUPPLIER_OFFERING_ARCHIVE_FAILED:
        "The material offering could not be archived.",
      RFQ_LIST_FAILED:
        "The RFQ inbox could not be loaded. Check that migrations 076 and 077 are applied, then refresh.",
      RFQ_LOAD_FAILED:
        "The RFQ could not be loaded. Refresh the Supplier Workspace.",
      RFQ_NOT_FOUND:
        "This RFQ is no longer available to this company.",
      RFQ_CLOSED:
        "This RFQ is closed because its deadline passed or it was awarded; responses are closed.",
      RFQ_ALREADY_RESPONDED:
        "Your company has already responded to this invitation.",
      RFQ_RESPONSE_FAILED:
        "Your response could not be saved. Please retry; if this persists, confirm migration 076 has been applied.",
      RFQ_INVITATION_DECLINED:
        "Your company declined this invitation and can no longer submit a quotation.",
      QUOTATION_STALE:
        "This quotation changed since you opened it. Refresh the RFQ before editing.",
      RFQ_STALE:
        "The buyer updated this RFQ. Refresh it and review the latest terms before submitting your quotation.",
      QUOTATION_VALIDITY_INVALID:
        "The quotation validity date cannot be in the past.",
      QUOTATION_INVALID:
        "Check the price, currency, quantity, unit, dates, and text lengths.",
      QUOTATION_SUBMISSION_FAILED:
        "Your quotation could not be saved. Please try again.",
      PURCHASE_ORDER_LIST_FAILED:
        "Purchase orders could not be loaded. Confirm migration 078 and migration 079 are applied, then refresh.",
      PURCHASE_ORDER_NOT_FOUND:
        "This purchase order is no longer available to this company.",
      PURCHASE_ORDER_TRANSITION_INVALID:
        "This order has already changed and can no longer be updated. Refresh the order list.",
      PURCHASE_ORDER_UPDATE_FAILED:
        "Your purchase order response could not be saved. Please retry.",
      PURCHASE_ORDER_FULFILLMENT_NOT_ALLOWED:
        "Fulfillment updates are available only after your company accepts the order.",
      FULFILLMENT_UPDATE_INVALID:
        "Check the fulfillment quantities, unit, and text fields.",
      FULFILLMENT_UPDATE_FAILED:
        "The fulfillment update could not be saved. Confirm migrations 078 and 079 are applied, then retry.",
      FULFILLMENT_IDEMPOTENCY_CONFLICT:
        "This update key was already used for different details. Reopen the form and submit again.",
      FULFILLMENT_DISPATCH_QUANTITY_EXCEEDED:
        "Cumulative dispatched quantity cannot exceed the order quantity.",
      FULFILLMENT_DELIVERY_QUANTITY_EXCEEDED:
        "Delivered quantity cannot exceed the dispatched or ordered quantity.",
      FULFILLMENT_STATUS_QUANTITY_INVALID:
        "The selected status requires a valid quantity increment and consistent cumulative quantities.",
      FULFILLMENT_DISPATCH_DATE_REQUIRED:
        "Enter a dispatch date when recording dispatched quantity.",
      FULFILLMENT_DELIVERY_DATE_REQUIRED:
        "Enter a delivery date when recording delivered quantity.",
      FULFILLMENT_DATE_INVALID:
        "Dispatch and actual delivery dates cannot be in the future, delivery cannot precede dispatch, and an estimated delivery date cannot be in the past.",
    };
    return (
      (detail && messages[detail]) ||
      detail ||
      "The supplier workspace could not complete that request."
    );
  }
  return "The supplier workspace could not complete that request.";
}

interface SupplierContextValue {
  companies: CompanyMembership[];
  selectedCompanyId: string;
  setSelectedCompanyId: (id: string) => void;
  selectedMembership: CompanyMembership | undefined;
  company: SupplierCompany | null;
  companyDataId: string;
  canManageMembers: boolean;
  loading: boolean;
  error: string;
  setError: (err: string) => void;
  invitations: CompanyMembership[];
  invitationsError: string;
  busyMemberId: string;
  acceptInvitation: (id: string) => Promise<void>;
  refreshWorkspace: () => Promise<void>;
  loadCompany: (companyId: string) => Promise<void>;

  // RFQs
  rfqs: SupplierRFQ[];
  rfqsLoading: boolean;
  rfqsHasMore: boolean;
  rfqsLoadingMore: boolean;
  rfqsError: string;
  rfqsSuccess: string;
  setRfqsError: (msg: string) => void;
  setRfqsSuccess: (msg: string) => void;
  refreshRFQs: () => Promise<void>;
  loadMoreRFQs: () => Promise<void>;
  loadSupplierRFQ: (rfqId: string) => Promise<void>;
  respondToRfq: (
    rfqId: string,
    status: "ACKNOWLEDGED" | "DECLINED",
    note?: string,
  ) => Promise<boolean>;
  submitQuotation: (
    rfqId: string,
    draft: QuotationDraft,
    expectedRevision: number | null,
  ) => Promise<boolean>;

  // Orders
  purchaseOrders: ProcurementPurchaseOrder[];
  purchaseOrdersLoading: boolean;
  purchaseOrdersLoaded: boolean;
  purchaseOrdersError: string;
  purchaseOrdersSuccess: string;
  purchaseOrderBusyId: string;
  setPurchaseOrdersError: (msg: string) => void;
  setPurchaseOrdersSuccess: (msg: string) => void;
  refreshPurchaseOrders: () => Promise<void>;
  respondToPurchaseOrder: (
    order: ProcurementPurchaseOrder,
    status: "ACCEPTED" | "REJECTED",
  ) => Promise<boolean>;
  updatePurchaseOrderFulfillment: (
    order: ProcurementPurchaseOrder,
    draft: FulfillmentDraft,
  ) => Promise<boolean>;

  // Offerings
  offerings: SupplierMaterialOffering[];
  offeringsLoading: boolean;
  offeringsLoaded: boolean;
  offeringsError: string;
  offeringsSuccess: string;
  includeArchivedOfferings: boolean;
  supplierSettingsLoaded: boolean;
  supplierSettingsLoading: boolean;
  supplierSettingsSaving: boolean;
  supplierSettingsError: string;
  setIncludeArchivedOfferings: (show: boolean) => Promise<boolean>;
  refreshSupplierSettings: () => Promise<boolean>;
  setOfferingError: (msg: string) => void;
  setOfferingSuccess: (msg: string) => void;
  refreshOfferings: () => Promise<void>;
  saveOffering: (
    draft: SupplierOfferingDraft,
    editingId?: string,
  ) => Promise<boolean>;
  archiveOffering: (offering: SupplierMaterialOffering) => Promise<boolean>;

  // Company management
  members: SupplierMember[];
  membersLoaded: boolean;
  membersError: string;
  verificationDocuments: VerificationDocument[];
  verificationDocumentsLoaded: boolean;
  verificationError: string;
  verificationBusy: boolean;
  companyError: string;
  createCompany: (draft: CompanyDraft) => Promise<boolean>;
  updateCompanyProfile: (draft: SupplierCompanyProfileDraft) => Promise<boolean>;
  updateCompanyPrivateProfile: (
    draft: SupplierCompanyPrivateProfileDraft,
  ) => Promise<boolean>;
  inviteMember: (email: string, role: "ADMIN" | "MEMBER") => Promise<boolean>;
  changeMemberRole: (
    member: SupplierMember,
    role: "ADMIN" | "MEMBER",
  ) => Promise<boolean>;
  revokeMember: (member: SupplierMember) => Promise<boolean>;
  transferOwnership: (member: SupplierMember) => Promise<boolean>;
  uploadVerificationDocument: (
    documentType: string,
    file: File,
  ) => Promise<boolean>;
  submitVerification: () => Promise<boolean>;
  viewVerificationDocument: (document: VerificationDocument) => Promise<void>;
}

const SupplierContext = createContext<SupplierContextValue | null>(null);

export function useSupplier() {
  const context = useContext(SupplierContext);
  if (!context) {
    throw new Error("useSupplier must be used within a SupplierProvider");
  }
  return context;
}

const SELECTED_COMPANY_STORAGE_KEY = "gleska_supplier_selected_company_id";

export function SupplierProvider({ children }: { children: React.ReactNode }) {
  const { user, isLoading } = useAuth();
  const [companies, setCompanies] = useState<CompanyMembership[]>([]);
  const [invitations, setInvitations] = useState<CompanyMembership[]>([]);
  const [invitationsError, setInvitationsError] = useState("");
  const [company, setCompany] = useState<SupplierCompany | null>(null);
  const [companyDataId, setCompanyDataId] = useState("");
  const [members, setMembers] = useState<SupplierMember[]>([]);
  const [membersLoaded, setMembersLoaded] = useState(false);
  const [verificationDocuments, setVerificationDocuments] = useState<
    VerificationDocument[]
  >([]);
  const [verificationDocumentsLoaded, setVerificationDocumentsLoaded] =
    useState(false);
  const [offerings, setOfferings] = useState<SupplierMaterialOffering[]>([]);
  const [offeringsLoaded, setOfferingsLoaded] = useState(false);
  const [rfqs, setRfqs] = useState<SupplierRFQ[]>([]);
  const [rfqsCursor, setRfqsCursor] = useState<string | null>(null);
  const [rfqsHasMore, setRfqsHasMore] = useState(false);
  const [rfqsLoadingMore, setRfqsLoadingMore] = useState(false);
  const [purchaseOrders, setPurchaseOrders] = useState<
    ProcurementPurchaseOrder[]
  >([]);
  const [purchaseOrdersLoading, setPurchaseOrdersLoading] = useState(false);
  const [purchaseOrdersLoaded, setPurchaseOrdersLoaded] = useState(false);
  const [purchaseOrdersError, setPurchaseOrdersError] = useState("");
  const [companyError, setCompanyError] = useState("");
  const [membersError, setMembersError] = useState("");
  const [verificationError, setVerificationError] = useState("");
  const [purchaseOrdersSuccess, setPurchaseOrdersSuccess] = useState("");
  const [purchaseOrderBusyId, setPurchaseOrderBusyId] = useState("");
  const [rfqsLoading, setRfqsLoading] = useState(false);
  const [rfqsError, setRfqsError] = useState("");
  const [rfqsSuccess, setRfqsSuccess] = useState("");
  const [includeArchivedOfferings, setIncludeArchivedOfferingsState] =
    useState(false);
  const [supplierSettingsLoaded, setSupplierSettingsLoaded] = useState(false);
  const [supplierSettingsLoading, setSupplierSettingsLoading] = useState(false);
  const [supplierSettingsSaving, setSupplierSettingsSaving] = useState(false);
  const [supplierSettingsError, setSupplierSettingsError] = useState("");
  const [offeringsLoading, setOfferingsLoading] = useState(false);
  const [offeringsError, setOfferingsError] = useState("");
  const [offeringsSuccess, setOfferingsSuccess] = useState("");
  const setOfferingError = setOfferingsError;
  const setOfferingSuccess = setOfferingsSuccess;
  const [selectedCompanyId, setSelectedCompanyIdState] = useState("");
  const [verificationBusy, setVerificationBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busyMemberId, setBusyMemberId] = useState("");
  const [error, setError] = useState("");

  const companiesRef = useRef(companies);
  companiesRef.current = companies;
  const includeArchivedOfferingsRef = useRef(includeArchivedOfferings);
  includeArchivedOfferingsRef.current = includeArchivedOfferings;
  const selectedCompanyIdRef = useRef(selectedCompanyId);
  selectedCompanyIdRef.current = selectedCompanyId;
  const companyRequestId = useRef(0);
  const pendingFulfillmentSubmission = useRef<{
    orderId: string;
    signature: string;
    idempotencyKey: string;
  } | null>(null);

  const setSelectedCompanyId = useCallback((id: string) => {
    setSelectedCompanyIdState(id);
    if (typeof window !== "undefined") {
      try {
        sessionStorage.setItem(SELECTED_COMPANY_STORAGE_KEY, id);
      } catch {
        // storage quota / disabled
      }
    }
  }, []);

  const loadMemberships = useCallback(async () => {
    let savedCompanyId = "";
    if (typeof window !== "undefined") {
      try {
        savedCompanyId =
          sessionStorage.getItem(SELECTED_COMPANY_STORAGE_KEY) || "";
      } catch {
        // ignore
      }
    }

    const companyRequest = apiClient
      .get<CompanyMembership[]>("/api/v1/suppliers/companies")
      .then((response) => {
        const nextCompanies = response.data;
        setCompanies(nextCompanies);
        setSelectedCompanyIdState((current) => {
          const target = current || savedCompanyId;
          const matched = nextCompanies.some(
            (entry) => entry.company_id === target,
          );
          const next = matched ? target : nextCompanies[0]?.company_id || "";
          if (typeof window !== "undefined" && next) {
            try {
              sessionStorage.setItem(SELECTED_COMPANY_STORAGE_KEY, next);
            } catch {
              // ignore
            }
          }
          return next;
        });
      })
      .catch((loadError: unknown) => setError(errorMessage(loadError)));

    const invitationRequest = apiClient
      .get<CompanyMembership[]>("/api/v1/suppliers/invitations")
      .then((response) => {
        setInvitations(response.data);
        setInvitationsError("");
      })
      .catch((loadError: unknown) =>
        setInvitationsError(errorMessage(loadError)),
      );

    await Promise.all([companyRequest, invitationRequest]);
  }, []);

  const loadCompany = useCallback(async (companyId: string) => {
    const requestId = ++companyRequestId.current;
    const isCurrentRequest = () =>
      companyRequestId.current === requestId &&
      selectedCompanyIdRef.current === companyId;

    setCompany(null);
    setCompanyDataId(companyId);
    setMembers([]);
    setMembersLoaded(false);
    setVerificationDocuments([]);
    setVerificationDocumentsLoaded(false);
    setOfferings([]);
    setOfferingsLoaded(false);
    setRfqs([]);
    setRfqsCursor(null);
    setRfqsHasMore(false);
    setRfqsLoadingMore(false);
    setRfqsCursor(null);
    setRfqsHasMore(false);
    setRfqsLoadingMore(false);
    setPurchaseOrders([]);
    setCompanyError("");
    setMembersError("");
    setVerificationError("");
    setOfferingError("");
    setRfqsError("");
    setPurchaseOrdersError("");
    setPurchaseOrdersSuccess("");
    setOfferingsLoading(Boolean(companyId));
    setRfqsLoading(Boolean(companyId));
    setPurchaseOrdersLoading(Boolean(companyId));
    setPurchaseOrdersLoaded(false);
    setSupplierSettingsLoading(Boolean(companyId));
    setSupplierSettingsLoaded(!companyId);
    setSupplierSettingsError("");

    if (!companyId) {
      includeArchivedOfferingsRef.current = false;
      setIncludeArchivedOfferingsState(false);
      setSupplierSettingsLoading(false);
      setPurchaseOrdersLoading(false);
      setRfqsLoading(false);
      setOfferingsLoading(false);
      return;
    }

    const membership = companiesRef.current.find(
      (entry) => entry.company_id === companyId,
    );
    const canManageCompany =
      membership?.role === "OWNER" || membership?.role === "ADMIN";

    includeArchivedOfferingsRef.current = false;
    setIncludeArchivedOfferingsState(false);
    const settingsRequest = (async () => {
      try {
        const settings = await procurementApi.getSupplierSettings();
        if (isCurrentRequest()) {
          includeArchivedOfferingsRef.current =
            settings.show_archived_offerings;
          setIncludeArchivedOfferingsState(settings.show_archived_offerings);
          setSupplierSettingsError("");
          setSupplierSettingsLoaded(true);
        }
        return settings;
      } catch (loadError) {
        if (isCurrentRequest()) {
          setSupplierSettingsError(errorMessage(loadError));
          setSupplierSettingsLoaded(false);
        }
        return null;
      } finally {
        if (isCurrentRequest()) {
          setSupplierSettingsLoading(false);
        }
      }
    })();

    const requests = [
      (async () => {
        try {
          const response = await apiClient.get<SupplierCompany>(
            `/api/v1/suppliers/companies/${companyId}`,
          );
          if (isCurrentRequest()) setCompany(response.data);
        } catch (loadError) {
          if (isCurrentRequest()) setCompanyError(errorMessage(loadError));
        }
      })(),
      (async () => {
        try {
          const response = await apiClient.get<SupplierMember[]>(
            `/api/v1/suppliers/companies/${companyId}/members`,
          );
          if (isCurrentRequest()) {
            setMembers(response.data);
            setMembersLoaded(true);
          }
        } catch (loadError) {
          if (isCurrentRequest()) {
            setMembersError(errorMessage(loadError));
            setMembersLoaded(true);
          }
        }
      })(),
      (async () => {
        if (!canManageCompany) return;
        try {
          const response = await apiClient.get<VerificationDocument[]>(
            `/api/v1/suppliers/companies/${companyId}/verification/documents`,
          );
          if (isCurrentRequest()) {
            setVerificationDocuments(response.data);
            setVerificationDocumentsLoaded(true);
          }
        } catch (loadError) {
          if (isCurrentRequest()) {
            setVerificationError(errorMessage(loadError));
            setVerificationDocumentsLoaded(true);
          }
        }
      })(),
      (async () => {
        try {
          await settingsRequest;
          if (!isCurrentRequest()) return;
          const response = await apiClient.get<SupplierMaterialOffering[]>(
            `/api/v1/suppliers/companies/${companyId}/offerings`,
            {
              params: {
                include_archived:
                  Boolean(canManageCompany) &&
                  includeArchivedOfferingsRef.current,
              },
            },
          );
          if (isCurrentRequest()) {
            setOfferings(response.data);
            setOfferingsLoaded(true);
          }
        } catch (loadError) {
          if (isCurrentRequest()) {
            setOfferings([]);
            setOfferingsLoaded(false);
            setOfferingError(errorMessage(loadError));
          }
        } finally {
          if (isCurrentRequest()) setOfferingsLoading(false);
        }
      })(),
      (async () => {
        try {
          const nextRfqs = await procurementApi.listSupplierRFQs(companyId);
          if (isCurrentRequest()) {
            setRfqs(nextRfqs.items);
            setRfqsCursor(nextRfqs.next_cursor);
            setRfqsHasMore(nextRfqs.has_more);
          }
        } catch (loadError) {
          if (isCurrentRequest()) {
            setRfqs([]);
            setRfqsError(errorMessage(loadError));
          }
        } finally {
          if (isCurrentRequest()) setRfqsLoading(false);
        }
      })(),
      (async () => {
        try {
          const nextOrders =
            await procurementApi.listSupplierPurchaseOrders(companyId);
          if (isCurrentRequest()) {
            setPurchaseOrders(nextOrders);
            setPurchaseOrdersLoaded(true);
          }
        } catch (loadError) {
          if (isCurrentRequest()) {
            setPurchaseOrders([]);
            setPurchaseOrdersError(errorMessage(loadError));
          }
        } finally {
          if (isCurrentRequest()) setPurchaseOrdersLoading(false);
        }
      })(),
    ];
    await Promise.all(requests);
  }, []);

  useEffect(() => {
    if (isLoading) return;
    if (!user) return;
    setLoading(true);
    setError("");
    void loadMemberships()
      .catch((loadError: unknown) => setError(errorMessage(loadError)))
      .finally(() => setLoading(false));
  }, [isLoading, loadMemberships, user]);

  useEffect(() => {
    if (!user || !selectedCompanyId) {
      setCompany(null);
      setMembers([]);
      setMembersLoaded(false);
      setVerificationDocuments([]);
      setVerificationDocumentsLoaded(false);
      setOfferings([]);
      setOfferingsLoaded(false);
      setRfqs([]);
      setPurchaseOrders([]);
      setPurchaseOrdersLoading(false);
      setPurchaseOrdersLoaded(false);
      setPurchaseOrdersError("");
      setPurchaseOrdersSuccess("");
      setRfqsLoading(false);
      setRfqsError("");
      setRfqsSuccess("");
      setOfferingsLoading(false);
      setOfferingError("");
      setOfferingSuccess("");
      includeArchivedOfferingsRef.current = false;
      setIncludeArchivedOfferingsState(false);
      setSupplierSettingsLoaded(true);
      setSupplierSettingsLoading(false);
      setSupplierSettingsSaving(false);
      setSupplierSettingsError("");
      return;
    }
    setOfferings([]);
    setOfferingError("");
    setError("");
    setOfferingSuccess("");
    void loadCompany(selectedCompanyId).catch((loadError: unknown) => {
      setCompany(null);
      setMembers([]);
      setOfferingsLoading(false);
      setPurchaseOrdersLoading(false);
      setError(errorMessage(loadError));
    });
  }, [loadCompany, selectedCompanyId, user]);

  const refreshWorkspace = async () => {
    setError("");
    try {
      await loadMemberships();
      if (selectedCompanyId) await loadCompany(selectedCompanyId);
    } catch (loadError) {
      setError(errorMessage(loadError));
    }
  };

  const refreshPurchaseOrders = async () => {
    if (!selectedCompanyId) return;
    const companyId = selectedCompanyId;
    const requestId = companyRequestId.current;
    setPurchaseOrdersLoading(true);
    setPurchaseOrdersLoaded(false);
    setPurchaseOrdersError("");
    try {
      const nextOrders =
        await procurementApi.listSupplierPurchaseOrders(companyId);
      if (
        companyRequestId.current === requestId &&
        selectedCompanyIdRef.current === companyId
      ) {
        setPurchaseOrders(nextOrders);
        setPurchaseOrdersLoaded(true);
      }
    } catch (loadError) {
      if (
        companyRequestId.current === requestId &&
        selectedCompanyIdRef.current === companyId
      ) {
        setPurchaseOrders([]);
        setPurchaseOrdersError(errorMessage(loadError));
      }
    } finally {
      if (
        companyRequestId.current === requestId &&
        selectedCompanyIdRef.current === companyId
      ) {
        setPurchaseOrdersLoading(false);
      }
    }
  };

  const refreshRFQs = async () => {
    if (!selectedCompanyId) return;
    const companyId = selectedCompanyId;
    const requestId = companyRequestId.current;
    setRfqsLoading(true);
    setRfqsError("");
    try {
      const nextRfqs = await procurementApi.listSupplierRFQs(companyId);
      if (
        companyRequestId.current === requestId &&
        selectedCompanyIdRef.current === companyId
      ) {
        setRfqs(nextRfqs.items);
        setRfqsCursor(nextRfqs.next_cursor);
        setRfqsHasMore(nextRfqs.has_more);
      }
    } catch (loadError) {
      if (
        companyRequestId.current === requestId &&
        selectedCompanyIdRef.current === companyId
      ) {
        setRfqsError(errorMessage(loadError));
      }
    } finally {
      if (
        companyRequestId.current === requestId &&
        selectedCompanyIdRef.current === companyId
      ) {
        setRfqsLoading(false);
      }
    }
  };

  const loadMoreRFQs = async () => {
    if (!selectedCompanyId || !rfqsHasMore || rfqsLoadingMore) return;
    const companyId = selectedCompanyId;
    const requestId = companyRequestId.current;
    setRfqsLoadingMore(true);
    setRfqsError("");
    try {
      const nextPage = await procurementApi.listSupplierRFQs(companyId, rfqsCursor);
      if (
        companyRequestId.current === requestId &&
        selectedCompanyIdRef.current === companyId
      ) {
        setRfqs((current) => {
          const knownIds = new Set(current.map((item) => item.id));
          return [...current, ...nextPage.items.filter((item) => !knownIds.has(item.id))];
        });
        setRfqsCursor(nextPage.next_cursor);
        setRfqsHasMore(nextPage.has_more);
      }
    } catch (loadError) {
      if (
        companyRequestId.current === requestId &&
        selectedCompanyIdRef.current === companyId
      ) {
        setRfqsError(errorMessage(loadError));
      }
    } finally {
      if (
        companyRequestId.current === requestId &&
        selectedCompanyIdRef.current === companyId
      ) {
        setRfqsLoadingMore(false);
      }
    }
  };

  const loadSupplierRFQ = async (rfqId: string) => {
    if (!selectedCompanyId) return;
    const companyId = selectedCompanyId;
    const requestId = companyRequestId.current;
    setRfqsLoading(true);
    try {
      const rfq = await procurementApi.getSupplierRFQ(companyId, rfqId);
      if (
        companyRequestId.current === requestId &&
        selectedCompanyIdRef.current === companyId
      ) {
        setRfqs((current) => current.some((item) => item.id === rfq.id)
          ? current
          : [...current, rfq]);
      }
    } catch (loadError) {
      if (
        companyRequestId.current === requestId &&
        selectedCompanyIdRef.current === companyId
      ) {
        setRfqsError(errorMessage(loadError));
      }
    } finally {
      if (
        companyRequestId.current === requestId &&
        selectedCompanyIdRef.current === companyId
      ) {
        setRfqsLoading(false);
      }
    }
  };

  const refreshOfferings = async () => {
    if (!selectedCompanyId) return;
    const companyId = selectedCompanyId;
    const requestId = companyRequestId.current;
    const membership = companiesRef.current.find(
      (entry) => entry.company_id === companyId,
    );
    const canManage =
      membership?.role === "OWNER" || membership?.role === "ADMIN";
    setOfferingsLoading(true);
    setOfferingError("");
    try {
      const response = await apiClient.get<SupplierMaterialOffering[]>(
        `/api/v1/suppliers/companies/${companyId}/offerings`,
        {
          params: {
            include_archived:
              Boolean(canManage) && includeArchivedOfferingsRef.current,
          },
        },
      );
      if (
        companyRequestId.current === requestId &&
        selectedCompanyIdRef.current === companyId
      ) {
        setOfferings(response.data);
        setOfferingsLoaded(true);
      }
    } catch (loadError) {
      if (
        companyRequestId.current === requestId &&
        selectedCompanyIdRef.current === companyId
      ) {
        setOfferingError(errorMessage(loadError));
      }
    } finally {
      if (
        companyRequestId.current === requestId &&
        selectedCompanyIdRef.current === companyId
      ) {
        setOfferingsLoading(false);
      }
    }
  };

  const refreshSupplierSettings = async () => {
    if (!selectedCompanyId) {
      setSupplierSettingsError("Select an active supplier company to load settings.");
      return false;
    }
    setSupplierSettingsLoading(true);
    setSupplierSettingsError("");
    try {
      const settings = await procurementApi.getSupplierSettings();
      const changed =
        includeArchivedOfferingsRef.current !== settings.show_archived_offerings;
      includeArchivedOfferingsRef.current = settings.show_archived_offerings;
      setIncludeArchivedOfferingsState(settings.show_archived_offerings);
      setSupplierSettingsLoaded(true);
      if (changed) await refreshOfferings();
      return true;
    } catch (loadError) {
      setSupplierSettingsError(errorMessage(loadError));
      return false;
    } finally {
      setSupplierSettingsLoading(false);
    }
  };

  const setIncludeArchivedOfferings = async (show: boolean) => {
    if (!selectedCompanyId) {
      setSupplierSettingsError(
        "An active supplier company membership is required to save this preference.",
      );
      return false;
    }
    setSupplierSettingsSaving(true);
    setSupplierSettingsError("");
    try {
      const settings = await procurementApi.updateSupplierSettings({
        show_archived_offerings: show,
      });
      includeArchivedOfferingsRef.current = settings.show_archived_offerings;
      setIncludeArchivedOfferingsState(settings.show_archived_offerings);
      setSupplierSettingsLoaded(true);
      await refreshOfferings();
      return true;
    } catch (saveError) {
      setSupplierSettingsError(errorMessage(saveError));
      return false;
    } finally {
      setSupplierSettingsSaving(false);
    }
  };

  const acceptInvitation = async (membershipId: string) => {
    setBusyMemberId(membershipId);
    setError("");
    try {
      await apiClient.post(
        `/api/v1/suppliers/invitations/${membershipId}/accept`,
      );
      await loadMemberships();
    } catch (acceptError) {
      setError(errorMessage(acceptError));
    } finally {
      setBusyMemberId("");
    }
  };

  const respondToRfq = async (
    rfqId: string,
    status: "ACKNOWLEDGED" | "DECLINED",
    note?: string,
  ): Promise<boolean> => {
    if (!selectedCompanyId) return false;
    setRfqsError("");
    setRfqsSuccess("");
    const currentRfq = rfqs.find((rfq) => rfq.id === rfqId);
    if (!currentRfq) {
      setRfqsError("This RFQ is no longer loaded. Refresh the RFQ list before submitting.");
      return false;
    }
    try {
      const response = await procurementApi.respondToSupplierRFQ(
        selectedCompanyId,
        rfqId,
        status,
        note ? note.trim() : null,
      );
      setRfqs((current) =>
        current.map((rfq) =>
          rfq.id === rfqId
            ? {
                ...rfq,
                recipient_status: response.recipient_status,
                response_note: response.response_note,
                responded_at: response.responded_at,
              }
            : rfq,
        ),
      );
      setRfqsSuccess("Your company response was saved.");
      return true;
    } catch (responseError) {
      setRfqsError(errorMessage(responseError));
      return false;
    }
  };

  const submitQuotation = async (
    rfqId: string,
    draft: QuotationDraft,
    expectedRevision: number | null,
  ): Promise<boolean> => {
    if (!selectedCompanyId) return false;
    setRfqsError("");
    setRfqsSuccess("");
    const currentRfq = rfqs.find((rfq) => rfq.id === rfqId);
    if (!currentRfq) {
      setRfqsError("This RFQ is no longer loaded. Refresh the RFQ list before submitting.");
      return false;
    }
    try {
      const saved = await procurementApi.submitSupplierQuotation(
        selectedCompanyId,
        rfqId,
        {
          expected_rfq_updated_at: currentRfq.updated_at,
          unit_price: draft.unit_price,
          currency: draft.currency,
          quantity_offered: draft.quantity_offered,
          unit: draft.unit,
          estimated_delivery_lead_time_days: Number(
            draft.estimated_delivery_lead_time_days,
          ),
          quotation_valid_until: draft.quotation_valid_until,
          delivery_terms: draft.delivery_terms.trim(),
          notes: draft.notes.trim() || null,
          expected_revision: expectedRevision,
        },
      );
      setRfqs((current) =>
        current.map((rfq) =>
          rfq.id === rfqId
            ? {
                ...rfq,
                recipient_status: "ACKNOWLEDGED",
                responded_at: rfq.responded_at || saved.submitted_at,
                quotation: saved,
              }
            : rfq,
        ),
      );
      setRfqsSuccess("Your quotation was saved and is available to the buyer.");
      return true;
    } catch (quotationError) {
      setRfqsError(errorMessage(quotationError));
      return false;
    }
  };

  const respondToPurchaseOrder = async (
    order: ProcurementPurchaseOrder,
    orderStatus: "ACCEPTED" | "REJECTED",
  ): Promise<boolean> => {
    if (!selectedCompanyId || order.status !== "ISSUED") return false;
    setPurchaseOrderBusyId(order.id);
    setPurchaseOrdersError("");
    setPurchaseOrdersSuccess("");
    try {
      const updated = await procurementApi.respondToSupplierPurchaseOrder(
        selectedCompanyId,
        order.id,
        orderStatus,
      );
      setPurchaseOrders((current) =>
        current.map((item) => (item.id === updated.id ? updated : item)),
      );
      setPurchaseOrdersSuccess(
        `${updated.order_reference} was ${orderStatus.toLowerCase()}.`,
      );
      return true;
    } catch (responseError) {
      setPurchaseOrdersError(errorMessage(responseError));
      return false;
    } finally {
      setPurchaseOrderBusyId("");
    }
  };

  const updatePurchaseOrderFulfillment = async (
    order: ProcurementPurchaseOrder,
    draft: FulfillmentDraft,
  ): Promise<boolean> => {
    if (!selectedCompanyId) return false;
    setPurchaseOrderBusyId(order.id);
    setPurchaseOrdersError("");
    setPurchaseOrdersSuccess("");

    const payload = {
      ...draft,
      dispatched_quantity: draft.dispatched_quantity || "0",
      delivered_quantity: draft.delivered_quantity || "0",
      unit: order.unit,
      dispatch_date: draft.dispatch_date || null,
      carrier: draft.carrier?.trim() || null,
      tracking_reference: draft.tracking_reference?.trim() || null,
      estimated_delivery_date: draft.estimated_delivery_date || null,
      delivery_date: draft.delivery_date || null,
      delivery_notes: draft.delivery_notes?.trim() || null,
    };
    const signature = JSON.stringify(payload);
    let pendingSubmission = pendingFulfillmentSubmission.current;
    if (
      !pendingSubmission ||
      pendingSubmission.orderId !== order.id ||
      pendingSubmission.signature !== signature
    ) {
      pendingSubmission = {
        orderId: order.id,
        signature,
        idempotencyKey: crypto.randomUUID(),
      };
      pendingFulfillmentSubmission.current = pendingSubmission;
    }
    const update: PurchaseOrderFulfillmentUpdate = {
      ...payload,
      idempotency_key: pendingSubmission.idempotencyKey,
    };

    try {
      const updated =
        await procurementApi.updateSupplierPurchaseOrderFulfillment(
          selectedCompanyId,
          order.id,
          update,
        );
      setPurchaseOrders((current) =>
        current.map((item) => (item.id === updated.id ? updated : item)),
      );
      pendingFulfillmentSubmission.current = null;
      setPurchaseOrdersSuccess(
        `${updated.order_reference} fulfillment progress was recorded.`,
      );
      return true;
    } catch (updateError) {
      setPurchaseOrdersError(errorMessage(updateError));
      return false;
    } finally {
      setPurchaseOrderBusyId("");
    }
  };

  const saveOffering = async (
    draft: SupplierOfferingDraft,
    editingId?: string,
  ): Promise<boolean> => {
    if (!selectedCompanyId) return false;
    setOfferingError("");
    setOfferingSuccess("");
    const payload = {
      name: draft.name,
      specification: draft.specification || null,
      unit: draft.unit,
      indicative_price: draft.indicative_price || null,
      currency_code: draft.indicative_price ? draft.currency_code : null,
      minimum_order_quantity: draft.minimum_order_quantity || null,
      is_available: draft.is_available,
      service_coverage: draft.service_coverage
        .split(/\r?\n/)
        .map((area) => area.trim())
        .filter(Boolean),
    };
    try {
      let savedOffering: SupplierMaterialOffering;
      if (editingId) {
        const current = offerings.find(
          (offering) => offering.id === editingId,
        );
        if (!current) {
          setOfferingError(
            "The selected material offering is no longer available. Refresh and try again.",
          );
          return false;
        }
        const response = await apiClient.patch<SupplierMaterialOffering>(
          `/api/v1/suppliers/companies/${selectedCompanyId}/offerings/${editingId}`,
          { ...payload, expected_revision: current.revision },
        );
        savedOffering = response.data;
        setOfferingSuccess("Material offering updated.");
      } else {
        const response = await apiClient.post<SupplierMaterialOffering>(
          `/api/v1/suppliers/companies/${selectedCompanyId}/offerings`,
          payload,
        );
        savedOffering = response.data;
        setOfferingSuccess("Material offering created.");
      }
      setOfferings((current) => [
        savedOffering,
        ...current.filter((offering) => offering.id !== savedOffering.id),
      ]);
      return true;
    } catch (saveError) {
      setOfferingError(errorMessage(saveError));
      return false;
    }
  };

  const archiveOffering = async (
    offering: SupplierMaterialOffering,
  ): Promise<boolean> => {
    if (!selectedCompanyId) return false;
    setOfferingError("");
    setOfferingSuccess("");
    try {
      const response = await apiClient.delete<SupplierMaterialOffering>(
        `/api/v1/suppliers/companies/${selectedCompanyId}/offerings/${offering.id}`,
        { params: { expected_revision: offering.revision } },
      );
      setOfferings((current) => [
        response.data,
        ...current.filter((entry) => entry.id !== offering.id),
      ]);
      setOfferingSuccess(`"${offering.name}" was archived.`);
      return true;
    } catch (archiveError) {
      setOfferingError(errorMessage(archiveError));
      return false;
    }
  };

  const createCompany = async (draft: CompanyDraft): Promise<boolean> => {
    setError("");
    try {
      const payload = Object.fromEntries(
        Object.entries(draft).map(([key, value]) => [
          key,
          value.trim() || null,
        ]),
      );
      const response = await apiClient.post<SupplierCompany>(
        "/api/v1/suppliers/companies",
        payload,
      );
      await loadMemberships();
      setSelectedCompanyId(response.data.id);
      return true;
    } catch (saveError) {
      setError(errorMessage(saveError));
      return false;
    }
  };

  const updateCompanyProfile = async (
    draft: SupplierCompanyProfileDraft,
  ): Promise<boolean> => {
    if (!selectedCompanyId) return false;
    setError("");
    try {
      const response = await apiClient.patch<SupplierCompany>(
        `/api/v1/suppliers/companies/${selectedCompanyId}`,
        {
          name: draft.name.trim(),
          description: draft.description.trim() || null,
          website: draft.website.trim() || null,
        },
      );
      setCompanies((current) =>
        current.map((membership) =>
          membership.company_id === selectedCompanyId
            ? { ...membership, company_name: response.data.name }
            : membership,
        ),
      );
      await loadCompany(selectedCompanyId);
      return true;
    } catch (saveError) {
      setError(errorMessage(saveError));
      return false;
    }
  };

  const updateCompanyPrivateProfile = async (
    draft: SupplierCompanyPrivateProfileDraft,
  ): Promise<boolean> => {
    if (!selectedCompanyId) return false;
    setError("");
    try {
      await apiClient.patch(
        `/api/v1/suppliers/companies/${selectedCompanyId}/private-profile`,
        {
          registered_name: draft.registered_name.trim() || null,
          registration_number: draft.registration_number.trim() || null,
          contact_email: draft.contact_email.trim() || null,
          contact_phone: draft.contact_phone.trim() || null,
          registered_address: draft.registered_address.trim() || null,
        },
      );
      await loadCompany(selectedCompanyId);
      return true;
    } catch (saveError) {
      setError(errorMessage(saveError));
      return false;
    }
  };

  const inviteMember = async (
    email: string,
    role: "ADMIN" | "MEMBER",
  ): Promise<boolean> => {
    if (!selectedCompanyId) return false;
    setError("");
    try {
      await apiClient.post(
        `/api/v1/suppliers/companies/${selectedCompanyId}/members`,
        {
          email,
          role,
        },
      );
      await loadCompany(selectedCompanyId);
      return true;
    } catch (inviteError) {
      setError(errorMessage(inviteError));
      return false;
    }
  };

  const changeMemberRole = async (
    member: SupplierMember,
    role: "ADMIN" | "MEMBER",
  ): Promise<boolean> => {
    if (!selectedCompanyId) return false;
    setBusyMemberId(member.id);
    setError("");
    try {
      await apiClient.patch(
        `/api/v1/suppliers/companies/${selectedCompanyId}/members/${member.id}`,
        { role },
      );
      await loadCompany(selectedCompanyId);
      return true;
    } catch (updateError) {
      setError(errorMessage(updateError));
      return false;
    } finally {
      setBusyMemberId("");
    }
  };

  const revokeMember = async (member: SupplierMember): Promise<boolean> => {
    if (!selectedCompanyId) return false;
    setBusyMemberId(member.id);
    setError("");
    try {
      await apiClient.delete(
        `/api/v1/suppliers/companies/${selectedCompanyId}/members/${member.id}`,
      );
      await loadCompany(selectedCompanyId);
      return true;
    } catch (revokeError) {
      setError(errorMessage(revokeError));
      return false;
    } finally {
      setBusyMemberId("");
    }
  };

  const transferOwnership = async (
    member: SupplierMember,
  ): Promise<boolean> => {
    if (!selectedCompanyId) return false;
    setBusyMemberId(member.id);
    setError("");
    try {
      await apiClient.post(
        `/api/v1/suppliers/companies/${selectedCompanyId}/transfer-ownership`,
        {
          new_owner_membership_id: member.id,
        },
      );
      await loadMemberships();
      await loadCompany(selectedCompanyId);
      return true;
    } catch (transferError) {
      setError(errorMessage(transferError));
      return false;
    } finally {
      setBusyMemberId("");
    }
  };

  const uploadVerificationDocument = async (
    documentType: string,
    file: File,
  ): Promise<boolean> => {
    if (!selectedCompanyId) return false;
    setVerificationBusy(true);
    setError("");
    try {
      const body = new FormData();
      body.set("document_type", documentType);
      body.set("file", file);
      await apiClient.post(
        `/api/v1/suppliers/companies/${selectedCompanyId}/verification/documents`,
        body,
        { headers: { "Content-Type": "multipart/form-data" } },
      );
      await loadCompany(selectedCompanyId);
      return true;
    } catch (uploadError) {
      setError(errorMessage(uploadError));
      return false;
    } finally {
      setVerificationBusy(false);
    }
  };

  const submitVerification = async (): Promise<boolean> => {
    if (!selectedCompanyId) return false;
    setVerificationBusy(true);
    setError("");
    try {
      await apiClient.post(
        `/api/v1/suppliers/companies/${selectedCompanyId}/verification/submit`,
      );
      await Promise.all([loadCompany(selectedCompanyId), loadMemberships()]);
      return true;
    } catch (submitError) {
      setError(errorMessage(submitError));
      return false;
    } finally {
      setVerificationBusy(false);
    }
  };

  const viewVerificationDocument = async (
    document: VerificationDocument,
  ): Promise<void> => {
    if (!selectedCompanyId) return;
    setError("");
    try {
      const response = await apiClient.get<{ url: string }>(
        `/api/v1/suppliers/companies/${selectedCompanyId}/verification/documents/${document.id}/url`,
      );
      window.open(response.data.url, "_blank", "noopener,noreferrer");
    } catch (viewError) {
      setError(errorMessage(viewError));
    }
  };

  const canManageMembers =
    company?.role === "OWNER" || company?.role === "ADMIN";
  const selectedMembership = companies.find(
    (entry) => entry.company_id === selectedCompanyId,
  );

  return (
    <SupplierContext.Provider
      value={{
        companies,
        selectedCompanyId,
        setSelectedCompanyId,
        selectedMembership,
        company,
        companyDataId,
        canManageMembers,
        loading,
        error,
        setError,
        invitations,
        invitationsError,
        busyMemberId,
        acceptInvitation,
        refreshWorkspace,
        loadCompany,
        rfqs,
        rfqsLoading,
        rfqsHasMore,
        rfqsLoadingMore,
        rfqsError,
        rfqsSuccess,
        setRfqsError,
        setRfqsSuccess,
        refreshRFQs,
        loadMoreRFQs,
        loadSupplierRFQ,
        respondToRfq,
        submitQuotation,
        purchaseOrders,
        purchaseOrdersLoading,
        purchaseOrdersLoaded,
        purchaseOrdersError,
        purchaseOrdersSuccess,
        purchaseOrderBusyId,
        setPurchaseOrdersError,
        setPurchaseOrdersSuccess,
        refreshPurchaseOrders,
        respondToPurchaseOrder,
        updatePurchaseOrderFulfillment,
        offerings,
        offeringsLoading,
        offeringsLoaded,
        offeringsError,
        offeringsSuccess,
        includeArchivedOfferings,
        supplierSettingsLoaded,
        supplierSettingsLoading,
        supplierSettingsSaving,
        supplierSettingsError,
        setIncludeArchivedOfferings,
        refreshSupplierSettings,
        setOfferingError,
        setOfferingSuccess,
        refreshOfferings,
        saveOffering,
        archiveOffering,
        members,
        membersLoaded,
        membersError,
        verificationDocuments,
        verificationDocumentsLoaded,
        verificationError,
        verificationBusy,
        companyError,
        createCompany,
        updateCompanyProfile,
        updateCompanyPrivateProfile,
        inviteMember,
        changeMemberRole,
        revokeMember,
        transferOwnership,
        uploadVerificationDocument,
        submitVerification,
        viewVerificationDocument,
      }}
    >
      {children}
    </SupplierContext.Provider>
  );
}
