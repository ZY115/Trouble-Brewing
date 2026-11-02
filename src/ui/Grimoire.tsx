import type { ReactNode } from "react";
import { roleById, roleName } from "../../shared/roles";

export type SeatTone =
  | "town"
  | "out"
  | "minion"
  | "demon"
  | "neutral"
  | "empty"
  | "conflict";
export type SeatRing = "actor" | "target" | "focus" | "self";
export type MarkKind =
  | "poison"
  | "protect"
  | "drunk"
  | "herring"
  | "dead"
  | "vote"
  | "hand"
  | "tag";

export interface GrimoireSeat {
  key: string;
  number: number;
  glyph: string;
  label?: string;
  tone: SeatTone;
  dead?: boolean;
  selected?: boolean;
  rings?: SeatRing[];
  marks?: { text: string; kind: MarkKind }[];
  badge?: string;
  ariaLabel: string;
}

const TEAM_TONE: Record<string, SeatTone> = {
  townsfolk: "town",
  outsider: "out",
  minion: "minion",
  demon: "demon",
};
const GLYPHS: Record<string, string> = { imp: "恶", scarletwoman: "猩" };

export const roleGlyph = (roleId?: string) =>
  roleId ? (GLYPHS[roleId] ?? roleName(roleId).slice(0, 1)) : "";
export const roleTone = (roleId?: string): SeatTone =>
  TEAM_TONE[roleById(roleId ?? "")?.team ?? ""] ?? "neutral";

/** Seat n of `capacity`, clockwise from the top, in percent of the circle. */
export function seatPosition(index: number, capacity: number) {
  const angle = ((-90 + (index * 360) / capacity) * Math.PI) / 180;
  return { x: 50 + 40 * Math.cos(angle), y: 50 + 40 * Math.sin(angle) };
}

export default function Grimoire({
  seats,
  capacity,
  onSeat,
  center,
  lines = [],
  className = "",
  label,
}: {
  seats: GrimoireSeat[];
  capacity: number;
  onSeat?: (seat: GrimoireSeat) => void;
  center?: ReactNode;
  lines?: { from: number; to: number; dashed?: boolean }[];
  className?: string;
  label: string;
}) {
  const point = (n: number) => seatPosition(n - 1, capacity);
  return (
    <div className={`grimoire ${className}`} role="group" aria-label={label}>
      {!!lines.length && (
        <svg className="g-lines" viewBox="0 0 100 100" aria-hidden="true">
          {lines.map((l, i) => {
            const a = point(l.from),
              b = point(l.to);
            return (
              <line
                key={i}
                x1={a.x}
                y1={a.y}
                x2={b.x}
                y2={b.y}
                stroke="var(--accent)"
                strokeWidth={0.35}
                strokeDasharray={l.dashed ? "1.2 1.2" : undefined}
                opacity={0.6}
              />
            );
          })}
        </svg>
      )}
      {seats.map((s) => {
        const p = point(s.number);
        const classes = [
          "g-seat",
          s.tone,
          p.y < 45 ? "upper" : "",
          s.dead ? "dead" : "",
          s.selected ? "selected" : "",
          ...(s.rings ?? []).map((r) => `ring-${r}`),
        ].join(" ");
        return (
          <div
            key={s.key}
            className={classes}
            style={{ "--x": `${p.x}%`, "--y": `${p.y}%` } as never}
          >
            <button
              type="button"
              className="g-token"
              aria-label={s.ariaLabel}
              aria-pressed={s.selected || undefined}
              disabled={!onSeat}
              onClick={() => onSeat?.(s)}
            >
              {s.glyph}
              <span className="g-num" aria-hidden="true">
                {s.number}
              </span>
              {s.badge && (
                <span className="g-badge" aria-hidden="true">
                  {s.badge}
                </span>
              )}
            </button>
            {s.label && <span className="g-label">{s.label}</span>}
            {!!s.marks?.length && (
              <span className="g-marks" aria-hidden="true">
                {s.marks.map((m, i) => (
                  <span key={i} className={`mark ${m.kind}`}>
                    {m.text}
                  </span>
                ))}
              </span>
            )}
          </div>
        );
      })}
      {center && <div className="g-center">{center}</div>}
    </div>
  );
}
