"use client";

import React, { FormEvent, useState } from "react";
import {
  Building2,
  CheckCircle2,
  FileText,
  Loader2,
  Plus,
  UserPlus,
  Users,
} from "lucide-react";
import {
  CompanyDraft,
  emptyCompanyDraft,
  useSupplier,
} from "@/context/SupplierContext";
import { SupplierMember, VerificationDocument } from "@/context/SupplierContext";

export default function SupplierCompanyPage() {
  const {
    companies,
    selectedCompanyId,
    selectedMembership,
    company,
    companyDataId,
    canManageMembers,
    invitations,
    invitationsError,
    busyMemberId,
    acceptInvitation,
    loadCompany,
    members,
    membersError,
    verificationDocuments,
    verificationError,
    verificationBusy,
    createCompany,
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

  // Invite member state
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"ADMIN" | "MEMBER">("MEMBER");
  const [inviting, setInviting] = useState(false);

  // Verification document upload state
  const [verificationDocumentType, setVerificationDocumentType] = useState(
    "BUSINESS_REGISTRATION",
  );
  const [verificationFile, setVerificationFile] = useState<File | null>(null);

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
    setInviting(true);
    const success = await inviteMember(inviteEmail.trim(), inviteRole);
    if (success) {
      setInviteEmail("");
    }
    setInviting(false);
  };

  const handleUploadDocument = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!verificationFile) return;
    const success = await uploadVerificationDocument(
      verificationDocumentType,
      verificationFile,
    );
    if (success) {
      setVerificationFile(null);
    }
  };

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
      {!company && companies.length === 0 && (
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
      {company && companyDataId === selectedCompanyId && (
        <section className="grid gap-6 lg:grid-cols-[1fr_1.15fr]">
          {/* Left Column: Identity, Verification, Member Invite */}
          <div className="space-y-6">
            {/* Company Identity */}
            <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-bold uppercase tracking-wider text-slate-500">
                    Company identity
                  </p>
                  <h2 className="mt-1 text-xl font-bold">{company.name}</h2>
                </div>
                <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold dark:bg-slate-800">
                  {company.operational_status}
                </span>
              </div>
              {company.description && (
                <p className="mt-3 text-sm text-slate-600 dark:text-slate-300">
                  {company.description}
                </p>
              )}
              {company.website && (
                <a
                  className="mt-3 inline-block text-sm font-medium text-purple-700 underline dark:text-purple-300"
                  href={company.website}
                  target="_blank"
                  rel="noreferrer"
                >
                  {company.website}
                </a>
              )}
              {canManageMembers && (
                <div className="mt-5 border-t border-slate-200 pt-4 text-sm dark:border-slate-800">
                  <h3 className="font-semibold">Private company details</h3>
                  <p className="mt-1 text-xs text-slate-500">
                    Visible only to company owners and admins in this workspace.
                  </p>
                  <dl className="mt-3 space-y-2">
                    {company.registered_name && (
                      <div>
                        <dt className="text-xs text-slate-500">
                          Registered name
                        </dt>
                        <dd>{company.registered_name}</dd>
                      </div>
                    )}
                    {company.registration_number && (
                      <div>
                        <dt className="text-xs text-slate-500">
                          Registration number
                        </dt>
                        <dd>{company.registration_number}</dd>
                      </div>
                    )}
                    {company.contact_email && (
                      <div>
                        <dt className="text-xs text-slate-500">
                          Private contact email
                        </dt>
                        <dd>{company.contact_email}</dd>
                      </div>
                    )}
                    {company.contact_phone && (
                      <div>
                        <dt className="text-xs text-slate-500">
                          Private contact phone
                        </dt>
                        <dd>{company.contact_phone}</dd>
                      </div>
                    )}
                    {company.registered_address && (
                      <div>
                        <dt className="text-xs text-slate-500">
                          Registered address
                        </dt>
                        <dd>{company.registered_address}</dd>
                      </div>
                    )}
                    {!company.registered_name &&
                      !company.registration_number &&
                      !company.contact_email &&
                      !company.contact_phone &&
                      !company.registered_address && (
                        <p className="text-sm text-slate-500">
                          No private registration details have been added.
                        </p>
                      )}
                  </dl>
                </div>
              )}
              <p className="mt-5 rounded-xl bg-purple-50 px-3 py-2 text-xs leading-relaxed text-purple-900 dark:bg-purple-950/50 dark:text-purple-200">
                Buyers may see available, non-archived offerings only when this
                company is active and verified. Catalogue discovery does not
                start procurement transactions.
              </p>
            </article>

            {/* Verification Card */}
            <article className="rounded-2xl border border-indigo-200 bg-white p-5 shadow-sm dark:border-indigo-900 dark:bg-slate-900">
              <div className="flex items-center justify-between gap-3">
                <h2 className="font-semibold text-slate-900 dark:text-white">
                  Supplier verification
                </h2>
                <span className="rounded-full bg-indigo-50 px-3 py-1 text-xs font-bold text-indigo-800 dark:bg-indigo-950 dark:text-indigo-200">
                  {company.verification_status.replaceAll("_", " ")}
                </span>
              </div>
              <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
                Submit company evidence for an authorized GLESKA administrator to
                review. This status is independent of operational status.
              </p>

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
                    it. After uploading at least one required document, select{" "}
                    <strong>Submit for review</strong> to request verification.
                  </p>
                )}

              {company.verification_reason && (
                <div className="mt-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-950 dark:bg-amber-950/40 dark:text-amber-100">
                  <strong>Review feedback:</strong>{" "}
                  {company.verification_reason}
                </div>
              )}

              {company.verification_submitted_at && (
                <p className="mt-2 text-xs text-slate-500">
                  Submitted{" "}
                  {new Date(company.verification_submitted_at).toLocaleString()}
                  {company.verification_reviewed_at &&
                    ` · Reviewed ${new Date(
                      company.verification_reviewed_at,
                    ).toLocaleString()}`}
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
                    <div className="grid gap-3 sm:grid-cols-[1fr_1.5fr_auto]">
                      <select
                        value={verificationDocumentType}
                        onChange={(event) =>
                          setVerificationDocumentType(event.target.value)
                        }
                        className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950"
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
                        type="file"
                        required
                        accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"
                        onChange={(event) =>
                          setVerificationFile(
                            event.target.files?.[0] || null,
                          )
                        }
                        className="min-w-0 rounded-lg border border-slate-300 px-2 py-1.5 text-xs dark:border-slate-700"
                      />
                      <button
                        type="submit"
                        disabled={
                          verificationBusy ||
                          !verificationFile ||
                          !["NOT_SUBMITTED", "REJECTED"].includes(
                            company.verification_status,
                          )
                        }
                        className="inline-flex items-center justify-center gap-2 rounded-lg border border-indigo-300 px-3 py-2 text-sm font-semibold text-indigo-800 disabled:opacity-50 dark:border-indigo-800 dark:text-indigo-200 hover:bg-indigo-50"
                      >
                        <FileText size={15} /> Upload
                      </button>
                    </div>
                    <p className="text-xs text-slate-500">
                      PDF, JPEG, or PNG · maximum 10 MB. Files are private to
                      company managers and GLESKA reviewers.
                    </p>
                  </form>

                  <div className="mt-3 space-y-2">
                    {verificationDocuments.map((document) => (
                      <div
                        key={document.id}
                        className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-slate-50 px-3 py-2 text-sm dark:bg-slate-950"
                      >
                        <span className="text-xs sm:text-sm">
                          {document.document_type.replaceAll("_", " ")} ·{" "}
                          {document.original_filename}
                        </span>
                        <button
                          type="button"
                          onClick={() => void viewVerificationDocument(document)}
                          className="text-xs font-semibold text-indigo-700 underline dark:text-indigo-300"
                        >
                          View private file
                        </button>
                      </div>
                    ))}
                  </div>

                  {["NOT_SUBMITTED", "REJECTED"].includes(
                    company.verification_status,
                  ) && (
                    <button
                      type="button"
                      disabled={
                        verificationBusy || verificationDocuments.length === 0
                      }
                      onClick={() => void submitVerification()}
                      className="mt-4 inline-flex items-center gap-2 rounded-xl bg-indigo-700 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50 hover:bg-indigo-800"
                    >
                      <CheckCircle2 size={16} />
                      {verificationBusy ? "Submitting…" : "Submit for review"}
                    </button>
                  )}
                  {company.verification_status === "PENDING_REVIEW" && (
                    <p className="mt-4 text-sm font-medium text-indigo-800 dark:text-indigo-200">
                      Your documents are awaiting admin review.
                    </p>
                  )}
                  {company.verification_status === "SUSPENDED" && (
                    <p className="mt-4 text-sm font-medium text-red-700 dark:text-red-300">
                      Verification is suspended. Contact GLESKA support for next
                      steps.
                    </p>
                  )}
                </>
              )}
            </article>

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
                  invitation.
                </p>
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
                      onChange={(event) =>
                        setInviteRole(
                          event.target.value as "ADMIN" | "MEMBER",
                        )
                      }
                      className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950"
                    >
                      <option value="MEMBER">Member</option>
                      <option value="ADMIN">Admin</option>
                    </select>
                  )}
                  <button
                    disabled={inviting}
                    className="rounded-xl bg-purple-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-purple-800 disabled:opacity-60"
                  >
                    {inviting ? "Sending..." : "Create invitation"}
                  </button>
                </div>
              </form>
            )}
          </div>

          {/* Right Column: Company Members */}
          <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-center gap-2">
              <Users
                size={19}
                className="text-purple-600 dark:text-purple-400"
              />
              <h2 className="text-lg font-bold text-slate-900 dark:text-white">
                Company members
              </h2>
            </div>
            <p className="mt-1 text-sm text-slate-500">
              Active membership is required for company-scoped access.
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

            <div className="mt-4 divide-y divide-slate-200 dark:divide-slate-800">
              {members.map((member) => (
                <div
                  key={member.id}
                  className="flex flex-wrap items-center justify-between gap-3 py-3"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-slate-900 dark:text-white">
                      {member.name || member.invited_email || "Invited member"}
                    </p>
                    <p className="mt-0.5 text-xs text-slate-500">
                      {member.role} · {member.status}
                    </p>
                  </div>
                  {canManageMembers &&
                    member.role !== "OWNER" &&
                    member.status === "ACTIVE" && (
                      <div className="flex flex-wrap gap-2">
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
                  {canManageMembers &&
                    member.status === "PENDING" &&
                    (company.role === "OWNER" || member.role === "MEMBER") && (
                      <button
                        type="button"
                        disabled={busyMemberId === member.id}
                        onClick={() => void revokeMember(member)}
                        className="rounded-lg border border-red-200 px-2 py-1.5 text-xs font-semibold text-red-700 disabled:opacity-50 dark:border-red-900 dark:text-red-300 hover:bg-red-50"
                      >
                        Cancel invitation
                      </button>
                    )}
                </div>
              ))}
              {members.length === 0 && (
                <p className="py-6 text-sm text-slate-500">
                  No company members are available.
                </p>
              )}
            </div>
          </article>
        </section>
      )}
    </div>
  );
}
