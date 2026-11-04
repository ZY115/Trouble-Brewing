import { useEffect, useId, useState } from "react";
import type { PublicSeat } from "../../shared/types";
import { ROLES, TEAM_NAMES, type Role } from "../../shared/roles";

export interface PickerOption {
  value: string;
  /** Chip text. */
  label: string;
  /** Text in the closed row; defaults to the label. */
  text?: string;
  group?: string;
  tone?: string;
  disabled?: boolean;
}

const TONE: Record<string, string> = { townsfolk: "town", outsider: "out", minion: "minion", demon: "demon" };
const OPEN = "picker:open";

export const seatOptions = (seats: PublicSeat[], disabled: string[] = []): PickerOption[] =>
  [...seats]
    .sort((a, b) => a.number - b.number)
    .map((s) => ({ value: s.id, label: String(s.number), text: `${s.number} 号`, disabled: disabled.includes(s.id) }));

export const roleOptions = (roles: Role[] = ROLES, by: "id" | "name" = "id"): PickerOption[] =>
  roles.map((r) => ({
    value: by === "id" ? r.id : r.name,
    label: r.name,
    group: TEAM_NAMES[r.team],
    tone: TONE[r.team],
  }));

export const valueOptions = (values: string[]): PickerOption[] => values.map((v) => ({ value: v, label: v }));

/**
 * A touch-sized replacement for <select>. The row shows the current choice;
 * tapping it lays every option out as chips right underneath, so nothing hides
 * in a scrolling wheel, and picking one folds it away. Only one is open at a time.
 */
export default function Picker({
  label,
  value,
  options,
  onChange,
  placeholder = "未选",
  clearable = true,
}: {
  label: string;
  value: string;
  options: PickerOption[];
  onChange: (value: string) => void;
  placeholder?: string;
  clearable?: boolean;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const other = (e: Event) => {
      if ((e as CustomEvent<string>).detail !== id) setOpen(false);
    };
    window.addEventListener(OPEN, other);
    return () => window.removeEventListener(OPEN, other);
  }, [id]);
  const current = options.find((o) => o.value === value);
  const groups = [...new Set(options.map((o) => o.group ?? ""))];
  const numeric = options.every((o) => o.label.length <= 2);
  const pick = (v: string) => {
    onChange(v);
    setOpen(false);
  };
  return (
    <div className={`picker${open ? " open" : ""}`}>
      <button
        type="button"
        className="picker-row"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => {
          if (!open) window.dispatchEvent(new CustomEvent(OPEN, { detail: id }));
          setOpen(!open);
        }}
      >
        <span className="picker-label">{label}</span>
        <span className={`picker-value ${current ? (current.tone ?? "") : "placeholder"}`}>
          {current ? (current.text ?? current.label) : placeholder}
        </span>
        <svg className="picker-chevron" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>
      {open && (
        <div id={id} className="picker-panel" role="listbox" aria-label={label}>
          {groups.map((g) => (
            <div key={g} className={`picker-group${g ? " named" : ""}`}>
              {g && <span className={`picker-group-name ${options.find((o) => o.group === g)?.tone ?? ""}`}>{g}</span>}
              <div className={`picker-chips${numeric ? " numeric" : ""}`}>
                {options
                  .filter((o) => (o.group ?? "") === g)
                  .map((o) => (
                    <button
                      key={o.value}
                      type="button"
                      role="option"
                      aria-selected={o.value === value}
                      disabled={o.disabled}
                      className={o.tone}
                      onClick={() => pick(o.value)}
                    >
                      {o.label}
                    </button>
                  ))}
              </div>
            </div>
          ))}
          {clearable && current && (
            <button type="button" className="link-button picker-clear" onClick={() => pick("")}>
              清除这一项
            </button>
          )}
        </div>
      )}
    </div>
  );
}
