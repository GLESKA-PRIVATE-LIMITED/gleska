import { apiDelete, apiGet, apiPost, apiPut, apiRequest } from "../../lib/api";

const basePath = "/api/v1/procurement";

export interface MaterialRequestDraft {
  title: string | null;
  item_name: string | null;
  specification: string | null;
  quantity: string | number | null;
  unit: string | null;
  required_by: string | null;
  delivery_location: string | null;
  additional_requirements: string[];
  notes: string | null;
}

export interface ProcurementPage<T> {
  items: T[];
  page: number;
  page_size: number;
  has_more: boolean;
  next_cursor?: string | null;
}

export interface ProcurementMaterialRequest extends MaterialRequestDraft {
  id: string;
  origin_conversation_id: string | null;
  confirmed_fields: string[];
  status: "SAVED";
  revision: number;
  created_at: string;
  updated_at: string;
}

export interface ProcurementConversationMessage {
  message_id?: number | null;
  role: "user" | "assistant";
  content: string;
  created_at: string;
}

export interface ProcurementConversation {
  conversation_id: string;
  status: "ACTIVE" | "COMPLETED";
  history: ProcurementConversationMessage[];
  history_limit_reached: boolean;
  history_cursor: string | null;
  draft: MaterialRequestDraft;
  confirmed_fields: string[];
  cleared_fields: string[];
  revision: number;
  created_at: string;
  updated_at: string;
}

export interface ProcurementSupplierMatch {
  supplier_company_id: string;
  supplier_name: string;
  offering_id: string;
  name: string;
  specification: string | null;
  unit: string;
  indicative_price: string | number | null;
  currency_code: string | null;
  minimum_order_quantity: string | number | null;
  service_coverage: string[];
  specification_match: string;
  coverage_match: string;
  minimum_order_compatible: boolean | null;
  match_reasons: string[];
}

export interface ProcurementSupplierDiscovery {
  request_id: string;
  item_name: string;
  specification: string | null;
  quantity: string | number;
  unit: string;
  delivery_location: string | null;
  matches: ProcurementSupplierMatch[];
  search_limit_reached: boolean;
}

export type ProcurementUnit =
  | "MT" | "Bags" | "Pieces" | "Kg" | "Tons" | "Meters"
  | "Sq. ft" | "Boxes" | "Liters";

export interface ProcurementSettings {
  default_delivery_location: string | null;
  preferred_units: ProcurementUnit[];
  specification_match_policy: "REVIEW_DIFFERENCES" | "REQUIRE_OVERLAP";
  delivery_coverage_policy: "ALLOW_UNSPECIFIED" | "REQUIRE_MATCH";
  updated_at: string | null;
}

export interface ProcurementRFQRecipient {
  company_id: string;
  company_name: string;
  offering_id: string;
  status: "INVITED" | "ACKNOWLEDGED" | "DECLINED";
  response_note: string | null;
  responded_at: string | null;
  quotation: SupplierQuotation | null;
}

export interface SupplierQuotation {
  id: string;
  unit_price: string | number;
  currency: "INR" | "USD" | "EUR" | "GBP" | "AED";
  quantity_offered: string | number;
  unit: ProcurementUnit;
  estimated_delivery_lead_time_days: number;
  quotation_valid_until: string;
  delivery_terms: string;
  notes: string | null;
  revision: number;
  submitted_at: string;
  updated_at: string;
}

export interface ProcurementRFQ {
  id: string;
  material_request_id: string | null;
  item_name: string;
  specification: string | null;
  quantity: string | number;
  unit: string;
  delivery_location: string;
  quotation_deadline: string;
  buyer_notes: string | null;
  status: "OPEN" | "CLOSED";
  created_at: string;
  recipients: ProcurementRFQRecipient[];
}

export interface ProcurementRFQCreatePayload {
  material_request_id: string;
  idempotency_key: string;
  supplier_company_ids: string[];
  delivery_location: string;
  quotation_deadline: string;
  buyer_notes: string | null;
}

export interface ProcurementRFQRecovery {
  idempotency_key: string;
  status: "NOT_FOUND" | "PENDING" | "SUCCEEDED" | "NOT_CREATED";
  rfq: ProcurementRFQ | null;
  error_code: string | null;
  legacy_attempt: boolean;
}

export interface ProcurementPendingRFQAttempt {
  idempotency_key: string;
  status: "PENDING";
  created_at: string;
}

export interface ProcurementPendingRFQAttemptsPage {
  items: ProcurementPendingRFQAttempt[];
  page: number;
  page_size: number;
  has_more: boolean;
}

