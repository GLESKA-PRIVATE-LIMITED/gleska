import apiClient from "@/lib/api";

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

export interface ProcurementConversationMessage {
  role: "user" | "assistant";
  content: string;
  created_at: string;
}

export interface ProcurementConversation {
  conversation_id: string;
  status: "ACTIVE" | "COMPLETED";
  history: ProcurementConversationMessage[];
  draft: MaterialRequestDraft;
  confirmed_fields: string[];
  revision: number;
  created_at: string;
  updated_at: string;
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

export interface ProcurementSupplierOfferingMatch {
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
  specification_match: "MATCHED" | "PARTIAL" | "NO_MATCH" | "NOT_LISTED" | "NOT_REQUESTED";
  coverage_match: "MATCHED" | "NOT_SPECIFIED" | "NOT_REQUESTED";
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
  matches: ProcurementSupplierOfferingMatch[];
  search_limit_reached: boolean;
}

export type ProcurementUnit =
  | "MT"
  | "Bags"
  | "Pieces"
  | "Kg"
  | "Tons"
  | "Meters"
  | "Sq. ft"
  | "Boxes"
  | "Liters";

export interface ProcurementSettings {
  default_delivery_location: string | null;
  preferred_units: ProcurementUnit[];
  specification_match_policy: "REVIEW_DIFFERENCES" | "REQUIRE_OVERLAP";
  delivery_coverage_policy: "ALLOW_UNSPECIFIED" | "REQUIRE_MATCH";
  updated_at: string | null;
}

export type ProcurementSettingsUpdate = Omit<ProcurementSettings, "updated_at">;

export type ProcurementRFQRecipientStatus = "INVITED" | "ACKNOWLEDGED" | "DECLINED";
export type ProcurementRFQStatus = "OPEN" | "CLOSED";

export interface ProcurementRFQRecipient {
  company_id: string;
  company_name: string;
  offering_id: string;
  status: ProcurementRFQRecipientStatus;
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
  status: ProcurementRFQStatus;
  created_at: string;
  recipients: ProcurementRFQRecipient[];
}

export interface SupplierRFQ {
  id: string;
  item_name: string;
  specification: string | null;
  quantity: string | number;
  unit: string;
  delivery_location: string;
  quotation_deadline: string;
  buyer_notes: string | null;
  status: ProcurementRFQStatus;
  created_at: string;
  recipient_status: ProcurementRFQRecipientStatus;
  response_note: string | null;
  responded_at: string | null;
  quotation: SupplierQuotation | null;
}

export interface SupplierQuotationSubmission {
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

export interface SupplierQuotationResult extends SupplierQuotation {
  rfq_id: string;
}

export interface ProcurementRFQCreate {
  material_request_id: string;
  idempotency_key: string;
  supplier_company_ids: string[];
  delivery_location: string | null;
  quotation_deadline: string;
  buyer_notes: string | null;
}

const basePath = "/api/v1/procurement";

export const procurementApi = {
  async getSettings() {
    const response = await apiClient.get<ProcurementSettings>(
      `${basePath}/settings`,
      { withCredentials: true },
    );
    return response.data;
  },

  async updateSettings(settings: ProcurementSettingsUpdate) {
    const response = await apiClient.put<ProcurementSettings>(
      `${basePath}/settings`,
      settings,
      { withCredentials: true },
    );
    return response.data;
  },

  async listConversations() {
    const response = await apiClient.get<ProcurementConversation[]>(
      `${basePath}/conversations`,
      { withCredentials: true },
    );
    return response.data;
  },

  async createConversation() {
    const response = await apiClient.post<ProcurementConversation>(
      `${basePath}/conversations`,
      {},
      { withCredentials: true },
    );
    return response.data;
  },

  async getConversation(id: string) {
    const response = await apiClient.get<ProcurementConversation>(
      `${basePath}/conversations/${encodeURIComponent(id)}`,
      { withCredentials: true },
    );
    return response.data;
  },

  async sendMessage(id: string, message: string, expectedRevision: number) {
    const response = await apiClient.post<ProcurementConversation>(
      `${basePath}/conversations/${encodeURIComponent(id)}/messages`,
      { message, expected_revision: expectedRevision },
      { withCredentials: true },
    );
    return response.data;
  },

  async updateDraft(
    id: string,
    draft: MaterialRequestDraft,
    confirmedFields: string[],
    expectedRevision: number,
  ) {
    const response = await apiClient.patch<ProcurementConversation>(
      `${basePath}/conversations/${encodeURIComponent(id)}/draft`,
      {
        draft,
        confirmed_fields: confirmedFields,
        expected_revision: expectedRevision,
      },
      { withCredentials: true },
    );
    return response.data;
  },

  async saveRequest(id: string, expectedRevision: number, idempotencyKey: string) {
    const response = await apiClient.post<ProcurementMaterialRequest>(
      `${basePath}/conversations/${encodeURIComponent(id)}/save`,
      { expected_revision: expectedRevision, idempotency_key: idempotencyKey },
      { withCredentials: true },
    );
    return response.data;
  },

  async listRequests() {
    const response = await apiClient.get<ProcurementMaterialRequest[]>(
      `${basePath}/requests`,
      { withCredentials: true },
    );
    return response.data;
  },

  async getRequest(id: string) {
    const response = await apiClient.get<ProcurementMaterialRequest>(
      `${basePath}/requests/${encodeURIComponent(id)}`,
      { withCredentials: true },
    );
    return response.data;
  },

  async discoverSuppliers(requestId: string, deliveryLocation?: string | null) {
    const response = await apiClient.get<ProcurementSupplierDiscovery>(
      `${basePath}/requests/${encodeURIComponent(requestId)}/matches`,
      {
        params: deliveryLocation ? { delivery_location: deliveryLocation } : undefined,
        withCredentials: true,
      },
    );
    return response.data;
  },

  async updateRequest(
    id: string,
    fields: Partial<MaterialRequestDraft>,
    expectedRevision: number,
  ) {
    const response = await apiClient.patch<ProcurementMaterialRequest>(
      `${basePath}/requests/${encodeURIComponent(id)}`,
      { ...fields, expected_revision: expectedRevision },
      { withCredentials: true },
    );
    return response.data;
  },

  async deleteRequest(id: string) {
    await apiClient.delete(
      `${basePath}/requests/${encodeURIComponent(id)}`,
      { withCredentials: true },
    );
  },

  async listRFQs() {
    const response = await apiClient.get<ProcurementRFQ[]>(
      `${basePath}/rfqs`,
      { withCredentials: true },
    );
    return response.data;
  },

  async getRFQ(id: string) {
    const response = await apiClient.get<ProcurementRFQ>(
      `${basePath}/rfqs/${encodeURIComponent(id)}`,
      { withCredentials: true },
    );
    return response.data;
  },

  async createRFQ(rfq: ProcurementRFQCreate) {
    const response = await apiClient.post<ProcurementRFQ>(
      `${basePath}/rfqs`,
      rfq,
      { withCredentials: true },
    );
    return response.data;
  },

  async listSupplierRFQs(companyId: string) {
    const response = await apiClient.get<SupplierRFQ[]>(
      `/api/v1/suppliers/companies/${encodeURIComponent(companyId)}/rfqs`,
      { withCredentials: true },
    );
    return response.data;
  },

  async getSupplierRFQ(companyId: string, rfqId: string) {
    const response = await apiClient.get<SupplierRFQ>(
      `/api/v1/suppliers/companies/${encodeURIComponent(companyId)}/rfqs/${encodeURIComponent(rfqId)}`,
      { withCredentials: true },
    );
    return response.data;
  },

  async respondToSupplierRFQ(
    companyId: string,
    rfqId: string,
    responseStatus: "ACKNOWLEDGED" | "DECLINED",
    responseNote: string | null,
  ) {
    const response = await apiClient.post<{
      rfq_id: string;
      recipient_status: "ACKNOWLEDGED" | "DECLINED";
      response_note: string | null;
      responded_at: string;
    }>(
      `/api/v1/suppliers/companies/${encodeURIComponent(companyId)}/rfqs/${encodeURIComponent(rfqId)}/response`,
      { status: responseStatus, response_note: responseNote },
      { withCredentials: true },
    );
    return response.data;
  },

  async submitSupplierQuotation(
    companyId: string,
    rfqId: string,
    quotation: SupplierQuotationSubmission,
  ) {
    const response = await apiClient.put<SupplierQuotationResult>(
      `/api/v1/suppliers/companies/${encodeURIComponent(companyId)}/rfqs/${encodeURIComponent(rfqId)}/quotation`,
      quotation,
      { withCredentials: true },
    );
    return response.data;
  },
};
