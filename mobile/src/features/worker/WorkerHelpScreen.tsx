import { useState, type FormEvent } from "react";
import { AlertCircle, ArrowRight, BriefcaseBusiness, CheckCircle2, ChevronDown, CircleHelp, LoaderCircle, Mail, MapPin, Phone, ShieldCheck, WalletCards } from "lucide-react";
import { useAuth } from "../auth/AuthProvider";
import { ApiError, apiPost } from "../../lib/api";
import WorkerMobileShell from "./WorkerMobileShell";
import "./WorkerHelpScreen.css";

const topics = [
  { title: "Jobs", text: "Keep your profile, trade, availability, and location current so matching can find suitable work.", icon: BriefcaseBusiness },
  { title: "Attendance", text: "Check in and out from the accepted work site. GPS freshness, accuracy, and the site geofence are verified by the server.", icon: ShieldCheck },
  { title: "Location", text: "Allow browser location access and use a device with a clear GPS signal when attendance requires a fresh position.", icon: MapPin },
  { title: "Subscription", text: "Review your current worker plan and payment status in Subscription.", icon: WalletCards },
];

const faqs = [
  { question: "How quickly can I hire workers through GO LESKA?", answer: "Our AI dispatch engine matches your requirements with verified workers within 60 seconds. Once accepted, workers can be on-site within hours depending on proximity." },
  { question: "What kind of workers are available on the platform?", answer: "We cover 50+ blue-collar trade categories — welders, fitters, CNC operators, electricians, plumbers, security guards, housekeeping staff, and many more." },
  { question: "Is there a minimum hiring commitment?", answer: "No minimum commitment. You can hire for a single day or long-term contracts. Pay-as-you-go with transparent daily rates and zero hidden fees." },
  { question: "How are workers verified?", answer: "Every worker on GO LESKA undergoes Aadhaar-based identity verification, skill assessment, and background checks before they appear on the platform." },
  { question: "Which cities are you currently operational in?", answer: "We're live across major industrial hubs in Maharashtra, Tamil Nadu, Karnataka, and Gujarat. Expanding rapidly — contact us if your city isn't listed yet!" },
];

type ContactResponse = { success: boolean; message: string; inquiry_id?: string | null };

function contactError(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 400) return "We couldn't process your inquiry. Please review the fields and try again.";
    if (error.status === 422) return "Enter a name, valid email, and message with at least 10 characters.";
    if (error.status === 429) return "Too many requests. Please wait a little before trying again.";
    if (error.status >= 500) return "Support is temporarily unavailable. Please try again.";
  }
  return error instanceof Error ? error.message : "Unable to send your message. Please try again.";
}

