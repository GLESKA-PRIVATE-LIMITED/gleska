import { useEffect, useEffectEvent, useState, type FormEvent } from "react";
import { ArrowLeft, Eye, EyeOff, LoaderCircle, Mail, Phone } from "lucide-react";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { missingBackendConfiguration, missingMsg91Configuration, missingSupabaseConfiguration } from "../../config/environment";
import { useAuth, errorMessage } from "./AuthProvider";
import { LanguageSelector, useLanguage } from "./LanguageContext";
import { getSupabaseClient } from "../../lib/supabase";
import { type AccountType, type AuthStateResponse } from "../../types/auth";

type SignupRole = "WORKER";
type SignupInput = {
  name: string;
  email: string;
  mobile: string;
  password: string;
  confirmPassword: string;
  role: SignupRole;
  accountType: AccountType;
};

function routeAfterAuth(state: AuthStateResponse, navigate: ReturnType<typeof useNavigate>) {
  navigate(state.user.role === "WORKER" ? "/worker/dashboard" : "/", { replace: true });
}

function MobileHeader({ signup = false }: { signup?: boolean }) {
  return <header className={`auth-header${signup ? " auth-header-signup" : ""}`}>
    <Link to="/" className="brand-lockup" aria-label="GLESKA welcome">
      <img src="/favicon.ico" alt="" width="36" height="36" />
      <span>GO LESKA AI</span>
    </Link>
    <LanguageSelector />
  </header>;
}

export function AuthLayout({ children, variant }: { children: React.ReactNode; variant?: "signup" | "selection" }) {
  return <div className={`auth-page${variant ? ` auth-${variant}-page` : ""}`}><MobileHeader signup={variant !== undefined} />{children}</div>;
}

export function WelcomeScreen() {
  return <main className="welcome-page">
    <div className="welcome-content">
      <header className="welcome-brand" aria-label="GLESKA">
        <img src="/favicon.ico" alt="" width="48" height="48" />
        <span>GO LESKA AI</span>
      </header>
      <section className="welcome-message" aria-labelledby="welcome-title">
        <h1 id="welcome-title">Kaam Milega. Turant.</h1>
        <p>INDIA'S BLUE-COLLAR PROFESSIONALS DESERVE BETTER. GO LESKA MATCHES VERIFIED WORKERS TO REAL JOBS, POWERED BY AI, BUILT FOR FACTORIES AND BUSINESSES.</p>
      </section>
      <nav className="welcome-actions" aria-label="Worker account actions">
        <Link className="welcome-primary" to="/worker/auth?mode=signup">Get Started</Link>
        <Link className="welcome-signin" to="/worker/auth">Already have an account? <strong>Sign in</strong></Link>
      </nav>
    </div>
  </main>;
}

function InlineError({ children }: { children: string }) {
  return children ? <p className="auth-error" role="alert">{children}</p> : null;
}

function AuthPasswordField({ label, value, onChange, autoComplete, inputClassName = "auth-input", strength = false, minLength, maxLength }: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete: string;
  inputClassName?: string;
  strength?: boolean;
  minLength?: number;
  maxLength?: number;
}) {
  const [visible, setVisible] = useState(false);
  const characterGroups = [/[a-z]/.test(value), /[A-Z]/.test(value), /\d/.test(value), /[^a-zA-Z\d]/.test(value)].filter(Boolean).length;
  const score = value ? Number(value.length >= 8) + Number(value.length >= 12) + Number(characterGroups >= 2) + Number(characterGroups >= 3) : 0;
  const strengthLabel = score < 2 ? "Weak" : score < 3 ? "Fair" : score < 4 ? "Good" : "Strong";

  return <label className="auth-field password-field">
    <span>{label}</span>
    <span className="password-field-control">
      <input className={inputClassName} type={visible ? "text" : "password"} autoComplete={autoComplete} value={value} onChange={(event) => onChange(event.target.value)} minLength={minLength} maxLength={maxLength} required />
      <button className="password-toggle" type="button" onClick={() => setVisible((current) => !current)} aria-label={visible ? "Hide password" : "Show password"} title={visible ? "Hide password" : "Show password"}>
        {visible ? <EyeOff size={18} /> : <Eye size={18} />}
      </button>
    </span>
    {strength && <>
      <span className="password-strength-row"><span>8+ characters; longer and varied is stronger.</span><span role="status">Strength{value ? `: ${strengthLabel}` : ""}</span></span>
      <span className="password-strength-bars" aria-hidden="true">{[1, 2, 3, 4].map((step) => <span key={step} className={score >= step ? `filled strength-${strengthLabel.toLowerCase()}` : ""} />)}</span>
    </>}
  </label>;
}

