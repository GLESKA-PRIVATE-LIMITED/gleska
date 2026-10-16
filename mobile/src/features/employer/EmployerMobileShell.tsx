import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import {
  Briefcase,
  Clock,
  CreditCard,
  HelpCircle,
  Home,
  LayoutDashboard,
  LogOut,
  PanelLeft,
  ShieldCheck,
  ShoppingCart,
  User,
  Users,
  Wallet,
  X,
} from "lucide-react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthProvider";
import type { EmployerType } from "../../types/auth";
import "./employer-dashboard.css";

type EmployerNavItem = {
  href: string;
  label: string;
  icon: typeof LayoutDashboard;
  isPage: boolean;
};

const employerNavigation: EmployerNavItem[] = [
  { href: "/employer/dashboard", label: "Dashboard", icon: LayoutDashboard, isPage: true },
  { href: "/employer/dashboard#create-job", label: "Post a Job & Sites", icon: Briefcase, isPage: false },
  { href: "/procurement/workspaces", label: "Procurement (web only)", icon: ShoppingCart, isPage: true },
  { href: "/financial", label: "Financial Agent (web only)", icon: Wallet, isPage: true },
  { href: "/employer/workers", label: "Workers", icon: Users, isPage: true },
  { href: "/employer/attendance", label: "Attendance", icon: Clock, isPage: true },
  { href: "/employer/subscription", label: "Subscription", icon: CreditCard, isPage: true },
  { href: "/employer/security", label: "Security & Settings", icon: ShieldCheck, isPage: true },
  { href: "/employer/help", label: "Help", icon: HelpCircle, isPage: true },
];

const employerTypeLabels: Record<EmployerType, string> = {
  INDIVIDUAL: "Individual Employer",
  REGISTERED_BUSINESS: "Registered Business",
  REGISTERED_INDUSTRY: "Registered Industry",
  UNREGISTERED_BUSINESS: "Unregistered Business",
};

function formatEmployerType(employerType?: EmployerType | null): string {
  return employerType ? employerTypeLabels[employerType] : "Employer";
}

type Props = {
  children: ReactNode;
  name?: string;
  employerType?: EmployerType | null;
  profilePhotoUrl?: string | null;
  onPostJob?: () => void;
};

export default function EmployerMobileShell({
  children,
  name,
  employerType,
  profilePhotoUrl,
  onPostJob,
}: Props) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [open, setOpen] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const displayName = name || user?.name || "Employer";
  const displayType = formatEmployerType(employerType ?? user?.employer_type);
  const displayPhoto = profilePhotoUrl === undefined ? user?.profile_photo_url : profilePhotoUrl;
  const identityHref = "/employer/company-profile";
  const identityActive = pathname === identityHref || pathname === "/employer/director-profile";

  useEffect(() => {
    if (!open) return;
    const oldOverflow = document.body.style.overflow;
    const trigger = triggerRef.current;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();
    return () => {
      document.body.style.overflow = oldOverflow;
      trigger?.focus();
    };
  }, [open]);

  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === "Escape") {
      setOpen(false);
      return;
    }
    if (event.key !== "Tab") return;
    const focusable = event.currentTarget.querySelectorAll<HTMLElement>("a[href], button:not([disabled])");
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last?.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first?.focus();
    }
  };

  const closeMobile = () => setOpen(false);
  const logoutFromShell = async () => {
    closeMobile();
    await logout();
    navigate("/", { replace: true });
  };

  const linkIsActive = (href: string) => {
    if (href.includes("#")) return false;
    return pathname === href || pathname.startsWith(`${href}/`);
  };

  const renderAccountActions = () => <>
    <Link to="/" onClick={closeMobile} className="employer-account-action">
      <Home size={17} aria-hidden="true" />
      <span>Back to Home</span>
    </Link>
    <button type="button" onClick={() => void logoutFromShell()} className="employer-account-action is-logout">
      <LogOut size={17} aria-hidden="true" />
      <span>Log out</span>
    </button>
  </>;

  return <div className="employer-app-shell">
    <header className="employer-app-header">
      <button
        ref={triggerRef}
        className="employer-menu-trigger"
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Open navigation"
        aria-expanded={open}
      >
        <PanelLeft size={20} />
      </button>
      <Link to="/employer/dashboard" className="employer-brand">GO LESKA AI</Link>
      <span className="employer-header-spacer" />
    </header>

    <div className={`employer-menu-overlay${open ? " is-open" : ""}`} aria-hidden={!open}>
      <button
        className="employer-menu-backdrop"
        type="button"
        tabIndex={open ? 0 : -1}
        onClick={closeMobile}
        aria-label="Close navigation"
      />
      <aside
        className="employer-menu-drawer"
        role="dialog"
        aria-modal="true"
        aria-label="Employer navigation"
        aria-hidden={!open}
        inert={!open}
        onKeyDown={onKeyDown}
      >
        <div className="employer-menu-top">
          <div className="employer-menu-heading">
            <Link to="/employer/dashboard" onClick={closeMobile} className="employer-brand">GO LESKA AI</Link>
            <button ref={closeRef} className="employer-menu-close" type="button" onClick={closeMobile} title="Close navigation" aria-label="Close navigation">
              <X size={20} />
            </button>
          </div>
          <nav className="employer-menu-navigation" aria-label="Employer pages">
            {employerNavigation.map(({ href, label, icon: Icon, isPage }) => {
              const active = isPage && linkIsActive(href);
              if (!isPage && pathname === "/employer/dashboard" && onPostJob) {
                return <button
                  key={label}
                  type="button"
                  onClick={() => {
                    closeMobile();
                    onPostJob();
                  }}
                  className="employer-menu-item"
                  title={label}
                >
                  <Icon size={19} aria-hidden="true" />
                  <span>{label}</span>
                </button>;
              }
              return <Link
                key={label}
                to={href}
                onClick={closeMobile}
                aria-current={active ? "page" : undefined}
                className={`employer-menu-item${active ? " is-active" : ""}`}
                title={label}
              >
                <Icon size={19} aria-hidden="true" />
                <span>{label}</span>
              </Link>;
            })}
          </nav>
        </div>
        <div className="employer-menu-bottom">
          <Link
            to={identityHref}
            onClick={closeMobile}
            aria-current={identityActive ? "page" : undefined}
            title={`${displayName} · ${displayType}`}
            className={`employer-profile-identity${identityActive ? " is-active" : ""}`}
          >
            <span className="employer-account-avatar">
              {displayPhoto ? <img src={displayPhoto} alt="" /> : displayName.charAt(0).toUpperCase() || <User size={20} />}
            </span>
            <span className="employer-account-copy">
              <strong>{displayName}</strong>
              <span>{displayType}</span>
            </span>
          </Link>
          <div className="employer-account-actions">{renderAccountActions()}</div>
        </div>
      </aside>
    </div>
    {children}
  </div>;
}
