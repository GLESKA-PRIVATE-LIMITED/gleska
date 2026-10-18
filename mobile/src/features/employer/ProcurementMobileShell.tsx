import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import {
  Boxes,
  Briefcase,
  Building2,
  ClipboardList,
  FileText,
  Home,
  LayoutDashboard,
  LogOut,
  Menu,
  Settings,
  ShoppingCart,
  Truck,
  User,
  X,
} from "lucide-react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthProvider";
import "./procurement-agent.css";

type ProcurementNavItem = {
  label: string;
  icon: typeof LayoutDashboard;
  href: string;
};

const procurementNavigation: ProcurementNavItem[] = [
  { label: "Overview", icon: LayoutDashboard, href: "/procurement" },
  { label: "Get Procurement", icon: ShoppingCart, href: "/procurement/get" },
  { label: "Requirements", icon: Boxes, href: "/procurement/requirements" },
  { label: "RFQs & Quotations", icon: ClipboardList, href: "/procurement/rfqs" },
  { label: "Orders & Fulfilment", icon: Truck, href: "/procurement/orders" },
  { label: "Procurement Details", icon: FileText, href: "/procurement/details" },
  { label: "Settings", icon: Settings, href: "/procurement/settings" },
  { label: "Provide Procurement", icon: Building2, href: "/supplier" },
  { label: "Companies & Verification", icon: Building2, href: "/supplier/company" },
  { label: "Employer Dashboard", icon: Briefcase, href: "/employer/dashboard" },
];

const employerTypeLabels: Record<string, string> = {
  INDIVIDUAL: "Individual Employer",
  REGISTERED_BUSINESS: "Registered Business",
  REGISTERED_INDUSTRY: "Registered Industry",
  UNREGISTERED_BUSINESS: "Unregistered Business",
};

export default function ProcurementMobileShell({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [open, setOpen] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const displayName = user?.name || "Employer";
  const employerType = user?.employer_type
    ? employerTypeLabels[user.employer_type] || "Employer"
    : "Employer";

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

  const closeMenu = () => setOpen(false);
  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === "Escape") {
      closeMenu();
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

  const logoutFromShell = async () => {
    closeMenu();
    await logout();
    navigate("/", { replace: true });
  };

  const isActive = (href: string) =>
    href === "/procurement"
      ? pathname === href
      : pathname === href || pathname.startsWith(`${href}/`);

  return (
    <div className="procurement-dashboard-shell">
      <header className="procurement-dashboard-header">
        <button
          ref={triggerRef}
          className="procurement-menu-trigger"
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Open Procurement navigation"
          aria-expanded={open}
        >
          <Menu size={21} aria-hidden="true" />
        </button>
        <Link to="/procurement" className="procurement-dashboard-brand">
          <img src="/favicon.ico" alt="" />
          <span>
            <strong>GO LESKA AI</strong>
            <small>PROCUREMENT</small>
          </span>
        </Link>
        <span className="procurement-header-spacer" />
      </header>

      <div className={`procurement-menu-overlay${open ? " is-open" : ""}`} aria-hidden={!open}>
        <button
          className="procurement-menu-backdrop"
          type="button"
          tabIndex={open ? 0 : -1}
          onClick={closeMenu}
          aria-label="Close navigation"
        />
        <aside
          className="procurement-menu-drawer"
          role="dialog"
          aria-modal="true"
          aria-label="Procurement navigation"
          aria-hidden={!open}
          inert={!open}
          onKeyDown={onKeyDown}
        >
          <div className="procurement-menu-top">
            <div className="procurement-menu-heading">
              <Link to="/procurement" onClick={closeMenu} className="procurement-menu-brand">
                <img className="procurement-menu-logo" src="/favicon.ico" alt="" />
                <span>
                  <strong>PROCUREMENT</strong>
                  <small>Autonomous AI</small>
                </span>
              </Link>
              <button
                ref={closeRef}
                className="procurement-menu-close"
                type="button"
                onClick={closeMenu}
                aria-label="Close navigation"
              >
                <X size={19} aria-hidden="true" />
              </button>
            </div>

            <nav className="procurement-menu-navigation" aria-label="Procurement sections">
              {procurementNavigation.map(({ label, icon: Icon, href }) => {
                const active = isActive(href);
                return (
                  <Link
                    key={label}
                    to={href}
                    onClick={closeMenu}
                    aria-current={active ? "page" : undefined}
                    className={`procurement-menu-item${active ? " is-active" : ""}`}
                  >
                    <Icon size={18} aria-hidden="true" />
                    <span>{label}</span>
                  </Link>
                );
              })}
            </nav>
          </div>

          <div className="procurement-menu-bottom">
            <Link
              to="/employer/company-profile"
              onClick={closeMenu}
              className="procurement-profile-identity"
            >
              <span className="procurement-account-avatar">
                {user?.profile_photo_url
                  ? <img src={user.profile_photo_url} alt="" />
                  : displayName.charAt(0).toUpperCase() || <User size={19} aria-hidden="true" />}
              </span>
              <span className="procurement-account-copy">
                <strong>{displayName}</strong>
                <small>{employerType}</small>
              </span>
            </Link>
            <Link to="/" onClick={closeMenu} className="procurement-menu-account-action">
              <Home size={17} aria-hidden="true" />
              <span>Back to Home</span>
            </Link>
            <button
              type="button"
              onClick={() => void logoutFromShell()}
              className="procurement-menu-account-action is-logout"
            >
              <LogOut size={17} aria-hidden="true" />
              <span>Log out</span>
            </button>
          </div>
        </aside>
      </div>

      <div className="procurement-dashboard-content">{children}</div>
    </div>
  );
}