export type ProcurementOrderStatus =
  | "ISSUED" | "ACCEPTED" | "REJECTED" | "CANCELLED"
  | "PREPARING" | "DISPATCHED" | "PARTIALLY_DELIVERED" | "DELIVERED";

export interface ProcurementFulfillmentEvent {
  id: string;
  status: "PREPARING" | "DISPATCHED" | "PARTIALLY_DELIVERED" | "DELIVERED";
  dispatched_quantity: string | number;
  delivered_quantity: string | number;
  unit: string;
  dispatch_date: string | null;
  carrier: string | null;
  tracking_reference: string | null;
  estimated_delivery_date: string | null;
  delivery_date: string | null;
  delivery_notes: string | null;
  created_at: string;
}

export interface ProcurementPurchaseOrder {
  id: string;
  order_reference: string;
  rfq_id: string;
  quotation_id: string;
  supplier_company_id: string;
  supplier_company_name: string;
  item_name: string;
  specification: string | null;
  quantity: string | number;
  unit: string;
  unit_price: string | number;
  currency: SupplierQuotation["currency"];
  quantity_offered: string | number;
  offered_unit: string;
  estimated_delivery_lead_time_days: number;
  quotation_valid_until: string;
  delivery_location: string;
  delivery_terms: string;
  supplier_notes: string | null;
  status: ProcurementOrderStatus;
  dispatched_quantity: string | number;
  delivered_quantity: string | number;
  fulfillment_unit: string;
  dispatch_date: string | null;
  carrier: string | null;
  tracking_reference: string | null;
  estimated_delivery_date: string | null;
  delivery_date: string | null;
  delivery_notes: string | null;
  fulfillment_events: ProcurementFulfillmentEvent[];
  created_at: string;
  updated_at: string;
}

export interface SupplierRFQ extends Omit<ProcurementRFQ, "recipients"> {
  updated_at: string;
  recipient_status: "INVITED" | "ACKNOWLEDGED" | "DECLINED";
  response_note: string | null;
  responded_at: string | null;
  quotation: SupplierQuotation | null;
}

export interface ProcurementCompanyMembership {
  id: string;
  company_id: string;
  company_name: string;
  role: "OWNER" | "ADMIN" | "MEMBER";
  status: "ACTIVE" | "PENDING" | "REVOKED";
  created_at: string;
  operational_status?: "ACTIVE" | "SUSPENDED" | "ARCHIVED" | null;
  verification_status?: "NOT_SUBMITTED" | "PENDING_REVIEW" | "VERIFIED" | "REJECTED" | "SUSPENDED" | null;
}

export interface SupplierCompany {
  id: string;
  name: string;
  description: string | null;
  website: string | null;
  operational_status: "ACTIVE" | "SUSPENDED" | "ARCHIVED";
  verification_status: "NOT_SUBMITTED" | "PENDING_REVIEW" | "VERIFIED" | "REJECTED" | "SUSPENDED";
  verification_reason: string | null;
  verification_submitted_at: string | null;
  verification_reviewed_at: string | null;
  role: "OWNER" | "ADMIN" | "MEMBER";
  created_at: string;
  updated_at: string;
  registered_name?: string | null;
  registration_number?: string | null;
  contact_email?: string | null;
  contact_phone?: string | null;
  registered_address?: string | null;
}

