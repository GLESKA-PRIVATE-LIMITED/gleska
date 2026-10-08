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

const basePath = "/api/v1/procurement";

export const procurementApi = {
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
};
