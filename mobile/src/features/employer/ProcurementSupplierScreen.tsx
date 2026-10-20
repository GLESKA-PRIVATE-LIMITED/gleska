import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import {
  AlertCircle,
  Building2,
  Check,
  ClipboardList,
  FileText,
  LoaderCircle,
  RefreshCw,
  Save,
  Settings,
  Trash2,
  Truck,
  Users,
} from "lucide-react";
import { Link } from "react-router-dom";
import { ApiError } from "../../lib/api";
import DeleteAccountSection from "../auth/DeleteAccountSection";
import {
  procurementWorkspaceApi,
  type ProcurementCompanyMembership,
  type ProcurementPurchaseOrder,
  type ProcurementUnit,
  type SupplierCompany,
  type SupplierFulfillmentUpdate,
  type SupplierMember,
  type SupplierOffering,
  type SupplierQuotationSubmission,
  type SupplierRFQ,
  type SupplierVerificationDocument,
} from "./procurementApi";

export type SupplierSection =
  | "dashboard"
  | "offerings"
  | "rfqs"
  | "orders"
  | "history"
  | "companies"
  | "settings";
type OfferingDraft = {
  name: string;
  specification: string;
  unit: string;
  indicative_price: string;
  currency_code: string;
  minimum_order_quantity: string;
  is_available: boolean;
  service_coverage: string;
};

const selectedCompanyStorageKey = "gleska_supplier_selected_company_id";
type PendingFulfillment = { orderId: string; signature: string; idempotencyKey: string };
type SupplierDataLoadState = {
  company: boolean;
  offerings: boolean;
  rfqs: boolean;
  orders: boolean;
  members: boolean;
  documents: boolean;
};
const emptySupplierDataLoadState: SupplierDataLoadState = {
  company: false,
  offerings: false,
  rfqs: false,
  orders: false,
  members: false,
  documents: false,
};
const emptyOffering: OfferingDraft = {
  name: "",
  specification: "",
  unit: "",
  indicative_price: "",
  currency_code: "INR",
  minimum_order_quantity: "",
  is_available: true,
  service_coverage: "",
};
const supplierUnits: ProcurementUnit[] = ["MT", "Bags", "Pieces", "Kg", "Tons", "Meters", "Sq. ft", "Boxes", "Liters"];

function errorText(error: unknown) {
  return error instanceof ApiError
    ? error.message
    : error instanceof Error
      ? error.message
      : "Could not complete this action. Please retry.";
}

function defaultFulfillmentStatus(order: ProcurementPurchaseOrder): SupplierFulfillmentUpdate["status"] {
  if (order.status === "DISPATCHED") return "DISPATCHED";
  if (order.status === "PARTIALLY_DELIVERED") return "PARTIALLY_DELIVERED";
  if (order.status === "DELIVERED") return "DELIVERED";
  return "PREPARING";
}

