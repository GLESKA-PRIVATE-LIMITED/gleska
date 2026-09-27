import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { Check, ChevronDown, Globe } from "lucide-react";
import { apiGet, apiPut } from "../../lib/api";
import { useAuth } from "./AuthProvider";

export type LanguageCode = "EN" | "HI" | "MR" | "TA";

const languages: { code: LanguageCode; locale: string; label: string }[] = [
  { code: "EN", locale: "en", label: "English" },
  { code: "HI", locale: "hi", label: "हिन्दी" },
  { code: "MR", locale: "mr", label: "मराठी" },
  { code: "TA", locale: "ta", label: "தமிழ்" },
];

const translations: Record<LanguageCode, Record<string, string>> = {
  EN: {
    "nav.signIn": "Sign in",
    "nav.signup": "Create account",
    "signin.selectRole": "Select Your Role",
    "signin.roleDescription": "Choose an option below to access your account or start registration.",
    "signin.businessSignupTitle": "CREATE BUSINESS ACCOUNT",
    "signin.businessSignupDescription": "Manage and Automate Your Company",
    "signin.individualSignupTitle": "CREATE INDIVIDUAL ACCOUNT",
    "signin.individualSignupDescription": "Manage and Automate Your Work",
    "signin.workerSignupTitle": "JOIN AS WORKING PARTNER",
    "signin.workerSignupDescription": "Find Work Opportunities",
    "signin.workerTitle": "Worker",
    "signin.businessEmployerTitle": "Business Employer",
    "signin.individualEmployerTitle": "Individual Employer",
    "auth.securityText": "Secure sign-in with your email or Google",
    "auth.emailLabel": "Email address",
    "auth.passwordLabel": "Password (8+ characters)",
    "auth.confirmPasswordLabel": "Confirm password",
    "auth.mobileLabel": "Phone number",
    "auth.fullNameLabel": "Full name",
    "auth.mobileOtp": "Mobile OTP",
    "auth.emailPassword": "Email & password",
    "auth.loginButton": "Login with email",
    "auth.signupButton": "Verify phone & create account",
    "auth.sendMobileOtpButton": "Send mobile OTP",
    "auth.forgotPassword": "Forgot password?",
    "auth.googleButton": "Sign in with Google",
    "auth.termsAccepted": "I have read and agree to the Terms & Conditions",
    "auth.enterValidMobile": "Enter a valid Indian mobile number.",
    "auth.enterOtp": "Enter the six-digit verification code.",
    "auth.otpSent": "Verification code sent.",
    "auth.continue": "Continue",
    "auth.verifyOtp": "Verify code",
    "auth.resend": "Resend code",
    "auth.resendIn": "Resend in {seconds}s",
    "auth.back": "Back",
    "auth.loading": "Restoring your GLESKA session...",
    "auth.resetPassword": "Reset password",
    "auth.newPassword": "New password",
    "auth.passwordUpdated": "Password updated. Sign in with your new password.",
    "auth.passwordUpdatedTitle": "Password updated",
    "auth.passwordResetSuccess": "Password reset successfully. Please log in with your new password.",
    "auth.continueLogin": "Continue to login",
    "auth.enterPhoneHelper": "Enter the mobile number associated with your account.",
    "auth.resetCodeSent": "Enter the six-digit code sent to {phone}.",
    "auth.sendOtp": "Send OTP",
    "auth.resendOtp": "Resend OTP",
    "auth.changePhone": "Change phone",
    "auth.newPasswordHelper": "Create a new password for your account.",
    "auth.secureSignup": "Secure signup",
    "auth.verifyPhone": "Verify your phone",
    "auth.signupCodeSent": "Enter the 6-digit code sent to {phone}.",
    "auth.verifyCreate": "Verify & create account",
    "auth.verifying": "Verifying...",
    "auth.cancel": "Cancel",
    "auth.employeeTitle": "Get Your Work Done.",
    "auth.businessSignupHeading": "Create Business Account",
    "auth.individualSignupHeading": "Create Individual Account",
    "auth.businessSubtitle": "Make company's brain.",
    "auth.individualSubtitle": "Hire workers as an individual employer.",
    "auth.accountReady": "Your GLESKA account is ready.",
    "auth.workerProfile": "Complete your Worker profile to continue.",
    "auth.logout": "Log out",
  },
  HI: {
    "nav.signIn": "साइन इन",
    "nav.signup": "खाता बनाएं",
    "signin.selectRole": "अपना रोल चुनें",
    "signin.roleDescription": "अपने खाते तक पहुंचने या रजिस्ट्रेशन शुरू करने के लिए नीचे विकल्प चुनें।",
    "signin.businessSignupTitle": "बिजनेस अकाउंट बनाएं",
    "signin.businessSignupDescription": "अपनी कंपनी को प्रबंधित और स्वचालित करें",
    "signin.individualSignupTitle": "व्यक्तिगत अकाउंट बनाएं",
    "signin.individualSignupDescription": "अपने काम को प्रबंधित और स्वचालित करें",
    "signin.workerSignupTitle": "कार्य भागीदार के रूप में जुड़ें",
    "signin.workerSignupDescription": "काम के अवसर खोजें",
    "signin.workerTitle": "वर्कर",
    "signin.businessEmployerTitle": "बिजनेस नियोक्ता",
    "signin.individualEmployerTitle": "व्यक्तिगत नियोक्ता",
    "auth.securityText": "अपने ईमेल या Google से सुरक्षित साइन-इन",
    "auth.emailLabel": "ईमेल पता",
    "auth.passwordLabel": "पासवर्ड (8+ अक्षर)",
    "auth.confirmPasswordLabel": "पासवर्ड की पुष्टि करें",
    "auth.mobileLabel": "फोन नंबर",
    "auth.fullNameLabel": "पूरा नाम",
    "auth.mobileOtp": "मोबाइल OTP",
    "auth.emailPassword": "ईमेल और पासवर्ड",
    "auth.loginButton": "ईमेल से लॉगिन",
    "auth.signupButton": "फोन सत्यापित करें और अकाउंट बनाएं",
    "auth.sendMobileOtpButton": "मोबाइल OTP भेजें",
    "auth.forgotPassword": "पासवर्ड भूल गए?",
    "auth.googleButton": "Google से साइन इन करें",
    "auth.termsAccepted": "मैंने नियमों और शर्तों को पढ़ लिया है और उनसे सहमत हूं",
    "auth.enterValidMobile": "मान्य भारतीय मोबाइल नंबर दर्ज करें।",
    "auth.enterOtp": "6-अंकीय सत्यापन कोड दर्ज करें।",
    "auth.otpSent": "सत्यापन कोड भेजा गया।",
    "auth.continue": "जारी रखें",
    "auth.verifyOtp": "कोड सत्यापित करें",
    "auth.resend": "कोड फिर भेजें",
    "auth.resendIn": "{seconds} सेकंड में फिर भेजें",
    "auth.back": "वापस",
    "auth.loading": "आपका GLESKA सेशन बहाल हो रहा है...",
    "auth.resetPassword": "पासवर्ड रीसेट करें",
    "auth.newPassword": "नया पासवर्ड",
    "auth.passwordUpdated": "पासवर्ड अपडेट हुआ। नए पासवर्ड से साइन इन करें।",
    "auth.passwordUpdatedTitle": "पासवर्ड अपडेट हुआ",
    "auth.passwordResetSuccess": "पासवर्ड सफलतापूर्वक रीसेट हो गया। कृपया अपने नए पासवर्ड से लॉग इन करें।",
    "auth.continueLogin": "लॉगिन जारी रखें",
    "auth.enterPhoneHelper": "अपने खाते से जुड़ा मोबाइल नंबर दर्ज करें।",
    "auth.resetCodeSent": "{phone} पर भेजा गया छह अंकों का कोड दर्ज करें।",
    "auth.sendOtp": "OTP भेजें",
    "auth.resendOtp": "OTP दोबारा भेजें",
    "auth.changePhone": "फ़ोन बदलें",
    "auth.newPasswordHelper": "अपने अकाउंट के लिए नया पासवर्ड बनाएं।",
    "auth.secureSignup": "सुरक्षित साइनअप",
    "auth.verifyPhone": "अपने फोन को सत्यापित करें",
    "auth.signupCodeSent": "आपके फोन पर भेजा गया 6-अंकीय कोड दर्ज करें: {phone}",
    "auth.verifyCreate": "सत्यापित करें और अकाउंट बनाएं",
    "auth.verifying": "सत्यापित किया जा रहा है...",
    "auth.cancel": "रद्द करें",
    "auth.employeeTitle": "अपना काम पूरा करें।",
    "auth.businessSignupHeading": "बिजनेस अकाउंट बनाएं",
    "auth.individualSignupHeading": "व्यक्तिगत अकाउंट बनाएं",
    "auth.businessSubtitle": "कंपनी का ब्रेन बनाएं।",
    "auth.individualSubtitle": "व्यक्तिगत नियोक्ता के रूप में श्रमिकों को नियुक्त करें।",
    "auth.accountReady": "आपका GLESKA खाता तैयार है।",
    "auth.workerProfile": "जारी रखने के लिए Worker प्रोफ़ाइल पूरी करें।",
    "auth.logout": "लॉग आउट",
  },
  MR: {
    "nav.signIn": "साइन इन",
    "nav.signup": "खाते तयार करा",
    "signin.selectRole": "आपला रोल निवडा",
    "signin.roleDescription": "खाते वापरण्यासाठी किंवा नोंदणी सुरू करण्यासाठी खालील पर्याय निवडा.",
    "signin.businessSignupTitle": "बिझनेस अकाउंट तयार करा",
    "signin.businessSignupDescription": "आपली कंपनी व्यवस्थापित आणि स्वयंचलित करा",
    "signin.individualSignupTitle": "वैयक्तिक अकाउंट तयार करा",
    "signin.individualSignupDescription": "आपले काम व्यवस्थापित आणि स्वयंचलित करा",
    "signin.workerSignupTitle": "कार्य भागीदार म्हणून सामील व्हा",
    "signin.workerSignupDescription": "कामाच्या संधी शोधा",
    "signin.workerTitle": "कामगार",
    "signin.businessEmployerTitle": "बिझनेस नियोक्ता",
    "signin.individualEmployerTitle": "वैयक्तिक नियोक्ता",
    "auth.securityText": "तुमच्या ईमेल किंवा Google वापरुन सुरक्षित साइन-इन",
    "auth.emailLabel": "ईमेल पत्ता",
    "auth.passwordLabel": "पासवर्ड (8+ अक्षरे)",
    "auth.confirmPasswordLabel": "पासवर्ड पुन्हा प्रविष्ट करा",
    "auth.mobileLabel": "फोन नंबर",
    "auth.fullNameLabel": "पूर्ण नाव",
    "auth.mobileOtp": "मोबाइल OTP",
    "auth.emailPassword": "ईमेल आणि पासवर्ड",
    "auth.loginButton": "ईमेलने लॉगिन",
    "auth.signupButton": "फोन पडताळा आणि अकाउंट तयार करा",
    "auth.sendMobileOtpButton": "मोबाइल OTP पाठवा",
    "auth.forgotPassword": "पासवर्ड विसरलात?",
    "auth.googleButton": "Google ने साइन इन करा",
    "auth.termsAccepted": "मी अटी आणि नियम वाचले आणि त्यांची मान्यता दिली आहे",
    "auth.enterValidMobile": "वैध भारतीय मोबाइल नंबर प्रविष्ट करा.",
    "auth.enterOtp": "6-अंकी सत्यापन कोड प्रविष्ट करा.",
    "auth.otpSent": "सत्यापन कोड पाठवला.",
    "auth.continue": "पुढे जा",
    "auth.verifyOtp": "कोड सत्यापित करा",
    "auth.resend": "कोड पुन्हा पाठवा",
    "auth.resendIn": "{seconds} सेकंदांत पुन्हा पाठवा",
    "auth.back": "मागे",
    "auth.loading": "तुमचे GLESKA सत्र पुनर्संचयित होत आहे...",
    "auth.resetPassword": "पासवर्ड रीसेट करा",
    "auth.newPassword": "नवीन पासवर्ड",
    "auth.passwordUpdated": "पासवर्ड अपडेट झाला. नवीन पासवर्डने साइन इन करा.",
    "auth.passwordUpdatedTitle": "पासवर्ड अपडेट झाला",
    "auth.passwordResetSuccess": "पासवर्ड यशस्वीरित्या रीसेट झाला. कृपया तुमच्या नवीन पासवर्डने लॉग इन करा.",
    "auth.continueLogin": "लॉगिन सुरू ठेवा",
    "auth.enterPhoneHelper": "तुमच्या खात्याशी संबंधित मोबाइल नंबर प्रविष्ट करा.",
    "auth.resetCodeSent": "{phone} वर पाठवलेला सहा अंकी कोड प्रविष्ट करा.",
    "auth.sendOtp": "OTP पाठवा",
    "auth.resendOtp": "OTP पुन्हा पाठवा",
    "auth.changePhone": "फोन बदलवा",
    "auth.newPasswordHelper": "तुमच्या अकाउंटसाठी नवीन पासवर्ड तयार करा.",
    "auth.secureSignup": "सुरक्षित साइनअप",
    "auth.verifyPhone": "तुमचा फोन पडताळा",
    "auth.signupCodeSent": "तुमच्या फोनवर पाठवलेला 6-अंकीय कोड प्रविष्ट करा: {phone}",
    "auth.verifyCreate": "पडताळा आणि अकाउंट तयार करा",
    "auth.verifying": "पडताळणी चालू आहे...",
    "auth.cancel": "रद्द करा",
    "auth.employeeTitle": "तुमचे काम पूर्ण करा.",
    "auth.businessSignupHeading": "बिझनेस अकाउंट तयार करा",
    "auth.individualSignupHeading": "वैयक्तिक अकाउंट तयार करा",
    "auth.businessSubtitle": "कंपनीचे ब्रेन बनवा.",
    "auth.individualSubtitle": "वैयक्तिक नियोक्ता म्हणून कामगार नियुक्त करा.",
    "auth.accountReady": "तुमचे GLESKA खाते तयार आहे.",
    "auth.workerProfile": "पुढे जाण्यासाठी Worker प्रोफाइल पूर्ण करा.",
    "auth.logout": "लॉग आउट",
  },
  TA: {
    "nav.signIn": "உள்நுழைக",
    "nav.signup": "கணக்கை உருவாக்கு",
    "signin.selectRole": "உங்கள் பாத்திரத்தை தேர்ந்தெடுக்கவும்",
    "signin.roleDescription": "உங்கள் கணக்கை அணுக அல்லது பதிவு தொடங்க கீழே உள்ள விருப்பத்தை தேர்ந்தெடுக்கவும்.",
    "signin.businessSignupTitle": "வணிகக் கணக்கை உருவாக்கவும்",
    "signin.businessSignupDescription": "உங்கள் நிறுவனத்தை நிர்வகித்து தானியங்குபடுத்துங்கள்",
    "signin.individualSignupTitle": "தனிநபர் கணக்கை உருவாக்கவும்",
    "signin.individualSignupDescription": "உங்கள் வேலையை நிர்வகித்து தானியங்குபடுத்துங்கள்",
    "signin.workerSignupTitle": "வேலை கூட்டாளராக இணையுங்கள்",
    "signin.workerSignupDescription": "வேலை வாய்ப்புகளைக் கண்டறியவும்",
    "signin.workerTitle": "தொழிலாளர்",
    "signin.businessEmployerTitle": "வணிக முதலாளி",
    "signin.individualEmployerTitle": "தனிநபர் முதலாளி",
    "auth.securityText": "உங்கள் மின்னஞ்சல் அல்லது Google மூலம் பாதுகாப்பான சைன்-இன்",
    "auth.emailLabel": "மின்னஞ்சல் முகவரி",
    "auth.passwordLabel": "கடவுச்சொல் (8+ எழுத்துகள்)",
    "auth.confirmPasswordLabel": "கடவுச்சொல்லை உறுதிப்படுத்தவும்",
    "auth.mobileLabel": "தொலைபேசி எண்",
    "auth.fullNameLabel": "முழு பெயர்",
    "auth.mobileOtp": "மொபைல் OTP",
    "auth.emailPassword": "மின்னஞ்சல் மற்றும் கடவுச்சொல்",
    "auth.loginButton": "மின்னஞ்சல் மூலம் லாகின்",
    "auth.signupButton": "தொலைபேசியை சரிபார்த்து கணக்கை உருவாக்கவும்",
    "auth.sendMobileOtpButton": "மொபைல் OTP அனுப்பு",
    "auth.forgotPassword": "கடவுச்சொல்லை மறந்துவிட்டீர்களா?",
    "auth.googleButton": "Google மூலம் உள்நுழைக",
    "auth.termsAccepted": "நான் விதிமுறைகள் மற்றும் நிபந்தனைகளைப் படித்து ஏற்றுக்கொண்டேன்",
    "auth.enterValidMobile": "சரியான இந்திய மொபைல் எண்ணை உள்ளிடவும்.",
    "auth.enterOtp": "6 இலக்க சரிபார்ப்பு குறியீட்டை உள்ளிடவும்.",
    "auth.otpSent": "சரிபார்ப்பு குறியீடு அனுப்பப்பட்டது.",
    "auth.continue": "தொடரவும்",
    "auth.verifyOtp": "குறியீட்டை சரிபார்க்கவும்",
    "auth.resend": "குறியீட்டை மீண்டும் அனுப்பு",
    "auth.resendIn": "{seconds} வினாடிகளில் மீண்டும் அனுப்பு",
    "auth.back": "பின்செல்",
    "auth.loading": "உங்கள் GLESKA அமர்வு மீட்டமைக்கப்படுகிறது...",
    "auth.resetPassword": "கடவுச்சொல்லை மீட்டமைக்கவும்",
    "auth.newPassword": "புதிய கடவுச்சொல்",
    "auth.passwordUpdated": "கடவுச்சொல் புதுப்பிக்கப்பட்டது. புதிய கடவுச்சொல்லுடன் உள்நுழையவும்.",
    "auth.passwordUpdatedTitle": "கடவுச்சொல் புதுப்பிக்கப்பட்டது",
    "auth.passwordResetSuccess": "கடவுச்சொல் வெற்றிகரமாக மீட்டமைக்கப்பட்டது. உங்கள் புதிய கடவுச்சொல்லுடன் லாகின் செய்யவும்.",
    "auth.continueLogin": "லாகினைத் தொடரவும்",
    "auth.enterPhoneHelper": "உங்கள் கணக்குடன் தொடர்புடைய மொபைல் எண்ணை உள்ளிடவும்.",
    "auth.resetCodeSent": "{phone} எண்ணுக்கு அனுப்பப்பட்ட ஆறு இலக்கக் குறியீட்டை உள்ளிடவும்.",
    "auth.sendOtp": "OTP அனுப்பு",
    "auth.resendOtp": "OTP மீண்டும் அனுப்பு",
    "auth.changePhone": "மொபைலை மாற்றவும்",
    "auth.newPasswordHelper": "உங்கள் கணக்கிற்கான புதிய கடவுச்சொல்லை உருவாக்கவும்.",
    "auth.secureSignup": "பாதுகாப்பான பதிவு",
    "auth.verifyPhone": "உங்கள் தொலைபேசியை சரிபார்க்கவும்",
    "auth.signupCodeSent": "உங்கள் தொலைபேசிக்கு அனுப்பப்பட்ட 6 இலக்கக் குறியீட்டை உள்ளிடவும்: {phone}",
    "auth.verifyCreate": "சரிபார்த்து கணக்கை உருவாக்கவும்",
    "auth.verifying": "சரிபார்க்கப்படுகிறது...",
    "auth.cancel": "ரத்து செய்",
    "auth.employeeTitle": "உங்கள் வேலையை முடிக்கவும்.",
    "auth.businessSignupHeading": "வணிகக் கணக்கை உருவாக்கவும்",
    "auth.individualSignupHeading": "தனிநபர் கணக்கை உருவாக்கவும்",
    "auth.businessSubtitle": "நிறுவனத்தின் மூளையை உருவாக்கவும்.",
    "auth.individualSubtitle": "தனிநபர் முதலாளியாக தொழிலாளர்களை பணியமர்த்தவும்.",
    "auth.accountReady": "உங்கள் GLESKA கணக்கு தயாராக உள்ளது.",
    "auth.workerProfile": "தொடர Worker சுயவிவரத்தை நிறைவு செய்யவும்.",
    "auth.logout": "வெளியேறு",
  },
};

