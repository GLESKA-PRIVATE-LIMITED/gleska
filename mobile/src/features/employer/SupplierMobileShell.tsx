import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import {
  Briefcase,
  Building2,
  Clock3,
  FileText,
  Home,
  LayoutDashboard,
  LogOut,
  Menu,
  Package,
  Settings,
  ShoppingCart,
  Truck,
  User,
  X,
} from "lucide-react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthProvider";
import "./procurement-agent.css";

const supplierNavigation = [
  { label: "Overview", icon: LayoutDashboard, href: "/procurement" },
  { label: "Get Procurement", icon: ShoppingCart, href: "/procurement" },
  { label: "Provide Procurement", icon: Package, href: "/supplier" },
  { label: "RFQs & Quotations", icon: FileText, href: "/supplier/rfqs" },
  { label: "Orders & Fulfilment", icon: Truck, href: "/supplier/orders" },
  { label: "Order History", icon: Clock3, href: "/supplier/history" },
  { label: "Material Offerings", icon: Package, href: "/supplier/offerings" },
  { label: "Companies & Verification", icon: Building2, href: "/supplier/company" },
  { label: "Settings", icon: Settings, href: "/supplier/settings" },
  { label: "Employer Dashboard", icon: Briefcase, href: "/employer/dashboard" },
];

export default function SupplierMobileShell({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [open, setOpen] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const displayName = user?.name || "Employer";

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    const trigger = triggerRef.current;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();
    return () => {
      document.body.style.overflow = previousOverflow;
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

  return (
    <div className="procurement-dashboard-shell">
      <header className="procurement-dashboard-header">
        <button
          ref={triggerRef}
          className="procurement-menu-trigger"
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Open Supplier navigation"
          aria-expanded={open}
        >
          <Menu size={21} aria-hidden="true" />
        </button>
        <Link to="/supplier" className="procurement-dashboard-brand">
          <img src="/favicon.ico" alt="" />
          <span>
            <strong>GO LESKA AI</strong>
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
          aria-label="Supplier navigation"
          aria-hidden={!open}
          inert={!open}
          onKeyDown={onKeyDown}
        >
          <div className="procurement-menu-top">
            <div className="procurement-menu-heading">
              <Link to="/supplier" onClick={closeMenu} className="procurement-menu-brand">
                <img className="procurement-menu-logo" src="/favicon.ico" alt="" />
                <span>
                  <strong>PROCUREMENT</strong>
                  <small>Provide Procurement</small>
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

            <nav className="procurement-menu-navigation" aria-label="Supplier sections">
              {supplierNavigation.map(({ label, icon: Icon, href }) => {
                const active = pathname === href || pathname.startsWith(`${href}/`);
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
              to="/supplier/company"
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
                <small>Supplier</small>
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
