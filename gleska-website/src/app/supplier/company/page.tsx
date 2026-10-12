"use client";

import React, { FormEvent, useEffect, useState } from "react";
import {
  Building2,
  CheckCircle2,
  FileText,
  Loader2,
  Pencil,
  Plus,
  Save,
  ShieldCheck,
  X,
  UserPlus,
  Users,
} from "lucide-react";
import {
  CompanyDraft,
  SupplierCompanyProfileDraft,
  SupplierCompanyPrivateProfileDraft,
  emptyCompanyDraft,
  useSupplier,
} from "@/context/SupplierContext";
import { SupplierMember, VerificationDocument } from "@/context/SupplierContext";

export default function SupplierCompanyPage() {
  const {
    companies,
    selectedCompanyId,
    company,
    companyDataId,
    canManageMembers,
    loading,
    companyError,
    setError,
    invitations,
    invitationsError,
    busyMemberId,
    acceptInvitation,
    loadCompany,
    members,
    membersLoaded,
    membersError,
    verificationDocuments,
    verificationDocumentsLoaded,
    verificationError,
    verificationBusy,
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
  } = useSupplier();

  // Create company state
  const [companyDraft, setCompanyDraft] =
    useState<CompanyDraft>(emptyCompanyDraft);
  const [creatingCompany, setCreatingCompany] = useState(false);
  const [editingCompany, setEditingCompany] = useState(false);
  const [savingCompany, setSavingCompany] = useState(false);
  const [companyProfileDraft, setCompanyProfileDraft] =
    useState<SupplierCompanyProfileDraft>({
      name: "",
      description: "",
      website: "",
    });
  const [companyProfileSuccess, setCompanyProfileSuccess] = useState("");
  const [privateProfileDraft, setPrivateProfileDraft] =
    useState<SupplierCompanyPrivateProfileDraft>({
      registered_name: "",
      registration_number: "",
      contact_email: "",
      contact_phone: "",
      registered_address: "",
    });
  const [savingPrivateProfile, setSavingPrivateProfile] = useState(false);
  const [privateProfileSuccess, setPrivateProfileSuccess] = useState("");

  // Invite member state
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"ADMIN" | "MEMBER">("MEMBER");
  const [inviting, setInviting] = useState(false);

  // Verification document upload state
  const [verificationDocumentType, setVerificationDocumentType] = useState(
    "BUSINESS_REGISTRATION",
  );
  const [verificationFile, setVerificationFile] = useState<File | null>(null);
  const [verificationActionSuccess, setVerificationActionSuccess] =
    useState("");
  const [viewingDocumentId, setViewingDocumentId] = useState("");
  const [inviteSuccess, setInviteSuccess] = useState("");

  useEffect(() => {
    setEditingCompany(false);
    setCompanyProfileSuccess("");
    setPrivateProfileSuccess("");
    setVerificationFile(null);
    setVerificationActionSuccess("");
    setViewingDocumentId("");
    setInviteEmail("");
    setInviteSuccess("");
  }, [selectedCompanyId]);

  const handleCreateCompany = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setCreatingCompany(true);
    const success = await createCompany(companyDraft);
    if (success) {
      setCompanyDraft(emptyCompanyDraft);
    }
    setCreatingCompany(false);
  };

  const handleInviteMember = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!inviteEmail.trim()) return;
    setInviteSuccess("");
    setInviting(true);
    const success = await inviteMember(inviteEmail.trim(), inviteRole);
    if (success) {
      setInviteEmail("");
      setInviteSuccess("Invitation created. The recipient must accept it after signing in with this email.");
    }
    setInviting(false);
  };

  const handleUploadDocument = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!verificationFile) return;
    if (verificationFile.size > 10 * 1024 * 1024) {
      setError("Choose a verification document no larger than 10 MB.");
      return;
    }
    const extension = verificationFile.name.split(".").pop()?.toLowerCase();
    const expectedMime =
      extension === "pdf"
        ? "application/pdf"
        : extension === "jpg" || extension === "jpeg"
          ? "image/jpeg"
          : extension === "png"
            ? "image/png"
            : "";
    if (!expectedMime || verificationFile.type !== expectedMime) {
      setError("Choose a PDF, JPEG, or PNG file whose extension matches its file type.");
      return;
    }
    const form = e.currentTarget;
    setVerificationActionSuccess("");
    const success = await uploadVerificationDocument(
      verificationDocumentType,
      verificationFile,
    );
    if (success) {
      setVerificationFile(null);
      form.reset();
      setVerificationActionSuccess("Document uploaded privately. It has not been submitted for review.");
    }
  };

  const beginCompanyEdit = () => {
    if (!company) return;
    setCompanyProfileDraft({
      name: company.name,
      description: company.description || "",
      website: company.website || "",
    });
    setPrivateProfileDraft({
      registered_name: company.registered_name || "",
      registration_number: company.registration_number || "",
      contact_email: company.contact_email || "",
      contact_phone: company.contact_phone || "",
      registered_address: company.registered_address || "",
    });
    setCompanyProfileSuccess("");
    setPrivateProfileSuccess("");
    setEditingCompany(true);
  };

  const handleSaveCompanyProfile = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setCompanyProfileSuccess("");
    setSavingCompany(true);
    const success = await updateCompanyProfile(companyProfileDraft);
    if (success) {
      setCompanyProfileSuccess("Company details saved.");
    }
    setSavingCompany(false);
  };

  const handleSavePrivateProfile = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setPrivateProfileSuccess("");
    setSavingPrivateProfile(true);
    const success = await updateCompanyPrivateProfile(privateProfileDraft);
    if (success) {
      setPrivateProfileSuccess("Registration and contact details saved.");
    }
    setSavingPrivateProfile(false);
  };

  const handleSubmitVerification = async () => {
    setVerificationActionSuccess("");
    const success = await submitVerification();
    if (success) {
      setVerificationActionSuccess("Verification submitted. The company is now awaiting administrator review.");
    }
  };

  const openPrivateDocument = async (document: VerificationDocument) => {
    setViewingDocumentId(document.id);
    await viewVerificationDocument(document);
    setViewingDocumentId("");
  };

  const formatDateTime = (value: string) =>
    new Intl.DateTimeFormat(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(value));
  const canEditVerificationDocuments =
    canManageMembers &&
    ["NOT_SUBMITTED", "REJECTED"].includes(company?.verification_status || "");

  return (
    <div className="space-y-6">
      {/* Pending Company Invitations Banner */}
      {invitations.length > 0 && (
        <section className="rounded-2xl border border-amber-200 bg-amber-50 p-5 dark:border-amber-900 dark:bg-amber-950/30">
          <h2 className="font-semibold text-amber-900 dark:text-amber-100">
            Company invitations
          </h2>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
            Invitations are visible only to your verified account.
          </p>
          <div className="mt-4 space-y-3">
            {invitations.map((invitation) => (
              <div
                key={invitation.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-white p-3 dark:bg-slate-900"
              >
                <div>
                  <p className="font-medium text-slate-900 dark:text-white">
                    {invitation.company_name}
                  </p>
                  <p className="text-xs text-slate-500">
                    {invitation.role} invitation
                  </p>
                </div>
                <button
                  type="button"
                  disabled={busyMemberId === invitation.id}
                  onClick={() => void acceptInvitation(invitation.id)}
                  className="rounded-lg bg-purple-700 px-4 py-2 text-sm font-semibold text-white hover:bg-purple-800 disabled:opacity-60"
                >
                  {busyMemberId === invitation.id
                    ? "Joining..."
                    : "Accept invitation"}
                </button>
              </div>
            ))}
          </div>
        </section>
      )}

      {invitationsError && (
        <div
          role="alert"
          className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/50 dark:text-red-200"
        >
          Company invitations could not be loaded: {invitationsError}
        </div>
      )}

      {/* Setup New Company View (if user has no company yet) */}
      {!loading && !company && !selectedCompanyId && companies.length === 0 && (
        <section className="grid gap-6 lg:grid-cols-[0.8fr_1.2fr]">
          <div className="rounded-2xl border border-purple-200 bg-purple-50 p-6 dark:border-purple-900 dark:bg-purple-950/30">
            <Building2
              className="text-purple-700 dark:text-purple-300"
              size={24}
            />
            <h2 className="mt-3 text-lg font-bold">Set up a supplier company</h2>
            <p className="mt-2 text-sm leading-relaxed text-slate-600 dark:text-slate-300">
              Your existing GLESKA login is used. Creating a supplier company adds
              a separate supplier persona and does not change your worker,
              employer, or admin role.
            </p>
          </div>
          <form
            onSubmit={handleCreateCompany}
            className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900"
          >
            <h2 className="text-lg font-bold">Company profile</h2>
            <p className="mt-1 text-sm text-slate-500">
              Public identity and private registration details are stored
              separately.
            </p>
            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              <label className="sm:col-span-2">
                <span className="mb-1 block text-sm font-medium">
                  Company name <span className="text-red-600">*</span>
                </span>
                <input
                  required
                  minLength={2}
                  maxLength={160}
                  value={companyDraft.name}
                  onChange={(event) =>
                    setCompanyDraft({
                      ...companyDraft,
                      name: event.target.value,
                    })
                  }
                  className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm dark:border-slate-700 dark:bg-slate-950"
                />
              </label>
              <label className="sm:col-span-2">
                <span className="mb-1 block text-sm font-medium">
                  Public company description
                </span>
                <textarea
                  maxLength={2000}
                  rows={3}
                  value={companyDraft.description}
                  onChange={(event) =>
                    setCompanyDraft({
                      ...companyDraft,
                      description: event.target.value,
                    })
                  }
                  className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm dark:border-slate-700 dark:bg-slate-950"
                />
              </label>
              <label className="sm:col-span-2">
                <span className="mb-1 block text-sm font-medium">
                  Public website
                </span>
                <input
                  type="url"
                  value={companyDraft.website}
                  onChange={(event) =>
                    setCompanyDraft({
                      ...companyDraft,
                      website: event.target.value,
                    })
                  }
                  placeholder="https://"
                  className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm dark:border-slate-700 dark:bg-slate-950"
                />
              </label>
              <div className="sm:col-span-2 border-t border-slate-200 pt-4 dark:border-slate-800">
                <h3 className="font-semibold">
                  Private registration and contact details
                </h3>
                <p className="mt-1 text-xs text-slate-500">
                  Only the company owner and admins can view these values.
                </p>
              </div>
              <label>
                <span className="mb-1 block text-sm font-medium">
                  Registered name
                </span>
                <input
                  maxLength={200}
                  value={companyDraft.registered_name}
                  onChange={(event) =>
                    setCompanyDraft({
                      ...companyDraft,
                      registered_name: event.target.value,
                    })
                  }
                  className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm dark:border-slate-700 dark:bg-slate-950"
                />
              </label>
              <label>
                <span className="mb-1 block text-sm font-medium">
                  Registration number
                </span>
                <input
                  maxLength={100}
                  value={companyDraft.registration_number}
                  onChange={(event) =>
                    setCompanyDraft({
                      ...companyDraft,
                      registration_number: event.target.value,
                    })
                  }
                  className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm dark:border-slate-700 dark:bg-slate-950"
                />
              </label>
              <label>
                <span className="mb-1 block text-sm font-medium">
                  Private contact email
                </span>
                <input
                  type="email"
                  value={companyDraft.contact_email}
                  onChange={(event) =>
                    setCompanyDraft({
                      ...companyDraft,
                      contact_email: event.target.value,
                    })
                  }
                  className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm dark:border-slate-700 dark:bg-slate-950"
                />
              </label>
              <label>
                <span className="mb-1 block text-sm font-medium">
                  Private contact phone
                </span>
                <input
                  maxLength={32}
                  value={companyDraft.contact_phone}
                  onChange={(event) =>
                    setCompanyDraft({
                      ...companyDraft,
                      contact_phone: event.target.value,
                    })
                  }
                  className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm dark:border-slate-700 dark:bg-slate-950"
                />
              </label>
              <label className="sm:col-span-2">
                <span className="mb-1 block text-sm font-medium">
                  Registered address
                </span>
                <textarea
                  maxLength={1000}
                  rows={2}
                  value={companyDraft.registered_address}
                  onChange={(event) =>
                    setCompanyDraft({
                      ...companyDraft,
                      registered_address: event.target.value,
                    })
                  }
                  className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm dark:border-slate-700 dark:bg-slate-950"
                />
              </label>
            </div>
            <button
              disabled={creatingCompany}
              className="mt-5 inline-flex items-center gap-2 rounded-xl bg-purple-700 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-purple-800 disabled:opacity-60"
            >
              {creatingCompany ? (
                <Loader2 className="animate-spin" size={17} />
              ) : (
                <Plus size={17} />
              )}
              Create supplier company
            </button>
          </form>
        </section>
      )}

      {/* Existing Company Management View */}
      {!company && (loading || selectedCompanyId) && (
        <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          {companyError && companyDataId === selectedCompanyId ? (
            <div role="alert" className="flex flex-wrap items-center justify-between gap-3 text-sm text-red-700 dark:text-red-300">
              <span>Company information could not be loaded: {companyError}</span>
              <button type="button" onClick={() => void loadCompany(selectedCompanyId)} className="font-semibold underline">Retry</button>
            </div>
          ) : (
            <div className="flex items-center gap-3 text-sm text-slate-600 dark:text-slate-300">
              <Loader2 size={18} className="animate-spin" />
              {loading ? "Loading supplier workspace…" : "Loading company profile…"}
            </div>
          )}
        </section>
      )}

      {company && companyDataId === selectedCompanyId && (
        <section className="grid grid-cols-1 gap-6">
          {/* Company profile and verification */}
          <div className="contents">
            {/* Company Identity */}
            <article className="rounded-2xl border border-slate-200/90 bg-white p-5 shadow-xs dark:border-slate-800 dark:bg-slate-900 sm:p-6">
              <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-100 pb-4 dark:border-slate-800">
                <div className="flex items-start gap-3">
                  <span className="rounded-xl bg-purple-50 p-2.5 text-purple-700 dark:bg-purple-950/50 dark:text-purple-300">
                    <Building2 size={21} />
                  </span>
                  <div>
                    <p className="text-xs font-bold uppercase tracking-wider text-purple-600 dark:text-purple-400">Company overview</p>
                    <h2 className="mt-1 text-xl font-bold text-slate-900 dark:text-white">{company.name}</h2>
                    <p className="mt-1 text-sm text-slate-500">Supplier business profile and verification standing</p>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`shrink-0 whitespace-nowrap rounded-full px-3 py-1 text-xs font-semibold ${
                    company.operational_status === "ACTIVE"
                      ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300"
                      : "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300"
                  }`}>Operations: {company.operational_status.replaceAll("_", " ")}</span>
                  <span className={`shrink-0 whitespace-nowrap rounded-full px-3 py-1 text-xs font-semibold ${
                    company.verification_status === "VERIFIED"
                      ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300"
                      : company.verification_status === "PENDING_REVIEW"
                        ? "bg-indigo-50 text-indigo-700 dark:bg-indigo-950/50 dark:text-indigo-300"
                        : company.verification_status === "REJECTED" || company.verification_status === "SUSPENDED"
                          ? "bg-rose-50 text-rose-700 dark:bg-rose-950/50 dark:text-rose-300"
                          : "bg-amber-50 text-amber-800 dark:bg-amber-950/50 dark:text-amber-200"
                  }`}>
                    <span className="inline-flex items-center gap-1.5">
                      <ShieldCheck size={13} />
                      {company.verification_status.replaceAll("_", " ")}
                    </span>
                  </span>
                </div>
              </div>

              {companyProfileSuccess && (
                <p role="status" className="mt-4 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200">
                  {companyProfileSuccess}
                </p>
              )}

              {editingCompany ? (
                <form onSubmit={handleSaveCompanyProfile} className="mt-5 space-y-4">
                  <div className="grid gap-4 sm:grid-cols-2">
                    <label className="sm:col-span-2">
                      <span className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-200">Company name <span className="text-red-600">*</span></span>
                      <input required minLength={2} maxLength={160} value={companyProfileDraft.name} onChange={(event) => setCompanyProfileDraft({ ...companyProfileDraft, name: event.target.value })} className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm dark:border-slate-700 dark:bg-slate-950" />
                    </label>
                    <label className="sm:col-span-2">
                      <span className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-200">Public company description</span>
                      <textarea maxLength={2000} rows={4} value={companyProfileDraft.description} onChange={(event) => setCompanyProfileDraft({ ...companyProfileDraft, description: event.target.value })} className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm dark:border-slate-700 dark:bg-slate-950" />
                    </label>
                    <label className="sm:col-span-2">
                      <span className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-200">Public website</span>
                      <input type="url" maxLength={2048} value={companyProfileDraft.website} onChange={(event) => setCompanyProfileDraft({ ...companyProfileDraft, website: event.target.value })} placeholder="https://" className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm dark:border-slate-700 dark:bg-slate-950" />
                    </label>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button type="submit" disabled={savingCompany} className="inline-flex items-center gap-2 rounded-xl bg-purple-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-purple-800 disabled:opacity-60">
                      {savingCompany ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
                      {savingCompany ? "Saving…" : "Save public details"}
                    </button>
                  </div>
                </form>
              ) : (
                <div className="mt-5">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-xs font-bold uppercase tracking-wide text-slate-400">Public business information</p>
                      <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-700 dark:text-slate-300">
                        {company.description || "No company description has been added."}
                      </p>
                      {company.website ? (
                        <a className="mt-3 inline-block break-all text-sm font-semibold text-purple-700 hover:underline dark:text-purple-300" href={company.website} target="_blank" rel="noreferrer">{company.website}</a>
                      ) : (
                        <p className="mt-3 text-sm text-slate-500">No website added.</p>
                      )}
                    </div>
                    {canManageMembers && (
                      <button type="button" onClick={beginCompanyEdit} className="inline-flex shrink-0 items-center gap-2 rounded-xl border border-purple-200 px-3.5 py-2 text-sm font-semibold text-purple-800 hover:bg-purple-50 dark:border-purple-900 dark:text-purple-200 dark:hover:bg-purple-950/40">
                        <Pencil size={15} /> Edit Company Details
                      </button>
                    )}
                  </div>
                  {!canManageMembers && (
                    <p className="mt-4 text-xs text-slate-500">Only company owners and admins can edit public company details.</p>
                  )}
                </div>
              )}

              <div className="mt-5 border-t border-slate-100 pt-5 dark:border-slate-800">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <h3 className="font-semibold text-slate-900 dark:text-white">Registration and contact details</h3>
                    <p className="mt-1 text-xs text-slate-500">Private details are visible to company owners and admins. Save this section separately from public company details.</p>
                  </div>
                </div>
                {canManageMembers && editingCompany ? (
                  <form onSubmit={handleSavePrivateProfile} className="mt-4 space-y-4">
                    <div className="grid gap-4 sm:grid-cols-2">
                      <label>
                        <span className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-200">Registered name</span>
                        <input maxLength={200} value={privateProfileDraft.registered_name} onChange={(event) => setPrivateProfileDraft({ ...privateProfileDraft, registered_name: event.target.value })} className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm dark:border-slate-700 dark:bg-slate-950" />
                      </label>
                      <label>
                        <span className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-200">Registration number</span>
                        <input maxLength={100} value={privateProfileDraft.registration_number} onChange={(event) => setPrivateProfileDraft({ ...privateProfileDraft, registration_number: event.target.value })} className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm dark:border-slate-700 dark:bg-slate-950" />
                      </label>
                      <label>
                        <span className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-200">Contact email</span>
                        <input type="email" maxLength={254} value={privateProfileDraft.contact_email} onChange={(event) => setPrivateProfileDraft({ ...privateProfileDraft, contact_email: event.target.value })} className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm dark:border-slate-700 dark:bg-slate-950" />
                      </label>
                      <label>
                        <span className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-200">Contact phone</span>
                        <input type="tel" maxLength={32} value={privateProfileDraft.contact_phone} onChange={(event) => setPrivateProfileDraft({ ...privateProfileDraft, contact_phone: event.target.value })} className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm dark:border-slate-700 dark:bg-slate-950" />
                      </label>
                      <label className="sm:col-span-2">
                        <span className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-200">Registered address</span>
                        <textarea maxLength={1000} rows={3} value={privateProfileDraft.registered_address} onChange={(event) => setPrivateProfileDraft({ ...privateProfileDraft, registered_address: event.target.value })} className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm dark:border-slate-700 dark:bg-slate-950" />
                      </label>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button type="submit" disabled={savingPrivateProfile} className="inline-flex items-center gap-2 rounded-xl bg-purple-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-purple-800 disabled:opacity-60">
                        {savingPrivateProfile ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
                        {savingPrivateProfile ? "Saving…" : "Save registration & contact"}
                      </button>
                      <button type="button" disabled={savingPrivateProfile || savingCompany} onClick={() => setEditingCompany(false)} className="inline-flex items-center gap-2 rounded-xl border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800">
                        <X size={16} /> Cancel
                      </button>
                    </div>
                    {privateProfileSuccess && (
                      <p role="status" className="text-sm text-emerald-700 dark:text-emerald-300">{privateProfileSuccess}</p>
                    )}
                  </form>
                ) : canManageMembers ? (
                  <dl className="mt-4 grid gap-x-6 gap-y-4 sm:grid-cols-2">
                    {[
                      ["Registered name", company.registered_name],
                      ["Registration number", company.registration_number],
                      ["Contact email", company.contact_email],
                      ["Contact phone", company.contact_phone],
                      ["Registered address", company.registered_address],
                    ].map(([label, value]) => (
                      <div key={label} className={label === "Registered address" ? "sm:col-span-2" : ""}>
                        <dt className="text-xs font-medium text-slate-500">{label}</dt>
                        <dd className="mt-1 break-words text-sm font-medium text-slate-800 dark:text-slate-200">{value || "Not provided"}</dd>
                      </div>
                    ))}
                  </dl>
                ) : (
                  <p className="mt-3 text-sm text-slate-500">Private registration and contact values are not available to your company role.</p>
                )}
              </div>
            </article>

            {/* Verification Card */}
            <article className="rounded-2xl border border-slate-200/90 bg-white p-5 shadow-xs dark:border-slate-800 dark:bg-slate-900 sm:p-6">
              <div className="flex items-start justify-between gap-3 border-b border-slate-100 pb-3 dark:border-slate-800">
                <div>
                  <span className="text-[10px] font-bold uppercase tracking-wider text-indigo-600 dark:text-indigo-400">
                    Compliance & Evidence
                  </span>
                  <h3 className="mt-0.5 text-base font-bold text-slate-900 dark:text-white">
                    Supplier Verification
                  </h3>
                </div>
                <span className={`shrink-0 whitespace-nowrap rounded-lg px-2.5 py-1 text-xs font-bold uppercase ${
                  company.verification_status === "VERIFIED"
                    ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300"
                    : company.verification_status === "PENDING_REVIEW"
                      ? "bg-purple-50 text-purple-700 dark:bg-purple-950/50 dark:text-purple-300"
                      : company.verification_status === "REJECTED" ||
                          company.verification_status === "SUSPENDED"
                        ? "bg-rose-50 text-rose-700 dark:bg-rose-950/50 dark:text-rose-300"
                        : "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300"
                }`}>
                  {company.verification_status.replaceAll("_", " ")}
                </span>
              </div>
                  <p className="mt-3 text-sm leading-6 text-slate-600 dark:text-slate-300">
                    Uploaded evidence is private to company owners and admins and authorized GLESKA reviewers. Uploading does not change this status; submission and administrator review are separate steps.
              </p>

                  <dl className="mt-4 grid gap-3 rounded-xl bg-slate-50 p-4 text-sm dark:bg-slate-950 sm:grid-cols-2">
                    <div>
                      <dt className="text-xs font-medium text-slate-500">Submitted</dt>
                      <dd className="mt-1 font-medium text-slate-800 dark:text-slate-200">
                        {company.verification_submitted_at ? formatDateTime(company.verification_submitted_at) : "Not submitted"}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs font-medium text-slate-500">Reviewed</dt>
                      <dd className="mt-1 font-medium text-slate-800 dark:text-slate-200">
                        {company.verification_reviewed_at ? formatDateTime(company.verification_reviewed_at) : "Not reviewed"}
                      </dd>
                    </div>
                  </dl>

                  {verificationError && (
                <div
                  role="alert"
                  className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/50 dark:text-red-200"
                >
                  <span>
                    Verification documents could not be loaded:{" "}
                    {verificationError}
                  </span>
                  <button
                    type="button"
                    onClick={() => void loadCompany(selectedCompanyId)}
                    className="font-semibold underline"
                  >
                    Retry
                  </button>
                </div>
              )}

              {["NOT_SUBMITTED", "REJECTED"].includes(
                company.verification_status,
              ) &&
                canManageMembers && (
                  <p className="mt-2 rounded-lg bg-indigo-50 px-3 py-2 text-xs leading-relaxed text-indigo-900 dark:bg-indigo-950/50 dark:text-indigo-200">
                    Uploading a document saves the evidence but does not submit
                    it. After uploading at least one supported verification document, select{" "}
                    <strong>Submit for review</strong> to request verification.
                  </p>
                )}

              {company.verification_reason && (
                <div className="mt-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-950 dark:bg-amber-950/40 dark:text-amber-100">
                  <strong>Review feedback:</strong>{" "}
                  {company.verification_reason}
                </div>
              )}

              {company.verification_status === "VERIFIED" && (
                <p className="mt-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200">
                  This company is verified. The current workflow does not allow additional uploads or resubmission from this page.
                </p>
              )}
              {company.verification_status === "PENDING_REVIEW" && (
                <p className="mt-3 rounded-lg bg-indigo-50 px-3 py-2 text-sm text-indigo-800 dark:bg-indigo-950/40 dark:text-indigo-200">
                  The submission is awaiting administrator review. Documents cannot be changed while it is under review.
                </p>
              )}
              {company.verification_status === "SUSPENDED" && (
                <p className="mt-3 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-800 dark:bg-rose-950/40 dark:text-rose-200">
                  Verification is suspended. Contact GLESKA support for next steps.
                </p>
              )}

              {canManageMembers && (
                <>
                  <form
                    onSubmit={handleUploadDocument}
                    className="mt-4 space-y-3 border-t border-slate-200 pt-4 dark:border-slate-800"
                  >
                    <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
                      Private verification documents
                    </h3>
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_1.5fr_auto]">
                      <select
                        value={verificationDocumentType}
                        disabled={!canEditVerificationDocuments || verificationBusy}
                        onChange={(event) =>
                          setVerificationDocumentType(event.target.value)
                        }
                        className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950"
                      >
                        <option value="BUSINESS_REGISTRATION">
                          Business registration
                        </option>
                        <option value="TAX_REGISTRATION">
                          Tax registration
                        </option>
                        <option value="ADDRESS_PROOF">Address proof</option>
                        <option value="OTHER">Other</option>
                      </select>
                      <input
                        key={selectedCompanyId}
                        type="file"
                        required
                        disabled={!canEditVerificationDocuments || verificationBusy}
                        accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"
                        onChange={(event) =>
                          setVerificationFile(
                            event.target.files?.[0] || null,
                          )
                        }
                        className="w-full min-w-0 rounded-lg border border-slate-300 px-2 py-1.5 text-xs dark:border-slate-700"
                      />
                      <button
                        type="submit"
                        disabled={
                          verificationBusy ||
                          !verificationFile ||
                          !canEditVerificationDocuments
                        }
                        className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-indigo-300 px-3 py-2 text-sm font-semibold text-indigo-800 disabled:opacity-50 hover:bg-indigo-50 dark:border-indigo-800 dark:text-indigo-200 sm:w-auto"
                      >
                        <FileText size={15} /> Upload
                      </button>
                    </div>
                    <p className="text-xs leading-5 text-slate-500">
                    PDF, JPEG, or PNG · maximum 10 MB. Uploading adds another document record; it does not replace or delete an existing file. The displayed category is stored document metadata, not inferred from the filename.
                    </p>
                  </form>

                  {verificationActionSuccess && (
                    <p role="status" className="mt-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200">
                      {verificationActionSuccess}
                    </p>
                  )}

                  {!verificationDocumentsLoaded && !verificationError ? (
                    <p className="mt-4 flex items-center gap-2 text-sm text-slate-500"><Loader2 size={15} className="animate-spin" /> Loading private documents…</p>
                  ) : verificationError ? null : verificationDocuments.length === 0 ? (
                    <p className="mt-4 rounded-lg border border-dashed border-slate-300 px-4 py-5 text-sm text-slate-500 dark:border-slate-700">
                      No verification documents are associated with this company.
                    </p>
                  ) : (
                    <div className="mt-4 space-y-4">
                      {[
                        ["BUSINESS_REGISTRATION", "Business registration"],
                        ["TAX_REGISTRATION", "Tax registration"],
                        ["ADDRESS_PROOF", "Address proof"],
                        ["OTHER", "Other"],
                      ].map(([type, title]) => {
                        const documents = verificationDocuments.filter((document) => document.document_type === type);
                        if (documents.length === 0) return null;
                        return (
                          <section key={type} aria-label={`${title} documents`}>
                            <h4 className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-500">{title}</h4>
                            <div className="space-y-2">
                              {documents.map((document) => (
                                <div key={document.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 px-3 py-3 dark:border-slate-800">
                                  <div className="min-w-0">
                                    <p className="break-all text-sm font-medium text-slate-800 dark:text-slate-200">{document.original_filename}</p>
                                    <p className="mt-1 text-xs text-slate-500">Uploaded {formatDateTime(document.uploaded_at)} · {Math.max(1, Math.round(document.file_size_bytes / 1024))} KB</p>
                                  </div>
                                  <button type="button" disabled={viewingDocumentId === document.id} onClick={() => void openPrivateDocument(document)} className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-indigo-200 px-3 py-2 text-xs font-semibold text-indigo-800 hover:bg-indigo-50 disabled:opacity-50 dark:border-indigo-900 dark:text-indigo-200 dark:hover:bg-indigo-950/40">
                                    {viewingDocumentId === document.id ? <Loader2 size={14} className="animate-spin" /> : <FileText size={14} />}
                                    View private file
                                  </button>
                                </div>
                              ))}
                            </div>
                          </section>
                        );
                      })}
                    </div>
                  )}

                  {["NOT_SUBMITTED", "REJECTED"].includes(
                    company.verification_status,
                  ) && (
                    <button
                      type="button"
                      disabled={
                        verificationBusy || verificationDocuments.length === 0
                      }
                      onClick={() => void handleSubmitVerification()}
                      className="mt-4 inline-flex items-center gap-2 rounded-xl bg-indigo-700 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50 hover:bg-indigo-800"
                    >
                      <CheckCircle2 size={16} />
                      {verificationBusy ? "Submitting…" : "Submit for review"}
                    </button>
                  )}
                </>
              )}
            </article>

          </div>

          <div className="contents">
            {/* Member Invitation Form */}
            {canManageMembers && (
              <form
                onSubmit={handleInviteMember}
                className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900"
              >
                <div className="flex items-center gap-2">
                  <UserPlus
                    size={18}
                    className="text-purple-600 dark:text-purple-400"
                  />
                  <h2 className="font-semibold text-slate-900 dark:text-white">
                    Invite a company member
                  </h2>
                </div>
                <p className="mt-1 text-xs text-slate-500">
                  The invitee must sign in with this email and accept the
                  invitation. Company admins can invite members; only the
                  owner can choose the admin role.
                </p>
                <div className="mt-4 flex flex-col gap-3 sm:flex-row">
                  <input
                    type="email"
                    required
                    autoComplete="email"
                    value={inviteEmail}
                    onChange={(event) => setInviteEmail(event.target.value)}
                    placeholder="Account email"
                    className="min-w-0 flex-1 rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950"
                  />
                  {company.role === "OWNER" && (
                    <select
                      value={inviteRole}
                      onChange={(event) =>
                        setInviteRole(
                          event.target.value as "ADMIN" | "MEMBER",
                        )
                      }
                      className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950 sm:w-auto"
                    >
                      <option value="MEMBER">Member</option>
                      <option value="ADMIN">Admin</option>
                    </select>
                  )}
                  <button
                    disabled={inviting}
                    className="w-full rounded-xl bg-purple-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-purple-800 disabled:opacity-60 sm:w-auto"
                  >
                    {inviting ? "Sending..." : "Create invitation"}
                  </button>
                </div>
                {inviteSuccess && (
                  <p role="status" className="mt-3 text-sm text-emerald-700 dark:text-emerald-300">{inviteSuccess}</p>
                )}
              </form>
            )}

          {/* Company Members */}
          <article className="rounded-2xl border border-slate-200/90 bg-white p-5 shadow-xs dark:border-slate-800 dark:bg-slate-900 sm:p-6">
            <div className="flex items-center justify-between gap-3 border-b border-slate-100 pb-3 dark:border-slate-800">
              <div className="flex items-center gap-2">
                <Users
                  size={18}
                  className="text-purple-600 dark:text-purple-400"
                />
                <h2 className="text-base font-bold text-slate-900 dark:text-white">
                  Company Members ({members.length})
                </h2>
              </div>
            </div>
            <p className="mt-2 text-sm leading-5 text-slate-500">
              Active members can use this supplier workspace. Pending invitations are listed separately until accepted.
            </p>

            {membersError && (
              <div
                role="alert"
                className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/50 dark:text-red-200"
              >
                <span>Company members could not be loaded: {membersError}</span>
                <button
                  type="button"
                  onClick={() => void loadCompany(selectedCompanyId)}
                  className="font-semibold underline"
                >
                  Retry
                </button>
              </div>
            )}

            <div className="mt-5">
              <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
                Active members ({members.filter((member) => member.status === "ACTIVE").length})
              </h3>
              {!membersLoaded && !membersError ? (
                <p className="mt-3 flex items-center gap-2 text-sm text-slate-500"><Loader2 size={15} className="animate-spin" /> Loading company members…</p>
              ) : null}
              <div className="mt-2 divide-y divide-slate-200 dark:divide-slate-800">
              {members.filter((member) => member.status === "ACTIVE").map((member) => (
                <div
                  key={member.id}
                  className="flex flex-wrap items-center justify-between gap-3 py-3"
                >
                  <div className="min-w-0 flex-1">
                    <p className="break-words text-sm font-semibold text-slate-900 dark:text-white">
                      {member.name || member.invited_email || "Invited member"}
                    </p>
                    <p className="mt-0.5 text-xs text-slate-500">
                      {member.role} · {member.status}
                    </p>
                  </div>
                  {canManageMembers &&
                    member.role !== "OWNER" &&
                    member.status === "ACTIVE" && (
                      <div className="flex shrink-0 flex-wrap gap-2">
                        {company.role === "OWNER" && (
                          <select
                            aria-label={`Role for ${member.name || "member"}`}
                            value={member.role}
                            disabled={busyMemberId === member.id}
                            onChange={(event) =>
                              void changeMemberRole(
                                member,
                                event.target.value as "ADMIN" | "MEMBER",
                              )
                            }
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
                            className="rounded-lg border border-purple-300 px-2 py-1.5 text-xs font-semibold text-purple-700 disabled:opacity-50 dark:border-purple-800 dark:text-purple-300 hover:bg-purple-50"
                          >
                            Transfer owner
                          </button>
                        )}
                        <button
                          type="button"
                          disabled={busyMemberId === member.id}
                          onClick={() => void revokeMember(member)}
                          className="rounded-lg border border-red-200 px-2 py-1.5 text-xs font-semibold text-red-700 disabled:opacity-50 dark:border-red-900 dark:text-red-300 hover:bg-red-50"
                        >
                          Revoke
                        </button>
                      </div>
                    )}
                </div>
              ))}
              {membersLoaded && !membersError && members.filter((member) => member.status === "ACTIVE").length === 0 && (
                <p className="py-6 text-sm text-slate-500">
                  No active members are available.
                </p>
              )}
              </div>
            </div>

            <div className="mt-6 border-t border-slate-100 pt-5 dark:border-slate-800">
              <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
                Pending invitations ({members.filter((member) => member.status === "PENDING").length})
              </h3>
              <div className="mt-2 divide-y divide-slate-200 dark:divide-slate-800">
                {members.filter((member) => member.status === "PENDING").map((member) => (
                  <div key={member.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                    <div className="min-w-0">
                      <p className="break-all text-sm font-semibold text-slate-900 dark:text-white">{member.invited_email || "Invited member"}</p>
                      <p className="mt-0.5 text-xs text-slate-500">{member.role} · Pending acceptance</p>
                    </div>
                    {canManageMembers && (company.role === "OWNER" || member.role === "MEMBER") && (
                      <button type="button" disabled={busyMemberId === member.id} onClick={() => void revokeMember(member)} className="rounded-lg border border-red-200 px-2.5 py-1.5 text-xs font-semibold text-red-700 disabled:opacity-50 dark:border-red-900 dark:text-red-300 hover:bg-red-50">
                        Cancel invitation
                      </button>
                    )}
                  </div>
                ))}
                {membersLoaded && !membersError && members.filter((member) => member.status === "PENDING").length === 0 && (
                  <p className="py-5 text-sm text-slate-500">There are no pending invitations.</p>
                )}
              </div>
            </div>
          </article>
          </div>
        </section>
      )}
    </div>
  );
}