function ConfigurationNotice({ needsSupabase = true, needsMsg91 = false }: { needsSupabase?: boolean; needsMsg91?: boolean }) {
  const missing: string[] = [];
  if (missingBackendConfiguration()) missing.push("VITE_API_BASE_URL");
  if (needsSupabase && missingSupabaseConfiguration()) missing.push("VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY");
  if (needsMsg91 && missingMsg91Configuration()) missing.push("VITE_MSG91_WIDGET_ID and VITE_MSG91_TOKEN");
  if (!missing.length) return null;
  return <p className="auth-error" role="alert">Authentication is unavailable until the public mobile configuration is set: {missing.join(", ")}.</p>;
}

export function RoleAuthScreen({ role }: { role: SignupRole }) {
  const [params] = useSearchParams();
  const accountType: AccountType = "BUSINESS";
  const isDirectSignup = params.get("mode") === "signup";
  const { t } = useLanguage();
  return <AuthLayout variant={isDirectSignup ? "signup" : undefined}>
    <main className="auth-content">
      <section className="auth-card">
        <p className="auth-eyebrow">{t("signin.workerTitle")}</p>
        <h1>{isDirectSignup
          ? t("auth.employeeTitle")
          : t("nav.signIn")}</h1>
        <p className="auth-description">{isDirectSignup
          ? t("auth.employeeTitle")
          : t("auth.securityText")}</p>
        <AuthForm role={role} accountType={accountType} initialSignup={isDirectSignup} />
      </section>
    </main>
  </AuthLayout>;
}

