import { useState, type FormEvent } from "react";
import {
  AlertCircle,
  ArrowRight,
  BriefcaseBusiness,
  CheckCircle2,
  CircleHelp,
  CreditCard,
  FileCheck2,
  LoaderCircle,
  Mail,
  MessageCircle,
  Phone,
  UserRound,
} from "lucide-react";
import { Navigate } from "react-router-dom";
import { ApiError, apiPost } from "../../lib/api";
import { useAuth } from "../auth/AuthProvider";
import EmployerMobileShell from "./EmployerMobileShell";
import "./EmployerHelpScreen.css";

const sections = [
  {
    title: "Getting Started",
    icon: CircleHelp,
    items: [
      "How do I post a job?",
      "How do I add a work site?",
      "How do I find workers?",
      "How does worker matching work?",
      "How do I hire a worker?",
    ],
  },
  {
    title: "Jobs & Workers",
    icon: BriefcaseBusiness,
    items: [
      "Post and manage jobs from the dashboard.",
      "View workers matched to an open job.",
      "Select a matched worker when a job is open for hiring.",
      "Review the current status of each job.",
      "Use worker availability and profile details when choosing a worker.",
    ],
  },
  {
    title: "Attendance",
    icon: CheckCircle2,
    items: [
      "Review attendance records for workers hired through GO LESKA.",
      "Use the attendance workflow for check-in and check-out records.",
      "Filter attendance history by date, worker, job, site, or status.",
      "Correct an attendance record with a reason when the workflow allows it.",
    ],
  },
  {
    title: "Profile & Verification",
    icon: FileCheck2,
    items: [
      "Open Profile from the account menu to review your employer information.",
      "Registered employers can review company and director information where applicable.",
      "Unregistered businesses can review business and proprietor information where applicable.",
      "Individuals can review their Individual Profile.",
      "Keep persisted profile information current when updates are supported.",
    ],
  },
  {
    title: "Subscription & Payments",
    icon: CreditCard,
    items: [
      "Open Subscription to review the current subscription state.",
      "Use the existing payment flow when a subscription is needed or renewed.",
      "Review the payment result after returning from checkout.",
      "Contact support if a payment or subscription state needs attention.",
    ],
  },
];

type ContactResponse = { success: boolean; message: string; inquiry_id?: string | null };

function contactError(error: unknown) {
  if (error instanceof ApiError) {
    if (error.status === 400) return "We couldn't process your inquiry. Please review the fields and try again.";
    if (error.status === 422) return "Enter a name, valid email, and message with at least 10 characters.";
    if (error.status === 429) return "Too many requests. Please wait a little before trying again.";
    if (error.status >= 500) return "Support is temporarily unavailable. Please try again.";
  }
  return error instanceof Error ? error.message : "Unable to send your message. Please try again.";
}