interface LanguageContextValue {
  language: LanguageCode;
  setLanguage: (value: LanguageCode) => void;
  t: (key: string, params?: Record<string, string | number>) => string;
}

const LanguageContext = createContext<LanguageContextValue | null>(null);
const STORAGE_KEY = "goleska_lang";

function storedLanguage(): LanguageCode {
  const stored = localStorage.getItem(STORAGE_KEY);
  return languages.some(({ code }) => code === stored) ? stored as LanguageCode : "EN";
}

export function LanguageProvider({ children }: { children: ReactNode }) {
  const { user, isLoading } = useAuth();
  const [language, setLanguageState] = useState<LanguageCode>(storedLanguage);
  const selectionId = useRef(0);

  useEffect(() => {
    const entry = languages.find(({ code }) => code === language) || languages[0];
    document.documentElement.lang = entry.locale;
    localStorage.setItem(STORAGE_KEY, language);
  }, [language]);

  useEffect(() => {
    if (isLoading || !user || (user.role !== "WORKER" && user.role !== "EMPLOYER")) return;
    const currentSelection = selectionId.current;
    const endpoint = user.role === "WORKER" ? "/api/v1/workers/me/preferences" : "/api/v1/employers/me/preferences";
    void apiGet<{ language?: string }>(endpoint).then((preferences) => {
      const saved = preferences.language;
      if (selectionId.current === currentSelection && languages.some(({ code }) => code === saved)) {
        setLanguageState(saved as LanguageCode);
      }
    }).catch(() => undefined);
  }, [isLoading, user]);

  const setLanguage = (value: LanguageCode) => {
    selectionId.current += 1;
    setLanguageState(value);
    if (!user || (user.role !== "WORKER" && user.role !== "EMPLOYER")) return;
    const endpoint = user.role === "WORKER" ? "/api/v1/workers/me/preferences" : "/api/v1/employers/me/preferences";
    void apiPut(endpoint, { language: value }).catch(() => undefined);
  };

  const t = (key: string, params?: Record<string, string | number>) => {
    const text = translations[language][key] || translations.EN[key] || key;
    if (!params) return text;
    return Object.entries(params).reduce((result, [name, value]) => result.replaceAll(`{${name}}`, String(value)), text);
  };

  return <LanguageContext.Provider value={{ language, setLanguage, t }}>{children}</LanguageContext.Provider>;
}

export function useLanguage() {
  const context = useContext(LanguageContext);
  if (!context) throw new Error("useLanguage must be used inside LanguageProvider.");
  return context;
}

export function LanguageSelector() {
  const { language, setLanguage } = useLanguage();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      if (!(event.target instanceof Element) || !event.target.closest(".language-selector")) setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open]);

  return (
    <div className="language-selector">
      <button type="button" className="language-trigger" aria-label="Select language" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
        <Globe size={16} /> <span>{language}</span> <ChevronDown size={14} />
      </button>
      {open && <div className="language-menu" role="menu">
        {languages.map((item) => <button key={item.code} type="button" role="menuitem" onClick={() => { setLanguage(item.code); setOpen(false); }}>
          <span>{item.label}</span>{language === item.code && <Check size={15} />}
        </button>)}
      </div>}
    </div>
  );
}