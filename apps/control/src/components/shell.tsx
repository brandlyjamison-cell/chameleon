"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

/** Opens and closes the mobile rail; desktop ignores the attribute. */
export function NavToggle() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const shell = document.querySelector(".shell");
    if (!shell) return;
    if (open) shell.setAttribute("data-nav", "open");
    else shell.removeAttribute("data-nav");
  }, [open]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  return (
    <>
      <button
        type="button"
        className="menu-toggle"
        aria-expanded={open}
        aria-controls="sidebar"
        onClick={() => setOpen((value) => !value)}
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M4 7h16M4 12h16M4 17h16" stroke="currentColor" strokeWidth="1.8" />
        </svg>
        Menu
      </button>
      {open ? (
        <button
          type="button"
          className="nav-scrim"
          aria-label="Close menu"
          onClick={() => setOpen(false)}
        />
      ) : null}
    </>
  );
}

/** Confirmation for a destructive submit, without a modal library. */
export function ConfirmSubmit({
  message,
  className = "btn ghost sm",
  children,
}: {
  message: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="submit"
      className={className}
      onClick={(event) => {
        if (!window.confirm(message)) event.preventDefault();
      }}
    >
      {children}
    </button>
  );
}

/** Marks itself current from the client path; no prop drilling from layout. */
export function NavLink({
  href,
  children,
  sub = false,
  exact = false,
  count,
}: {
  href: string;
  children: React.ReactNode;
  sub?: boolean;
  exact?: boolean;
  count?: number;
}) {
  const path = usePathname();
  const active = exact ? path === href : path === href || path.startsWith(`${href}/`);
  return (
    <a
      href={href}
      className={sub ? "navitem sub" : "navitem"}
      aria-current={active ? "page" : undefined}
    >
      {children}
      {count !== undefined && count > 0 ? <span className="count">{count}</span> : null}
    </a>
  );
}
