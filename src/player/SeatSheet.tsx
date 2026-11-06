import { useEffect, useState } from "react";
import type { NoteRevision, RoomView } from "../../shared/types";
import { ROLES, roleById, roleName, TEAM_NAMES, type Team } from "../../shared/roles";
import { claimFields } from "../../shared/claims";
import type { Send } from "../useRoom";
import { localKey, useLocalState, useUnread } from "../localState";
import Picker, { roleOptions, seatOptions } from "../ui/Picker";
import { claimSummary, seatNotes, type Verdict } from "./notes";
import { currentNoteDate, dateLabel, noteBaseline, noteChangedElsewhere, noteSaveCommands, restoredNote, sameNoteDate, type NoteDate, type NoteDraft } from "./notebookEditing";

const TEAMS: Team[] = ["townsfolk", "outsider", "minion", "demon"];
const TONE: Record<Team, string> = { townsfolk: "town", outsider: "out", minion: "minion", demon: "demon" };

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
  const [draft, setDraft, clearDraft] = useLocalState<NoteDraft | null>(localKey(room, `note-draft:${seatId}`), null);
  const [restoredDraft] = useState(!!draft);
  const [baseline, setBaseline] = useState(() => draft ? draft.baseline ?? null : noteBaseline(room, seatId));
  const [roleId, setRoleId] = useState(draft?.roleId ?? note.claim?.rev.roleId ?? "");
  const [choosing, setChoosing] = useState(!(draft ? draft.roleId : note.claim));
  const [source, setSource] = useState<"claimed" | "suspected">(draft?.source ?? note.claim?.rev.source ?? "claimed");
  const [info, setInfo] = useState<Record<string, string>>(draft?.info ?? note.claim?.rev.info ?? {});
  const [body, setBody] = useState(draft?.body ?? (note.claim ?? note.text)?.rev.body ?? "");
  const [dateOverride, setDateOverride] = useState<NoteDate | undefined>(draft?.date);
  const [editDate, setEditDate] = useState<NoteDate | undefined>();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [partialSave, setPartialSave] = useState(false);
  const original = baseline?.fields ?? noteBaseline(room, seatId).fields;
  const originalDate = baseline?.date ?? currentNoteDate(room);
  const cleanInfo = Object.fromEntries(Object.entries(info).filter(([, v]) => v));
  const contentChanged =
    roleId !== original.roleId ||
    (!!roleId && source !== original.source) ||
    (!!roleId && JSON.stringify(cleanInfo) !== JSON.stringify(original.info)) ||
    body.trim() !== original.body;
  const date = dateOverride ?? (contentChanged ? editDate ?? currentNoteDate(room) : originalDate);
  const changed = contentChanged || !sameNoteDate(date, originalDate);
  const conflict = noteChangedElsewhere(baseline, room, seatId);
  const role = roleById(roleId);
  const fields = roleId && seatId !== me ? claimFields(roleId) : [];

  useEffect(() => {
    if (contentChanged && !editDate) setEditDate(date);
    else if (!contentChanged && editDate) setEditDate(undefined);
    if (changed) setDraft({ roleId, source, info: cleanInfo, body, baseline, date });
    else clearDraft();
  }, [roleId, source, info, body, baseline, date.day, date.period, changed, contentChanged, editDate]);

  async function save() {
    if (!baseline || conflict || partialSave) return false;
    let saved = false;
    for (const command of noteSaveCommands(baseline, seatId, { roleId, source, info: cleanInfo, body }, date)) {
      if (!(await send(command))) {
        setPartialSave(saved);
        return false;
      }
      saved = true;
    }
    return true;
  }

  async function finish(then: () => void) {
    if (busy) return;
    if (!changed) {
      clearDraft();
      return then();
    }
    setBusy(true);
    const ok = await save();
    setBusy(false);
    setFailed(!ok);
    if (ok) {
      clearDraft();
      then();
    }
  }
  const keepDraft = () => {
    setDraft({ roleId, source, info: cleanInfo, body, baseline, date });
    onClose();
  };
  const revert = () => {
    const latest = noteBaseline(room, seatId);
    clearDraft();
    setBaseline(latest);
    setRoleId(latest.fields.roleId);
    setSource(latest.fields.source);
    setInfo(latest.fields.info);
    setBody(latest.fields.body);
    setDateOverride(undefined);
    setEditDate(undefined);
    setChoosing(!latest.fields.roleId);
    setFailed(false);
    setPartialSave(false);
  };
  const restore = (kind: string, rev: NoteRevision) => {
    const restored = restoredNote(kind, rev);
    setRoleId(restored.roleId);
    setSource(restored.source);
    setInfo(restored.info);
    setChoosing(!restored.roleId);
    setBody(restored.body);
    setDateOverride({ day: rev.day, period: rev.period });
  };

  const current = new Set([note.claim?.rev, note.text?.rev].filter(Boolean));
  const history = room.notebook
    .filter((e) => e.target === seatId)
    .flatMap((e) => e.revisions.filter((rev) => !rev.archived && !current.has(rev)).map((rev) => ({ kind: e.kind, rev })))
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
          <button className="note-done" disabled={busy || partialSave || (conflict && changed)} onClick={() => void finish(onClose)}>
            {busy ? "保存中" : "完成"}
          </button>
        </header>

        {conflict || partialSave ? (
          <div className="note-error" role="alert">
            <span>{partialSave ? "已有部分修改保存，请加载最新版后继续。" : baseline ? "这份笔记已有新版本，请先核对；本次修改仍保留在这里。" : "这份旧草稿缺少版本信息，请先核对最新版。"}</span>
            <button className="link-button" onClick={revert}>
              放弃本次修改，加载最新版
            </button>
            <button className="link-button" onClick={keepDraft}>
              保留草稿退出
            </button>
          </div>
        ) : failed ? (
          <div className="note-error" role="alert">
            <span>没保存上。</span>
            <button className="link-button" onClick={keepDraft}>
              保留草稿退出
            </button>
            <button className="link-button" onClick={() => {
              clearDraft();
              onClose();
            }}>
              放弃修改
            </button>
          </div>
        ) : (
          changed && (
            <div className="note-draft">
              <span className="pl-small">{restoredDraft ? "上次的修改还没保存" : "有修改，点「完成」保存"}</span>
              <button className="link-button" onClick={revert}>
                放弃修改
              </button>
            </div>
          )
        )}

        <div className="note-block">
          <Picker
            label="信息发生时间"
            clearable={false}
            value={`${date.day}:${date.period}`}
            options={Array.from({ length: Math.max(1, room.day) }, (_, i) => i + 1).flatMap((day) =>
              (["NIGHT", "DAY"] as const)
                .filter((period) => day < room.day || period === "NIGHT" || room.phase === "DAY" || room.phase === "ENDED")
                .map((period) => ({ value: `${day}:${period}`, label: dateLabel({ day, period }) })),
            )}
            onChange={(value) => {
              const [day, period] = value.split(":");
              if (period === "DAY" || period === "NIGHT") setDateOverride({ day: Number(day), period });
            }}
          />
          <span className="pl-small">新信息默认记在当前时间；更正旧信息可选择原来的时间。</span>
        </div>

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
              {source === "claimed" ? "他说他得知" : "我推测他得知"}
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
                  <button className="link-button note-restore" onClick={() => restore(kind, rev)}>
                    恢复这个版本
                  </button>
                  <span>
                    {kind === "claim" ? `${rev.source === "claimed" ? "自称" : "我猜"}${roleName(rev.roleId)}` : "备注"}
                    {kind === "claim" && claimSummary(rev, room.seats) ? ` · ${claimSummary(rev, room.seats)}` : ""}
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
