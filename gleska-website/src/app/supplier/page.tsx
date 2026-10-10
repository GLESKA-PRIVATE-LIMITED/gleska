"use client";

import React, { useCallback, useEffect, useState } from "react";
import type { FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { isAxiosError } from "axios";
import { Archive, Building2, CheckCircle2, ClipboardList, Clock3, FileText, Loader2, Menu, Package, Pencil, Plus, RefreshCw, UserPlus, Users, X } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import apiClient from "@/lib/api";
import AgentSidebar from "@/components/agent-dashboard/AgentSidebar";
import { procurementConfig } from "@/components/agents/procurement/procurementConfig";
import {
  ProcurementUnit,
  SupplierQuotation,
  SupplierRFQ,
  procurementApi,
} from "@/lib/procurement-api";

type CompanyRole = "OWNER" | "ADMIN" | "MEMBER";
type MembershipStatus = "ACTIVE" | "PENDING" | "REVOKED";
type VerificationStatus = "NOT_SUBMITTED" | "PENDING_REVIEW" | "VERIFIED" | "REJECTED" | "SUSPENDED";

interface CompanyMembership {
  id: string;
  company_id: string;
  company_name: string;
  role: CompanyRole;
  status: MembershipStatus;
  created_at: string;
  verification_status?: VerificationStatus | null;
}

interface SupplierCompany {
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

interface VerificationDocument {
  id: string;
  company_id: string;
  document_type: string;
  original_filename: string;
  mime_type: string;
  file_size_bytes: number;
  uploaded_at: string;
}

interface SupplierMember {
  id: string;
  name: string | null;
  invited_email: string | null;
  role: CompanyRole;
  status: MembershipStatus;
  created_at: string;
}

interface SupplierMaterialOffering {
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

interface SupplierOfferingDraft {
  name: string;
  specification: string;
  unit: string;
  indicative_price: string;
  currency_code: string;
  minimum_order_quantity: string;
  is_available: boolean;
  service_coverage: string;
}

interface QuotationDraft {
  unit_price: string;
  currency: SupplierQuotation["currency"];
  quantity_offered: string;
  unit: ProcurementUnit;
  estimated_delivery_lead_time_days: string;
  quotation_valid_until: string;
  delivery_terms: string;
  notes: string;
}

const quotationUnits: ProcurementUnit[] = [
  "MT", "Bags", "Pieces", "Kg", "Tons", "Meters", "Sq. ft", "Boxes", "Liters",
];

function localDateString(value = new Date()): string {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function quotationDateDefault(): string {
  const value = new Date();
  value.setDate(value.getDate() + 30);
  return localDateString(value);
}

function quotationDraftFrom(
  quotation: SupplierQuotation | null,
  rfq: SupplierRFQ,
): QuotationDraft {
  return {
    unit_price: quotation ? String(quotation.unit_price) : "",
    currency: quotation?.currency || "INR",
    quantity_offered: quotation ? String(quotation.quantity_offered) : String(rfq.quantity),
    unit: quotation?.unit || (quotationUnits.includes(rfq.unit as ProcurementUnit)
      ? rfq.unit as ProcurementUnit
      : "MT"),
    estimated_delivery_lead_time_days: quotation
      ? String(quotation.estimated_delivery_lead_time_days)
      : "7",
    quotation_valid_until: quotation?.quotation_valid_until || quotationDateDefault(),
    delivery_terms: quotation?.delivery_terms || "",
    notes: quotation?.notes || "",
  };
}

const emptyOfferingDraft: SupplierOfferingDraft = {
  name: "",
  specification: "",
  unit: "",
  indicative_price: "",
  currency_code: "",
  minimum_order_quantity: "",
  is_available: true,
  service_coverage: "",
};

interface CompanyDraft {
  name: string;
  description: string;
  website: string;
  registered_name: string;
  registration_number: string;
  contact_email: string;
  contact_phone: string;
  registered_address: string;
}

const emptyCompanyDraft: CompanyDraft = {
  name: "",
  description: "",
  website: "",
  registered_name: "",
  registration_number: "",
  contact_email: "",
  contact_phone: "",
  registered_address: "",
};

function errorMessage(error: unknown): string {
  if (isAxiosError<{ detail?: unknown }>(error)) {
    const detail = error.response?.data?.detail;
    if (detail !== undefined && typeof detail !== "string") {
      return "Check the submitted fields and try again.";
    }
    const messages: Record<string, string> = {
      SUPPLIER_COMPANY_MEMBERSHIP_NOT_FOUND: "You do not have active membership in that supplier company.",
      SUPPLIER_COMPANY_NOT_OPERATIONAL: "This supplier company is suspended or archived. Contact an authorized GLESKA administrator.",
      VERIFIED_EMAIL_REQUIRED_TO_ACCEPT_SUPPLIER_INVITATION: "Confirm your account email before accepting this invitation.",
      SUPPLIER_INVITATION_NOT_FOUND: "This invitation is no longer available for your verified account.",
      SUPPLIER_MEMBER_MANAGEMENT_FORBIDDEN: "Your company role does not allow member management.",
      SUPPLIER_OWNER_REQUIRED: "Only the current company owner can transfer ownership.",
      SUPPLIER_MEMBERSHIP_CONFLICT: "That account already has a company invitation or membership.",
      SUPPLIER_DOCUMENT_UPLOAD_NOT_ALLOWED: "Documents cannot be changed while this verification is under review.",
      SUPPLIER_VERIFICATION_DOCUMENT_REQUIRED: "Upload at least one verification document before submitting.",
      SUPPLIER_VERIFICATION_SUBMISSION_NOT_ALLOWED: "This verification cannot be submitted in its current status.",
      SUPPLIER_VERIFICATION_SUBMISSION_FORBIDDEN: "Only an active company owner or admin can submit verification.",
      SUPPLIER_VERIFICATION_MANAGEMENT_FORBIDDEN: "Only active company owners and admins can manage verification documents.",
      SUPPLIER_DOCUMENT_SIZE_INVALID: "Choose a document no larger than 10 MB.",
      SUPPLIER_DOCUMENT_TYPE_INVALID: "Upload a PDF, JPEG, or PNG whose extension matches its file type.",
      SUPPLIER_DOCUMENT_CONTENT_INVALID: "The selected file does not match its declared file type.",
      SUPPLIER_OFFERING_MANAGEMENT_FORBIDDEN: "Only active company owners and admins can change material offerings.",
      SUPPLIER_OFFERING_WRITE_NOT_ALLOWED: "Only an active company owner or admin can change offerings for an operational company.",
      SUPPLIER_OFFERING_INVALID: "Check the material offering fields, including price and currency, and try again.",
      SUPPLIER_OFFERING_NOT_FOUND: "That material offering was not found in this company.",
      SUPPLIER_OFFERING_ARCHIVED: "That material offering is archived and cannot be edited.",
      SUPPLIER_OFFERING_STALE: "This material offering changed on the server. Refresh the list before editing it.",
      SUPPLIER_OFFERING_LIST_FAILED: "Material offerings could not be loaded. Check that migration 074 is applied, then refresh.",
      SUPPLIER_OFFERING_CREATE_FAILED: "The material offering could not be created.",
      SUPPLIER_OFFERING_UPDATE_FAILED: "The material offering could not be updated.",
      SUPPLIER_OFFERING_ARCHIVE_FAILED: "The material offering could not be archived.",
      RFQ_LIST_FAILED: "The RFQ inbox could not be loaded. Check that migrations 076 and 077 are applied, then refresh.",
      RFQ_LOAD_FAILED: "The RFQ could not be loaded. Refresh the Supplier Workspace.",
      RFQ_NOT_FOUND: "This RFQ is no longer available to this company.",
      RFQ_CLOSED: "This RFQ deadline has passed; responses are closed.",
      RFQ_ALREADY_RESPONDED: "Your company has already responded to this invitation.",
      RFQ_RESPONSE_FAILED: "Your response could not be saved. Please retry; if this persists, confirm migration 076 has been applied.",
      RFQ_INVITATION_DECLINED: "Your company declined this invitation and can no longer submit a quotation.",
      QUOTATION_STALE: "This quotation changed since you opened it. Refresh the RFQ before editing.",
      QUOTATION_VALIDITY_INVALID: "The quotation validity date cannot be in the past.",
      QUOTATION_INVALID: "Check the price, currency, quantity, unit, dates, and text lengths.",
      QUOTATION_SUBMISSION_FAILED: "Your quotation could not be saved. Please try again.",
    };
    return (detail && messages[detail]) || detail || "The supplier workspace could not complete that request.";
  }
  return "The supplier workspace could not complete that request.";
}

export default function SupplierWorkspacePage() {
  const router = useRouter();
  const { user, isLoading } = useAuth();
  const [companies, setCompanies] = useState<CompanyMembership[]>([]);
  const [invitations, setInvitations] = useState<CompanyMembership[]>([]);
  const [company, setCompany] = useState<SupplierCompany | null>(null);
  const [members, setMembers] = useState<SupplierMember[]>([]);
  const [verificationDocuments, setVerificationDocuments] = useState<VerificationDocument[]>([]);
  const [offerings, setOfferings] = useState<SupplierMaterialOffering[]>([]);
  const [rfqs, setRfqs] = useState<SupplierRFQ[]>([]);
  const [rfqsLoading, setRfqsLoading] = useState(false);
  const [rfqsError, setRfqsError] = useState("");
  const [rfqsSuccess, setRfqsSuccess] = useState("");
  const [selectedRfqId, setSelectedRfqId] = useState("");
  const [rfqResponseNote, setRfqResponseNote] = useState("");
  const [rfqBusy, setRfqBusy] = useState(false);
  const [quotationDraft, setQuotationDraft] = useState<QuotationDraft | null>(null);
  const [quotationFormOpen, setQuotationFormOpen] = useState(false);
  const [quotationReview, setQuotationReview] = useState(false);
  const [quotationBusy, setQuotationBusy] = useState(false);
  const [offeringDraft, setOfferingDraft] = useState<SupplierOfferingDraft>(emptyOfferingDraft);
  const [editingOfferingId, setEditingOfferingId] = useState("");
  const [includeArchivedOfferings, setIncludeArchivedOfferings] = useState(true);
  const [offeringsLoading, setOfferingsLoading] = useState(false);
  const [offeringBusy, setOfferingBusy] = useState(false);
  const [offeringError, setOfferingError] = useState("");
  const [offeringSuccess, setOfferingSuccess] = useState("");
  const [selectedCompanyId, setSelectedCompanyId] = useState("");
  const [companyDraft, setCompanyDraft] = useState<CompanyDraft>(emptyCompanyDraft);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"ADMIN" | "MEMBER">("MEMBER");
  const [verificationDocumentType, setVerificationDocumentType] = useState("BUSINESS_REGISTRATION");
  const [verificationFile, setVerificationFile] = useState<File | null>(null);
  const [verificationBusy, setVerificationBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [busyMemberId, setBusyMemberId] = useState("");
  const [error, setError] = useState("");
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);

  const loadMemberships = useCallback(async () => {
    const [companyResponse, invitationResponse] = await Promise.all([
      apiClient.get<CompanyMembership[]>("/api/v1/suppliers/companies"),
      apiClient.get<CompanyMembership[]>("/api/v1/suppliers/invitations"),
    ]);
    const nextCompanies = companyResponse.data;
    setCompanies(nextCompanies);
    setInvitations(invitationResponse.data);
    setSelectedCompanyId((current) =>
      nextCompanies.some((entry) => entry.company_id === current)
        ? current
        : nextCompanies[0]?.company_id || "",
    );
  }, []);

  const loadCompany = useCallback(async (companyId: string) => {
    if (!companyId) {
      setCompany(null);
      setMembers([]);
      setVerificationDocuments([]);
      setOfferings([]);
      setRfqs([]);
      setSelectedRfqId("");
      setRfqsError("");
      setOfferingError("");
      return;
    }
    const [companyResponse, membersResponse] = await Promise.all([
      apiClient.get<SupplierCompany>(`/api/v1/suppliers/companies/${companyId}`),
      apiClient.get<SupplierMember[]>(`/api/v1/suppliers/companies/${companyId}/members`),
    ]);
    setCompany(companyResponse.data);
    setMembers(membersResponse.data);
    if (companyResponse.data.role === "OWNER" || companyResponse.data.role === "ADMIN") {
      const documentsResponse = await apiClient.get<VerificationDocument[]>(
        `/api/v1/suppliers/companies/${companyId}/verification/documents`,
      );
      setVerificationDocuments(documentsResponse.data);
    } else {
      setVerificationDocuments([]);
    }
    setOfferingsLoading(true);
    setOfferingError("");
    try {
      const includeArchived = companyResponse.data.role === "OWNER" || companyResponse.data.role === "ADMIN";
      const offeringsResponse = await apiClient.get<SupplierMaterialOffering[]>(
        `/api/v1/suppliers/companies/${companyId}/offerings`,
        { params: { include_archived: includeArchived } },
      );
      setOfferings(offeringsResponse.data);
    } catch (offeringLoadError) {
      setOfferings([]);
      setOfferingError(errorMessage(offeringLoadError));
    } finally {
      setOfferingsLoading(false);
    }
    setRfqsLoading(true);
    setRfqsError("");
    try {
      const nextRfqs = await procurementApi.listSupplierRFQs(companyId);
      setRfqs(nextRfqs);
      setSelectedRfqId((current) =>
        nextRfqs.some((rfq) => rfq.id === current) ? current : nextRfqs[0]?.id || "",
      );
    } catch (rfqLoadError) {
      setRfqs([]);
      setSelectedRfqId("");
      setRfqsError(errorMessage(rfqLoadError));
    } finally {
      setRfqsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isLoading) return;
    if (!user) {
      router.replace(`/auth/signin?next=${encodeURIComponent("/supplier")}`);
      return;
    }
    setLoading(true);
    setError("");
    void loadMemberships()
      .catch((loadError: unknown) => setError(errorMessage(loadError)))
      .finally(() => setLoading(false));
  }, [isLoading, loadMemberships, router, user]);

  useEffect(() => {
    if (!user || !selectedCompanyId) {
      setCompany(null);
      setMembers([]);
      setOfferings([]);
      setRfqs([]);
      setRfqsLoading(false);
      setRfqsError("");
      setRfqsSuccess("");
      setSelectedRfqId("");
      setOfferingsLoading(false);
      setOfferingError("");
      setOfferingSuccess("");
      setEditingOfferingId("");
      setOfferingDraft(emptyOfferingDraft);
      return;
    }
    setOfferings([]);
    setOfferingError("");
    setError("");
    setOfferingSuccess("");
    setEditingOfferingId("");
    setOfferingDraft(emptyOfferingDraft);
    void loadCompany(selectedCompanyId).catch((loadError: unknown) => {
      setCompany(null);
      setMembers([]);
      setOfferingsLoading(false);
      setError(errorMessage(loadError));
    });
  }, [loadCompany, selectedCompanyId, user]);

  useEffect(() => {
    const selected = rfqs.find((rfq) => rfq.id === selectedRfqId);
    setQuotationDraft(selected ? quotationDraftFrom(selected.quotation, selected) : null);
    setQuotationFormOpen(false);
    setQuotationReview(false);
    setRfqsError("");
  }, [rfqs, selectedCompanyId, selectedRfqId]);

  const refreshWorkspace = async () => {
    setError("");
    try {
      await loadMemberships();
      if (selectedCompanyId) await loadCompany(selectedCompanyId);
    } catch (loadError) {
      setError(errorMessage(loadError));
    }
  };

  const createCompany = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      const payload = Object.fromEntries(
        Object.entries(companyDraft).map(([key, value]) => [key, value.trim() || null]),
      );
      const response = await apiClient.post<SupplierCompany>("/api/v1/suppliers/companies", payload);
      await loadMemberships();
      setSelectedCompanyId(response.data.id);
      setCompanyDraft(emptyCompanyDraft);
    } catch (saveError) {
      setError(errorMessage(saveError));
    } finally {
      setSaving(false);
    }
  };

  const acceptInvitation = async (membershipId: string) => {
    setBusyMemberId(membershipId);
    setError("");
    try {
      await apiClient.post(`/api/v1/suppliers/invitations/${membershipId}/accept`);
      await loadMemberships();
    } catch (acceptError) {
      setError(errorMessage(acceptError));
    } finally {
      setBusyMemberId("");
    }
  };

  const inviteMember = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selectedCompanyId) return;
    setSaving(true);
    setError("");
    try {
      await apiClient.post(`/api/v1/suppliers/companies/${selectedCompanyId}/members`, {
        email: inviteEmail,
        role: inviteRole,
      });
      setInviteEmail("");
      await loadCompany(selectedCompanyId);
    } catch (inviteError) {
      setError(errorMessage(inviteError));
    } finally {
      setSaving(false);
    }
  };

  const changeMemberRole = async (member: SupplierMember, role: "ADMIN" | "MEMBER") => {
    if (!selectedCompanyId) return;
    setBusyMemberId(member.id);
    setError("");
    try {
      await apiClient.patch(`/api/v1/suppliers/companies/${selectedCompanyId}/members/${member.id}`, { role });
      await loadCompany(selectedCompanyId);
    } catch (updateError) {
      setError(errorMessage(updateError));
    } finally {
      setBusyMemberId("");
    }
  };

  const revokeMember = async (member: SupplierMember) => {
    if (!selectedCompanyId || !window.confirm("Revoke this supplier company membership?")) return;
    setBusyMemberId(member.id);
    setError("");
    try {
      await apiClient.delete(`/api/v1/suppliers/companies/${selectedCompanyId}/members/${member.id}`);
      await loadCompany(selectedCompanyId);
    } catch (revokeError) {
      setError(errorMessage(revokeError));
    } finally {
      setBusyMemberId("");
    }
  };

  const transferOwnership = async (member: SupplierMember) => {
    if (!selectedCompanyId || !window.confirm(`Transfer company ownership to ${member.name || member.invited_email}? You will become an admin.`)) return;
    setBusyMemberId(member.id);
    setError("");
    try {
      await apiClient.post(`/api/v1/suppliers/companies/${selectedCompanyId}/transfer-ownership`, {
        new_owner_membership_id: member.id,
      });
      await loadMemberships();
      await loadCompany(selectedCompanyId);
    } catch (transferError) {
      setError(errorMessage(transferError));
    } finally {
      setBusyMemberId("");
    }
  };

  const uploadVerificationDocument = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selectedCompanyId || !verificationFile) return;
    setVerificationBusy(true);
    setError("");
    try {
      const body = new FormData();
      body.set("document_type", verificationDocumentType);
      body.set("file", verificationFile);
      await apiClient.post(
        `/api/v1/suppliers/companies/${selectedCompanyId}/verification/documents`,
        body,
        { headers: { "Content-Type": "multipart/form-data" } },
      );
      setVerificationFile(null);
      await loadCompany(selectedCompanyId);
    } catch (uploadError) {
      setError(errorMessage(uploadError));
    } finally {
      setVerificationBusy(false);
    }
  };

  const submitVerification = async () => {
    if (!selectedCompanyId) return;
    setVerificationBusy(true);
    setError("");
    try {
      await apiClient.post(`/api/v1/suppliers/companies/${selectedCompanyId}/verification/submit`);
      await Promise.all([loadCompany(selectedCompanyId), loadMemberships()]);
    } catch (submitError) {
      setError(errorMessage(submitError));
    } finally {
      setVerificationBusy(false);
    }
  };

  const viewVerificationDocument = async (document: VerificationDocument) => {
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

  const saveOffering = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selectedCompanyId) return;
    setOfferingBusy(true);
    setOfferingError("");
    setOfferingSuccess("");
    const payload = {
      name: offeringDraft.name,
      specification: offeringDraft.specification || null,
      unit: offeringDraft.unit,
      indicative_price: offeringDraft.indicative_price || null,
      currency_code: offeringDraft.indicative_price ? offeringDraft.currency_code : null,
      minimum_order_quantity: offeringDraft.minimum_order_quantity || null,
      is_available: offeringDraft.is_available,
      service_coverage: offeringDraft.service_coverage
        .split(/\r?\n/)
        .map((area) => area.trim())
        .filter(Boolean),
    };
    try {
      let savedOffering: SupplierMaterialOffering;
      if (editingOfferingId) {
        const current = offerings.find((offering) => offering.id === editingOfferingId);
        if (!current) {
          setOfferingError("The selected material offering is no longer available. Refresh and try again.");
          return;
        }
        const response = await apiClient.patch<SupplierMaterialOffering>(
          `/api/v1/suppliers/companies/${selectedCompanyId}/offerings/${editingOfferingId}`,
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
      setOfferingDraft(emptyOfferingDraft);
      setEditingOfferingId("");
    } catch (saveError) {
      setOfferingError(errorMessage(saveError));
    } finally {
      setOfferingBusy(false);
    }
  };

  const editOffering = (offering: SupplierMaterialOffering) => {
    setEditingOfferingId(offering.id);
    setOfferingDraft({
      name: offering.name,
      specification: offering.specification || "",
      unit: offering.unit,
      indicative_price: offering.indicative_price || "",
      currency_code: offering.currency_code || "",
      minimum_order_quantity: offering.minimum_order_quantity || "",
      is_available: offering.is_available,
      service_coverage: offering.service_coverage.join("\n"),
    });
    setOfferingError("");
    setOfferingSuccess("");
  };

  const archiveOffering = async (offering: SupplierMaterialOffering) => {
    if (!selectedCompanyId || !window.confirm(`Archive "${offering.name}"? It will no longer be available for future discovery.`)) {
      return;
    }
    setOfferingBusy(true);
    setOfferingError("");
    setOfferingSuccess("");
    try {
      const response = await apiClient.delete<SupplierMaterialOffering>(
        `/api/v1/suppliers/companies/${selectedCompanyId}/offerings/${offering.id}`,
        { params: { expected_revision: offering.revision } },
      );
      setOfferings((current) => [
        response.data,
        ...current.filter((currentOffering) => currentOffering.id !== offering.id),
      ]);
      setOfferingSuccess(`"${offering.name}" was archived.`);
      if (editingOfferingId === offering.id) {
        setEditingOfferingId("");
        setOfferingDraft(emptyOfferingDraft);
      }
    } catch (archiveError) {
      setOfferingError(errorMessage(archiveError));
    } finally {
      setOfferingBusy(false);
    }
  };

  const respondToRfq = async (responseStatus: "ACKNOWLEDGED" | "DECLINED") => {
    if (!selectedCompanyId || !selectedRfq || rfqBusy) return;
    setRfqBusy(true);
    setRfqsError("");
    setRfqsSuccess("");
    try {
      const response = await procurementApi.respondToSupplierRFQ(
        selectedCompanyId,
        selectedRfq.id,
        responseStatus,
        rfqResponseNote.trim() || null,
      );
      setRfqs((current) => current.map((rfq) => rfq.id === selectedRfq.id
        ? {
            ...rfq,
            recipient_status: response.recipient_status,
            response_note: response.response_note,
            responded_at: response.responded_at,
          }
        : rfq));
      setRfqResponseNote("");
      setRfqsSuccess("Your company response was saved.");
    } catch (responseError) {
      setRfqsError(errorMessage(responseError));
    } finally {
      setRfqBusy(false);
    }
  };

  const reviewQuotation = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selectedRfq || !quotationDraft || !canSubmitQuotation) return;
    if (
      Number(quotationDraft.unit_price) < 0
      || !Number.isFinite(Number(quotationDraft.unit_price))
      || Number(quotationDraft.quantity_offered) <= 0
      || !Number.isFinite(Number(quotationDraft.quantity_offered))
      || !Number.isInteger(Number(quotationDraft.estimated_delivery_lead_time_days))
      || quotationDraft.quotation_valid_until < localDateString()
    ) {
      setRfqsError("Check price, positive quantity, delivery lead time and quotation validity date.");
      return;
    }
    setRfqsError("");
    setQuotationReview(true);
  };

  const submitQuotation = async () => {
    if (!selectedCompanyId || !selectedRfq || !quotationDraft || !canSubmitQuotation || quotationBusy) return;
    setQuotationBusy(true);
    setRfqsError("");
    setRfqsSuccess("");
    try {
      const saved = await procurementApi.submitSupplierQuotation(
        selectedCompanyId,
        selectedRfq.id,
        {
          unit_price: quotationDraft.unit_price,
          currency: quotationDraft.currency,
          quantity_offered: quotationDraft.quantity_offered,
          unit: quotationDraft.unit,
          estimated_delivery_lead_time_days: Number(quotationDraft.estimated_delivery_lead_time_days),
          quotation_valid_until: quotationDraft.quotation_valid_until,
          delivery_terms: quotationDraft.delivery_terms.trim(),
          notes: quotationDraft.notes.trim() || null,
          expected_revision: selectedRfq.quotation?.revision ?? null,
        },
      );
      setRfqs((current) => current.map((rfq) => rfq.id === selectedRfq.id
        ? {
            ...rfq,
            recipient_status: "ACKNOWLEDGED",
            responded_at: rfq.responded_at || saved.submitted_at,
            quotation: saved,
          }
        : rfq));
      setQuotationReview(false);
      setRfqsSuccess("Your quotation was saved and is available to the buyer.");
    } catch (quotationError) {
      setRfqsError(errorMessage(quotationError));
    } finally {
      setQuotationBusy(false);
    }
  };

  const cancelOfferingEdit = () => {
    setEditingOfferingId("");
    setOfferingDraft(emptyOfferingDraft);
    setOfferingError("");
    setOfferingSuccess("");
  };

  if (isLoading || loading || !user) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#eef1fb] dark:bg-slate-950">
        <div className="flex items-center gap-3 text-sm font-medium text-slate-600 dark:text-slate-300">
          <Loader2 className="animate-spin" size={20} />
          Loading supplier workspace...
        </div>
      </div>
    );
  }

  const canManageMembers = company?.role === "OWNER" || company?.role === "ADMIN";
  const selectedRfq = rfqs.find((rfq) => rfq.id === selectedRfqId) || null;
  const canSubmitQuotation = Boolean(
    selectedRfq
    && selectedRfq.recipient_status !== "DECLINED"
    && selectedRfq.status === "OPEN"
    && new Date(selectedRfq.quotation_deadline).getTime() > Date.now(),
  );
  const canRespondToRfq = Boolean(
    selectedRfq
    && selectedRfq.recipient_status === "INVITED"
    && selectedRfq.status === "OPEN"
    && new Date(selectedRfq.quotation_deadline).getTime() > Date.now(),
  );
  const visibleOfferings = offerings.filter(
    (offering) => includeArchivedOfferings || !offering.archived_at,
  );

  return (
    <div className="min-h-screen bg-[#eef1fb] font-sans text-slate-900 dark:bg-slate-950 dark:text-slate-100 flex">
      {/* Mobile Header Bar — mirrors AgentLayout */}
      <div className="md:hidden fixed top-0 left-0 right-0 z-40 flex items-center justify-between border-b border-slate-200/80 bg-white/90 px-4 py-3 shadow-sm backdrop-blur-md dark:border-slate-800 dark:bg-slate-900/90">
        <Link href="/" className="flex items-center gap-2">
          <img src="/favicon.ico" alt="GO LESKA" className="h-7 w-7 rounded-md" />
          <span className="font-[var(--font-anton)] text-lg uppercase tracking-wide text-slate-900 dark:text-white">
            {procurementConfig.agentName}
          </span>
        </Link>
        <button
          onClick={() => setMobileSidebarOpen(!mobileSidebarOpen)}
          className="rounded-lg p-2 text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
          aria-label="Toggle Navigation Menu"
        >
          {mobileSidebarOpen ? <X size={22} /> : <Menu size={22} />}
        </button>
      </div>

      {/* Sidebar — same component as Procurement dashboard, active item = provide-procurement */}
      <AgentSidebar
        config={procurementConfig}
        activeTab="provide-procurement"
        setActiveTab={() => undefined}
        isCollapsed={isCollapsed}
        setIsCollapsed={setIsCollapsed}
        mobileSidebarOpen={mobileSidebarOpen}
        setMobileSidebarOpen={setMobileSidebarOpen}
      />

      {/* Main Content — same margin / padding as AgentLayout */}
      <main
        className={`flex-1 transition-all duration-300 min-h-screen pt-20 md:pt-8 p-6 sm:p-10 lg:p-12 ${
          isCollapsed ? "md:ml-20" : "md:ml-64"
        }`}
      >
        <div className="mx-auto max-w-5xl space-y-6">
          {/* Page header */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-purple-100 text-purple-700 dark:bg-purple-950/60 dark:text-purple-300">
                <Package size={18} />
              </div>
              <div>
                <p className="text-[10px] font-bold uppercase tracking-widest text-purple-600 dark:text-purple-400">
                  Provide Procurement
                </p>
                <h1 className="text-lg font-bold leading-tight text-slate-900 dark:text-white">
                  Supplier Workspace
                </h1>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {user.role === "EMPLOYER" && (
                <Link
                  href="/procurement"
                  className="inline-flex min-h-9 items-center rounded-xl border border-slate-300 px-3 py-2 text-sm font-semibold transition hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800"
                >
                  Procurement Dashboard
                </Link>
              )}
              {user.role === "EMPLOYER" && (
                <Link
                  href="/employer/dashboard"
                  className="inline-flex min-h-9 items-center rounded-xl border border-slate-300 px-3 py-2 text-sm font-semibold transition hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800"
                >
                  Employer workspace
                </Link>
              )}
              <button
                type="button"
                onClick={() => void refreshWorkspace()}
                className="inline-flex min-h-9 items-center gap-2 rounded-xl border border-slate-300 px-3 py-2 text-sm font-semibold transition hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800"
              >
                <RefreshCw size={15} />
                Refresh
              </button>
            </div>
          </div>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Signed in as <span className="font-medium text-slate-700 dark:text-slate-200">{user.name}</span>. Supplier access is separate from your {user.role.toLowerCase()} account permissions.
          </p>

        {error && (
          <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/50 dark:text-red-200">
            {error}
          </div>
        )}

        {invitations.length > 0 && (
          <section className="rounded-2xl border border-amber-200 bg-amber-50 p-5 dark:border-amber-900 dark:bg-amber-950/30">
            <h2 className="font-semibold">Company invitations</h2>
            <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
              Invitations are visible only to the invited, email-verified account.
            </p>
            <div className="mt-4 space-y-3">
              {invitations.map((invitation) => (
                <div key={invitation.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-white p-3 dark:bg-slate-900">
                  <div>
                    <p className="font-medium">{invitation.company_name}</p>
                    <p className="text-xs text-slate-500">{invitation.role} invitation</p>
                  </div>
                  <button
                    type="button"
                    disabled={busyMemberId === invitation.id}
                    onClick={() => void acceptInvitation(invitation.id)}
                    className="rounded-lg bg-purple-700 px-4 py-2 text-sm font-semibold text-white hover:bg-purple-800 disabled:opacity-60"
                  >
                    {busyMemberId === invitation.id ? "Joining..." : "Accept invitation"}
                  </button>
                </div>
              ))}
            </div>
          </section>
        )}

        {companies.length > 0 && (
          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <label htmlFor="supplier-company" className="mb-2 block text-sm font-semibold">Supplier company</label>
            <select
              id="supplier-company"
              value={selectedCompanyId}
              onChange={(event) => setSelectedCompanyId(event.target.value)}
              className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm dark:border-slate-700 dark:bg-slate-950 sm:max-w-xl"
            >
              {companies.map((entry) => (
                <option key={entry.company_id} value={entry.company_id}>
                  {entry.company_name} · {entry.role}
                </option>
              ))}
            </select>
          </section>
        )}

        {selectedCompanyId && (
          <section className="space-y-5 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900 sm:p-6">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <ClipboardList size={19} className="text-purple-700 dark:text-purple-300" />
                  <h2 className="text-lg font-bold">RFQ inbox</h2>
                </div>
                <p className="mt-1 max-w-3xl text-sm text-slate-600 dark:text-slate-400">
                  Invitations addressed to this supplier company. You can acknowledge or decline; price quotations are not part of this phase.
                </p>
              </div>
              <button
                type="button"
                onClick={() => void loadCompany(selectedCompanyId)}
                disabled={rfqsLoading}
                className="inline-flex min-h-9 items-center gap-2 rounded-xl border border-slate-300 px-3 py-2 text-sm font-semibold hover:bg-slate-50 disabled:opacity-60 dark:border-slate-700 dark:hover:bg-slate-800"
              >
                <RefreshCw size={14} className={rfqsLoading ? "animate-spin" : ""} /> Refresh inbox
              </button>
            </div>

            {rfqsError && (
              <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/50 dark:text-red-200">
                {rfqsError}
                {rfqsError.includes("migration 076") && (
                  <p className="mt-1">Apply the forward-only migration through your normal database workflow, then refresh.</p>
                )}
              </div>
            )}
            {rfqsSuccess && (
              <div role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200">
                {rfqsSuccess}
              </div>
            )}

            {rfqsLoading ? (
              <div role="status" className="flex items-center gap-2 py-5 text-sm text-slate-500">
                <Loader2 size={16} className="animate-spin" /> Loading company RFQs…
              </div>
            ) : rfqs.length === 0 ? (
              <div className="rounded-xl border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500 dark:border-slate-700">
                No RFQs have been addressed to this company.
              </div>
            ) : (
              <div className="grid gap-5 lg:grid-cols-[minmax(230px,0.8fr)_minmax(0,1.4fr)]">
                <ul className="space-y-2">
                  {rfqs.map((rfq) => (
                    <li key={rfq.id}>
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedRfqId(rfq.id);
                          setRfqResponseNote("");
                          setRfqsError("");
                          setRfqsSuccess("");
                        }}
                        className={`w-full rounded-xl border p-3 text-left transition ${
                          rfq.id === selectedRfqId
                            ? "border-purple-300 bg-purple-50/60 dark:border-purple-800 dark:bg-purple-950/30"
                            : "border-slate-200 hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800/60"
                        }`}
                      >
                        <span className="block font-semibold text-slate-900 dark:text-white">{rfq.item_name}</span>
                        <span className="mt-1 block text-xs text-slate-500">{rfq.quantity} {rfq.unit}</span>
                        <span className="mt-2 flex flex-wrap gap-1.5">
                          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-700 dark:bg-slate-800 dark:text-slate-300">{rfq.status}</span>
                          <span className="rounded-full bg-purple-100 px-2 py-0.5 text-[10px] font-bold text-purple-800 dark:bg-purple-950/60 dark:text-purple-300">{rfq.recipient_status}</span>
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>

                {selectedRfq && (
                  <article className="rounded-xl border border-slate-200 p-4 dark:border-slate-700 sm:p-5">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="text-xs font-bold uppercase tracking-wider text-purple-700 dark:text-purple-300">Buyer request</p>
                        <h3 className="mt-1 text-lg font-bold text-slate-900 dark:text-white">{selectedRfq.item_name}</h3>
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-700 dark:bg-slate-800 dark:text-slate-300">{selectedRfq.status}</span>
                        <span className="rounded-full bg-purple-100 px-2.5 py-1 text-xs font-bold text-purple-800 dark:bg-purple-950/60 dark:text-purple-300">{selectedRfq.recipient_status}</span>
                      </div>
                    </div>
                    <dl className="mt-4 grid gap-x-5 gap-y-3 border-t border-slate-100 pt-4 text-sm dark:border-slate-800 sm:grid-cols-2">
                      <div>
                        <dt className="text-xs font-semibold text-slate-500">Requested quantity</dt>
                        <dd className="mt-1 font-medium">{selectedRfq.quantity} {selectedRfq.unit}</dd>
                      </div>
                      <div>
                        <dt className="text-xs font-semibold text-slate-500">Delivery location</dt>
                        <dd className="mt-1">{selectedRfq.delivery_location}</dd>
                      </div>
                      <div>
                        <dt className="text-xs font-semibold text-slate-500">Quotation deadline</dt>
                        <dd className="mt-1 inline-flex items-center gap-1.5"><Clock3 size={14} />{new Date(selectedRfq.quotation_deadline).toLocaleString()}</dd>
                      </div>
                      <div>
                        <dt className="text-xs font-semibold text-slate-500">Invited</dt>
                        <dd className="mt-1">{new Date(selectedRfq.created_at).toLocaleString()}</dd>
                      </div>
                      <div className="sm:col-span-2">
                        <dt className="text-xs font-semibold text-slate-500">Specification</dt>
                        <dd className="mt-1 whitespace-pre-wrap">{selectedRfq.specification || "Not specified"}</dd>
                      </div>
                      {selectedRfq.buyer_notes && (
                        <div className="sm:col-span-2">
                          <dt className="text-xs font-semibold text-slate-500">Buyer notes</dt>
                          <dd className="mt-1 whitespace-pre-wrap">{selectedRfq.buyer_notes}</dd>
                        </div>
                      )}
                      {selectedRfq.responded_at && (
                        <div className="sm:col-span-2">
                          <dt className="text-xs font-semibold text-slate-500">Your response</dt>
                          <dd className="mt-1">
                            {selectedRfq.recipient_status} · {new Date(selectedRfq.responded_at).toLocaleString()}
                            {selectedRfq.response_note && <p className="mt-1 whitespace-pre-wrap text-slate-600 dark:text-slate-300">{selectedRfq.response_note}</p>}
                          </dd>
                        </div>
                      )}
                    </dl>
                    <section className="mt-5 space-y-3 border-t border-slate-100 pt-4 dark:border-slate-800">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <h4 className="font-semibold text-slate-900 dark:text-white">Your quotation</h4>
                          {selectedRfq.quotation && (
                            <p className="mt-1 text-xs text-slate-500">
                              {selectedRfq.quotation.quotation_valid_until < localDateString()
                                ? "Quotation validity expired"
                                : `Submitted ${new Date(selectedRfq.quotation.submitted_at).toLocaleString()}`}
                              {" · "}Revision {selectedRfq.quotation.revision + 1}
                            </p>
                          )}
                        </div>
                        {canSubmitQuotation && !quotationFormOpen && (
                          <button
                            type="button"
                            onClick={() => {
                              setQuotationDraft(quotationDraftFrom(selectedRfq.quotation, selectedRfq));
                              setQuotationReview(false);
                              setQuotationFormOpen(true);
                              setRfqsError("");
                            }}
                            className="inline-flex min-h-9 items-center gap-2 rounded-xl bg-purple-700 px-3 py-2 text-sm font-semibold text-white hover:bg-purple-800"
                          >
                            <Pencil size={14} />
                            {selectedRfq.quotation ? "Edit quotation" : "Submit quotation"}
                          </button>
                        )}
                      </div>

                      {selectedRfq.quotation && (
                        <dl className="grid gap-3 rounded-xl bg-slate-50 p-4 text-sm dark:bg-slate-950 sm:grid-cols-2">
                          <div><dt className="text-xs font-semibold text-slate-500">Unit price</dt><dd className="mt-1">{selectedRfq.quotation.currency} {selectedRfq.quotation.unit_price} / {selectedRfq.quotation.unit}</dd></div>
                          <div><dt className="text-xs font-semibold text-slate-500">Quantity offered</dt><dd className="mt-1">{selectedRfq.quotation.quantity_offered} {selectedRfq.quotation.unit}</dd></div>
                          <div><dt className="text-xs font-semibold text-slate-500">Estimated delivery</dt><dd className="mt-1">{selectedRfq.quotation.estimated_delivery_lead_time_days} days</dd></div>
                          <div><dt className="text-xs font-semibold text-slate-500">Valid until</dt><dd className="mt-1">{new Date(`${selectedRfq.quotation.quotation_valid_until}T00:00:00`).toLocaleDateString()}</dd></div>
                          <div className="sm:col-span-2"><dt className="text-xs font-semibold text-slate-500">Delivery terms</dt><dd className="mt-1 whitespace-pre-wrap">{selectedRfq.quotation.delivery_terms}</dd></div>
                          {selectedRfq.quotation.notes && <div className="sm:col-span-2"><dt className="text-xs font-semibold text-slate-500">Supplier notes</dt><dd className="mt-1 whitespace-pre-wrap">{selectedRfq.quotation.notes}</dd></div>}
                        </dl>
                      )}

                      {selectedRfq.recipient_status === "DECLINED" && (
                        <p className="rounded-lg bg-slate-100 p-3 text-sm text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                          Your company declined this invitation, so a quotation cannot be submitted.
                        </p>
                      )}
                      {!canSubmitQuotation && selectedRfq.recipient_status !== "DECLINED" && (
                        <p className="rounded-lg bg-slate-100 p-3 text-sm text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                          The RFQ is closed. Quotations can no longer be submitted or edited.
                        </p>
                      )}

                      {quotationFormOpen && quotationDraft && canSubmitQuotation && (
                        quotationReview ? (
                          <div className="space-y-4 rounded-xl border border-purple-200 bg-purple-50/60 p-4 dark:border-purple-900 dark:bg-purple-950/20">
                            <div>
                              <h5 className="font-semibold">Review your quotation</h5>
                              <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
                                {quotationDraft.currency} {quotationDraft.unit_price} / {quotationDraft.unit} · {quotationDraft.quantity_offered} {quotationDraft.unit}
                              </p>
                              <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
                                Requested: {selectedRfq.quantity} {selectedRfq.unit}
                                {quotationDraft.unit.toLowerCase() !== selectedRfq.unit.trim().toLowerCase()
                                  ? " — different unit; the buyer will see this as non-comparable"
                                  : ""}
                              </p>
                            </div>
                            <dl className="grid gap-3 text-sm sm:grid-cols-2">
                              <div><dt className="text-xs font-semibold text-slate-500">Estimated delivery</dt><dd>{quotationDraft.estimated_delivery_lead_time_days} days</dd></div>
                              <div><dt className="text-xs font-semibold text-slate-500">Valid until</dt><dd>{quotationDraft.quotation_valid_until}</dd></div>
                              <div className="sm:col-span-2"><dt className="text-xs font-semibold text-slate-500">Delivery terms</dt><dd className="whitespace-pre-wrap">{quotationDraft.delivery_terms}</dd></div>
                              {quotationDraft.notes && <div className="sm:col-span-2"><dt className="text-xs font-semibold text-slate-500">Notes</dt><dd className="whitespace-pre-wrap">{quotationDraft.notes}</dd></div>}
                            </dl>
                            <div className="flex flex-wrap justify-between gap-2">
                              <button type="button" disabled={quotationBusy} onClick={() => setQuotationReview(false)} className="min-h-9 rounded-xl border border-slate-300 px-3 py-2 text-sm font-semibold dark:border-slate-700">Edit quotation</button>
                              <button type="button" disabled={quotationBusy} onClick={() => void submitQuotation()} className="inline-flex min-h-9 items-center gap-2 rounded-xl bg-purple-700 px-4 py-2 text-sm font-bold text-white hover:bg-purple-800 disabled:opacity-60">
                                {quotationBusy ? <Loader2 size={15} className="animate-spin" /> : <CheckCircle2 size={15} />}
                                {quotationBusy ? "Saving…" : "Confirm and submit"}
                              </button>
                            </div>
                          </div>
                        ) : (
                          <form onSubmit={reviewQuotation} className="space-y-4 rounded-xl border border-slate-200 p-4 dark:border-slate-700">
                            <p className="text-xs text-slate-500">
                              The RFQ requests {selectedRfq.quantity} {selectedRfq.unit}. Your offered quantity and unit are recorded as entered; no unit conversion is performed.
                            </p>
                            <div className="grid gap-3 sm:grid-cols-2">
                              <label className="block text-sm font-medium">Unit price *
                                <input type="number" required min="0" max="1000000000000" step="0.0001" value={quotationDraft.unit_price} onChange={(event) => setQuotationDraft({ ...quotationDraft, unit_price: event.target.value })} className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950" />
                              </label>
                              <label className="block text-sm font-medium">Currency *
                                <select required value={quotationDraft.currency} onChange={(event) => setQuotationDraft({ ...quotationDraft, currency: event.target.value as SupplierQuotation["currency"] })} className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950">
                                  {["INR", "USD", "EUR", "GBP", "AED"].map((currency) => <option key={currency} value={currency}>{currency}</option>)}
                                </select>
                              </label>
                              <label className="block text-sm font-medium">Quantity offered *
                                <input type="number" required min="0.0001" max="1000000000" step="0.0001" value={quotationDraft.quantity_offered} onChange={(event) => setQuotationDraft({ ...quotationDraft, quantity_offered: event.target.value })} className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950" />
                              </label>
                              <label className="block text-sm font-medium">Unit *
                                <select required value={quotationDraft.unit} onChange={(event) => setQuotationDraft({ ...quotationDraft, unit: event.target.value as ProcurementUnit })} className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950">
                                  {quotationUnits.map((unit) => <option key={unit} value={unit}>{unit}</option>)}
                                </select>
                              </label>
                              <label className="block text-sm font-medium">Estimated delivery lead time (days) *
                                <input type="number" required min="0" max="3650" step="1" value={quotationDraft.estimated_delivery_lead_time_days} onChange={(event) => setQuotationDraft({ ...quotationDraft, estimated_delivery_lead_time_days: event.target.value })} className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950" />
                              </label>
                              <label className="block text-sm font-medium">Quotation valid until *
                                <input type="date" required min={localDateString()} value={quotationDraft.quotation_valid_until} onChange={(event) => setQuotationDraft({ ...quotationDraft, quotation_valid_until: event.target.value })} className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950" />
                              </label>
                              <label className="block text-sm font-medium sm:col-span-2">Delivery terms *
                                <textarea required maxLength={2000} rows={2} value={quotationDraft.delivery_terms} onChange={(event) => setQuotationDraft({ ...quotationDraft, delivery_terms: event.target.value })} className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950" />
                              </label>
                              <label className="block text-sm font-medium sm:col-span-2">Notes <span className="font-normal text-slate-500">(optional)</span>
                                <textarea maxLength={4000} rows={2} value={quotationDraft.notes} onChange={(event) => setQuotationDraft({ ...quotationDraft, notes: event.target.value })} className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950" />
                              </label>
                            </div>
                            <div className="flex justify-end gap-2">
                              <button type="button" onClick={() => setQuotationFormOpen(false)} className="min-h-9 rounded-xl border border-slate-300 px-3 py-2 text-sm font-semibold dark:border-slate-700">Cancel</button>
                              <button type="submit" disabled={quotationBusy} className="min-h-9 rounded-xl bg-purple-700 px-4 py-2 text-sm font-bold text-white hover:bg-purple-800 disabled:opacity-60">Review quotation</button>
                            </div>
                          </form>
                        )
                      )}
                    </section>
                    {canRespondToRfq ? (
                      <div className="mt-5 space-y-3 border-t border-slate-100 pt-4 dark:border-slate-800">
                        <label className="block text-sm font-semibold">
                          Response note <span className="font-normal text-slate-500">(optional)</span>
                          <textarea
                            value={rfqResponseNote}
                            onChange={(event) => setRfqResponseNote(event.target.value)}
                            maxLength={2000}
                            rows={3}
                            className="mt-1.5 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-normal dark:border-slate-700 dark:bg-slate-950"
                          />
                          <span className="mt-1 block text-right text-xs font-normal text-slate-500">{rfqResponseNote.length}/2000</span>
                        </label>
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            disabled={rfqBusy}
                            onClick={() => void respondToRfq("ACKNOWLEDGED")}
                            className="inline-flex min-h-10 items-center gap-2 rounded-xl bg-emerald-700 px-4 py-2 text-sm font-bold text-white hover:bg-emerald-800 disabled:opacity-60"
                          >
                            {rfqBusy ? <Loader2 size={15} className="animate-spin" /> : <CheckCircle2 size={15} />}
                            Acknowledge
                          </button>
                          <button
                            type="button"
                            disabled={rfqBusy}
                            onClick={() => void respondToRfq("DECLINED")}
                            className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-rose-300 px-4 py-2 text-sm font-bold text-rose-700 hover:bg-rose-50 disabled:opacity-60 dark:border-rose-800 dark:text-rose-300 dark:hover:bg-rose-950/40"
                          >
                            {rfqBusy ? <Loader2 size={15} className="animate-spin" /> : <X size={15} />}
                            Decline invitation
                          </button>
                        </div>
                      </div>
                    ) : selectedRfq.recipient_status === "INVITED" && selectedRfq.status === "CLOSED" ? (
                      <p className="mt-4 rounded-lg bg-slate-100 p-3 text-sm text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                        The quotation deadline has passed. Responses are closed.
                      </p>
                    ) : null}
                  </article>
                )}
              </div>
            )}
          </section>
        )}

        {company && (
          <section className="grid gap-6 lg:grid-cols-[1fr_1.15fr]">
            <div className="space-y-6">
              <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-bold uppercase tracking-wider text-slate-500">Company identity</p>
                    <h2 className="mt-1 text-xl font-bold">{company.name}</h2>
                  </div>
                  <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold dark:bg-slate-800">
                    {company.operational_status}
                  </span>
                </div>
                {company.description && <p className="mt-3 text-sm text-slate-600 dark:text-slate-300">{company.description}</p>}
                {company.website && <a className="mt-3 inline-block text-sm font-medium text-purple-700 underline dark:text-purple-300" href={company.website} target="_blank" rel="noreferrer">{company.website}</a>}
                {canManageMembers && (
                  <div className="mt-5 border-t border-slate-200 pt-4 text-sm dark:border-slate-800">
                    <h3 className="font-semibold">Private company details</h3>
                    <p className="mt-1 text-xs text-slate-500">Visible only to company owners and admins in this workspace.</p>
                    <dl className="mt-3 space-y-2">
                      {company.registered_name && <div><dt className="text-xs text-slate-500">Registered name</dt><dd>{company.registered_name}</dd></div>}
                      {company.registration_number && <div><dt className="text-xs text-slate-500">Registration number</dt><dd>{company.registration_number}</dd></div>}
                      {company.contact_email && <div><dt className="text-xs text-slate-500">Private contact email</dt><dd>{company.contact_email}</dd></div>}
                      {company.contact_phone && <div><dt className="text-xs text-slate-500">Private contact phone</dt><dd>{company.contact_phone}</dd></div>}
                      {company.registered_address && <div><dt className="text-xs text-slate-500">Registered address</dt><dd>{company.registered_address}</dd></div>}
                      {!company.registered_name && !company.registration_number && !company.contact_email && !company.contact_phone && !company.registered_address && (
                        <p className="text-sm text-slate-500">No private registration details have been added.</p>
                      )}
                    </dl>
                  </div>
                )}
                <p className="mt-5 rounded-xl bg-purple-50 px-3 py-2 text-xs leading-relaxed text-purple-900 dark:bg-purple-950/50 dark:text-purple-200">
                  Buyer discovery requires the company to be active and verified and the offering to be available. Discovery shows catalogue listings only; it does not start procurement transactions.
                </p>
              </article>
              <article className="rounded-2xl border border-indigo-200 bg-white p-5 shadow-sm dark:border-indigo-900 dark:bg-slate-900">
                <div className="flex items-center justify-between gap-3">
                  <h2 className="font-semibold">Supplier verification</h2>
                  <span className="rounded-full bg-indigo-50 px-3 py-1 text-xs font-bold text-indigo-800 dark:bg-indigo-950 dark:text-indigo-200">
                    {company.verification_status.replaceAll("_", " ")}
                  </span>
                </div>
                <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
                  Submit company evidence for an authorized GLESKA administrator to review. This status is independent of operational status.
                </p>
                {company.verification_reason && (
                  <div className="mt-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-950 dark:bg-amber-950/40 dark:text-amber-100">
                    <strong>Review feedback:</strong> {company.verification_reason}
                  </div>
                )}
                {company.verification_submitted_at && (
                  <p className="mt-2 text-xs text-slate-500">
                    Submitted {new Date(company.verification_submitted_at).toLocaleString()}
                    {company.verification_reviewed_at && ` · Reviewed ${new Date(company.verification_reviewed_at).toLocaleString()}`}
                  </p>
                )}
                {canManageMembers && (
                  <>
                    <form onSubmit={uploadVerificationDocument} className="mt-4 space-y-3 border-t border-slate-200 pt-4 dark:border-slate-800">
                      <h3 className="text-sm font-semibold">Private verification documents</h3>
                      <div className="grid gap-3 sm:grid-cols-[1fr_1.5fr_auto]">
                        <select
                          value={verificationDocumentType}
                          onChange={(event) => setVerificationDocumentType(event.target.value)}
                          className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950"
                        >
                          <option value="BUSINESS_REGISTRATION">Business registration</option>
                          <option value="TAX_REGISTRATION">Tax registration</option>
                          <option value="ADDRESS_PROOF">Address proof</option>
                          <option value="OTHER">Other</option>
                        </select>
                        <input
                          type="file"
                          required
                          accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"
                          onChange={(event) => setVerificationFile(event.target.files?.[0] || null)}
                          className="min-w-0 rounded-lg border border-slate-300 px-2 py-1.5 text-xs dark:border-slate-700"
                        />
                        <button
                          disabled={verificationBusy || !verificationFile || !["NOT_SUBMITTED", "REJECTED"].includes(company.verification_status)}
                          className="inline-flex items-center justify-center gap-2 rounded-lg border border-indigo-300 px-3 py-2 text-sm font-semibold text-indigo-800 disabled:opacity-50 dark:border-indigo-800 dark:text-indigo-200"
                        >
                          <FileText size={15} /> Upload
                        </button>
                      </div>
                      <p className="text-xs text-slate-500">PDF, JPEG, or PNG · maximum 10 MB. Files are private to company managers and GLESKA reviewers.</p>
                    </form>
                    <div className="mt-3 space-y-2">
                      {verificationDocuments.map((document) => (
                        <div key={document.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-slate-50 px-3 py-2 text-sm dark:bg-slate-950">
                          <span>{document.document_type.replaceAll("_", " ")} · {document.original_filename}</span>
                          <button type="button" onClick={() => void viewVerificationDocument(document)} className="text-xs font-semibold text-indigo-700 underline dark:text-indigo-300">View private file</button>
                        </div>
                      ))}
                    </div>
                    {["NOT_SUBMITTED", "REJECTED"].includes(company.verification_status) && (
                      <button
                        type="button"
                        disabled={verificationBusy || verificationDocuments.length === 0}
                        onClick={() => void submitVerification()}
                        className="mt-4 inline-flex items-center gap-2 rounded-xl bg-indigo-700 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
                      >
                        <CheckCircle2 size={16} />
                        {verificationBusy ? "Submitting…" : "Submit for review"}
                      </button>
                    )}
                    {company.verification_status === "PENDING_REVIEW" && (
                      <p className="mt-4 text-sm font-medium text-indigo-800 dark:text-indigo-200">Your documents are awaiting admin review.</p>
                    )}
                    {company.verification_status === "SUSPENDED" && (
                      <p className="mt-4 text-sm font-medium text-red-700 dark:text-red-300">Verification is suspended. Contact GLESKA support for next steps.</p>
                    )}
                  </>
                )}
              </article>
              {canManageMembers && (
                <form onSubmit={inviteMember} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
                  <div className="flex items-center gap-2">
                    <UserPlus size={18} className="text-purple-600 dark:text-purple-400" />
                    <h2 className="font-semibold">Invite a company member</h2>
                  </div>
                  <p className="mt-1 text-xs text-slate-500">The invitee must sign in with this email and accept the invitation. Share the invitation informally; email delivery is not configured here.</p>
                  <div className="mt-4 flex flex-col gap-3 sm:flex-row">
                    <input
                      type="email"
                      required
                      value={inviteEmail}
                      onChange={(event) => setInviteEmail(event.target.value)}
                      placeholder="Account email"
                      className="min-w-0 flex-1 rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950"
                    />
                    {company.role === "OWNER" && (
                      <select
                        value={inviteRole}
                        onChange={(event) => setInviteRole(event.target.value as "ADMIN" | "MEMBER")}
                        className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950"
                      >
                        <option value="MEMBER">Member</option>
                        <option value="ADMIN">Admin</option>
                      </select>
                    )}
                    <button disabled={saving} className="rounded-xl bg-purple-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-purple-800 disabled:opacity-60">
                      {saving ? "Sending..." : "Create invitation"}
                    </button>
                  </div>
                </form>
              )}
            </div>

            <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
              <div className="flex items-center gap-2">
                <Users size={19} className="text-purple-600 dark:text-purple-400" />
                <h2 className="text-lg font-bold">Company members</h2>
              </div>
              <p className="mt-1 text-sm text-slate-500">Active membership is required for company-scoped access.</p>
              <div className="mt-4 divide-y divide-slate-200 dark:divide-slate-800">
                {members.map((member) => (
                  <div key={member.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold">{member.name || member.invited_email || "Invited member"}</p>
                      <p className="mt-0.5 text-xs text-slate-500">{member.role} · {member.status}</p>
                    </div>
                    {canManageMembers && member.role !== "OWNER" && member.status === "ACTIVE" && (
                      <div className="flex flex-wrap gap-2">
                        {company.role === "OWNER" && (
                          <select
                            aria-label={`Role for ${member.name || "member"}`}
                            value={member.role}
                            disabled={busyMemberId === member.id}
                            onChange={(event) => void changeMemberRole(member, event.target.value as "ADMIN" | "MEMBER")}
                            className="rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-xs dark:border-slate-700 dark:bg-slate-950"
                          >
                            <option value="MEMBER">Member</option>
                            <option value="ADMIN">Admin</option>
                          </select>
                        )}
                        {company.role === "OWNER" && (
                          <button
                            type="button"
                            disabled={busyMemberId === member.id}
                            onClick={() => void transferOwnership(member)}
                            className="rounded-lg border border-purple-300 px-2 py-1.5 text-xs font-semibold text-purple-700 disabled:opacity-50 dark:border-purple-800 dark:text-purple-300"
                          >
                            Transfer owner
                          </button>
                        )}
                        <button
                          type="button"
                          disabled={busyMemberId === member.id}
                          onClick={() => void revokeMember(member)}
                          className="rounded-lg border border-red-200 px-2 py-1.5 text-xs font-semibold text-red-700 disabled:opacity-50 dark:border-red-900 dark:text-red-300"
                        >
                          Revoke
                        </button>
                      </div>
                    )}
                    {canManageMembers && member.status === "PENDING" && (company.role === "OWNER" || member.role === "MEMBER") && (
                      <button
                        type="button"
                        disabled={busyMemberId === member.id}
                        onClick={() => void revokeMember(member)}
                        className="rounded-lg border border-red-200 px-2 py-1.5 text-xs font-semibold text-red-700 disabled:opacity-50 dark:border-red-900 dark:text-red-300"
                      >
                        Cancel invitation
                      </button>
                    )}
                  </div>
                ))}
                {members.length === 0 && <p className="py-6 text-sm text-slate-500">No company members are available.</p>}
              </div>
            </article>
          </section>
        )}

        {!company && companies.length === 0 && (
          <section className="grid gap-6 lg:grid-cols-[0.8fr_1.2fr]">
            <div className="rounded-2xl border border-purple-200 bg-purple-50 p-6 dark:border-purple-900 dark:bg-purple-950/30">
              <Building2 className="text-purple-700 dark:text-purple-300" size={24} />
              <h2 className="mt-3 text-lg font-bold">Set up a supplier company</h2>
              <p className="mt-2 text-sm leading-relaxed text-slate-600 dark:text-slate-300">
                Your existing GLESKA login is used. Creating a supplier company adds a separate supplier persona and does not change your worker, employer, or admin role.
              </p>
              {invitations.length === 0 && (
                <p className="mt-4 text-xs text-slate-500">
                  If you were invited, sign in with the invited, verified email address and refresh this workspace.
                </p>
              )}
            </div>
            <form onSubmit={createCompany} className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
              <h2 className="text-lg font-bold">Company profile</h2>
              <p className="mt-1 text-sm text-slate-500">Public identity and private registration details are stored separately.</p>
              <div className="mt-5 grid gap-4 sm:grid-cols-2">
                <label className="sm:col-span-2">
                  <span className="mb-1 block text-sm font-medium">Company name <span className="text-red-600">*</span></span>
                  <input required minLength={2} maxLength={160} value={companyDraft.name} onChange={(event) => setCompanyDraft({ ...companyDraft, name: event.target.value })} className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm dark:border-slate-700 dark:bg-slate-950" />
                </label>
                <label className="sm:col-span-2">
                  <span className="mb-1 block text-sm font-medium">Public company description</span>
                  <textarea maxLength={2000} rows={3} value={companyDraft.description} onChange={(event) => setCompanyDraft({ ...companyDraft, description: event.target.value })} className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm dark:border-slate-700 dark:bg-slate-950" />
                </label>
                <label className="sm:col-span-2">
                  <span className="mb-1 block text-sm font-medium">Public website</span>
                  <input type="url" value={companyDraft.website} onChange={(event) => setCompanyDraft({ ...companyDraft, website: event.target.value })} placeholder="https://" className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm dark:border-slate-700 dark:bg-slate-950" />
                </label>
                <div className="sm:col-span-2 border-t border-slate-200 pt-4 dark:border-slate-800">
                  <h3 className="font-semibold">Private registration and contact details</h3>
                  <p className="mt-1 text-xs text-slate-500">Only the company owner and admins can view these values. They are not exposed to employers or a supplier directory.</p>
                </div>
                <label>
                  <span className="mb-1 block text-sm font-medium">Registered name</span>
                  <input maxLength={200} value={companyDraft.registered_name} onChange={(event) => setCompanyDraft({ ...companyDraft, registered_name: event.target.value })} className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm dark:border-slate-700 dark:bg-slate-950" />
                </label>
                <label>
                  <span className="mb-1 block text-sm font-medium">Registration number</span>
                  <input maxLength={100} value={companyDraft.registration_number} onChange={(event) => setCompanyDraft({ ...companyDraft, registration_number: event.target.value })} className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm dark:border-slate-700 dark:bg-slate-950" />
                </label>
                <label>
                  <span className="mb-1 block text-sm font-medium">Private contact email</span>
                  <input type="email" value={companyDraft.contact_email} onChange={(event) => setCompanyDraft({ ...companyDraft, contact_email: event.target.value })} className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm dark:border-slate-700 dark:bg-slate-950" />
                </label>
                <label>
                  <span className="mb-1 block text-sm font-medium">Private contact phone</span>
                  <input maxLength={32} value={companyDraft.contact_phone} onChange={(event) => setCompanyDraft({ ...companyDraft, contact_phone: event.target.value })} className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm dark:border-slate-700 dark:bg-slate-950" />
                </label>
                <label className="sm:col-span-2">
                  <span className="mb-1 block text-sm font-medium">Registered address</span>
                  <textarea maxLength={1000} rows={2} value={companyDraft.registered_address} onChange={(event) => setCompanyDraft({ ...companyDraft, registered_address: event.target.value })} className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm dark:border-slate-700 dark:bg-slate-950" />
                </label>
              </div>
              <button disabled={saving} className="mt-5 inline-flex items-center gap-2 rounded-xl bg-purple-700 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-purple-800 disabled:opacity-60">
                {saving ? <Loader2 className="animate-spin" size={17} /> : <Plus size={17} />}
                Create supplier company
              </button>
            </form>
          </section>
        )}

        {company && (
          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900 sm:p-6">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-bold">Material offerings</h2>
                <p className="mt-1 max-w-3xl text-sm text-slate-600 dark:text-slate-400">
                  Manage the materials and service areas your company can provide. Available, non-archived offerings from active, verified companies may appear as catalogue matches in Get Procurement. Buyers are not contacting suppliers or requesting quotes through discovery.
                </p>
              </div>
              {canManageMembers && (
                <label className="flex items-center gap-2 text-xs font-medium text-slate-600 dark:text-slate-300">
                  <input
                    type="checkbox"
                    checked={includeArchivedOfferings}
                    onChange={(event) => setIncludeArchivedOfferings(event.target.checked)}
                  />
                  Show archived
                </label>
              )}
            </div>

            {offeringError && (
              <div role="alert" className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/50 dark:text-red-200">
                {offeringError}
              </div>
            )}
            {offeringSuccess && (
              <div role="status" className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200">
                {offeringSuccess}
              </div>
            )}

            {canManageMembers && (
              <form onSubmit={saveOffering} className="mt-5 space-y-4 border-t border-slate-200 pt-5 dark:border-slate-800">
                <h3 className="font-semibold">{editingOfferingId ? "Edit material offering" : "Add a material offering"}</h3>
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  <label>
                    <span className="mb-1 block text-sm font-medium">Material name *</span>
                    <input
                      required
                      minLength={2}
                      maxLength={240}
                      value={offeringDraft.name}
                      onChange={(event) => setOfferingDraft({ ...offeringDraft, name: event.target.value })}
                      className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm dark:border-slate-700 dark:bg-slate-950"
                    />
                  </label>
                  <label>
                    <span className="mb-1 block text-sm font-medium">Unit *</span>
                    <input
                      required
                      maxLength={48}
                      value={offeringDraft.unit}
                      onChange={(event) => setOfferingDraft({ ...offeringDraft, unit: event.target.value })}
                      placeholder="e.g. MT, bags, pieces"
                      className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm dark:border-slate-700 dark:bg-slate-950"
                    />
                  </label>
                  <label>
                    <span className="mb-1 block text-sm font-medium">Minimum order quantity</span>
                    <input
                      type="number"
                      min="0.0001"
                      step="any"
                      value={offeringDraft.minimum_order_quantity}
                      onChange={(event) => setOfferingDraft({ ...offeringDraft, minimum_order_quantity: event.target.value })}
                      className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm dark:border-slate-700 dark:bg-slate-950"
                    />
                  </label>
                  <label>
                    <span className="mb-1 block text-sm font-medium">Indicative price (optional)</span>
                    <input
                      type="number"
                      min="0.0001"
                      step="any"
                      value={offeringDraft.indicative_price}
                      onChange={(event) => setOfferingDraft({ ...offeringDraft, indicative_price: event.target.value })}
                      className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm dark:border-slate-700 dark:bg-slate-950"
                    />
                  </label>
                  <label>
                    <span className="mb-1 block text-sm font-medium">Currency code {offeringDraft.indicative_price && "*"}</span>
                    <input
                      minLength={3}
                      maxLength={3}
                      required={Boolean(offeringDraft.indicative_price)}
                      value={offeringDraft.currency_code}
                      onChange={(event) => setOfferingDraft({ ...offeringDraft, currency_code: event.target.value.toUpperCase() })}
                      placeholder="e.g. INR"
                      className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm uppercase dark:border-slate-700 dark:bg-slate-950"
                    />
                  </label>
                  <label className="flex items-center gap-2 self-end pb-3 text-sm font-medium">
                    <input
                      type="checkbox"
                      checked={offeringDraft.is_available}
                      onChange={(event) => setOfferingDraft({ ...offeringDraft, is_available: event.target.checked })}
                    />
                    Currently available
                  </label>
                  <label className="sm:col-span-2 lg:col-span-3">
                    <span className="mb-1 block text-sm font-medium">Specifications / grade</span>
                    <textarea
                      maxLength={2000}
                      rows={2}
                      value={offeringDraft.specification}
                      onChange={(event) => setOfferingDraft({ ...offeringDraft, specification: event.target.value })}
                      className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm dark:border-slate-700 dark:bg-slate-950"
                    />
                  </label>
                  <label className="sm:col-span-2 lg:col-span-3">
                    <span className="mb-1 block text-sm font-medium">Service coverage areas (one per line)</span>
                    <textarea
                      rows={3}
                      value={offeringDraft.service_coverage}
                      onChange={(event) => setOfferingDraft({ ...offeringDraft, service_coverage: event.target.value })}
                      placeholder="Enter the cities, districts, or regions you serve."
                      className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm dark:border-slate-700 dark:bg-slate-950"
                    />
                  </label>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    disabled={offeringBusy || company.operational_status !== "ACTIVE"}
                    className="inline-flex items-center gap-2 rounded-xl bg-purple-700 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-purple-800 disabled:opacity-60"
                  >
                    {offeringBusy ? <Loader2 className="animate-spin" size={16} /> : <Plus size={16} />}
                    {editingOfferingId ? "Save offering" : "Add offering"}
                  </button>
                  {editingOfferingId && (
                    <button
                      type="button"
                      onClick={cancelOfferingEdit}
                      disabled={offeringBusy}
                      className="inline-flex items-center gap-2 rounded-xl border border-slate-300 px-4 py-2.5 text-sm font-semibold dark:border-slate-700"
                    >
                      <X size={16} /> Cancel edit
                    </button>
                  )}
                </div>
              </form>
            )}

            <div className="mt-5 border-t border-slate-200 pt-5 dark:border-slate-800">
              {offeringsLoading ? (
                <div className="flex items-center gap-2 py-5 text-sm text-slate-500"><Loader2 className="animate-spin" size={16} /> Loading offerings...</div>
              ) : visibleOfferings.length === 0 ? (
                <p className="py-5 text-sm text-slate-500">
                  {offeringError
                    ? "Offerings are unavailable until the required database migration is applied."
                    : offerings.length > 0
                      ? "No active offerings. Turn on “Show archived” to view archived records."
                      : "No material offerings have been added yet."}
                </p>
              ) : (
                <ul className="space-y-3">
                  {visibleOfferings.map((offering) => (
                      <li key={offering.id} className="rounded-xl border border-slate-200 p-4 dark:border-slate-700">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <h3 className="font-semibold">{offering.name}</h3>
                              <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${offering.archived_at ? "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300" : offering.is_available ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300" : "bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300"}`}>
                                {offering.archived_at ? "Archived" : offering.is_available ? "Available" : "Unavailable"}
                              </span>
                            </div>
                            {offering.specification && <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">{offering.specification}</p>}
                            <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
                              Unit: {offering.unit}
                              {offering.minimum_order_quantity && ` · Minimum order: ${offering.minimum_order_quantity} ${offering.unit}`}
                              {offering.indicative_price && ` · Indicative price: ${offering.currency_code} ${offering.indicative_price} / ${offering.unit}`}
                            </p>
                            {offering.service_coverage.length > 0 && (
                              <p className="mt-1 text-xs text-slate-500">Coverage: {offering.service_coverage.join(", ")}</p>
                            )}
                          </div>
                          {canManageMembers && !offering.archived_at && (
                            <div className="flex gap-2">
                              <button
                                type="button"
                                disabled={offeringBusy}
                                onClick={() => editOffering(offering)}
                                className="inline-flex items-center gap-1 rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold dark:border-slate-700"
                              >
                                <Pencil size={13} /> Edit
                              </button>
                              <button
                                type="button"
                                disabled={offeringBusy}
                                onClick={() => void archiveOffering(offering)}
                                className="inline-flex items-center gap-1 rounded-lg border border-amber-300 px-3 py-1.5 text-xs font-semibold text-amber-800 dark:border-amber-800 dark:text-amber-200"
                              >
                                <Archive size={13} /> Archive
                              </button>
                            </div>
                          )}
                        </div>
                      </li>
                    ))}
                </ul>
              )}
            </div>
          </section>
        )}

        {companies.length > 0 && !company && !error && (
          <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500 dark:border-slate-800 dark:bg-slate-900">
            Select an operational company or refresh the workspace. Inactive company access must be restored by an authorized operator.
          </div>
        )}

          <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 pt-5 text-xs text-slate-500 dark:border-slate-800">
            <span>Supplier discovery, RFQs, quotations, and orders are not available in this phase.</span>
            <Link href="/" className="font-semibold hover:text-purple-700 dark:hover:text-purple-300">
              Back to GLESKA
            </Link>
          </footer>
        </div>
      </main>
    </div>
  );
}
