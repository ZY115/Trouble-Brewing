import { useEffect, useRef, type ReactNode } from "react";

export default function Drawer({
  title,
  onClose,
  children,
  extra,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  extra?: ReactNode;
}) {
  const panel = useRef<HTMLElement>(null);
  useEffect(() => {
    panel.current?.focus();
  }, []);
  return (
    <>
      <div className="drawer-backdrop" onClick={onClose} aria-hidden="true" />
      <aside
        ref={panel}
        className="drawer"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        onKeyDown={(e) => {
          if (e.key === "Escape") onClose();
        }}
      >
        <div className="drawer-head">
          <h2>{title}</h2>
          {extra}
          <span className="spacer" />
          <button
            className="icon-button"
            aria-label={`关闭${title}`}
            onClick={onClose}
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              aria-hidden="true"
            >
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>
        <div className="drawer-body">{children}</div>
      </aside>
    </>
  );
}