function AuthForm({ role, accountType, initialSignup = false }: {
  role: SignupRole | undefined;
  accountType: AccountType;
  initialSignup?: boolean;
}) {
  const navigate = useNavigate();
  const { t } = useLanguage();
  const auth = useAuth();
  const [signup, setSignup] = useState(initialSignup);
  const [loginMethod, setLoginMethod] = useState<"email" | "mobile">("email");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [mobile, setMobile] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [otp, setOtp] = useState("");
  const [otpPurpose, setOtpPurpose] = useState<"signup" | "mobile-login" | null>(null);
  const [requestId, setRequestId] = useState<string | null>(null);
  const [countdown, setCountdown] = useState(0);
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState("");

  useEffect(() => {
    if (!countdown) return;
    const timer = window.setTimeout(() => setCountdown((value) => value - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [countdown]);

  useEffect(() => {
    if (auth.user && auth.nextStep) routeAfterAuth({ user: auth.user, next_step: auth.nextStep }, navigate);
  }, [auth.user, auth.nextStep, navigate]);

    const input: SignupInput = { name, email, mobile, password, confirmPassword, role: role || "WORKER", accountType };
  const visibleError = localError || auth.error;
  const validMobile = /^\d{10}$/.test(mobile.replace(/\D/g, ""));
  const needsSupabase = signup || (!signup && loginMethod === "email");
  const needsMsg91 = signup || (!signup && loginMethod === "mobile");

  const validateSignup = () => {
    if (!role) return "Choose an account type before creating an account.";
    if (name.trim().length < 2 || name.trim().length > 120) return "Enter your name (2 to 120 characters).";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return "Enter a valid email address.";
    if (!validMobile) return t("auth.enterValidMobile");
    if (password.length < 8 || password.length > 128) return "Password must be between 8 and 128 characters.";
    if (password !== confirmPassword) return "Passwords do not match.";
    if (!termsAccepted) return "Accept the Terms & Conditions to continue.";
    return "";
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setLocalError("");
    if (signup) {
      const validationError = validateSignup();
      if (validationError) {
        setLocalError(validationError);
        return;
      }
      setBusy(true);
      try {
        const result = await auth.beginSignup(input);
        setRequestId(result.requestId ?? null);
        setOtpPurpose("signup");
        setOtp("");
        setCountdown(30);
      } catch (error) {
        setLocalError(errorMessage(error));
      } finally {
        setBusy(false);
      }
      return;
    }

    if (loginMethod === "mobile") {
      if (!validMobile) {
        setLocalError(t("auth.enterValidMobile"));
        return;
      }
      setBusy(true);
      try {
        const result = await auth.sendLoginOtp(mobile);
        setRequestId(result.requestId ?? null);
        setOtpPurpose("mobile-login");
        setOtp("");
        setCountdown(30);
      } catch (error) {
        setLocalError(errorMessage(error));
      } finally {
        setBusy(false);
      }
      return;
    }

    if (!email.trim() || !password) {
      setLocalError("Enter your email address and password.");
      return;
    }
    setBusy(true);
    try {
      routeAfterAuth(await auth.signInWithEmail(email, password, role), navigate);
    } catch (error) {
      setLocalError(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const verify = async (event: FormEvent) => {
    event.preventDefault();
    if (!/^\d{6}$/.test(otp)) {
      setLocalError(t("auth.enterOtp"));
      return;
    }
    setBusy(true);
    setLocalError("");
    try {
      const state = otpPurpose === "signup"
        ? await auth.completeSignup(input, otp)
        : await auth.signInWithMobileOtp(mobile, otp);
      routeAfterAuth(state, navigate);
    } catch (error) {
      if (otpPurpose === "signup") setOtp("");
      setLocalError(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const resend = async () => {
    if (countdown || busy) return;
    setBusy(true);
    setLocalError("");
    try {
      const nextRequestId = await auth.retryOtp(mobile, requestId);
      setRequestId(nextRequestId ?? requestId);
      setOtp("");
      setCountdown(30);
    } catch (error) {
      setLocalError(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const google = async () => {
    setBusy(true);
    setLocalError("");
    try {
      await auth.startGoogleAuth(role, accountType);
    } catch (error) {
      setLocalError(errorMessage(error));
      setBusy(false);
    }
  };

  return <>
    {!initialSignup && role && <div className="auth-tabs" role="tablist" aria-label="Authentication method">
      <button type="button" role="tab" aria-selected={!signup} className={!signup ? "active" : ""} onClick={() => { setSignup(false); setOtpPurpose(null); setLocalError(""); }}>Login</button>
      <button type="button" role="tab" aria-selected={signup} className={signup ? "active" : ""} onClick={() => { setSignup(true); setOtpPurpose(null); setLocalError(""); }}>Sign up</button>
    </div>}

    {otpPurpose === "signup" ? <div className="auth-otp-backdrop" role="presentation">
      <section className="auth-otp-dialog" role="dialog" aria-modal="true" aria-labelledby="signup-otp-title">
        <div className="auth-otp-heading">
          <p className="auth-eyebrow">{t("auth.secureSignup")}</p>
          <h2 id="signup-otp-title">{t("auth.verifyPhone")}</h2>
          <p className="auth-description">{t("auth.signupCodeSent", { phone: `+91 ${mobile}` })}</p>
        </div>
        <form className="auth-form" onSubmit={(event) => void verify(event)}>
          <label className="sr-only" htmlFor="signup-otp">6-digit verification code</label>
          <input id="signup-otp" className="auth-input otp-input" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={otp} onChange={(event) => setOtp(event.target.value.replace(/\D/g, "").slice(0, 6))} placeholder="000000" autoFocus />
          <InlineError>{visibleError}</InlineError>
          <button className="auth-primary" type="submit" disabled={busy || otp.length !== 6}>{busy && <LoaderCircle size={17} className="spin" />}{busy ? t("auth.verifying") : t("auth.verifyCreate")}</button>
          <div className="auth-form-row">
            <button className="text-link" type="button" onClick={() => { setOtpPurpose(null); setRequestId(null); setOtp(""); setLocalError(""); }}>{t("auth.cancel")}</button>
            <button className="text-link" type="button" disabled={Boolean(countdown) || busy} onClick={() => void resend()}>{countdown ? t("auth.resendIn", { seconds: countdown }) : t("auth.resendOtp")}</button>
          </div>
        </form>
      </section>
    </div> : otpPurpose === "mobile-login" ? <form className="auth-form" onSubmit={(event) => void verify(event)}>
      <p className="auth-description">Enter the six-digit code sent to +{mobile.startsWith("91") ? mobile : `91${mobile}`}.</p>
      <label className="sr-only" htmlFor="auth-otp">{t("auth.verifyOtp")}</label>
      <input id="auth-otp" className="auth-input otp-input" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={otp} onChange={(event) => setOtp(event.target.value.replace(/\D/g, "").slice(0, 6))} placeholder="000000" autoFocus />
      <InlineError>{visibleError}</InlineError>
      <button className="auth-primary" type="submit" disabled={busy || otp.length !== 6}>{busy && <LoaderCircle size={17} className="spin" />}{t("auth.verifyOtp")}</button>
      <div className="auth-form-row">
        <button className="text-link" type="button" onClick={() => { setOtpPurpose(null); setRequestId(null); setOtp(""); setLocalError(""); }}>{t("auth.back")}</button>
        <button className="text-link" type="button" disabled={Boolean(countdown) || busy} onClick={() => void resend()}>{countdown ? t("auth.resendIn", { seconds: countdown }) : t("auth.resend")}</button>
      </div>
    </form> : <>
      {!signup && <div className="auth-tabs method-tabs" role="tablist" aria-label="Sign-in method">
        <button type="button" role="tab" aria-selected={loginMethod === "email"} className={loginMethod === "email" ? "active" : ""} onClick={() => setLoginMethod("email")}>{t("auth.emailPassword")}</button>
        <button type="button" role="tab" aria-selected={loginMethod === "mobile"} className={loginMethod === "mobile" ? "active" : ""} onClick={() => setLoginMethod("mobile")}>{t("auth.mobileOtp")}</button>
      </div>}
      <form className={`auth-form${signup ? " auth-signup-form" : ""}`} onSubmit={(event) => void submit(event)}>
        {signup && <input className="auth-input" aria-label={t("auth.fullNameLabel")} placeholder={t("auth.fullNameLabel")} autoComplete="name" value={name} onChange={(event) => setName(event.target.value)} required minLength={2} maxLength={120} />}
        {signup && <span className="auth-input-with-icon"><Mail size={17} /><input className="auth-input" type="email" aria-label={t("auth.emailLabel")} placeholder={t("auth.emailLabel")} autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} required /></span>}
        {!signup && loginMethod === "email" && <label className="auth-field"><span>{t("auth.emailLabel")}</span><span className="auth-input-with-icon"><Mail size={17} /><input className="auth-input" type="email" placeholder={t("auth.emailLabel")} autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} required /></span></label>}
        {!signup && loginMethod === "email" && <AuthPasswordField label={t("auth.passwordLabel")} value={password} onChange={setPassword} autoComplete="current-password" minLength={8} maxLength={128} />}
        {!signup && loginMethod === "mobile" && <label className="auth-field"><span>{t("auth.mobileLabel")}</span><span className="auth-input-with-icon"><Phone size={17} /><span className="phone-prefix">+91</span><input className="auth-input" placeholder={t("auth.mobileLabel")} inputMode="numeric" autoComplete="tel-national" value={mobile} onChange={(event) => setMobile(event.target.value.replace(/\D/g, "").slice(0, 10))} required /></span></label>}
        {signup && <AuthPasswordField label={t("auth.passwordLabel")} value={password} onChange={setPassword} autoComplete="new-password" strength minLength={8} maxLength={128} />}
        {signup && <AuthPasswordField label={t("auth.confirmPasswordLabel")} value={confirmPassword} onChange={setConfirmPassword} autoComplete="new-password" minLength={8} maxLength={128} />}
        {signup && <span className="auth-input-with-icon"><span className="phone-prefix">+91</span><input className="auth-input" aria-label={t("auth.mobileLabel")} placeholder={t("auth.mobileLabel")} inputMode="numeric" autoComplete="tel-national" value={mobile} onChange={(event) => setMobile(event.target.value.replace(/\D/g, "").slice(0, 10))} required /></span>}
        {signup && <label className="terms-check"><input type="checkbox" checked={termsAccepted} onChange={(event) => setTermsAccepted(event.target.checked)} /><span>{t("auth.termsAccepted")} <a href="https://www.goleska.in/terms" target="_blank" rel="noreferrer">Terms & Conditions</a></span></label>}
        <InlineError>{visibleError}</InlineError>
        <ConfigurationNotice needsSupabase={needsSupabase} needsMsg91={needsMsg91} />
        <button className="auth-primary" type="submit" disabled={busy || missingBackendConfiguration() || (needsSupabase && missingSupabaseConfiguration()) || (needsMsg91 && missingMsg91Configuration()) || (signup && !termsAccepted)}>
          {busy && <LoaderCircle size={17} className="spin" />}
          {signup ? t("auth.signupButton") : loginMethod === "mobile" ? t("auth.sendMobileOtpButton") : t("auth.loginButton")}
        </button>
      </form>
      {!signup && <>
        <Link className="text-link forgot-link" to="/auth/forgot-password">{t("auth.forgotPassword")}</Link>
        <div className="auth-divider"><span>Or</span></div>
        <button className="auth-secondary" type="button" disabled={busy || missingSupabaseConfiguration()} onClick={() => void google()}>
          <GoogleMark /> {t("auth.googleButton")}
        </button>
        <p className="auth-footnote">{t("auth.securityText")}</p>
      </>}
    </>}
  </>;
}

function GoogleMark() {
  return <svg width="17" height="17" viewBox="0 0 24 24" aria-hidden="true">
    <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
    <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
    <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18A11 11 0 0 0 1 12c0 1.8.43 3.45 1.18 4.94l3.66-2.85z" />
    <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84C6.71 7.3 9.14 5.38 12 5.38z" />
  </svg>;
}

export function ForgotPasswordScreen() {
  const auth = useAuth();
  const { t } = useLanguage();
  const [step, setStep] = useState<"phone" | "otp" | "password" | "success">("phone");
  const [mobile, setMobile] = useState("");
  const [otp, setOtp] = useState("");
  const [authorization, setAuthorization] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [requestId, setRequestId] = useState<string | null>(null);
  const [countdown, setCountdown] = useState(0);

  useEffect(() => {
    if (!countdown) return;
    const timer = window.setTimeout(() => setCountdown((value) => value - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [countdown]);

  const requestOtp = async (event: FormEvent) => {
    event.preventDefault();
    if (!/^\d{10}$/.test(mobile)) {
      setError(t("auth.enterValidMobile"));
      return;
    }
    setBusy(true);
    setError("");
    try {
      const result = await auth.requestPasswordResetOtp(mobile);
      setRequestId(result.requestId ?? null);
      setStep("otp");
      setCountdown(30);
    } catch (requestError) {
      const message = errorMessage(requestError);
      setError(message);
      const waitMatch = message.match(/Please wait (\d+) seconds/);
      if (waitMatch) setCountdown(Number(waitMatch[1]));
    } finally {
      setBusy(false);
    }
  };

  const verifyOtp = async (event: FormEvent) => {
    event.preventDefault();
    if (!/^\d{6}$/.test(otp)) {
      setError(t("auth.enterOtp"));
      return;
    }
    setBusy(true);
    setError("");
    try {
      setAuthorization(await auth.verifyPasswordResetOtp(mobile, otp));
      setRequestId(null);
      setOtp("");
      setStep("password");
    } catch (verifyError) {
      setError(errorMessage(verifyError));
    } finally {
      setBusy(false);
    }
  };

  const resend = async () => {
    setBusy(true);
    setError("");
    try {
      const nextRequestId = await auth.retryPasswordResetOtp(mobile, requestId);
      setRequestId(nextRequestId ?? null);
      setOtp("");
      setCountdown(30);
    } catch (retryError) {
      setError(errorMessage(retryError));
    } finally {
      setBusy(false);
    }
  };

  const reset = async (event: FormEvent) => {
    event.preventDefault();
    if (password.length < 8 || password.length > 128) {
      setError("Password must be between 8 and 128 characters.");
      return;
    }
    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await auth.resetPasswordWithAuthorization(authorization, password, confirmPassword);
      setAuthorization("");
      setRequestId(null);
      setOtp("");
      setMobile("");
      setPassword("");
      setConfirmPassword("");
      setCountdown(0);
      setStep("success");
    } catch (resetError) {
      setError(errorMessage(resetError));
      setAuthorization("");
      setStep("phone");
    } finally {
      setBusy(false);
    }
  };

  return <AuthLayout><main className="recovery-page"><section className="recovery-card">
    <Link className="recovery-back" to="/auth/signin"><ArrowLeft size={16} /> {t("auth.back")}</Link>
    <h1>{step === "success" ? t("auth.passwordUpdatedTitle") : t("auth.resetPassword")}</h1>
    {step === "success" ? <><p className="recovery-description">{t("auth.passwordResetSuccess")}</p><Link className="recovery-primary recovery-link-button" to="/auth/signin">{t("auth.continueLogin")}</Link></> : <>
      <p className="recovery-description">{step === "phone" ? t("auth.enterPhoneHelper") : step === "otp" ? t("auth.resetCodeSent", { phone: `+91 ${mobile}` }) : t("auth.newPasswordHelper")}</p>
      {step === "phone" && <form className="recovery-form" onSubmit={(event) => void requestOtp(event)}>
        <div className="recovery-phone"><span>+91</span><input aria-label={t("auth.mobileLabel")} inputMode="numeric" autoComplete="tel-national" value={mobile} onChange={(event) => setMobile(event.target.value.replace(/\D/g, "").slice(0, 10))} placeholder={t("auth.mobileLabel")} required /></div>
        <InlineError>{error}</InlineError>
        <button className="recovery-primary" type="submit" disabled={busy || Boolean(countdown) || missingBackendConfiguration() || missingMsg91Configuration()}>{busy && <LoaderCircle size={16} className="spin" />}{countdown ? t("auth.resendIn", { seconds: countdown }) : t("auth.sendOtp")}</button>
      </form>}
      {step === "otp" && <form className="recovery-form" onSubmit={(event) => void verifyOtp(event)}>
        <label className="sr-only" htmlFor="reset-otp">{t("auth.verifyOtp")}</label><input id="reset-otp" className="recovery-input recovery-otp" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={otp} onChange={(event) => setOtp(event.target.value.replace(/\D/g, "").slice(0, 6))} placeholder="000000" />
        <InlineError>{error}</InlineError>
        <button className="recovery-primary" type="submit" disabled={busy || otp.length !== 6}>{busy && <LoaderCircle size={16} className="spin" />}{t("auth.verifyOtp")}</button>
        <div className="recovery-actions"><button type="button" onClick={() => { setStep("phone"); setOtp(""); setError(""); }}>{t("auth.changePhone")}</button><button type="button" disabled={busy || Boolean(countdown)} onClick={() => void resend()}>{countdown ? t("auth.resendIn", { seconds: countdown }) : t("auth.resendOtp")}</button></div>
      </form>}
      {step === "password" && <form className="recovery-form" onSubmit={(event) => void reset(event)}>
        <AuthPasswordField label={t("auth.newPassword")} value={password} onChange={setPassword} autoComplete="new-password" inputClassName="recovery-input" strength minLength={8} maxLength={128} />
        <AuthPasswordField label={t("auth.confirmPasswordLabel")} value={confirmPassword} onChange={setConfirmPassword} autoComplete="new-password" inputClassName="recovery-input" minLength={8} maxLength={128} />
        <InlineError>{error}</InlineError>
        <button className="recovery-primary" type="submit" disabled={busy || password.length < 8 || password !== confirmPassword}>{busy && <LoaderCircle size={16} className="spin" />}{t("auth.resetPassword")}</button>
      </form>}
    </>}
  </section></main></AuthLayout>;
}

export function ResetPasswordScreen() {
  const auth = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const { t } = useLanguage();
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  useEffect(() => {
    let active = true;
    const restoreRecovery = async () => {
      try {
        const fragment = new URLSearchParams(window.location.hash.replace(/^#/, ""));
        const accessToken = fragment.get("access_token");
        const refreshToken = fragment.get("refresh_token");
        if (fragment.get("type") === "recovery" && accessToken && refreshToken) {
          const { error: sessionError } = await getSupabaseClient().auth.setSession({ access_token: accessToken, refresh_token: refreshToken });
          if (sessionError) throw sessionError;
          if (active) setReady(true);
          return;
        }
        const code = new URLSearchParams(location.search).get("code");
        if (code) {
          const { error: exchangeError } = await getSupabaseClient().auth.exchangeCodeForSession(code);
          if (exchangeError) throw exchangeError;
          if (active) setReady(true);
        }
      } catch (restoreError) {
        if (active) setError(errorMessage(restoreError));
      }
    };
    void restoreRecovery();
    return () => { active = false; };
  }, [location.search]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (password.length < 8 || password !== confirmPassword) {
      setError(password.length < 8 ? "Password must be at least 8 characters." : "Passwords do not match.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await auth.resetPasswordWithRecoverySession(password);
      navigate("/auth/signin", { replace: true });
    } catch (updateError) {
      setError(errorMessage(updateError));
    } finally {
      setBusy(false);
    }
  };

  return <AuthLayout><main className="auth-content"><section className="auth-card">
    <p className="auth-eyebrow">GLESKA</p><h1>{t("auth.resetPassword")}</h1>
    {ready ? <form className="auth-form" onSubmit={(event) => void submit(event)}>
      <AuthPasswordField label={t("auth.newPassword")} value={password} onChange={setPassword} autoComplete="new-password" strength minLength={8} />
      <AuthPasswordField label={t("auth.confirmPasswordLabel")} value={confirmPassword} onChange={setConfirmPassword} autoComplete="new-password" minLength={8} />
      <InlineError>{error}</InlineError>
      <button className="auth-primary" type="submit" disabled={busy || password.length < 8 || password !== confirmPassword}>{busy && <LoaderCircle size={17} className="spin" />}{t("auth.resetPassword")}</button>
    </form> : <><InlineError>{error || "Open the password recovery link from your GLESKA email to continue."}</InlineError><Link className="text-link auth-back-link" to="/auth/signin">{t("auth.back")}</Link></>}
  </section></main></AuthLayout>;
}

export function OAuthCallbackScreen() {
  const auth = useAuth();
  const navigate = useNavigate();
  const { t } = useLanguage();
  const [error, setError] = useState("");
  const completeCallback = useEffectEvent(async () => {
    const state = await auth.completeOAuthCallback();
    routeAfterAuth(state, navigate);
  });
  const showCallbackError = useEffectEvent((callbackError: unknown) => {
    setError(errorMessage(callbackError));
    void auth.logout();
  });

  useEffect(() => {
    let active = true;
    void completeCallback().catch((callbackError) => { if (active) showCallbackError(callbackError); });
    return () => { active = false; };
  }, []);

  return <AuthLayout><main className="auth-content"><section className="auth-card auth-status-card">
    {error ? <><InlineError>{error}</InlineError><Link className="auth-primary auth-link-button" to="/auth/signin">{t("nav.signIn")}</Link></> : <><LoaderCircle className="spin auth-status-icon" size={28} /><p role="status">Completing Google sign-in...</p></>}
  </section></main></AuthLayout>;
}

export function LoadingScreen() {
  const { t } = useLanguage();
  return <main className="auth-loading"><LoaderCircle size={28} className="spin" /><p>{t("auth.loading")}</p></main>;
}