export interface SupplierOffering {
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

export interface SupplierMember {
  id: string;
  name: string | null;
  invited_email: string | null;
  role: "OWNER" | "ADMIN" | "MEMBER";
  status: "ACTIVE" | "PENDING" | "REVOKED";
  created_at: string;
}

export interface SupplierVerificationDocument {
  id: string;
  company_id: string;
  document_type: string;
  original_filename: string;
  mime_type: string;
  file_size_bytes: number;
  uploaded_at: string;
}

export interface SupplierQuotationSubmission {
  expected_rfq_updated_at: string;
  unit_price: string;
  currency: SupplierQuotation["currency"];
  quantity_offered: string;
  unit: ProcurementUnit;
  estimated_delivery_lead_time_days: number;
  quotation_valid_until: string;
  delivery_terms: string;
  notes: string | null;
  expected_revision: number | null;
}

export interface SupplierFulfillmentUpdate {
  idempotency_key: string;
  status: "PREPARING" | "DISPATCHED" | "PARTIALLY_DELIVERED" | "DELIVERED";
  dispatched_quantity: string;
  delivered_quantity: string;
  unit: string;
  dispatch_date: string | null;
  carrier: string | null;
  tracking_reference: string | null;
  estimated_delivery_date: string | null;
  delivery_date: string | null;
  delivery_notes: string | null;
}

export interface ProcurementSettingsUpdate extends Omit<ProcurementSettings, "updated_at"> {}

export const procurementWorkspaceApi = {
  listConversations(cursor?: string | null) {
    const params = new URLSearchParams({ page_size: "25" });
    if (cursor) params.set("cursor", cursor);
    return apiGet<ProcurementPage<ProcurementConversation>>(
      `${basePath}/conversations?${params.toString()}`,
    );
  },

  createConversation() {
    return apiPost<ProcurementConversation>(`${basePath}/conversations`);
  },

  getConversation(id: string) {
    return apiGet<ProcurementConversation>(`${basePath}/conversations/${encodeURIComponent(id)}`);
  },

  sendConversationMessage(id: string, message: string, expectedRevision: number) {
    return apiPost<ProcurementConversation>(
      `${basePath}/conversations/${encodeURIComponent(id)}/messages`,
      { message, expected_revision: expectedRevision },
    );
  },

  updateConversationDraft(
    id: string,
    draft: MaterialRequestDraft,
    confirmedFields: string[],
    expectedRevision: number,
    clearedFields: string[] = [],
  ) {
    return apiRequest<ProcurementConversation>(
      `${basePath}/conversations/${encodeURIComponent(id)}/draft`,
      {
        method: "PATCH",
        body: {
          draft,
          confirmed_fields: confirmedFields,
          cleared_fields: clearedFields,
          expected_revision: expectedRevision,
        },
      },
    );
  },

  saveConversationRequest(id: string, expectedRevision: number, idempotencyKey: string) {
    return apiPost<ProcurementMaterialRequest>(
      `${basePath}/conversations/${encodeURIComponent(id)}/save`,
      { expected_revision: expectedRevision, idempotency_key: idempotencyKey },
    );
  },

  listRequests(cursor?: string | null) {
    const params = new URLSearchParams({ page_size: "25" });
    if (cursor) params.set("cursor", cursor);
    return apiGet<ProcurementPage<ProcurementMaterialRequest>>(
      `${basePath}/requests?${params.toString()}`,
    );
  },

  getRequest(id: string) {
    return apiGet<ProcurementMaterialRequest>(`${basePath}/requests/${encodeURIComponent(id)}`);
  },

  updateRequest(id: string, fields: Partial<MaterialRequestDraft>, expectedRevision: number) {
    return apiRequest<ProcurementMaterialRequest>(`${basePath}/requests/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: { ...fields, expected_revision: expectedRevision },
    });
  },

  deleteRequest(id: string) {
    return apiDelete(`${basePath}/requests/${encodeURIComponent(id)}`);
  },

  discoverSuppliers(requestId: string, deliveryLocation?: string | null) {
    const params = new URLSearchParams();
    if (deliveryLocation) params.set("delivery_location", deliveryLocation);
    const query = params.size ? `?${params.toString()}` : "";
    return apiGet<ProcurementSupplierDiscovery>(
      `${basePath}/requests/${encodeURIComponent(requestId)}/matches${query}`,
    );
  },

  getSettings() {
    return apiGet<ProcurementSettings>(`${basePath}/settings`);
  },

  updateSettings(settings: ProcurementSettingsUpdate) {
    return apiPut<ProcurementSettings>(`${basePath}/settings`, settings);
  },

  listRfqs(page = 1, pageSize = 25) {
    const params = new URLSearchParams({ page: String(page), page_size: String(pageSize) });
    return apiGet<ProcurementPage<ProcurementRFQ>>(`${basePath}/rfqs?${params.toString()}`);
  },

  listPendingRfqAttempts(page = 1, pageSize = 100) {
    const params = new URLSearchParams({ page: String(page), page_size: String(pageSize) });
    return apiGet<ProcurementPendingRFQAttemptsPage>(
      `${basePath}/rfqs/recovery?${params.toString()}`,
    );
  },

  recoverRfqAttempt(idempotencyKey: string) {
    return apiGet<ProcurementRFQRecovery>(
      `${basePath}/rfqs/recovery/${encodeURIComponent(idempotencyKey)}`,
    );
  },

  getRfq(id: string) {
    return apiGet<ProcurementRFQ>(`${basePath}/rfqs/${encodeURIComponent(id)}`);
  },

  createRfq(payload: ProcurementRFQCreatePayload) {
    return apiPost<ProcurementRFQ>(`${basePath}/rfqs`, payload);
  },

  updateRfq(id: string, payload: {
    delivery_location: string;
    quotation_deadline: string;
    buyer_notes: string | null;
  }) {
    return apiPut<ProcurementRFQ>(`${basePath}/rfqs/${encodeURIComponent(id)}`, payload);
  },

  closeRfq(id: string) {
    return apiPost<ProcurementRFQ>(`${basePath}/rfqs/${encodeURIComponent(id)}/close`, {});
  },

  listPurchaseOrders(page = 1, pageSize = 25) {
    const params = new URLSearchParams({ page: String(page), page_size: String(pageSize) });
    return apiGet<ProcurementPage<ProcurementPurchaseOrder>>(
      `${basePath}/purchase-orders?${params.toString()}`,
    );
  },

  async listAllPurchaseOrders() {
    const orders: ProcurementPurchaseOrder[] = [];
    let page = 1;
    while (true) {
      const result = await procurementWorkspaceApi.listPurchaseOrders(page, 100);
      orders.push(...result.items);
      if (!result.has_more) return orders;
      if (result.items.length === 0) {
        throw new Error("Purchase order pagination did not advance.");
      }
      page += 1;
    }
  },

  selectQuotation(rfqId: string, quotationId: string) {
    return apiPost<ProcurementPurchaseOrder>(
      `${basePath}/rfqs/${encodeURIComponent(rfqId)}/select-quotation`,
      { quotation_id: quotationId },
    );
  },

  cancelPurchaseOrder(orderId: string) {
    return apiPost<ProcurementPurchaseOrder>(
      `${basePath}/purchase-orders/${encodeURIComponent(orderId)}/cancel`,
      {},
    );
  },

  listSupplierCompanies() {
    return apiGet<ProcurementCompanyMembership[]>("/api/v1/suppliers/companies");
  },

  listSupplierInvitations() {
    return apiGet<ProcurementCompanyMembership[]>("/api/v1/suppliers/invitations");
  },

  acceptSupplierInvitation(membershipId: string) {
    return apiPost<ProcurementCompanyMembership>(
      `/api/v1/suppliers/invitations/${encodeURIComponent(membershipId)}/accept`,
    );
  },

  listSupplierOfferings(companyId: string, includeArchived = false) {
    const params = new URLSearchParams({ include_archived: String(includeArchived) });
    return apiGet<SupplierOffering[]>(
      `/api/v1/suppliers/companies/${encodeURIComponent(companyId)}/offerings?${params.toString()}`,
    );
  },

  saveSupplierOffering(
    companyId: string,
    payload: Omit<SupplierOffering, "id" | "company_id" | "revision" | "archived_at" | "created_at" | "updated_at">,
    offering?: SupplierOffering,
  ) {
    const path = `/api/v1/suppliers/companies/${encodeURIComponent(companyId)}/offerings`;
    if (!offering) return apiPost<SupplierOffering>(path, payload);
    return apiRequest<SupplierOffering>(`${path}/${encodeURIComponent(offering.id)}`, {
      method: "PATCH",
      body: { ...payload, expected_revision: offering.revision },
    });
  },

  archiveSupplierOffering(companyId: string, offering: SupplierOffering) {
    const params = new URLSearchParams({ expected_revision: String(offering.revision) });
    return apiDelete<SupplierOffering>(
      `/api/v1/suppliers/companies/${encodeURIComponent(companyId)}/offerings/${encodeURIComponent(offering.id)}?${params.toString()}`,
    );
  },

  listSupplierRfqs(companyId: string, cursor?: string | null) {
    const params = new URLSearchParams({ page_size: "25" });
    if (cursor) params.set("cursor", cursor);
    return apiGet<{ items: SupplierRFQ[]; has_more: boolean; next_cursor: string | null }>(
      `/api/v1/suppliers/companies/${encodeURIComponent(companyId)}/rfqs?${params.toString()}`,
    );
  },

  respondToSupplierRfq(companyId: string, rfqId: string, status: "ACKNOWLEDGED" | "DECLINED", responseNote: string | null) {
    return apiPost(
      `/api/v1/suppliers/companies/${encodeURIComponent(companyId)}/rfqs/${encodeURIComponent(rfqId)}/response`,
      { status, response_note: responseNote },
    );
  },

  submitSupplierQuotation(companyId: string, rfqId: string, payload: SupplierQuotationSubmission) {
    return apiRequest(
      `/api/v1/suppliers/companies/${encodeURIComponent(companyId)}/rfqs/${encodeURIComponent(rfqId)}/quotation`,
      { method: "PUT", body: payload },
    );
  },

  listSupplierPurchaseOrders(companyId: string) {
    return apiGet<ProcurementPurchaseOrder[]>(
      `/api/v1/suppliers/companies/${encodeURIComponent(companyId)}/purchase-orders`,
    );
  },

  respondToSupplierPurchaseOrder(companyId: string, orderId: string, status: "ACCEPTED" | "REJECTED") {
    return apiPost<ProcurementPurchaseOrder>(
      `/api/v1/suppliers/companies/${encodeURIComponent(companyId)}/purchase-orders/${encodeURIComponent(orderId)}/response`,
      { status },
    );
  },

  updateSupplierPurchaseOrderFulfillment(companyId: string, orderId: string, payload: SupplierFulfillmentUpdate) {
    return apiPost<ProcurementPurchaseOrder>(
      `/api/v1/suppliers/companies/${encodeURIComponent(companyId)}/purchase-orders/${encodeURIComponent(orderId)}/fulfillment`,
      payload,
    );
  },

  getSupplierCompany(companyId: string) {
    return apiGet<SupplierCompany>(`/api/v1/suppliers/companies/${encodeURIComponent(companyId)}`);
  },

  createSupplierCompany(payload: Record<string, string | null>) {
    return apiPost<SupplierCompany>("/api/v1/suppliers/companies", payload);
  },

  listSupplierMembers(companyId: string) {
    return apiGet<SupplierMember[]>(`/api/v1/suppliers/companies/${encodeURIComponent(companyId)}/members`);
  },

  inviteSupplierMember(companyId: string, email: string, role: "ADMIN" | "MEMBER") {
    return apiPost<SupplierMember>(
      `/api/v1/suppliers/companies/${encodeURIComponent(companyId)}/members`,
      { email, role },
    );
  },

  updateSupplierMember(companyId: string, memberId: string, role: "ADMIN" | "MEMBER") {
    return apiRequest<SupplierMember>(
      `/api/v1/suppliers/companies/${encodeURIComponent(companyId)}/members/${encodeURIComponent(memberId)}`,
      { method: "PATCH", body: { role } },
    );
  },

  revokeSupplierMember(companyId: string, memberId: string) {
    return apiDelete(
      `/api/v1/suppliers/companies/${encodeURIComponent(companyId)}/members/${encodeURIComponent(memberId)}`,
    );
  },

  transferSupplierOwnership(companyId: string, membershipId: string) {
    return apiPost(
      `/api/v1/suppliers/companies/${encodeURIComponent(companyId)}/transfer-ownership`,
      { new_owner_membership_id: membershipId },
    );
  },

  listVerificationDocuments(companyId: string) {
    return apiGet<SupplierVerificationDocument[]>(
      `/api/v1/suppliers/companies/${encodeURIComponent(companyId)}/verification/documents`,
    );
  },

  getVerificationDocumentUrl(companyId: string, documentId: string) {
    return apiGet<{ url: string }>(
      `/api/v1/suppliers/companies/${encodeURIComponent(companyId)}/verification/documents/${encodeURIComponent(documentId)}/url`,
    );
  },

  async uploadVerificationDocument(companyId: string, documentType: string, file: File) {
    const body = new FormData();
    body.set("document_type", documentType);
    body.set("file", file);
    return apiRequest(
      `/api/v1/suppliers/companies/${encodeURIComponent(companyId)}/verification/documents`,
      { method: "POST", body },
    );
  },

  submitVerification(companyId: string) {
    return apiPost(
      `/api/v1/suppliers/companies/${encodeURIComponent(companyId)}/verification/submit`,
    );
  },

  updateSupplierCompany(companyId: string, payload: Record<string, string | null>) {
    return apiRequest<SupplierCompany>(`/api/v1/suppliers/companies/${encodeURIComponent(companyId)}`, {
      method: "PATCH",
      body: payload,
    });
  },

  updateSupplierPrivateProfile(companyId: string, payload: Record<string, string | null>) {
    return apiRequest(
      `/api/v1/suppliers/companies/${encodeURIComponent(companyId)}/private-profile`,
      { method: "PATCH", body: payload },
    );
  },

  getSupplierSettings() {
    return apiGet<{ show_archived_offerings: boolean; updated_at: string | null }>("/api/v1/suppliers/settings");
  },

  updateSupplierSettings(showArchivedOfferings: boolean) {
    return apiPut<{ show_archived_offerings: boolean; updated_at: string | null }>(
      "/api/v1/suppliers/settings",
      { show_archived_offerings: showArchivedOfferings },
    );
  },
};
