import { useState } from "react";
import type { RoomView } from "../../shared/types";
import { ROLES, roleById, roleName, TEAM_NAMES, type Team } from "../../shared/roles";
import { claimFields } from "../../shared/claims";
import type { Send } from "../useRoom";
import { useUnread } from "../localState";
import Picker, { roleOptions, seatOptions } from "../ui/Picker";
import { seatNotes, type Verdict } from "./notes";

type Patch = Extract<Parameters<Send>[0], { type: "edit_notebook" }>["patch"];
const TEAMS: Team[] = ["townsfolk", "outsider", "minion", "demon"];
const TONE: Record<Team, string> = { townsfolk: "town", outsider: "out", minion: "minion", demon: "demon" };

/**
 * Notes live on the seat they are about. One sheet per player: my read,
 * the role they claim (or I suspect), what they said they learned, and a note.
 * Closing the sheet keeps what was written; every save is a revision, so
 * nothing is ever lost by accident.
 */
export default function SeatSheet({
  room,
  send,
  seatId,
  verdict,
  setVerdict,
  onClose,
  onChat,
}: {
  room: RoomView;
  send: Send;
  seatId: string;
  verdict: Verdict | undefined;
  setVerdict: (v: Verdict | "") => void;
  onClose: () => void;
  onChat: () => void;
}) {
  const seat = room.seats.find((s) => s.id === seatId)!;
  const me = room.viewer.seatId;
  const note = seatNotes(room)[seatId] ?? {};
  const unread = useUnread(room).contactCount(seatId);
  const [roleId, setRoleId] = useState(note.claim?.rev.roleId ?? "");
  const [choosing, setChoosing] = useState(!note.claim);
  const [source, setSource] = useState<"claimed" | "suspected">(note.claim?.rev.source ?? "claimed");
  const [info, setInfo] = useState<Record<string, string>>(note.claim?.rev.info ?? {});
  const [body, setBody] = useState((note.claim ?? note.text)?.rev.body ?? "");
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const original = {
    roleId: note.claim?.rev.roleId ?? "",
    source: note.claim?.rev.source ?? "claimed",
    info: JSON.stringify(note.claim?.rev.info ?? {}),
    body: (note.claim ?? note.text)?.rev.body ?? "",
  };
  const cleanInfo = Object.fromEntries(Object.entries(info).filter(([, v]) => v));
  const changed =
    roleId !== original.roleId ||
    (!!roleId && source !== original.source) ||
    (!!roleId && JSON.stringify(cleanInfo) !== original.info) ||
    body.trim() !== original.body;
  const role = roleById(roleId);
  const fields = roleId ? claimFields(roleId) : [];

  async function save() {
    const text = body.trim();
    const edit = (ref: NonNullable<typeof note.claim>, patch: Patch) =>
      send({ type: "edit_notebook", entryId: ref.entry.id, expectedVersion: ref.entry.revisions.length, patch });
    let ok = true;
    if (roleId) {
      ok = await (note.claim
        ? edit(note.claim, { roleId, source, info: cleanInfo, body: text })
        : send({ type: "add_note", target: seatId, roleId, source, info: cleanInfo, body: text }));
      // The role note now carries the text, so the loose note retires.
      if (ok && note.text) ok = await edit(note.text, { archived: true });
    } else {
      if (note.claim) ok = await edit(note.claim, { archived: true });
      if (ok && text)
        ok = await (note.text ? edit(note.text, { body: text }) : send({ type: "add_note", target: seatId, body: text }));
      else if (ok && note.text) ok = await edit(note.text, { archived: true });
    }
    return ok;
  }

  async function finish(then: () => void) {
    if (!changed) return then();
    setBusy(true);
    const ok = await save();
    setBusy(false);
    setFailed(!ok);
    if (ok) then();
  }

  const history = [note.claim, note.text]
    .filter(Boolean)
    .flatMap((n) => n!.entry.revisions.slice(0, -1).map((rev) => ({ kind: n!.entry.kind, rev })))
    .sort((a, b) => (b.rev.sequence ?? 0) - (a.rev.sequence ?? 0));

  const pick = (id: string) => {
    setRoleId(id);
    setInfo({});
    setChoosing(!id);
  };

  return (
    <div className="sheet-overlay" role="dialog" aria-modal="true" aria-label={`${seat.number} 号笔记`}>
      <div className="sheet-scrim" onClick={() => void finish(onClose)} aria-hidden="true" />
      <section className="note-sheet">
        <span className="sheet-grip" aria-hidden="true" />
        <header className="note-sheet-head">
          <span className={`note-seat ${verdict ?? ""} ${seat.alive ? "" : "dead"}`}>{seat.number}</span>
          <div className="note-seat-text">
            <b>{seat.id === me ? "我自己" : `${seat.number} 号`}</b>
            <span className="pl-small">
              {seat.alive ? "存活" : seat.deadVoteAvailable ? "已死亡 · 还有死者票" : "已死亡 · 死者票已用"}
            </span>
          </div>
          <button className="note-done" disabled={busy} onClick={() => void finish(onClose)}>
            {busy ? "保存中" : "完成"}
          </button>
        </header>

        {failed && <p className="note-error">没保存上，网络恢复后再点一次「完成」。</p>}

        {seat.id !== me && (
          <div className="note-block">
            <span className="note-label">我的判断</span>
            <div className="segmented verdict" role="group" aria-label="我的判断">
              {(
                [
                  ["good", "偏善良"],
                  ["", "不确定"],
                  ["evil", "偏邪恶"],
                ] as const
              ).map(([v, label]) => (
                <button key={label} aria-pressed={(verdict ?? "") === v} className={v} onClick={() => setVerdict(v)}>
                  {label}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="note-block">
          <div className="note-label-row">
            <span className="note-label">角色</span>
            <div className="segmented small" role="group" aria-label="角色来源">
              <button aria-pressed={source === "claimed"} onClick={() => setSource("claimed")}>
                {seat.id === me ? "我对外说" : "他自称"}
              </button>
              <button aria-pressed={source === "suspected"} onClick={() => setSource("suspected")}>
                {seat.id === me ? "备忘" : "我猜"}
              </button>
            </div>
          </div>
          {role && !choosing ? (
            <div className="role-picked">
              <span className={`role-picked-name ${TONE[role.team]}`}>
                {role.name}
                {source === "suspected" ? "？" : ""}
              </span>
              <span className="pl-small">{TEAM_NAMES[role.team]}</span>
              <span style={{ flex: 1 }} />
              <button className="link-button" onClick={() => setChoosing(true)}>
                更换
              </button>
              <button className="link-button" onClick={() => pick("")}>
                清除
              </button>
            </div>
          ) : (
            TEAMS.map((team) => (
              <div key={team} className="role-row">
                <span className={`role-team ${TONE[team]}`}>{TEAM_NAMES[team]}</span>
                <div className="role-chips">
                  {ROLES.filter((r) => r.team === team).map((r) => (
                    <button
                      key={r.id}
                      className={TONE[team]}
                      aria-pressed={roleId === r.id}
                      onClick={() => pick(roleId === r.id ? "" : r.id)}
                    >
                      {r.name}
                    </button>
                  ))}
                </div>
              </div>
            ))
          )}
        </div>

        {!!fields.length && !choosing && (
          <div className="note-block">
            <span className="note-label">
              {seat.id === me ? "我说我得知" : source === "claimed" ? "他说他得知" : "我推测他得知"}
            </span>
            <div className="claim-fields">
              {fields.map((f) =>
                f.type === "choice" && (f.options?.length ?? 0) <= 4 ? (
                  <div key={f.key} className="claim-field">
                    <span>{f.label}</span>
                    <div className="segmented small">
                      {f.options!.map((o) => (
                        <button
                          key={o.value}
                          aria-pressed={info[f.key] === o.value}
                          onClick={() => setInfo({ ...info, [f.key]: info[f.key] === o.value ? "" : o.value })}
                        >
                          {o.label}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : (
                  <Picker
                    key={f.key}
                    label={f.label}
                    value={info[f.key] ?? ""}
                    options={
                      f.type === "seat"
                        ? seatOptions(room.seats)
                        : f.key === "learnedRole"
                          ? roleOptions(ROLES.filter((r) => f.options!.some((o) => o.value === r.id)))
                          : f.options!.map((o) => ({ value: o.value, label: o.label }))
                    }
                    onChange={(v) => setInfo({ ...info, [f.key]: v })}
                  />
                ),
              )}
            </div>
          </div>
        )}

        <label className="note-block">
          <span className="note-label">备注</span>
          <textarea
            value={body}
            maxLength={4000}
            rows={3}
            placeholder={seat.id === me ? "我准备怎么说、要找谁……" : "他说了什么、投了谁、你的直觉……"}
            onChange={(e) => setBody(e.target.value)}
          />
        </label>

        {seat.id !== me && (
          <button className="note-chat" disabled={busy} onClick={() => void finish(onChat)}>
            私聊 {seat.number} 号{unread ? <span className="dock-unread"> · {unread} 条新消息</span> : null}
          </button>
        )}

        {!!history.length && (
          <details className="note-history">
            <summary>以前的版本 · {history.length}</summary>
            <ul>
              {history.map(({ kind, rev }) => (
                <li key={`${kind}-${rev.version}-${rev.sequence}`}>
                  <span className="pl-small">
                    第 {rev.day} {rev.period === "DAY" ? "天" : "夜"}
                  </span>
                  <span>
                    {kind === "claim" ? `${rev.source === "claimed" ? "自称" : "我猜"}${roleName(rev.roleId)}` : "备注"}
                    {rev.body ? ` · ${rev.body}` : ""}
                  </span>
                </li>
              ))}
            </ul>
          </details>
        )}
      </section>
    </div>
  );
}