function localDateString(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function quotationDateDefault() {
  const date = new Date();
  date.setDate(date.getDate() + 30);
  return localDateString(date);
}

export default function ProcurementSupplierScreen({ section }: { section: SupplierSection }) {
  const [companies, setCompanies] = useState<ProcurementCompanyMembership[]>([]);
  const [invitations, setInvitations] = useState<ProcurementCompanyMembership[]>([]);
  const [invitationError, setInvitationError] = useState("");
  const [membershipsLoaded, setMembershipsLoaded] = useState(false);
  const [selectedCompanyId, setSelectedCompanyId] = useState("");
  const [company, setCompany] = useState<SupplierCompany | null>(null);
  const [offerings, setOfferings] = useState<SupplierOffering[]>([]);
  const [rfqs, setRfqs] = useState<SupplierRFQ[]>([]);
  const [rfqCursor, setRfqCursor] = useState<string | null>(null);
  const [rfqsHaveMore, setRfqsHaveMore] = useState(false);
  const [loadingMoreRfqs, setLoadingMoreRfqs] = useState(false);
  const [orders, setOrders] = useState<ProcurementPurchaseOrder[]>([]);
  const [members, setMembers] = useState<SupplierMember[]>([]);
  const [documents, setDocuments] = useState<SupplierVerificationDocument[]>([]);
  const [loadedData, setLoadedData] = useState<SupplierDataLoadState>(emptySupplierDataLoadState);
  const [showArchived, setShowArchived] = useState(false);
  const [supplierSettingsLoaded, setSupplierSettingsLoaded] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [offeringDraft, setOfferingDraft] = useState<OfferingDraft>(emptyOffering);
  const [editingOffering, setEditingOffering] = useState<SupplierOffering | null>(null);
  const [companyDraft, setCompanyDraft] = useState<Record<string, string>>({});
  const [privateDraft, setPrivateDraft] = useState<Record<string, string>>({});
  const [newCompanyDraft, setNewCompanyDraft] = useState({ name: "", description: "", website: "", registered_name: "", registration_number: "", contact_email: "", contact_phone: "", registered_address: "" });
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"ADMIN" | "MEMBER">("MEMBER");
  const [quotationDrafts, setQuotationDrafts] = useState<Record<string, SupplierQuotationSubmission>>({});
  const [selectedRfqId, setSelectedRfqId] = useState("");
  const [rfqResponseNote, setRfqResponseNote] = useState("");
  const [quotationFormOpen, setQuotationFormOpen] = useState(false);
  const [quotationReview, setQuotationReview] = useState(false);
  const [fulfillmentOrderId, setFulfillmentOrderId] = useState("");
  const companyLoadSequence = useRef(0);
  const pendingFulfillment = useRef<PendingFulfillment | null>(null);
  const selectedCompanyIdRef = useRef(selectedCompanyId);
  const companiesRef = useRef(companies);
  const showArchivedRef = useRef(showArchived);
  const supplierSettingsLoadedRef = useRef(supplierSettingsLoaded);
  selectedCompanyIdRef.current = selectedCompanyId;
  companiesRef.current = companies;
  showArchivedRef.current = showArchived;
  supplierSettingsLoadedRef.current = supplierSettingsLoaded;

  const canManage = company?.role === "OWNER" || company?.role === "ADMIN";
  const canEditVerification = canManage
    && (company?.verification_status === "NOT_SUBMITTED" || company?.verification_status === "REJECTED");
  const activeMemberships = companies.filter((item) => item.status === "ACTIVE");

  const loadMemberships = useCallback(async () => {
    setError("");
    setLoading(true);
    try {
      const [companiesResult, invitationsResult] = await Promise.allSettled([
        procurementWorkspaceApi.listSupplierCompanies(),
        procurementWorkspaceApi.listSupplierInvitations(),
      ]);
      if (companiesResult.status === "rejected") {
        companyLoadSequence.current += 1;
        setCompanies([]);
        setSelectedCompanyId("");
        setInvitations(invitationsResult.status === "fulfilled" ? invitationsResult.value : []);
        setInvitationError(invitationsResult.status === "rejected"
          ? `Invitations: ${errorText(invitationsResult.reason)}`
          : "");
        setMembershipsLoaded(invitationsResult.status === "fulfilled");
        setCompany(null);
        setOfferings([]);
        setRfqs([]);
        setOrders([]);
        setMembers([]);
        setDocuments([]);
        setLoadedData(emptySupplierDataLoadState);
        setOfferingDraft(emptyOffering);
        setEditingOffering(null);
        setCompanyDraft({});
        setPrivateDraft({});
        setInviteEmail("");
        setInviteRole("MEMBER");
        setQuotationDrafts({});
        setSelectedRfqId("");
        setRfqResponseNote("");
        setQuotationFormOpen(false);
        setQuotationReview(false);
        setFulfillmentOrderId("");
        pendingFulfillment.current = null;
        try {
          sessionStorage.removeItem(selectedCompanyStorageKey);
        } catch {
          // No selected company remains active in component state.
        }
        setError([
          `Supplier companies: ${errorText(companiesResult.reason)}`,
          ...(invitationsResult.status === "rejected"
            ? [`Invitations: ${errorText(invitationsResult.reason)}`]
            : []),
        ].join(" "));
        return;
      }
      const nextCompanies = companiesResult.value;
      setCompanies(nextCompanies);
      setMembershipsLoaded(true);
      if (invitationsResult.status === "fulfilled") {
        setInvitations(invitationsResult.value);
        setInvitationError("");
      } else {
        setInvitations([]);
        setInvitationError(`Invitations could not be loaded: ${errorText(invitationsResult.reason)}`);
      }
      let saved = "";
      try {
        saved = sessionStorage.getItem(selectedCompanyStorageKey) || "";
      } catch {
        saved = "";
      }
      const savedMembership = nextCompanies.find((entry) => entry.status === "ACTIVE" && entry.company_id === saved);
      const selected = savedMembership?.company_id
        || nextCompanies.find((entry) => entry.status === "ACTIVE")?.company_id
        || "";
      setSelectedCompanyId(selected);
      if (selected) {
        try {
          sessionStorage.setItem(selectedCompanyStorageKey, selected);
        } catch {
          // Company selection remains in component state when storage is unavailable.
        }
      } else {
        try {
          sessionStorage.removeItem(selectedCompanyStorageKey);
        } catch {
          // Company selection remains in component state when storage is unavailable.
        }
      }
    } catch (loadError) {
      setError(errorText(loadError));
    } finally {
      setLoading(false);
    }
  }, []);

  const loadCompanyData = useCallback(async (
    companyId: string,
    includeArchivedOverride?: boolean,
  ) => {
    const sequence = ++companyLoadSequence.current;
    const current = () =>
      companyLoadSequence.current === sequence
      && selectedCompanyIdRef.current === companyId;
    setLoadingMoreRfqs(false);
    if (!companyId) {
      setCompany(null);
      setOfferings([]);
      setRfqs([]);
      setRfqCursor(null);
      setRfqsHaveMore(false);
      setOrders([]);
      setMembers([]);
      setDocuments([]);
      setLoadedData(emptySupplierDataLoadState);
      setOfferingDraft(emptyOffering);
      setEditingOffering(null);
      setCompanyDraft({});
      setPrivateDraft({});
      setInviteEmail("");
      setInviteRole("MEMBER");
      setQuotationDrafts({});
      setSelectedRfqId("");
      setRfqResponseNote("");
      setQuotationFormOpen(false);
      setQuotationReview(false);
      setFulfillmentOrderId("");
      pendingFulfillment.current = null;
      setLoading(false);
      return;
    }
    setLoading(true);
    setError("");
    setSuccess("");
    setCompany(null);
    setOfferings([]);
    setRfqs([]);
    setRfqCursor(null);
    setRfqsHaveMore(false);
    setOrders([]);
    setMembers([]);
    setDocuments([]);
    setLoadedData(emptySupplierDataLoadState);
    setOfferingDraft(emptyOffering);
    setEditingOffering(null);
    setCompanyDraft({});
    setPrivateDraft({});
    setInviteEmail("");
    setInviteRole("MEMBER");
    setQuotationDrafts({});
    setSelectedRfqId("");
    setRfqResponseNote("");
    setQuotationFormOpen(false);
    setQuotationReview(false);
    setFulfillmentOrderId("");
    pendingFulfillment.current = null;
    try {
      const membership = companiesRef.current.find((item) => item.company_id === companyId);
      const manager = membership?.role === "OWNER" || membership?.role === "ADMIN";
      const responses = await Promise.allSettled([
        procurementWorkspaceApi.getSupplierCompany(companyId),
        procurementWorkspaceApi.listSupplierOfferings(
          companyId,
          manager && (includeArchivedOverride ?? showArchivedRef.current),
        ),
        procurementWorkspaceApi.listSupplierRfqs(companyId),
        procurementWorkspaceApi.listSupplierPurchaseOrders(companyId),
        procurementWorkspaceApi.listSupplierMembers(companyId),
        manager
          ? procurementWorkspaceApi.listVerificationDocuments(companyId)
          : Promise.resolve([] as SupplierVerificationDocument[]),
        supplierSettingsLoadedRef.current
          ? Promise.resolve(null)
          : procurementWorkspaceApi.getSupplierSettings(),
      ]);
      if (!current()) return;
      const failures: string[] = [];
      const [companyResult, offeringsResult, rfqsResult, ordersResult, membersResult, documentsResult, settingsResult] = responses;
      setLoadedData({
        company: companyResult.status === "fulfilled",
        offerings: offeringsResult.status === "fulfilled",
        rfqs: rfqsResult.status === "fulfilled",
        orders: ordersResult.status === "fulfilled",
        members: membersResult.status === "fulfilled",
        documents: documentsResult.status === "fulfilled",
      });
      if (companyResult.status === "fulfilled") setCompany(companyResult.value);
      else failures.push(`Company profile: ${errorText(companyResult.reason)}`);
      if (offeringsResult.status === "fulfilled") setOfferings(offeringsResult.value);
      else failures.push(`Offerings: ${errorText(offeringsResult.reason)}`);
      if (rfqsResult.status === "fulfilled") {
        setRfqs(rfqsResult.value.items);
        setRfqCursor(rfqsResult.value.next_cursor);
        setRfqsHaveMore(rfqsResult.value.has_more);
      }
      else failures.push(`Incoming RFQs: ${errorText(rfqsResult.reason)}`);
      if (ordersResult.status === "fulfilled") setOrders(ordersResult.value);
      else failures.push(`Purchase orders: ${errorText(ordersResult.reason)}`);
      if (membersResult.status === "fulfilled") setMembers(membersResult.value);
      else failures.push(`Company members: ${errorText(membersResult.reason)}`);
      if (documentsResult.status === "fulfilled") setDocuments(documentsResult.value);
      else failures.push(`Verification documents: ${errorText(documentsResult.reason)}`);
      if (settingsResult.status === "fulfilled" && settingsResult.value) {
        setShowArchived(settingsResult.value.show_archived_offerings);
        setSupplierSettingsLoaded(true);
      } else if (settingsResult.status === "rejected") {
        failures.push(`Supplier settings: ${errorText(settingsResult.reason)}`);
      }
      setError(failures.join(" "));
      if (companyResult.status === "fulfilled") {
        setCompanyDraft({
          name: companyResult.value.name || "",
          description: companyResult.value.description || "",
          website: companyResult.value.website || "",
        });
        setPrivateDraft({
          registered_name: companyResult.value.registered_name || "",
          registration_number: companyResult.value.registration_number || "",
          contact_email: companyResult.value.contact_email || "",
          contact_phone: companyResult.value.contact_phone || "",
          registered_address: companyResult.value.registered_address || "",
        });
      }
    } finally {
      if (current()) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadMemberships();
  }, [loadMemberships]);

  useEffect(() => {
    if (selectedCompanyId) void loadCompanyData(selectedCompanyId);
  }, [selectedCompanyId, loadCompanyData]);

  useEffect(() => {
    if (!rfqs.some((rfq) => rfq.id === selectedRfqId)) {
      setSelectedRfqId(rfqs[0]?.id || "");
      setQuotationFormOpen(false);
      setQuotationReview(false);
    }
  }, [rfqs, selectedRfqId]);

  const selectCompany = (companyId: string) => {
    if (companyId !== selectedCompanyId) {
      setOfferingDraft(emptyOffering);
      setEditingOffering(null);
      setCompanyDraft({});
      setPrivateDraft({});
      setInviteEmail("");
      setInviteRole("MEMBER");
      setQuotationDrafts({});
      setSelectedRfqId("");
      setRfqResponseNote("");
      setQuotationFormOpen(false);
      setQuotationReview(false);
      setFulfillmentOrderId("");
      pendingFulfillment.current = null;
    }
    setSelectedCompanyId(companyId);
    setLoadingMoreRfqs(false);
    setFulfillmentOrderId("");
    pendingFulfillment.current = null;
    try {
      if (companyId) sessionStorage.setItem(selectedCompanyStorageKey, companyId);
      else sessionStorage.removeItem(selectedCompanyStorageKey);
    } catch {
      // Company selection remains in component state when storage is unavailable.
    }
  };

  const runAction = async (key: string, action: () => Promise<void>, message: string) => {
    setBusy(key);
    setError("");
    setSuccess("");
    try {
      await action();
      setSuccess(message);
      return true;
    } catch (actionError) {
      setError(errorText(actionError));
      return false;
    } finally {
      setBusy("");
    }
  };

  const changeMemberRole = async (member: SupplierMember, role: "ADMIN" | "MEMBER") => {
    await runAction(`member-${member.id}`, async () => {
      await procurementWorkspaceApi.updateSupplierMember(selectedCompanyId, member.id, role);
      await loadCompanyData(selectedCompanyId);
    }, "Member role updated.");
  };

  const transferOwnership = async (member: SupplierMember) => {
    if (!window.confirm(`Transfer ownership to ${member.name || member.invited_email || "this member"}? You will lose owner permissions.`)) return;
    await runAction(`member-${member.id}`, async () => {
      await procurementWorkspaceApi.transferSupplierOwnership(selectedCompanyId, member.id);
      await loadMemberships();
    }, "Company ownership transferred.");
  };

  const revokeMember = async (member: SupplierMember) => {
    if (!window.confirm(member.status === "PENDING" ? "Cancel this pending invitation?" : `Revoke ${member.name || member.invited_email || "this member"}'s access?`)) return;
    await runAction(`member-${member.id}`, async () => {
      await procurementWorkspaceApi.revokeSupplierMember(selectedCompanyId, member.id);
      await loadCompanyData(selectedCompanyId);
    }, member.status === "PENDING" ? "Invitation cancelled." : "Member access revoked.");
  };

  const loadMoreRfqs = async () => {
    if (!selectedCompanyId || !rfqCursor || loadingMoreRfqs) return;
    const companyId = selectedCompanyId;
    const sequence = companyLoadSequence.current;
    setLoadingMoreRfqs(true);
    setError("");
    try {
      const nextPage = await procurementWorkspaceApi.listSupplierRfqs(companyId, rfqCursor);
      if (companyLoadSequence.current !== sequence || selectedCompanyId !== companyId) return;
      setRfqs((current) => [...current, ...nextPage.items]);
      setRfqCursor(nextPage.next_cursor);
      setRfqsHaveMore(nextPage.has_more);
    } catch (loadError) {
      setError(`Incoming RFQs: ${errorText(loadError)}`);
    } finally {
      if (companyLoadSequence.current === sequence) setLoadingMoreRfqs(false);
    }
  };

  const refreshCompanyData = async () => {
    if (!selectedCompanyId) return;
    await Promise.all([loadMemberships(), loadCompanyData(selectedCompanyId)]);
  };

  const createCompany = async (event: FormEvent) => {
    event.preventDefault();
    await runAction("create-company", async () => {
      const result = await procurementWorkspaceApi.createSupplierCompany(
        Object.fromEntries(Object.entries(newCompanyDraft).map(([key, value]) => [key, value.trim() || null])),
      );
      const nextMemberships = await procurementWorkspaceApi.listSupplierCompanies();
      setCompanies(nextMemberships);
      selectCompany(result.id);
    }, "Supplier company created.");
  };

  const saveCompanyProfile = async (event: FormEvent) => {
    event.preventDefault();
    if (!selectedCompanyId) return;
    await runAction("company-profile", async () => {
      await procurementWorkspaceApi.updateSupplierCompany(selectedCompanyId, {
        name: companyDraft.name.trim(),
        description: companyDraft.description.trim() || null,
        website: companyDraft.website.trim() || null,
      });
      await loadCompanyData(selectedCompanyId);
    }, "Company profile saved.");
  };

  const savePrivateProfile = async (event: FormEvent) => {
    event.preventDefault();
    if (!selectedCompanyId) return;
    await runAction("private-profile", async () => {
      await procurementWorkspaceApi.updateSupplierPrivateProfile(
        selectedCompanyId,
        Object.fromEntries(Object.entries(privateDraft).map(([key, value]) => [key, value.trim() || null])),
      );
      await loadCompanyData(selectedCompanyId);
    }, "Private company details saved.");
  };

  const uploadVerificationDocument = async (event: FormEvent) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget as HTMLFormElement);
    const documentType = String(form.get("document_type") || "");
    const file = form.get("file");
    if (!(file instanceof File) || !file.size) {
      setError("Choose a verification document to upload.");
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setError("Choose a verification document no larger than 10 MB.");
      return;
    }
    const extension = file.name.split(".").pop()?.toLowerCase();
    const expectedMime = extension === "pdf"
      ? "application/pdf"
      : extension === "jpg" || extension === "jpeg"
        ? "image/jpeg"
        : extension === "png"
          ? "image/png"
          : "";
    if (!expectedMime || file.type !== expectedMime) {
      setError("Choose a PDF, JPEG, or PNG file whose extension matches its file type.");
      return;
    }
    if (!canEditVerification) {
      setError("Verification documents cannot be changed while this company is under review or already verified.");
      return;
    }
    await runAction("verification-upload", async () => {
      await procurementWorkspaceApi.uploadVerificationDocument(selectedCompanyId, documentType, file);
      await loadCompanyData(selectedCompanyId);
    }, "Verification document uploaded.");
  };

  const saveOffering = async (event: FormEvent) => {
    event.preventDefault();
    if (!selectedCompanyId) return;
    await runAction("offering", async () => {
      const saved = await procurementWorkspaceApi.saveSupplierOffering(
        selectedCompanyId,
        {
          ...offeringDraft,
          specification: offeringDraft.specification.trim() || null,
          indicative_price: offeringDraft.indicative_price.trim() || null,
          currency_code: offeringDraft.indicative_price ? offeringDraft.currency_code : null,
          minimum_order_quantity: offeringDraft.minimum_order_quantity.trim() || null,
          service_coverage: offeringDraft.service_coverage.split(/\r?\n/).map((area) => area.trim()).filter(Boolean),
        },
        editingOffering || undefined,
      );
      setOfferings((items) => [saved, ...items.filter((item) => item.id !== saved.id)]);
      setOfferingDraft(emptyOffering);
      setEditingOffering(null);
    }, editingOffering ? "Offering updated." : "Offering created.");
  };

  const archiveOffering = async (offering: SupplierOffering) => {
    if (!window.confirm(`Archive offering "${offering.name}"?`)) return;
    await runAction(`archive-${offering.id}`, async () => {
      const archived = await procurementWorkspaceApi.archiveSupplierOffering(selectedCompanyId, offering);
      setOfferings((items) => items.map((item) => item.id === archived.id ? archived : item));
    }, "Offering archived.");
  };

  const createQuotationDraft = (rfq: SupplierRFQ): SupplierQuotationSubmission => ({
    expected_rfq_updated_at: rfq.updated_at,
    unit_price: rfq.quotation ? String(rfq.quotation.unit_price) : "",
    currency: rfq.quotation?.currency || "INR",
    quantity_offered: rfq.quotation ? String(rfq.quotation.quantity_offered) : String(rfq.quantity),
    unit: rfq.quotation?.unit || (supplierUnits.includes(rfq.unit as ProcurementUnit) ? rfq.unit as ProcurementUnit : "MT"),
    estimated_delivery_lead_time_days: rfq.quotation?.estimated_delivery_lead_time_days || 7,
    quotation_valid_until: rfq.quotation?.quotation_valid_until || quotationDateDefault(),
    delivery_terms: rfq.quotation?.delivery_terms || "",
    notes: rfq.quotation?.notes || null,
    expected_revision: rfq.quotation?.revision ?? null,
  });

  const selectedRfq = rfqs.find((rfq) => rfq.id === selectedRfqId) || null;
  const selectedQuotationDraft = selectedRfq
    ? quotationDrafts[selectedRfq.id] || createQuotationDraft(selectedRfq)
    : null;

  const quotationValidationError = (quotation: SupplierQuotationSubmission) => {
    if (
      !Number.isFinite(Number(quotation.unit_price)) ||
      Number(quotation.unit_price) < 0 ||
      !Number.isFinite(Number(quotation.quantity_offered)) ||
      Number(quotation.quantity_offered) <= 0 ||
      !Number.isInteger(quotation.estimated_delivery_lead_time_days) ||
      quotation.estimated_delivery_lead_time_days < 1 ||
      quotation.quotation_valid_until < localDateString() ||
      !quotation.delivery_terms.trim()
    ) {
      return "Check the price, positive offered quantity, delivery lead time, validity date, and delivery terms.";
    }
    return "";
  };

  const reviewQuotation = (event: FormEvent) => {
    event.preventDefault();
    if (!selectedRfq || !selectedQuotationDraft) return;
    const validationError = quotationValidationError(selectedQuotationDraft);
    if (validationError) {
      setError(validationError);
      return;
    }
    setError("");
    setQuotationReview(true);
  };

  const submitQuotation = async (rfq: SupplierRFQ) => {
    if (rfq.status !== "OPEN" || Date.parse(rfq.quotation_deadline) <= Date.now()) {
      setError("This RFQ is closed or past its quotation deadline.");
      return;
    }
    const quotation = quotationDrafts[rfq.id] || createQuotationDraft(rfq);
    const validationError = quotationValidationError(quotation);
    if (validationError) {
      setError(validationError);
      return;
    }
    const completed = await runAction(`quotation-${rfq.id}`, async () => {
      await procurementWorkspaceApi.submitSupplierQuotation(selectedCompanyId, rfq.id, quotation);
      await loadCompanyData(selectedCompanyId);
    }, "Quotation submitted.");
    if (completed) {
      setQuotationDrafts((current) => {
        const next = { ...current };
        delete next[rfq.id];
        return next;
      });
      setQuotationReview(false);
      setQuotationFormOpen(false);
    }
  };

  const respondToRfq = async (
    rfq: SupplierRFQ,
    status: "ACKNOWLEDGED" | "DECLINED",
  ) => {
    if (rfq.status !== "OPEN" || Date.parse(rfq.quotation_deadline) <= Date.now() || rfq.recipient_status !== "INVITED") {
      setError("This RFQ is no longer accepting supplier responses.");
      return;
    }
    const completed = await runAction(`rfq-${status.toLowerCase()}-${rfq.id}`, async () => {
      await procurementWorkspaceApi.respondToSupplierRfq(
        selectedCompanyId,
        rfq.id,
        status,
        rfqResponseNote.trim() || null,
      );
      await loadCompanyData(selectedCompanyId);
    }, status === "ACKNOWLEDGED" ? "RFQ acknowledged." : "RFQ declined.");
    if (completed) setRfqResponseNote("");
  };

  const updateFulfillment = async (event: FormEvent, order: ProcurementPurchaseOrder) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget as HTMLFormElement);
    const fulfillmentStatus = String(form.get("status") || defaultFulfillmentStatus(order)) as SupplierFulfillmentUpdate["status"];
    const dispatchedQuantity = Number(form.get("dispatched_quantity") || "0");
    const deliveredQuantity = Number(form.get("delivered_quantity") || "0");
    const dispatchDate = String(form.get("dispatch_date") || "");
    const deliveryDate = String(form.get("delivery_date") || "");
    if (fulfillmentStatus === "DISPATCHED" && dispatchedQuantity <= 0) {
      setError("Enter a positive additional dispatched quantity.");
      return;
    }
    if (fulfillmentStatus === "PREPARING" && dispatchedQuantity > 0) {
      setError("A preparing update cannot include dispatched quantity.");
      return;
    }
    if (["PARTIALLY_DELIVERED", "DELIVERED"].includes(fulfillmentStatus) && deliveredQuantity <= 0) {
      setError("Enter a positive additional delivered quantity.");
      return;
    }
    if (dispatchedQuantity > 0 && (!dispatchDate || dispatchDate > localDateString())) {
      setError("Enter a dispatch date that is not in the future.");
      return;
    }
    if (deliveredQuantity > 0 && (!deliveryDate || deliveryDate > localDateString())) {
      setError("Enter a delivery date that is not in the future.");
      return;
    }
    await runAction(`fulfillment-${order.id}`, async () => {
      const payload: SupplierFulfillmentUpdate = {
        idempotency_key: "",
        status: fulfillmentStatus,
        dispatched_quantity: String(form.get("dispatched_quantity") || "0").trim(),
        delivered_quantity: String(form.get("delivered_quantity") || "0").trim(),
        unit: order.unit,
        dispatch_date: dispatchDate || null,
        carrier: String(form.get("carrier") || "").trim() || null,
        tracking_reference: String(form.get("tracking_reference") || "").trim() || null,
        estimated_delivery_date: String(form.get("estimated_delivery_date") || "") || null,
        delivery_date: deliveryDate || null,
        delivery_notes: String(form.get("delivery_notes") || "").trim() || null,
      };
      const signature = JSON.stringify({ ...payload, idempotency_key: undefined });
      if (!pendingFulfillment.current
        || pendingFulfillment.current.orderId !== order.id
        || pendingFulfillment.current.signature !== signature) {
        pendingFulfillment.current = {
          orderId: order.id,
          signature,
          idempotencyKey: crypto.randomUUID(),
        };
      }
      payload.idempotency_key = pendingFulfillment.current.idempotencyKey;
      await procurementWorkspaceApi.updateSupplierPurchaseOrderFulfillment(selectedCompanyId, order.id, payload);
      pendingFulfillment.current = null;
      setFulfillmentOrderId("");
      await loadCompanyData(selectedCompanyId);
    }, "Fulfilment update recorded.");
  };

  const managerControls = (children: ReactNode) => canManage
    ? children
    : <p className="procurement-workspace-note">Your supplier-company role is {company?.role || "read-only"}; only active owners and admins can make this change.</p>;
  const activeOrders = orders.filter((order) =>
    ["ISSUED", "ACCEPTED", "PREPARING", "DISPATCHED", "PARTIALLY_DELIVERED"].includes(order.status),
  );
  const historicalOrders = orders.filter((order) =>
    ["DELIVERED", "REJECTED", "CANCELLED"].includes(order.status),
  );
  const sectionTitles: Record<SupplierSection, string> = {
    dashboard: "Provide Procurement",
    offerings: "Material Offerings",
    rfqs: "RFQs & Quotations",
    orders: "Orders & Fulfilment",
    history: "Order History",
    companies: "Companies & Verification",
    settings: "Settings",
  };

  if (loading && !membershipsLoaded) {
    return <main className="procurement-workspace"><div className="procurement-workspace-state" role="status"><LoaderCircle className="procurement-agent-spin" size={21} />Loading supplier companies…</div></main>;
  }
  if (!membershipsLoaded) {
    return (
      <main className="procurement-workspace">
        <div className="procurement-workspace-alert is-error" role="alert">
          <AlertCircle size={17} />
          <span>{error || "Supplier companies could not be loaded."}</span>
          <button type="button" onClick={() => void loadMemberships()}>Retry</button>
        </div>
      </main>
    );
  }

  return (
    <main className="procurement-workspace">
      <header className="procurement-workspace-heading">
        <div className="procurement-workspace-title">
          <h1>{sectionTitles[section]}</h1>
        </div>
        <div className="procurement-workspace-heading-actions">
          {activeMemberships.length > 1 && (
            <label className="procurement-workspace-company-picker">
              <span className="sr-only">Select supplier company</span>
              <select
                value={selectedCompanyId}
                onChange={(event) => selectCompany(event.target.value)}
                aria-label="Select supplier company"
              >
                {activeMemberships.map((membership) => (
                  <option key={membership.company_id} value={membership.company_id}>
                    {membership.company_name} ({membership.role})
                  </option>
                ))}
              </select>
            </label>
          )}
          <button className="procurement-workspace-icon-button" type="button" aria-label="Refresh supplier data" onClick={() => void refreshCompanyData()}><RefreshCw size={18} /></button>
        </div>
      </header>

      {error && <div className="procurement-workspace-alert is-error" role="alert"><AlertCircle size={17} /><span>{error}</span><button type="button" onClick={() => void refreshCompanyData()}>Retry</button></div>}
      {invitationError && <div className="procurement-workspace-alert is-error" role="alert"><AlertCircle size={17} /><span>{invitationError}</span><button type="button" onClick={() => void loadMemberships()}>Retry invitations</button></div>}
      {success && <div className="procurement-workspace-alert is-success" role="status"><Check size={17} /><span>{success}</span></div>}

      {selectedCompanyId && loading && !company && (
        <div className="procurement-workspace-panel procurement-workspace-state" role="status">
          <LoaderCircle className="procurement-agent-spin" size={19} />
          Loading selected supplier company…
        </div>
      )}
      {selectedCompanyId && !loading && !company && (
        <div className="procurement-workspace-alert is-error" role="alert">
          <AlertCircle size={17} />
          <span>Selected supplier company details could not be loaded.</span>
          <button type="button" onClick={() => void loadCompanyData(selectedCompanyId)}>Retry</button>
        </div>
      )}

      {!selectedCompanyId && section === "dashboard" && (
        <section className="procurement-workspace-panel procurement-workspace-onboarding">
          <Building2 size={34} aria-hidden="true" />
          <h2>Welcome to Supplier Workspace</h2>
          <p>To start receiving RFQs and participating in procurement, create or join a supplier company.</p>
          <Link className="procurement-workspace-primary" to="/supplier/company">Set up supplier company</Link>
          {invitations.length > 0 && (
            <div className="procurement-workspace-invitations">
              <h3>Supplier invitations</h3>
              {invitations.map((invitation) => (
                <article className="procurement-workspace-card" key={invitation.id}>
                  <div className="procurement-workspace-card-head">
                    <div><h3>{invitation.company_name}</h3><p>{invitation.status}</p></div>
                    <button className="procurement-workspace-primary" type="button" disabled={busy === `invite-${invitation.id}`} onClick={() => void runAction(`invite-${invitation.id}`, async () => { await procurementWorkspaceApi.acceptSupplierInvitation(invitation.id); await loadMemberships(); }, "Invitation accepted.")}>Accept invitation</button>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      )}

      {section === "companies" && invitations.length > 0 && (
        <section className="procurement-workspace-panel">
          <h2>Supplier invitations</h2>
          {invitations.map((invitation) => (
            <article className="procurement-workspace-card" key={invitation.id}>
              <div className="procurement-workspace-card-head">
                <div><h3>{invitation.company_name}</h3><p>{invitation.status}</p></div>
                <button className="procurement-workspace-primary" type="button" disabled={busy === `invite-${invitation.id}`} onClick={() => void runAction(`invite-${invitation.id}`, async () => { await procurementWorkspaceApi.acceptSupplierInvitation(invitation.id); await loadMemberships(); }, "Invitation accepted.")}>Accept invitation</button>
              </div>
            </article>
          ))}
        </section>
      )}

      {section === "companies" && (
        <section className="procurement-workspace-panel procurement-workspace-create-company">
          <details open={!selectedCompanyId}>
            <summary><Building2 size={18} /> Create supplier company</summary>
            <p className="procurement-workspace-note">
              Your existing GLESKA login is used. Creating a supplier company adds a supplier profile without changing your employer account.
            </p>
            <form className="procurement-workspace-form" onSubmit={(event) => void createCompany(event)}>
              <label>Company name<input required minLength={2} maxLength={160} value={newCompanyDraft.name} onChange={(event) => setNewCompanyDraft({ ...newCompanyDraft, name: event.target.value })} /></label>
              <label>Public company description<textarea maxLength={2000} value={newCompanyDraft.description} onChange={(event) => setNewCompanyDraft({ ...newCompanyDraft, description: event.target.value })} /></label>
              <label>Public website<input type="url" value={newCompanyDraft.website} onChange={(event) => setNewCompanyDraft({ ...newCompanyDraft, website: event.target.value })} placeholder="https://" /></label>
              <h3>Private registration and contact details</h3>
              <p className="procurement-workspace-note">Only the company owner and admins can view these values.</p>
              <div className="procurement-workspace-inline">
                <label>Registered name<input maxLength={200} value={newCompanyDraft.registered_name} onChange={(event) => setNewCompanyDraft({ ...newCompanyDraft, registered_name: event.target.value })} /></label>
                <label>Registration number<input maxLength={100} value={newCompanyDraft.registration_number} onChange={(event) => setNewCompanyDraft({ ...newCompanyDraft, registration_number: event.target.value })} /></label>
              </div>
              <div className="procurement-workspace-inline">
                <label>Private contact email<input type="email" value={newCompanyDraft.contact_email} onChange={(event) => setNewCompanyDraft({ ...newCompanyDraft, contact_email: event.target.value })} /></label>
                <label>Private contact phone<input maxLength={32} value={newCompanyDraft.contact_phone} onChange={(event) => setNewCompanyDraft({ ...newCompanyDraft, contact_phone: event.target.value })} /></label>
              </div>
              <label>Registered address<textarea maxLength={1000} value={newCompanyDraft.registered_address} onChange={(event) => setNewCompanyDraft({ ...newCompanyDraft, registered_address: event.target.value })} /></label>
              <button className="procurement-workspace-primary" type="submit" disabled={busy === "create-company"}>
                <Building2 size={16} />{busy === "create-company" ? "Creating…" : "Create supplier company"}
              </button>
            </form>
          </details>
        </section>
      )}

      {!selectedCompanyId && section !== "dashboard" && section !== "companies" && (
        <section className="procurement-workspace-panel">
          <h2>Supplier company required</h2>
          <p className="procurement-workspace-note">Create a supplier company or accept an invitation before managing offerings, RFQs, or orders.</p>
          <Link className="procurement-workspace-primary" to="/supplier/company">Open Companies &amp; Verification</Link>
        </section>
      )}

      {company && selectedCompanyId && section === "dashboard" && (
        <>
          <section className="procurement-supplier-summary" aria-label="Supplier summary">
            <Link className="procurement-supplier-summary-card is-purple" to="/supplier/rfqs">
              <span className="procurement-supplier-summary-top">
                <span>RFQ Invitations</span>
                <span className="procurement-supplier-summary-icon"><ClipboardList size={16} /></span>
              </span>
              <strong>{loadedData.rfqs && !rfqsHaveMore ? rfqs.filter((rfq) => rfq.recipient_status === "INVITED" && rfq.status === "OPEN").length : "—"}</strong>
              <small>Pending response</small>
            </Link>
            <Link className="procurement-supplier-summary-card is-blue" to="/supplier/orders">
              <span className="procurement-supplier-summary-top">
                <span>Active Orders</span>
                <span className="procurement-supplier-summary-icon"><Truck size={16} /></span>
              </span>
              <strong>{loadedData.orders ? activeOrders.length : "—"}</strong>
              <small>In fulfilment</small>
            </Link>
            <Link className="procurement-supplier-summary-card is-emerald" to="/supplier/offerings">
              <span className="procurement-supplier-summary-top">
                <span>Catalogue</span>
                <span className="procurement-supplier-summary-icon"><Building2 size={16} /></span>
              </span>
              <strong className="is-label">Material Offerings</strong>
              <small>Manage supply items</small>
            </Link>
            <Link className="procurement-supplier-summary-card is-indigo" to="/supplier/company">
              <span className="procurement-supplier-summary-top">
                <span>Verification</span>
                <span className="procurement-supplier-summary-icon"><Building2 size={16} /></span>
              </span>
              <strong className="is-label">{loadedData.company ? company.verification_status.replaceAll("_", " ") || "Company Profile" : "Company Profile unavailable"}</strong>
              <small>Evidence &amp; team</small>
            </Link>
          </section>

          <section className="procurement-supplier-quick-access">
            <h2>Operations &amp; Quick Access</h2>
            <div>
              <Link className="procurement-supplier-quick-card is-purple" to="/supplier/rfqs">
                <span><ClipboardList size={19} /></span>
                <span><strong>RFQs &amp; Quotations</strong><small>Review invitations from buyers, acknowledge deadlines, and submit competitive quotations.</small></span>
              </Link>
              <Link className="procurement-supplier-quick-card is-blue" to="/supplier/orders">
                <span><Truck size={19} /></span>
                <span><strong>Purchase Orders &amp; Fulfilment</strong><small>Accept or reject issued purchase orders and record progressive dispatch &amp; delivery milestones.</small></span>
              </Link>
            </div>
          </section>
        </>
      )}

      {company && selectedCompanyId && section === "offerings" && (
        <>
          <section className="procurement-workspace-panel procurement-workspace-form">
              <h2>{editingOffering ? "Edit supplier offering" : "Add material or service offering"}</h2>
              {managerControls(<form className="procurement-workspace-form" onSubmit={(event) => void saveOffering(event)}>
                <label>Name<input required value={offeringDraft.name} onChange={(event) => setOfferingDraft({ ...offeringDraft, name: event.target.value })} /></label>
                <label>Specification<textarea value={offeringDraft.specification} onChange={(event) => setOfferingDraft({ ...offeringDraft, specification: event.target.value })} /></label>
                <div className="procurement-workspace-inline"><label>Unit<input required value={offeringDraft.unit} onChange={(event) => setOfferingDraft({ ...offeringDraft, unit: event.target.value })} /></label><label>Indicative price<input type="number" min="0" step="any" value={offeringDraft.indicative_price} onChange={(event) => setOfferingDraft({ ...offeringDraft, indicative_price: event.target.value })} /></label></div>
                <div className="procurement-workspace-inline"><label>Currency<input value={offeringDraft.currency_code} onChange={(event) => setOfferingDraft({ ...offeringDraft, currency_code: event.target.value.toUpperCase() })} /></label><label>Minimum order quantity<input type="number" min="0" step="any" value={offeringDraft.minimum_order_quantity} onChange={(event) => setOfferingDraft({ ...offeringDraft, minimum_order_quantity: event.target.value })} /></label></div>
                <label>Service coverage (one area per line)<textarea value={offeringDraft.service_coverage} onChange={(event) => setOfferingDraft({ ...offeringDraft, service_coverage: event.target.value })} /></label>
                <label className="procurement-workspace-check"><input type="checkbox" checked={offeringDraft.is_available} onChange={(event) => setOfferingDraft({ ...offeringDraft, is_available: event.target.checked })} />Available for matching</label>
                <div className="procurement-workspace-actions"><button className="procurement-workspace-primary" type="submit" disabled={busy === "offering"}><Save size={16} />{busy === "offering" ? "Saving…" : "Save offering"}</button>{editingOffering && <button className="procurement-workspace-secondary" type="button" onClick={() => { setEditingOffering(null); setOfferingDraft(emptyOffering); }}>Cancel</button>}</div>
              </form>)}
            </section>
            <section className="procurement-workspace-panel"><div className="procurement-workspace-panel-heading"><h2>Company offerings</h2>{canManage && <label className="procurement-workspace-check"><input type="checkbox" checked={showArchived} disabled={busy === "archived-setting"} onChange={(event) => { const includeArchived = event.currentTarget.checked; void runAction("archived-setting", async () => { const saved = await procurementWorkspaceApi.updateSupplierSettings(includeArchived); setShowArchived(saved.show_archived_offerings); setSupplierSettingsLoaded(true); await loadCompanyData(selectedCompanyId, saved.show_archived_offerings); }, "Supplier settings updated."); }} />Show archived</label>}</div>
              {!loadedData.offerings
                ? <p className="procurement-workspace-empty">Company offerings could not be loaded. Retry the supplier data request.</p>
                : offerings.length === 0
                  ? <p className="procurement-workspace-empty">No offerings found for this supplier company.</p>
                  : offerings.map((offering) => <article className="procurement-workspace-card" key={offering.id}><div className="procurement-workspace-card-head"><div><h3>{offering.name}</h3><p>{offering.unit} · {offering.is_available ? "Available" : "Unavailable"}{offering.archived_at ? " · Archived" : ""}</p></div>{canManage && !offering.archived_at && <div className="procurement-workspace-actions"><button className="procurement-workspace-secondary" type="button" onClick={() => { setEditingOffering(offering); setOfferingDraft({ name: offering.name, specification: offering.specification || "", unit: offering.unit, indicative_price: offering.indicative_price || "", currency_code: offering.currency_code || "INR", minimum_order_quantity: offering.minimum_order_quantity || "", is_available: offering.is_available, service_coverage: offering.service_coverage.join("\n") }); }}>Edit</button><button className="procurement-workspace-danger" type="button" onClick={() => void archiveOffering(offering)} disabled={busy === `archive-${offering.id}`}><Trash2 size={14} />Archive</button></div>}</div><p>{offering.specification || "No specification"}</p><small>{offering.indicative_price ? `${offering.currency_code || ""} ${offering.indicative_price} / ${offering.unit}` : "Price not listed"}{offering.service_coverage.length ? ` · ${offering.service_coverage.join(", ")}` : ""}</small></article>)}
          </section>
        </>
      )}

      {company && selectedCompanyId && section === "rfqs" && (
        <section className="procurement-workspace-panel procurement-rfq-inbox">
          <header className="procurement-rfq-toolbar">
            <div className="procurement-rfq-title">
              <span className="procurement-rfq-icon"><ClipboardList size={17} /></span>
              <span>
                <strong>RFQ Inbox</strong>
                <small>Incoming buyer invitations · acknowledge, quote, or decline</small>
              </span>
            </div>
            <div className="procurement-workspace-actions">
              {rfqs.length > 1 && (
                <label className="procurement-workspace-rfq-picker">
                  <span className="sr-only">Select RFQ</span>
                  <select
                    aria-label="Select RFQ"
                    value={selectedRfqId}
                    onChange={(event) => {
                      setSelectedRfqId(event.target.value);
                      setRfqResponseNote("");
                      setQuotationFormOpen(false);
                      setQuotationReview(false);
                      setError("");
                      setSuccess("");
                    }}
                  >
                    {rfqs.map((rfq) => (
                      <option key={rfq.id} value={rfq.id}>
                        {rfq.item_name} ({rfq.quantity} {rfq.unit})
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <button
                className="procurement-workspace-secondary"
                type="button"
                onClick={() => void refreshCompanyData()}
                disabled={loading}
              >
                <RefreshCw size={14} className={loading ? "procurement-agent-spin" : ""} />
                Refresh
              </button>
            </div>
          </header>

          {!loadedData.rfqs ? (
            <p className="procurement-workspace-empty">Incoming RFQs could not be loaded. Retry the supplier data request.</p>
          ) : rfqs.length === 0 ? (
            <p className="procurement-workspace-empty">No RFQs have been addressed to this company yet.</p>
          ) : (
            <>
              {rfqsHaveMore && (
                <div className="procurement-workspace-load-more">
                  <button
                    className="procurement-workspace-secondary"
                    type="button"
                    disabled={loadingMoreRfqs}
                    onClick={() => void loadMoreRfqs()}
                  >
                    {loadingMoreRfqs ? <LoaderCircle size={14} className="procurement-agent-spin" /> : null}
                    {loadingMoreRfqs ? "Loading more RFQs…" : "Load more RFQs"}
                  </button>
                </div>
              )}

              {selectedRfq && selectedQuotationDraft && (() => {
                const acceptsResponses = selectedRfq.status === "OPEN"
                  && Date.parse(selectedRfq.quotation_deadline) > Date.now()
                  && selectedRfq.recipient_status !== "DECLINED";
                const canRespond = acceptsResponses && selectedRfq.recipient_status === "INVITED";
                const updateQuotation = (changes: Partial<SupplierQuotationSubmission>) => {
                  setQuotationDrafts((current) => ({
                    ...current,
                    [selectedRfq.id]: { ...selectedQuotationDraft, ...changes },
                  }));
                };
                return (
                  <article className="procurement-workspace-rfq-detail">
                    <header className="procurement-rfq-detail-heading">
                      <div>
                        <span className="procurement-rfq-buyer-badge">Buyer Request</span>
                        <h2>{selectedRfq.item_name}</h2>
                      </div>
                      <div className="procurement-workspace-actions">
                        <span className={`procurement-workspace-status ${selectedRfq.status === "OPEN" ? "is-open" : ""}`}>{selectedRfq.status}</span>
                        <span className={`procurement-workspace-status ${selectedRfq.recipient_status === "INVITED" ? "is-invited" : ""}`}>{selectedRfq.recipient_status}</span>
                      </div>
                    </header>

                    <dl className="procurement-rfq-facts">
                      <div><dt>Quantity</dt><dd>{selectedRfq.quantity} {selectedRfq.unit}</dd></div>
                      <div><dt>Deadline</dt><dd>{new Date(selectedRfq.quotation_deadline).toLocaleDateString()}</dd></div>
                      <div className="is-wide"><dt>Location</dt><dd>{selectedRfq.delivery_location}</dd></div>
                    </dl>

                    {(selectedRfq.specification || selectedRfq.buyer_notes) && (
                      <div className="procurement-rfq-notes">
                        {selectedRfq.specification && (
                          <div>
                            <h3>Specification &amp; Requirements</h3>
                            <p>{selectedRfq.specification}</p>
                          </div>
                        )}
                        {selectedRfq.buyer_notes && (
                          <div>
                            <h3>Buyer Notes</h3>
                            <p>{selectedRfq.buyer_notes}</p>
                          </div>
                        )}
                      </div>
                    )}

                    {selectedRfq.responded_at && (
                      <div className="procurement-rfq-response">
                        <strong>Your Response</strong>
                        <p>{selectedRfq.recipient_status} · {new Date(selectedRfq.responded_at).toLocaleString()}</p>
                        {selectedRfq.response_note && <p>{selectedRfq.response_note}</p>}
                      </div>
                    )}

                    {canRespond && (
                      <section className="procurement-rfq-response-actions">
                        <label>
                          Response note (optional)
                          <textarea
                            maxLength={2000}
                            value={rfqResponseNote}
                            onChange={(event) => setRfqResponseNote(event.target.value)}
                          />
                        </label>
                        <div className="procurement-workspace-actions">
                          <button
                            className="procurement-workspace-primary"
                            type="button"
                            disabled={busy === `rfq-acknowledged-${selectedRfq.id}`}
                            onClick={() => void respondToRfq(selectedRfq, "ACKNOWLEDGED")}
                          >
                            {busy === `rfq-acknowledged-${selectedRfq.id}` ? "Saving…" : "Acknowledge"}
                          </button>
                          <button
                            className="procurement-workspace-danger"
                            type="button"
                            disabled={busy === `rfq-declined-${selectedRfq.id}`}
                            onClick={() => {
                              if (window.confirm("Decline this RFQ invitation?")) {
                                void respondToRfq(selectedRfq, "DECLINED");
                              }
                            }}
                          >
                            Decline
                          </button>
                        </div>
                      </section>
                    )}

                    {selectedRfq.quotation && (
                      <section className="procurement-rfq-existing-quote">
                        <h3>{selectedRfq.quotation.revision > 1 ? "Current quotation" : "Submitted quotation"}</h3>
                        <div className="procurement-rfq-facts">
                          <div><dt>Price</dt><dd>{selectedRfq.quotation.currency} {selectedRfq.quotation.unit_price} / {selectedRfq.quotation.unit}</dd></div>
                          <div><dt>Quantity offered</dt><dd>{selectedRfq.quotation.quantity_offered} {selectedRfq.quotation.unit}</dd></div>
                          <div><dt>Lead time</dt><dd>{selectedRfq.quotation.estimated_delivery_lead_time_days} days</dd></div>
                          {selectedRfq.quotation.delivery_terms && <div className="is-wide"><dt>Delivery terms</dt><dd>{selectedRfq.quotation.delivery_terms}</dd></div>}
                        </div>
                      </section>
                    )}

                    {selectedRfq.recipient_status === "DECLINED" && (
                      <p className="procurement-workspace-note">Your company declined this invitation, so a quotation cannot be submitted.</p>
                    )}
                    {!acceptsResponses && selectedRfq.recipient_status !== "DECLINED" && (
                      <p className="procurement-workspace-note">This RFQ is closed or past its response deadline. Quotations can no longer be submitted or edited.</p>
                    )}

                    {acceptsResponses && (
                      <section className="procurement-rfq-quotation">
                        <header>
                          <div>
                            <h3>Quotation</h3>
                            <p>{selectedRfq.quotation ? "Review or update the quotation submitted by your company." : "Submit your company's price and delivery terms for this request."}</p>
                          </div>
                          {!quotationFormOpen && (
                            <button
                              className="procurement-workspace-primary"
                              type="button"
                              onClick={() => {
                                setQuotationDrafts((current) => ({
                                  ...current,
                                  [selectedRfq.id]: current[selectedRfq.id] || createQuotationDraft(selectedRfq),
                                }));
                                setQuotationFormOpen(true);
                                setQuotationReview(false);
                              }}
                            >
                              {selectedRfq.quotation ? "Edit quotation" : "Submit quotation"}
                            </button>
                          )}
                        </header>

                        {quotationFormOpen && (
                          quotationReview ? (
                            <div className="procurement-rfq-review">
                              <h4>Review your quotation</h4>
                              <p className="procurement-workspace-note">
                                {selectedQuotationDraft.currency} {selectedQuotationDraft.unit_price} / {selectedQuotationDraft.unit}
                                {" · "}{selectedQuotationDraft.quantity_offered} {selectedQuotationDraft.unit}
                              </p>
                              <p className="procurement-workspace-note">
                                Requested: {selectedRfq.quantity} {selectedRfq.unit}
                                {selectedQuotationDraft.unit.toLowerCase() !== selectedRfq.unit.trim().toLowerCase()
                                  ? " — different unit; the buyer will see this as non-comparable."
                                  : ""}
                              </p>
                              <dl className="procurement-rfq-facts">
                                <div><dt>Estimated delivery</dt><dd>{selectedQuotationDraft.estimated_delivery_lead_time_days} days</dd></div>
                                <div><dt>Valid until</dt><dd>{selectedQuotationDraft.quotation_valid_until}</dd></div>
                                <div className="is-wide"><dt>Delivery terms</dt><dd>{selectedQuotationDraft.delivery_terms}</dd></div>
                                {selectedQuotationDraft.notes && <div className="is-wide"><dt>Notes</dt><dd>{selectedQuotationDraft.notes}</dd></div>}
                              </dl>
                              <div className="procurement-workspace-actions">
                                <button className="procurement-workspace-secondary" type="button" onClick={() => setQuotationReview(false)}>Edit quotation</button>
                                <button className="procurement-workspace-primary" type="button" disabled={busy === `quotation-${selectedRfq.id}`} onClick={() => void submitQuotation(selectedRfq)}>
                                  <Check size={15} />
                                  {busy === `quotation-${selectedRfq.id}` ? "Saving…" : "Confirm and submit"}
                                </button>
                              </div>
                            </div>
                          ) : (
                            <form className="procurement-workspace-form procurement-rfq-form" onSubmit={reviewQuotation}>
                              <p className="procurement-workspace-note">
                                The RFQ requests {selectedRfq.quantity} {selectedRfq.unit}. Your offered quantity and unit are recorded as entered; no unit conversion is performed.
                              </p>
                              <div className="procurement-workspace-inline">
                                <label>Unit price<input required type="number" min="0" step="any" value={selectedQuotationDraft.unit_price} onChange={(event) => updateQuotation({ unit_price: event.target.value })} /></label>
                                <label>Currency<select value={selectedQuotationDraft.currency} onChange={(event) => updateQuotation({ currency: event.target.value as SupplierQuotationSubmission["currency"] })}>{["INR", "USD", "EUR", "GBP", "AED"].map((currency) => <option key={currency}>{currency}</option>)}</select></label>
                              </div>
                              <div className="procurement-workspace-inline">
                                <label>Quantity offered<input required type="number" min="0.0001" step="any" value={selectedQuotationDraft.quantity_offered} onChange={(event) => updateQuotation({ quantity_offered: event.target.value })} /></label>
                                <label>Unit<select value={selectedQuotationDraft.unit} onChange={(event) => updateQuotation({ unit: event.target.value as ProcurementUnit })}>{supplierUnits.map((unit) => <option key={unit}>{unit}</option>)}</select></label>
                              </div>
                              <div className="procurement-workspace-inline">
                                <label>Lead time (days)<input required type="number" min="1" step="1" value={selectedQuotationDraft.estimated_delivery_lead_time_days} onChange={(event) => updateQuotation({ estimated_delivery_lead_time_days: Number(event.target.value) })} /></label>
                                <label>Valid until<input required type="date" min={localDateString()} value={selectedQuotationDraft.quotation_valid_until} onChange={(event) => updateQuotation({ quotation_valid_until: event.target.value })} /></label>
                              </div>
                              <label>Delivery terms<textarea required maxLength={2000} value={selectedQuotationDraft.delivery_terms} onChange={(event) => updateQuotation({ delivery_terms: event.target.value })} /></label>
                              <label>Notes<textarea maxLength={2000} value={selectedQuotationDraft.notes || ""} onChange={(event) => updateQuotation({ notes: event.target.value || null })} /></label>
                              <div className="procurement-workspace-actions">
                                <button className="procurement-workspace-secondary" type="button" onClick={() => { setQuotationFormOpen(false); setQuotationReview(false); }}>Cancel</button>
                                <button className="procurement-workspace-primary" type="submit">Review quotation</button>
                              </div>
                            </form>
                          )
                        )}
                      </section>
                    )}
                  </article>
                );
              })()}
            </>
          )}
        </section>
      )}

      {company && selectedCompanyId && (section === "orders" || section === "history") && (
            <section className="procurement-workspace-panel">
              <h2>{section === "history" ? "Historical purchase orders" : "Supplier purchase orders"}</h2>
              {!loadedData.orders
                ? <p className="procurement-workspace-empty">Purchase orders could not be loaded. Retry the supplier data request.</p>
                : (section === "history" ? historicalOrders : activeOrders).length === 0
                ? <p className="procurement-workspace-empty">{section === "history" ? "No delivered, rejected, or cancelled purchase orders are in the available history." : "No purchase orders currently need a supplier response or fulfilment."}</p>
                : (section === "history" ? historicalOrders : activeOrders).map((order) => {
                  const fulfillmentStatuses: SupplierFulfillmentUpdate["status"][] =
                    order.status === "ACCEPTED" || order.status === "PREPARING"
                      ? ["PREPARING", "DISPATCHED"]
                      : order.status === "DISPATCHED"
                        ? ["DISPATCHED", "PARTIALLY_DELIVERED", "DELIVERED"]
                        : order.status === "PARTIALLY_DELIVERED"
                          ? ["PARTIALLY_DELIVERED", "DELIVERED"]
                          : [];
                  return <article className="procurement-workspace-card" key={order.id}>
                    <div className="procurement-workspace-card-head">
                      <div><h3>{order.order_reference} · {order.item_name}</h3><p>{order.quantity} {order.unit} · {order.currency} {order.unit_price} / {order.offered_unit}</p></div>
                      <span className="procurement-workspace-status">{order.status.replaceAll("_", " ")}</span>
                    </div>
                    <p>Delivery: {order.delivery_location} · {order.delivery_terms}</p>
                    {section === "history" && (
                      <dl className="procurement-workspace-facts">
                        <div><dt>Recorded delivered quantity</dt><dd>{order.delivered_quantity} {order.fulfillment_unit}</dd></div>
                        <div><dt>Recorded delivery date</dt><dd>{order.delivery_date || "—"}</dd></div>
                        <div><dt>Carrier</dt><dd>{order.carrier || "—"}</dd></div>
                        <div><dt>Tracking reference</dt><dd>{order.tracking_reference || "—"}</dd></div>
                        <div><dt>Estimated delivery</dt><dd>{order.estimated_delivery_date || "—"}</dd></div>
                      </dl>
                    )}
                    {order.status === "ISSUED" && <div className="procurement-workspace-actions">
                      <button className="procurement-workspace-primary" type="button" disabled={busy === `accept-${order.id}`} onClick={() => void runAction(`accept-${order.id}`, async () => { await procurementWorkspaceApi.respondToSupplierPurchaseOrder(selectedCompanyId, order.id, "ACCEPTED"); await loadCompanyData(selectedCompanyId); }, "Purchase order accepted.")}>Accept order</button>
                      <button className="procurement-workspace-danger" type="button" disabled={busy === `reject-${order.id}`} onClick={() => void runAction(`reject-${order.id}`, async () => { await procurementWorkspaceApi.respondToSupplierPurchaseOrder(selectedCompanyId, order.id, "REJECTED"); await loadCompanyData(selectedCompanyId); }, "Purchase order rejected.")}>Reject</button>
                    </div>}
                    {fulfillmentStatuses.length > 0 && <>
                      <button className="procurement-workspace-secondary" type="button" onClick={() => setFulfillmentOrderId(fulfillmentOrderId === order.id ? "" : order.id)}><Truck size={15} />{fulfillmentOrderId === order.id ? "Close update form" : "Update fulfilment"}</button>
                      {fulfillmentOrderId === order.id && <form className="procurement-workspace-form" onSubmit={(event) => void updateFulfillment(event, order)}>
                        <label>Status<select name="status" required defaultValue={defaultFulfillmentStatus(order)}>{fulfillmentStatuses.map((status) => <option key={status} value={status}>{status.replaceAll("_", " ")}</option>)}</select></label>
                        <div className="procurement-workspace-inline">
                          <label>Additional dispatched quantity ({order.unit})<input name="dispatched_quantity" type="number" min="0" step="any" defaultValue="0" /></label>
                          <label>Additional delivered quantity ({order.unit})<input name="delivered_quantity" type="number" min="0" step="any" defaultValue="0" /></label>
                        </div>
                        <div className="procurement-workspace-inline"><label>Dispatch date<input name="dispatch_date" type="date" max={localDateString()} /></label><label>Estimated delivery<input name="estimated_delivery_date" type="date" min={localDateString()} /></label></div>
                        <div className="procurement-workspace-inline"><label>Carrier<input name="carrier" maxLength={200} /></label><label>Tracking reference<input name="tracking_reference" maxLength={200} /></label></div>
                        <label>Delivery date<input name="delivery_date" type="date" max={localDateString()} /></label>
                        <label>Notes<textarea name="delivery_notes" maxLength={2000} /></label>
                        <button className="procurement-workspace-primary" type="submit" disabled={busy === `fulfillment-${order.id}`}><Save size={15} />Record fulfilment</button>
                      </form>}
                    </>}
                    {order.fulfillment_events.map((event) => <p className="procurement-workspace-event" key={event.id}>{event.status.replaceAll("_", " ")} · +{event.dispatched_quantity} dispatched · +{event.delivered_quantity} delivered {event.unit}{event.delivery_notes ? ` · ${event.delivery_notes}` : ""}</p>)}
                  </article>;
                })}
            </section>
          )}

      {company && selectedCompanyId && section === "companies" && <>
        <form className="procurement-workspace-panel procurement-workspace-form" onSubmit={(event) => void saveCompanyProfile(event)}><h2>Company profile</h2>{(["name", "description", "website"] as const).map((key) => <label key={key}>{key === "name" ? "Company name" : key[0].toUpperCase() + key.slice(1)}{key === "description" ? <textarea value={companyDraft[key] || ""} onChange={(event) => setCompanyDraft({ ...companyDraft, [key]: event.target.value })} /> : <input required={key === "name"} value={companyDraft[key] || ""} onChange={(event) => setCompanyDraft({ ...companyDraft, [key]: event.target.value })} />}</label>)}{managerControls(<button className="procurement-workspace-primary" type="submit" disabled={busy === "company-profile"}><Save size={15} />Save company profile</button>)}</form>
        <form className="procurement-workspace-panel procurement-workspace-form" onSubmit={(event) => void savePrivateProfile(event)}><h2>Private registration and contact details</h2>{(["registered_name", "registration_number", "contact_email", "contact_phone", "registered_address"] as const).map((key) => <label key={key}>{key.replaceAll("_", " ").replace(/^\w/, (letter) => letter.toUpperCase())}{key === "registered_address" ? <textarea value={privateDraft[key] || ""} onChange={(event) => setPrivateDraft({ ...privateDraft, [key]: event.target.value })} /> : <input value={privateDraft[key] || ""} onChange={(event) => setPrivateDraft({ ...privateDraft, [key]: event.target.value })} />}</label>)}{managerControls(<button className="procurement-workspace-primary" type="submit" disabled={busy === "private-profile"}><Save size={15} />Save private details</button>)}</form>
        <section className="procurement-workspace-panel">
          <h2>Verification</h2>
          <p>Status: <strong>{company.verification_status.replaceAll("_", " ")}</strong></p>
          {company.verification_reason && <p>{company.verification_reason}</p>}
          {company.verification_submitted_at && <p>Submitted {new Date(company.verification_submitted_at).toLocaleString()}</p>}
          {company.verification_status === "VERIFIED" && <p className="procurement-workspace-note">This company is verified. Additional uploads and resubmission are unavailable here.</p>}
          {company.verification_status === "PENDING_REVIEW" && <p className="procurement-workspace-note">This submission is awaiting administrator review. Documents cannot be changed while it is under review.</p>}
          {company.verification_status === "SUSPENDED" && <p className="procurement-workspace-note">Verification is suspended. Contact GLESKA support for next steps.</p>}
          {!loadedData.documents && <p className="procurement-workspace-empty">Verification documents could not be loaded. Retry the supplier data request.</p>}
          {loadedData.documents && documents.map((document) => <article className="procurement-workspace-card" key={document.id}>
            <div className="procurement-workspace-card-head">
              <span>{document.document_type} · {document.original_filename}</span>
              <button className="procurement-workspace-secondary" type="button" onClick={() => void runAction(`document-${document.id}`, async () => {
                const result = await procurementWorkspaceApi.getVerificationDocumentUrl(selectedCompanyId, document.id);
                window.open(result.url, "_blank", "noopener,noreferrer");
              }, "Secure document link opened.")}>View</button>
            </div>
          </article>)}
          {canEditVerification && <form className="procurement-workspace-form" onSubmit={(event) => void uploadVerificationDocument(event)}>
            <label>Document type<select required name="document_type"><option value="BUSINESS_REGISTRATION">Business registration</option><option value="TAX_REGISTRATION">Tax registration</option><option value="ADDRESS_PROOF">Address proof</option><option value="OTHER">Other</option></select></label>
            <label>Document (PDF, JPEG or PNG; max 10 MB)<input required name="file" type="file" accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png" /></label>
            <button className="procurement-workspace-secondary" type="submit" disabled={busy === "verification-upload"}><FileText size={15} />Upload document</button>
            <button className="procurement-workspace-primary" type="button" disabled={!loadedData.documents || busy === "verification-submit" || documents.length === 0} onClick={() => void runAction("verification-submit", async () => {
              await procurementWorkspaceApi.submitVerification(selectedCompanyId);
              await refreshCompanyData();
            }, "Verification submitted for review.")}>Submit for review</button>
          </form>}
        </section>
        <section className="procurement-workspace-panel">
          <h2><Users size={18} /> Company members</h2>
          {!loadedData.members && <p className="procurement-workspace-empty">Company members could not be loaded. Retry the supplier data request.</p>}
          {loadedData.members && members.filter((member) => member.status === "ACTIVE").map((member) => (
            <article className="procurement-workspace-card" key={member.id}>
              <div className="procurement-workspace-card-head">
                <div><h3>{member.name || member.invited_email || "Member"}</h3><p>{member.role}</p></div>
                {canManage && member.role !== "OWNER" && <div className="procurement-workspace-actions">
                  {company.role === "OWNER" && <>
                    <select aria-label={`Role for ${member.name || "member"}`} value={member.role} disabled={busy === `member-${member.id}`} onChange={(event) => void changeMemberRole(member, event.target.value as "ADMIN" | "MEMBER")}>
                      <option value="MEMBER">Member</option><option value="ADMIN">Admin</option>
                    </select>
                    <button className="procurement-workspace-secondary" type="button" disabled={busy === `member-${member.id}`} onClick={() => void transferOwnership(member)}>Transfer owner</button>
                  </>}
                  <button className="procurement-workspace-danger" type="button" disabled={busy === `member-${member.id}`} onClick={() => void revokeMember(member)}><Trash2 size={14} />Revoke</button>
                </div>}
              </div>
            </article>
          ))}
          {loadedData.members && members.filter((member) => member.status === "ACTIVE").length === 0 && <p className="procurement-workspace-empty">No active members are available.</p>}
          {loadedData.members && <h3>Pending invitations ({members.filter((member) => member.status === "PENDING").length})</h3>}
          {loadedData.members && members.filter((member) => member.status === "PENDING").map((member) => (
            <article className="procurement-workspace-card" key={member.id}>
              <div className="procurement-workspace-card-head">
                <div><h3>{member.invited_email || "Invited member"}</h3><p>{member.role} · Pending acceptance</p></div>
                {canManage && (company.role === "OWNER" || member.role === "MEMBER") && <button className="procurement-workspace-danger" type="button" disabled={busy === `member-${member.id}`} onClick={() => void revokeMember(member)}>Cancel invitation</button>}
              </div>
            </article>
          ))}
          {loadedData.members && members.filter((member) => member.status === "PENDING").length === 0 && <p className="procurement-workspace-empty">There are no pending invitations.</p>}
          {loadedData.members && canManage && <form className="procurement-workspace-form" onSubmit={(event) => { event.preventDefault(); void runAction("invite-member", async () => { await procurementWorkspaceApi.inviteSupplierMember(selectedCompanyId, inviteEmail.trim(), inviteRole); setInviteEmail(""); await loadCompanyData(selectedCompanyId); }, "Invitation sent."); }}>
            <h3>Invite a member</h3>
            <label>Email<input required type="email" value={inviteEmail} onChange={(event) => setInviteEmail(event.target.value)} /></label>
            <label>Role<select value={inviteRole} onChange={(event) => setInviteRole(event.target.value as "ADMIN" | "MEMBER")}><option value="ADMIN">Admin</option><option value="MEMBER">Member</option></select></label>
            <button className="procurement-workspace-primary" type="submit" disabled={busy === "invite-member"}><Users size={15} />Send invitation</button>
          </form>}
        </section>
      </>}

      {section === "settings" && (
        <>
          <section className="procurement-workspace-panel">
            <h2><Settings size={18} /> Supplier settings</h2>
            <p>
              {company
                ? `${company.name} · ${company.role.toLowerCase()}`
                : "Select an active supplier company to manage supplier settings."}
            </p>
          </section>
          <section className="procurement-workspace-panel">
            <h2>Notification preferences</h2>
            <p className="procurement-workspace-note">Read receipts are unavailable because supplier messaging does not currently support them.</p>
            <p className="procurement-workspace-note">Order status notifications are unavailable because supplier purchase-order status changes do not currently deliver notifications.</p>
            <p className="procurement-workspace-note">RFQ deadline reminders are unavailable because no reminder scheduler or delivery mechanism is configured.</p>
          </section>
          <section className="procurement-workspace-panel">
            <h2>Display preferences</h2>
            {!selectedCompanyId ? (
              <p className="procurement-workspace-note">An active supplier company membership is required to manage this preference.</p>
            ) : supplierSettingsLoaded ? (
              <label className="procurement-workspace-check">
                <input
                  type="checkbox"
                  checked={showArchived}
                  disabled={!selectedCompanyId || busy === "supplier-settings"}
                  onChange={(event) => {
                    const includeArchived = event.currentTarget.checked;
                    void runAction(
                      "supplier-settings",
                      async () => {
                        const saved = await procurementWorkspaceApi.updateSupplierSettings(includeArchived);
                        setShowArchived(saved.show_archived_offerings);
                        setSupplierSettingsLoaded(true);
                        await loadCompanyData(selectedCompanyId, saved.show_archived_offerings);
                      },
                      "Display preference saved.",
                    );
                  }}
                />
                Show archived offerings
              </label>
            ) : (
              <div className="procurement-workspace-state" role="status">
                <LoaderCircle size={17} className="procurement-agent-spin" />
                Loading saved display preferences…
                <button className="procurement-workspace-secondary" type="button" onClick={() => void refreshCompanyData()}>
                  Retry
                </button>
              </div>
            )}
          </section>
          <DeleteAccountSection roleLabel="Supplier" />
        </>
      )}

      {company && loading && <div className="procurement-workspace-state" role="status"><LoaderCircle className="procurement-agent-spin" size={18} />Refreshing selected supplier company…</div>}
    </main>
  );
}
