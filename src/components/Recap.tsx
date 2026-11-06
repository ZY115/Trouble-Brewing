import { useState } from "react";
import type { GameRecap, GameResult, RecapEntry } from "../../shared/endgame";
import type { RoomView } from "../../shared/types";
import { roleById, roleName } from "../../shared/roles";
import type { Send } from "../useRoom";
import Grimoire, { roleGlyph, roleTone, type GrimoireSeat } from "../ui/Grimoire";

export const periodName = (day: number, period: "DAY" | "NIGHT") =>
  period === "NIGHT" ? (day === 1 ? "首夜" : `第 ${day} 夜`) : `第 ${day} 天`;

const evil = (roleId?: string) => ["minion", "demon"].includes(roleById(roleId ?? "")?.team ?? "");

export function ResultBanner({ result }: { result?: GameResult }) {
  const winner = result?.mode === "normal" ? result.winner : "none";
  return (
    <section className={`result-banner ${winner}`}>
      <span className="task-eyebrow">
        {result ? `第 ${result.gameNo} 局 · ${periodName(result.day, result.period)}结束` : "本局已结束"}
      </span>
      <h2>{winner === "good" ? "善良阵营获胜" : winner === "evil" ? "邪恶阵营获胜" : "本局提前结束"}</h2>
      {result?.reason && <p>{result.reason}</p>}
    </section>
  );
}

export function TruthCircle({ room, recap }: { room: RoomView; recap: GameRecap }) {
  const me = room.viewer.seatId;
  const seats: GrimoireSeat[] = recap.seats.map((s) => ({
    key: s.seatId,
    number: s.number,
    glyph: roleGlyph(s.final.actualRoleId),
    tone: roleTone(s.final.actualRoleId),
    dead: !s.alive,
    rings: s.seatId === me ? ["self"] : undefined,
    label: roleName(s.final.actualRoleId),
    ariaLabel: `${s.number} 号${s.seatId === me ? "（你）" : ""}，${roleName(s.final.actualRoleId)}，${s.alive ? "存活" : "死亡"}`,
  }));
  const evilSeats = recap.seats.filter((s) => evil(s.final.actualRoleId)).map((s) => s.number);
  return (
    <div className="truth-circle">
      <Grimoire
        label="身份真相"
        capacity={room.capacity}
        seats={seats}
        center={
          <>
            <span className="task-eyebrow">邪恶阵营</span>
            <span className="truth-evil">{evilSeats.join(" · ") || "—"}</span>
          </>
        }
      />
    </div>
  );
}

export function RecapFacts({ recap }: { recap: GameRecap }) {
  const facts = recap.seats.flatMap((s) => {
    const out: string[] = [];
    const actual = s.final.actualRoleId;
    if (s.initial && s.initial.actualRoleId !== actual)
      out.push(`开局是${roleName(s.initial.actualRoleId)}，后来成为${roleName(actual)}`);
    if (s.final.perceivedRoleId && s.final.perceivedRoleId !== actual)
      out.push(`是${roleName(actual)}，却以为自己是${roleName(s.final.perceivedRoleId)}`);
    if (recap.redHerring === s.seatId) out.push("是占卜师的误判目标（会被查成恶魔）");
    return out.map((text) => ({ key: `${s.seatId}:${text}`, number: s.number, text, role: actual }));
  });
  if (!facts.length) return null;
  return (
    <section className="recap-facts" aria-label="身份变化">
      <span className="note-label">身份变化</span>
      <ul>
        {facts.map((f) => (
          <li key={f.key}>
            <span className={`recap-num ${roleTone(f.role)}`}>{f.number}</span>
            <span>{f.text}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function EntryEditor({
  initial,
  busy,
  onSave,
  onCancel,
}: {
  initial: string;
  busy: boolean;
  onSave: (text: string) => void;
  onCancel: () => void;
}) {
  const [text, setText] = useState(initial);
  return (
    <div className="recap-editor">
      <textarea autoFocus rows={3} maxLength={2000} value={text} onChange={(e) => setText(e.target.value)} />
      <div className="recap-tools">
        <button className="link-button" disabled={busy || !text.trim()} onClick={() => onSave(text.trim())}>
          保存
        </button>
        <button className="link-button" disabled={busy} onClick={onCancel}>
          取消
        </button>
      </div>
    </div>
  );
}

export function RecapTimeline({
  recap,
  room,
  send,
  editable = false,
}: {
  recap: GameRecap;
  room: RoomView;
  send?: Send;
  editable?: boolean;
}) {
  const [editing, setEditing] = useState("");
  const [busy, setBusy] = useState(false);
  const lastDay = recap.result?.day ?? room.day;
  const lastPeriod = recap.result?.period ?? (room.phase === "DAY" ? "DAY" : "NIGHT");
  const periods: { day: number; period: "DAY" | "NIGHT" }[] = [];
  for (let d = 1; d <= Math.max(lastDay, 1); d++) {
    periods.push({ day: d, period: "NIGHT" });
    if (d < lastDay || lastPeriod === "DAY") periods.push({ day: d, period: "DAY" });
  }
  const groups = periods
    .map((p) => ({ ...p, entries: recap.entries.filter((e) => e.day === p.day && e.period === p.period) }))
    .filter((g) => editable || g.entries.length);

  async function save(entry: Pick<RecapEntry, "day" | "period" | "text"> & { id?: string }) {
    if (!send) return;
    setBusy(true);
    const ok = await send({
      type: "edit_recap",
      ...(entry.id ? { entryId: entry.id } : {}),
      expectedVersion: recap.version,
      day: entry.day,
      period: entry.period,
      text: entry.text,
    });
    setBusy(false);
    if (ok) setEditing("");
  }

  if (!groups.length) return <p className="recap-empty">这一局没有登记到关键行动。</p>;
  return (
    <ol className="recap-timeline">
      {groups.map((g) => {
        const key = `${g.day}-${g.period}`;
        return (
          <li key={key} className={`recap-period ${g.period === "NIGHT" ? "night" : "day"}`}>
            <span className="recap-period-name">{periodName(g.day, g.period)}</span>
            <ul>
              {g.entries.map((e) => (
                <li key={e.id} className={`recap-entry ${e.kind}`}>
                  {editing === e.id ? (
                    <EntryEditor
                      initial={e.text}
                      busy={busy}
                      onCancel={() => setEditing("")}
                      onSave={(text) => void save({ ...e, text })}
                    />
                  ) : (
                    <>
                      <p>{e.text}</p>
                      {editable && (
                        <span className="recap-tools">
                          <button className="link-button" disabled={busy} onClick={() => setEditing(e.id)}>
                            改写
                          </button>
                        </span>
                      )}
                    </>
                  )}
                </li>
              ))}
              {editable &&
                (editing === `new:${key}` ? (
                  <li className="recap-entry manual">
                    <EntryEditor
                      initial=""
                      busy={busy}
                      onCancel={() => setEditing("")}
                      onSave={(text) => void save({ day: g.day, period: g.period, text })}
                    />
                  </li>
                ) : (
                  <li className="recap-add">
                    <button className="link-button" onClick={() => setEditing(`new:${key}`)}>
                      ＋ 补充一条
                    </button>
                  </li>
                ))}
            </ul>
          </li>
        );
      })}
    </ol>
  );
}
