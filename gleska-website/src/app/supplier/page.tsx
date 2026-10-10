"use client";

import React, { useCallback, useEffect, useState } from "react";
import type { FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { isAxiosError } from "axios";
import { ArrowLeft, Building2, Loader2, Plus, RefreshCw, UserPlus, Users } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import apiClient from "@/lib/api";

type CompanyRole = "OWNER" | "ADMIN" | "MEMBER";
type MembershipStatus = "ACTIVE" | "PENDING" | "REVOKED";

interface CompanyMembership {
  id: string;
  company_id: string;
  company_name: string;
  role: CompanyRole;
  status: MembershipStatus;
  created_at: string;
}

interface SupplierCompany {
  id: string;
  name: string;
  description: string | null;
  website: string | null;
  operational_status: "ACTIVE" | "SUSPENDED" | "ARCHIVED";
  role: CompanyRole;
  created_at: string;
  updated_at: string;
  registered_name?: string | null;
  registration_number?: string | null;
  contact_email?: string | null;
  contact_phone?: string | null;
  registered_address?: string | null;
}

interface SupplierMember {
  id: string;
  name: string | null;
  invited_email: string | null;
  role: CompanyRole;
  status: MembershipStatus;
  created_at: string;
}

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
  if (isAxiosError<{ detail?: string }>(error)) {
    const detail = error.response?.data?.detail;
    const messages: Record<string, string> = {
      SUPPLIER_COMPANY_MEMBERSHIP_NOT_FOUND: "You do not have active membership in that supplier company.",
      SUPPLIER_COMPANY_NOT_OPERATIONAL: "This supplier company is suspended or archived. Contact an authorized GLESKA administrator.",
      VERIFIED_EMAIL_REQUIRED_TO_ACCEPT_SUPPLIER_INVITATION: "Confirm your account email before accepting this invitation.",
      SUPPLIER_INVITATION_NOT_FOUND: "This invitation is no longer available for your verified account.",
      SUPPLIER_MEMBER_MANAGEMENT_FORBIDDEN: "Your company role does not allow member management.",
      SUPPLIER_OWNER_REQUIRED: "Only the current company owner can transfer ownership.",
      SUPPLIER_MEMBERSHIP_CONFLICT: "That account already has a company invitation or membership.",
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
  const [selectedCompanyId, setSelectedCompanyId] = useState("");
  const [companyDraft, setCompanyDraft] = useState<CompanyDraft>(emptyCompanyDraft);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"ADMIN" | "MEMBER">("MEMBER");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [busyMemberId, setBusyMemberId] = useState("");
  const [error, setError] = useState("");

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
      return;
    }
    const [companyResponse, membersResponse] = await Promise.all([
      apiClient.get<SupplierCompany>(`/api/v1/suppliers/companies/${companyId}`),
      apiClient.get<SupplierMember[]>(`/api/v1/suppliers/companies/${companyId}/members`),
    ]);
    setCompany(companyResponse.data);
    setMembers(membersResponse.data);
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
      return;
    }
    setError("");
    void loadCompany(selectedCompanyId).catch((loadError: unknown) => {
      setCompany(null);
      setMembers([]);
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

  if (isLoading || loading || !user) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-50 dark:bg-slate-950">
        <div className="flex items-center gap-3 text-sm font-medium text-slate-600 dark:text-slate-300">
          <Loader2 className="animate-spin" size={20} />
          Loading supplier workspace...
        </div>
      </main>
    );
  }

  const canManageMembers = company?.role === "OWNER" || company?.role === "ADMIN";

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-8 text-slate-900 dark:bg-slate-950 dark:text-slate-100 sm:px-8">
      <div className="mx-auto max-w-6xl space-y-7">
        <header className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="rounded-2xl bg-blue-100 p-3 text-blue-700 dark:bg-blue-950 dark:text-blue-300">
              <Building2 size={24} />
            </div>
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.18em] text-blue-700 dark:text-blue-300">
                Supplier identity & membership
              </p>
              <h1 className="mt-1 text-2xl font-bold tracking-tight sm:text-3xl">Supplier Workspace</h1>
              <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
                Signed in as {user.name}. Supplier access is separate from your {user.role.toLowerCase()} account permissions.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {user.role === "EMPLOYER" && (
              <Link
                href="/employer/dashboard"
                className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-semibold hover:bg-white dark:border-slate-700 dark:hover:bg-slate-900"
              >
                Employer workspace
              </Link>
            )}
            <button
              type="button"
              onClick={() => void refreshWorkspace()}
              className="inline-flex items-center gap-2 rounded-xl border border-slate-300 px-4 py-2 text-sm font-semibold hover:bg-white dark:border-slate-700 dark:hover:bg-slate-900"
            >
              <RefreshCw size={16} />
              Refresh
            </button>
          </div>
        </header>

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
                    className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
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
                {company.website && <a className="mt-3 inline-block text-sm font-medium text-blue-700 underline dark:text-blue-300" href={company.website} target="_blank" rel="noreferrer">{company.website}</a>}
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
                <p className="mt-5 rounded-xl bg-blue-50 px-3 py-2 text-xs leading-relaxed text-blue-900 dark:bg-blue-950/50 dark:text-blue-200">
                  Company creation does not mean the supplier is verified. Verification and supplier discovery are not part of this workspace phase.
                </p>
              </article>
              {canManageMembers && (
                <form onSubmit={inviteMember} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
                  <div className="flex items-center gap-2">
                    <UserPlus size={18} className="text-blue-600" />
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
                    <button disabled={saving} className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60">
                      {saving ? "Sending..." : "Create invitation"}
                    </button>
                  </div>
                </form>
              )}
            </div>

            <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
              <div className="flex items-center gap-2">
                <Users size={19} className="text-blue-600" />
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
                            className="rounded-lg border border-blue-300 px-2 py-1.5 text-xs font-semibold text-blue-700 disabled:opacity-50 dark:border-blue-800 dark:text-blue-300"
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
            <div className="rounded-2xl border border-blue-200 bg-blue-50 p-6 dark:border-blue-900 dark:bg-blue-950/30">
              <Building2 className="text-blue-700 dark:text-blue-300" size={24} />
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
              <button disabled={saving} className="mt-5 inline-flex items-center gap-2 rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60">
                {saving ? <Loader2 className="animate-spin" size={17} /> : <Plus size={17} />}
                Create supplier company
              </button>
            </form>
          </section>
        )}

        {companies.length > 0 && !company && !error && (
          <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500 dark:border-slate-800 dark:bg-slate-900">
            Select an operational company or refresh the workspace. Inactive company access must be restored by an authorized operator.
          </div>
        )}

        <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 pt-5 text-xs text-slate-500 dark:border-slate-800">
          <span>Supplier verification, catalogue, discovery, RFQs, quotations, and orders are not available in this phase.</span>
          <Link href="/" className="inline-flex items-center gap-1 font-semibold hover:text-blue-700 dark:hover:text-blue-300">
            <ArrowLeft size={14} />
            Back to GLESKA
          </Link>
        </footer>
      </div>
    </main>
  );
}