export default function WorkerHelpScreen() {
  const { user } = useAuth();
  const [contactOpen, setContactOpen] = useState(false);
  const [name, setName] = useState(user?.name || "");
  const [company, setCompany] = useState("");
  const [email, setEmail] = useState(user?.email || "");
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [formError, setFormError] = useState("");
  const [openFaq, setOpenFaq] = useState<number | null>(null);

  const submitInquiry = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmedName = name.trim();
    const trimmedEmail = email.trim();
    const trimmedMessage = message.trim();
    if (trimmedName.length < 2 || trimmedName.length > 120 || !trimmedEmail || trimmedMessage.length < 10 || trimmedMessage.length > 2000 || company.trim().length > 255) {
      setFormError("Enter a name (2–120 characters), valid email, and message (10–2,000 characters). Company is optional and must be 255 characters or fewer.");
      return;
    }

    setSubmitting(true);
    setFormError("");
    try {
      const response = await apiPost<ContactResponse>("/api/v1/contact", {
        name: trimmedName,
        company: company.trim() || null,
        email: trimmedEmail,
        message: trimmedMessage,
      });
      if (!response.success) throw new Error("We couldn't confirm that your inquiry was received. Please try again.");
      setSubmitted(true);
    } catch (error) {
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
    <WorkerMobileShell>
      <main className="worker-dashboard worker-help-page">
        <header className="worker-dashboard-header worker-help-header">
          <div>
            <p className="worker-page-eyebrow">Support</p>
            <h1>Help</h1>
            <p>Quick answers for common Worker tasks.</p>
          </div>
        </header>

        <section className="worker-help-topics" aria-label="Worker help topics">
          {topics.map(({ title, text, icon: Icon }) => (
            <article className="worker-card worker-help-topic" key={title}>
              <Icon size={22} aria-hidden="true" />
              <h2>{title}</h2>
              <p>{text}</p>
            </article>
          ))}
        </section>

        <section className="worker-card worker-help-support">
          <div className="worker-help-support-heading">
            <CircleHelp size={22} aria-hidden="true" />
            <div>
              <h2>Need more help?</h2>
              <p>Contact support through the existing support form.</p>
            </div>
          </div>
          <div className="worker-help-contact-links">
            <a href="tel:+917372888875"><Phone size={17} aria-hidden="true" /><span>+91 7372888875</span></a>
            <a href="mailto:office@goleska.in"><Mail size={17} aria-hidden="true" /><span>office@goleska.in</span></a>
            <a href="https://www.google.com/maps/dir/?api=1&destination=28.5376510%2C77.2132260" target="_blank" rel="noreferrer"><MapPin size={17} aria-hidden="true" /><span>Malviya Nagar, South Delhi</span></a>
          </div>
          <button className="worker-primary-button worker-help-contact-trigger" type="button" aria-expanded={contactOpen} aria-controls="worker-help-contact-form" onClick={() => { setContactOpen((open) => !open); setFormError(""); }}>
            {contactOpen ? "Close contact form" : "Contact support"}<ArrowRight size={17} aria-hidden="true" />
          </button>

          {contactOpen && <div className="worker-help-contact-panel" id="worker-help-contact-form">
            {submitted ? (
              <div className="worker-help-success" role="status">
                <CheckCircle2 size={22} aria-hidden="true" />
                <div><h3>Message received</h3><p>Your inquiry has been received. We will respond within 4 hours.</p><button className="worker-help-text-button" type="button" onClick={sendAnother}>Send another message</button></div>
              </div>
            ) : <form className="worker-help-form" onSubmit={(event) => void submitInquiry(event)}>
              {formError && <p className="worker-help-error" role="alert"><AlertCircle size={17} aria-hidden="true" />{formError}</p>}
              <label><span>Name</span><input value={name} onChange={(event) => setName(event.target.value)} minLength={2} maxLength={120} autoComplete="name" required /></label>
              <label><span>Company <small>(optional)</small></span><input value={company} onChange={(event) => setCompany(event.target.value)} maxLength={255} autoComplete="organization" /></label>
              <label><span>Email</span><input type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" required /></label>
              <label><span>Message</span><textarea value={message} onChange={(event) => setMessage(event.target.value)} minLength={10} maxLength={2000} rows={4} required /></label>
              <button className="worker-primary-button" type="submit" disabled={submitting}>
                {submitting ? <><LoaderCircle size={17} className="spin" />Sending...</> : <>Send message<ArrowRight size={17} /></>}
              </button>
            </form>}

            <section className="worker-help-faqs" aria-labelledby="worker-help-faq-heading">
              <h3 id="worker-help-faq-heading">Frequently asked questions</h3>
              {faqs.map(({ question, answer }, index) => {
                const expanded = openFaq === index;
                const answerId = `worker-help-faq-${index}`;
                return <article className="worker-help-faq" key={question}>
                  <button type="button" aria-expanded={expanded} aria-controls={answerId} onClick={() => setOpenFaq(expanded ? null : index)}>
                    <span>{question}</span><ChevronDown size={18} aria-hidden="true" />
                  </button>
                  {expanded && <p id={answerId}>{answer}</p>}
                </article>;
              })}
            </section>
          </div>}
        </section>
      </main>
    </WorkerMobileShell>
  );
}