export default function EmployerHelpScreen() {
  const { user, isLoading, nextStep } = useAuth();
  const [contactOpen, setContactOpen] = useState(false);
  const [name, setName] = useState(user?.name || "");
  const [company, setCompany] = useState("");
  const [email, setEmail] = useState(user?.email || "");
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [formError, setFormError] = useState("");

  if (isLoading) return null;
  if (!user) return <Navigate to="/auth/signin?role=EMPLOYER" replace />;
  if (user.role !== "EMPLOYER") return <Navigate to={user.role === "WORKER" ? "/worker/dashboard" : "/"} replace />;
  if (nextStep !== "DASHBOARD") return <Navigate to="/employer/onboarding" replace />;

  const submitInquiry = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmedName = name.trim();
    const trimmedEmail = email.trim();
    const trimmedMessage = message.trim();
    const trimmedCompany = company.trim();
    if (
      trimmedName.length < 2
      || trimmedName.length > 120
      || !trimmedEmail
      || trimmedMessage.length < 10
      || trimmedMessage.length > 2000
      || trimmedCompany.length > 255
    ) {
      setFormError("Enter a name (2–120 characters), valid email, and message (10–2,000 characters). Company is optional and must be 255 characters or fewer.");
      return;
    }

    setSubmitting(true);
    setFormError("");
    try {
      const response = await apiPost<ContactResponse>("/api/v1/contact", {
        name: trimmedName,
        company: trimmedCompany || null,
        email: trimmedEmail,
        message: trimmedMessage,
      });
      if (!response.success) throw new Error("We couldn't confirm that your inquiry was received. Please try again.");
      setSubmitted(true);
    } catch (error: unknown) {
      setFormError(contactError(error));
    } finally {
      setSubmitting(false);
    }
  };

  const sendAnother = () => {
    setSubmitted(false);
    setCompany("");
    setMessage("");
    setFormError("");
  };

  return (
    <EmployerMobileShell name={user.name} employerType={user.employer_type} profilePhotoUrl={user.profile_photo_url}>
      <main className="employer-dashboard employer-help-page">
        <header className="employer-help-header">
          <p className="employer-eyebrow">Employer workspace</p>
          <h1>Help &amp; Support</h1>
          <p>Find answers and get help with your employer account.</p>
        </header>

        <div className="employer-help-sections">
          {sections.map(({ title, icon: Icon, items }) => (
            <section className="employer-section-card employer-help-topic" key={title}>
              <div className="employer-help-topic-heading">
                <span><Icon size={21} aria-hidden="true" /></span>
                <h2>{title}</h2>
              </div>
              <ul>
                {items.map((item) => <li key={item}>{item}</li>)}
              </ul>
            </section>
          ))}
        </div>

        <section className="employer-help-contact">
          <div className="employer-help-contact-heading">
            <MessageCircle size={23} aria-hidden="true" />
            <div>
              <h2>Contact Support</h2>
              <p>Need more help? Send a message through the support form.</p>
            </div>
          </div>
          <div className="employer-help-contact-links">
            <a href="tel:+917372888875"><Phone size={17} aria-hidden="true" /><span>+91 7372888875</span></a>
            <a href="mailto:office@goleska.in"><Mail size={17} aria-hidden="true" /><span>office@goleska.in</span></a>
          </div>
          <button
            className="employer-primary-button employer-help-contact-trigger"
            type="button"
            aria-expanded={contactOpen}
            aria-controls="employer-help-contact-form"
            onClick={() => {
              setContactOpen((open) => !open);
              setFormError("");
            }}
          >
            {contactOpen ? "Close contact form" : "Contact support"}<ArrowRight size={17} aria-hidden="true" />
          </button>

          {contactOpen && (
            <div className="employer-help-contact-panel" id="employer-help-contact-form">
              {submitted ? (
                <div className="employer-help-success" role="status">
                  <CheckCircle2 size={22} aria-hidden="true" />
                  <div>
                    <h3>Message received</h3>
                    <p>Your inquiry has been received. We will respond within 4 hours.</p>
                    <button className="employer-help-text-button" type="button" onClick={sendAnother}>Send another message</button>
                  </div>
                </div>
              ) : (
                <form className="employer-help-form" onSubmit={(event) => void submitInquiry(event)}>
                  {formError && <p className="employer-help-error" role="alert"><AlertCircle size={17} aria-hidden="true" />{formError}</p>}
                  <label>
                    <span><UserRound size={15} aria-hidden="true" />Name</span>
                    <input value={name} onChange={(event) => setName(event.target.value)} minLength={2} maxLength={120} autoComplete="name" required />
                  </label>
                  <label>
                    <span>Company <small>(optional)</small></span>
                    <input value={company} onChange={(event) => setCompany(event.target.value)} maxLength={255} autoComplete="organization" />
                  </label>
                  <label>
                    <span>Email</span>
                    <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" required />
                  </label>
                  <label>
                    <span>Message</span>
                    <textarea value={message} onChange={(event) => setMessage(event.target.value)} minLength={10} maxLength={2000} rows={4} required />
                  </label>
                  <button className="employer-primary-button" type="submit" disabled={submitting}>
                    {submitting ? <><LoaderCircle size={17} className="spin" />Sending...</> : <>Send message<ArrowRight size={17} /></>}
                  </button>
                </form>
              )}
            </div>
          )}
        </section>
      </main>
    </EmployerMobileShell>
  );
}
