import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { LogOut, PanelLeft, X } from "lucide-react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthProvider";
import { workerHomeNavigation, workerNavigation } from "./workerNavigation";

function WorkerMobileDrawer({ open, onOpen, onClose }: { open: boolean; onOpen: () => void; onClose: () => void }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const openButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeButtonRef.current?.focus();

    const restoreFocus = () => openButtonRef.current?.focus();
    return () => {
      document.body.style.overflow = previousOverflow;
      restoreFocus();
    };
  }, [open]);

  const handleDrawerKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === "Escape") {
      event.stopPropagation();
      onClose();
      return;
    }
    if (event.key !== "Tab") return;

    const focusable = event.currentTarget.querySelectorAll<HTMLElement>(
      "a[href], button:not([disabled])",
    );
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (!first || !last) return;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  const activeHref = workerNavigation.find(({ href }) => pathname === href || pathname.startsWith(`${href}/`))?.href;

  const handleLogout = async () => {
    onClose();
    await logout();
    navigate("/auth/signin", { replace: true });
  };

  return <>
    <header className="worker-app-header">
      <button
        ref={openButtonRef}
        className="worker-menu-trigger"
        type="button"
        onClick={onOpen}
        aria-label="Open navigation"
        aria-expanded={open}
      >
        <PanelLeft size={21} />
      </button>
      <span className="worker-brand">GO LESKA AI</span>
      <span className="worker-header-spacer" />
    </header>
    <div className={`worker-menu-overlay${open ? " is-open" : ""}`} aria-hidden={!open}>
      <button className="worker-menu-backdrop" type="button" aria-label="Close navigation" onClick={onClose} tabIndex={open ? 0 : -1} />
      <aside
        className="worker-menu-drawer"
        role="dialog"
        aria-modal="true"
        aria-label="Worker navigation"
        aria-hidden={!open}
        inert={!open}
        onKeyDown={handleDrawerKeyDown}
      >
        <div className="worker-menu-heading">
          <span className="worker-brand">GO LESKA AI</span>
          <button ref={closeButtonRef} className="worker-menu-close" type="button" onClick={onClose} aria-label="Close navigation">
            <X size={21} />
          </button>
        </div>

        <nav className="worker-menu-navigation" aria-label="Worker pages">
          {workerNavigation.filter(({ section }) => section === "pages").map(({ href, label, icon: Icon, screen }) => (
            screen === "unavailable"
              ? <button key={href} className="worker-menu-item" type="button" disabled title={`${label} is not available in this mobile app yet`} aria-label={`${label}, not available in this mobile app`}>
                  <Icon size={21} aria-hidden="true" />
                  <span>{label}</span>
                </button>
              : <Link
                  key={href}
                  to={href}
                  className={`worker-menu-item${activeHref === href ? " is-active" : ""}`}
                  aria-current={activeHref === href ? "page" : undefined}
                  onClick={onClose}
                >
                  <Icon size={21} aria-hidden="true" />
                  <span>{label}</span>
                </Link>
          ))}
          <Link className="worker-menu-item worker-menu-home" to={workerHomeNavigation.href} onClick={onClose}>
            <workerHomeNavigation.icon size={21} aria-hidden="true" />
            <span>{workerHomeNavigation.label}</span>
          </Link>
        </nav>

        <section className="worker-menu-account" aria-label="Current user">
          <div className="worker-account-avatar">
            {user?.profile_photo_url
              ? <img src={user.profile_photo_url} alt="" />
              : <span>{user?.name?.charAt(0).toUpperCase() || "W"}</span>}
          </div>
          <div className="worker-account-copy">
            <strong>{user?.name || "Worker"}</strong>
            <span>Worker</span>
          </div>
        </section>

        <div className="worker-menu-account-actions">
          {workerNavigation.filter(({ section }) => section === "account").map(({ href, label, icon: Icon }) => (
            <Link
              key={href}
              className={`worker-menu-item${activeHref === href ? " is-active" : ""}`}
              to={href}
              aria-current={activeHref === href ? "page" : undefined}
              onClick={onClose}
            >
              <Icon size={21} aria-hidden="true" />
              <span>{label}</span>
            </Link>
          ))}
          <button className="worker-menu-logout" type="button" onClick={() => void handleLogout()}>
            <LogOut size={21} aria-hidden="true" />
            <span>Log out</span>
          </button>
        </div>
      </aside>
    </div>
  </>;
}

export default function WorkerMobileShell({ children }: { children: ReactNode }) {
  const [drawerOpen, setDrawerOpen] = useState(false);

  return <div className="worker-app-shell">
    <WorkerMobileDrawer open={drawerOpen} onOpen={() => setDrawerOpen(true)} onClose={() => setDrawerOpen(false)} />
    {children}
  </div>;
}