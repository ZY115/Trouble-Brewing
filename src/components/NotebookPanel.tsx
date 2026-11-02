import { localKey, useLocalState } from "../localState";
import { useState } from "react";
import { claimFields } from "../../shared/claims";
import { ROLES, roleName } from "../../shared/roles";
import type {
  NotebookEntry,
  NoteRevision,
  PublicSeat,
  RoomView,
} from "../../shared/types";
import type { Send } from "../useRoom";
function Revision({
  revision: r,
  seats,
}: {
  revision: NoteRevision;
  seats: PublicSeat[];
}) {
  return (
    <div className="note-revision">
      <small>
        第 {r.day} {r.period === "DAY" ? "天" : "夜"} · 版本 {r.version}
      </small>
      {r.roleId && (
        <p>
          <strong>
            {r.source === "claimed" ? "对方自报" : "我的判断"}：
            {roleName(r.roleId)}
          </strong>
        </p>
      )}
      {claimFields(r.roleId)
        .filter((f) => r.info[f.key])
        .map((f) => (
          <p key={f.key}>
            {f.label}：
            {f.type === "seat"
              ? r.seatNumbers[r.info[f.key]]
                ? `${r.seatNumbers[r.info[f.key]]} 号`
                : (seats.find((s) => s.id === r.info[f.key])?.nickname ??
                  "已离场玩家")
              : f.options?.find((o) => o.value === r.info[f.key])?.label}
          </p>
        ))}
      {r.body && <p className="note-text">{r.body}</p>}
    </div>
  );
}
export default function NotebookPanel({
  room,
  send,
}: {
  room: RoomView;
  send: Send;
}) {
  type Draft = {
    kind: "text" | "claim";
    target: string;
    roleId: string;
    source: "claimed" | "suspected";
    body: string;
    info: Record<string, string>;
    day: number;
    period: "DAY" | "NIGHT";
    manualDate: boolean;
    editing?: { id: string; version: number };
  };
  const empty: Draft = {
    kind: "text",
    target: "",
    roleId: "",
    source: "claimed",
    body: "",
    info: {},
    day: Math.max(1, room.day),
    period: room.phase === "DAY" ? "DAY" : "NIGHT",
    manualDate: false,
  };
  const [draft, setDraft, clearDraft] = useLocalState(
    localKey(room, "notebook-draft"),
    empty,
  );
  const { kind, target, roleId, source, body, info, editing } = draft;
  const dirty = !!(
    body ||
    roleId ||
    target ||
    Object.keys(info).length ||
    editing ||
    draft.manualDate
  );
  const day = dirty ? draft.day : empty.day,
    period = dirty ? draft.period : empty.period;
  const patch = (values: Partial<Draft>) =>
    setDraft((prev) => ({ ...prev, day, period, ...values }));
  const setKind = (kind: Draft["kind"]) => patch({ kind });
  const setTarget = (target: string) => patch({ target });
  const setRole = (roleId: string) => patch({ roleId });
  const setSource = (source: Draft["source"]) => patch({ source });
  const setBody = (body: string) => patch({ body });
  const setInfo = (info: Record<string, string>) => patch({ info });
  const setDay = (day: number) => patch({ day, manualDate: true });
  const setPeriod = (period: Draft["period"]) =>
    patch({ period, manualDate: true });
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  function reset() {
    clearDraft();
    setSaved(false);
  }
  function edit(entry: NotebookEntry) {
    const r = entry.revisions.at(-1)!;
    setDraft({
      kind: entry.kind,
      target: entry.target,
      roleId: r.roleId,
      source: r.source,
      body: r.body,
      info: r.info,
      day: r.day,
      period: r.period,
      manualDate: true,
      editing: { id: entry.id, version: r.version },
    });
    setSaved(false);
    document
      .getElementById("note-editor")
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
  }
  const latestTag = (seatId: string) =>
    room.notebook
      .filter((e) => e.kind === "claim" && e.target === seatId)
      .sort((a, b) =>
        b.revisions.at(-1)!.savedAt.localeCompare(a.revisions.at(-1)!.savedAt),
      )[0];
  return (
    <div className="notebook-page">
      <div className="section-title">
        <div>
          <h2>我的笔记</h2>
          <p>仅自己可见。标注是个人记录，不代表真实身份。</p>
        </div>
      </div>
      <div className="personal-tags">
        {room.seats.map((s) => {
          const entry = latestTag(s.id),
            r = entry?.revisions.at(-1);
          return (
            <button
              key={s.id}
              onClick={() => {
                if (entry) edit(entry);
                else {
                  setDraft({ ...empty, kind: "claim", target: s.id });
                  setSaved(false);
                }
              }}
            >
              <strong>{s.nickname}</strong>
              <small>{r ? roleName(r.roleId) : "标注身份"}</small>
            </button>
          );
        })}
      </div>
      <form
        id="note-editor"
        className="panel note-editor"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          const ok = await send({
            type: "save_notebook",
            entryId: editing?.id,
            expectedVersion: editing?.version ?? 0,
            kind,
            target: kind === "claim" ? target : "",
            roleId: kind === "claim" ? roleId : "",
            source,
            body,
            info: kind === "claim" ? info : {},
            day,
            period,
          });
          setBusy(false);
          if (ok) {
            reset();
            setSaved(true);
          }
        }}
      >
        <div className="panel-heading">
          <h3>{editing ? "修改记录（保留旧版本）" : "新增记录"}</h3>
          <small className="muted">
            草稿在本浏览器保留。
            {editing || dirty
              ? `当前归属：第 ${day} ${period === "DAY" ? "天" : "夜"}，可手动调整。`
              : "新记录日期跟随当前天／夜。"}
          </small>
          {editing && (
            <button type="button" onClick={reset}>
              取消修改
            </button>
          )}
        </div>
        <div className="form-grid">
          <label>
            记录方式
            <select
              aria-label="记录方式"
              disabled={!!editing}
              value={kind}
              onChange={(e) => {
                setKind(e.target.value as typeof kind);
                setInfo({});
              }}
            >
              <option value="text">文字笔记</option>
              <option value="claim">身份与信息</option>
            </select>
          </label>
          <label>
            第几天 / 夜
            <input
              aria-label="记录日期"
              type="number"
              min={1}
              max={Math.max(1, room.day)}
              value={day}
              onChange={(e) => setDay(Number(e.target.value))}
            />
          </label>
          <label>
            时段
            <select
              aria-label="记录时段"
              value={period}
              onChange={(e) => setPeriod(e.target.value as typeof period)}
            >
              <option value="DAY">白天</option>
              <option value="NIGHT">夜晚</option>
            </select>
          </label>
          {kind === "claim" && (
            <>
              <label>
                玩家
                <select
                  aria-label="标注玩家"
                  disabled={!!editing}
                  value={target}
                  onChange={(e) => setTarget(e.target.value)}
                  required
                >
                  <option value="">选择玩家</option>
                  {room.seats.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.nickname}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                依据
                <select
                  aria-label="身份依据"
                  value={source}
                  onChange={(e) => setSource(e.target.value as typeof source)}
                >
                  <option value="claimed">对方自报</option>
                  <option value="suspected">我的判断</option>
                </select>
              </label>
              <label>
                标注身份
                <select
                  aria-label="标注身份"
                  value={roleId}
                  required
                  onChange={(e) => {
                    setRole(e.target.value);
                    setInfo({});
                  }}
                >
                  <option value="">选择身份</option>
                  {ROLES.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
                </select>
              </label>
              {claimFields(roleId).map((f) => (
                <label key={f.key}>
                  {f.label}
                  <select
                    aria-label={f.label}
                    value={info[f.key] ?? ""}
                    onChange={(e) =>
                      setInfo({ ...info, [f.key]: e.target.value })
                    }
                  >
                    <option value="">未记录</option>
                    {f.type === "seat"
                      ? room.seats.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.nickname}
                          </option>
                        ))
                      : f.options?.map((o) => (
                          <option key={o.value} value={o.value}>
                            {o.label}
                          </option>
                        ))}
                  </select>
                </label>
              ))}
            </>
          )}
        </div>
        <label>
          {kind === "text" ? "内容" : "补充说明"}
          <textarea
            aria-label="笔记内容"
            maxLength={4000}
            value={body}
            onChange={(e) => {
              setBody(e.target.value);
              setSaved(false);
            }}
          />
        </label>
        <button
          className="primary"
          disabled={
            busy || (kind === "text" ? !body.trim() : !target || !roleId)
          }
        >
          {editing ? "保存新版本" : "保存记录"}
        </button>
        {saved && <span role="status"> 已保存</span>}
      </form>
      {room.self?.note && (
        <details className="panel">
          <summary>旧版文字笔记</summary>
          <p className="note-text">{room.self.note}</p>
        </details>
      )}
      {[...room.notebook].reverse().map((entry) => (
        <article className="panel note-entry" key={entry.id}>
          <div className="panel-heading">
            <h3>
              {entry.kind === "claim"
                ? `${entry.revisions.at(-1)!.seatNumbers[entry.target]} 号的身份与信息`
                : "文字笔记"}
            </h3>
            <button onClick={() => edit(entry)}>修改</button>
          </div>
          <Revision revision={entry.revisions.at(-1)!} seats={room.seats} />
          {entry.revisions.length > 1 && (
            <details>
              <summary>历史版本（{entry.revisions.length - 1}）</summary>
              {entry.revisions
                .slice(0, -1)
                .reverse()
                .map((r) => (
                  <Revision key={r.version} revision={r} seats={room.seats} />
                ))}
            </details>
          )}
        </article>
      ))}
      {room.pastNotebooks
        .filter((a) => a.entries.length)
        .map((a) => (
          <details className="panel" key={a.gameNo}>
            <summary>第 {a.gameNo} 局笔记（只读）</summary>
            {a.entries.map((e) => (
              <article className="note-entry" key={e.id}>
                <h4>
                  {e.kind === "claim"
                    ? `${e.revisions.at(-1)!.seatNumbers[e.target]} 号`
                    : "文字笔记"}
                </h4>
                {[...e.revisions].reverse().map((r) => (
                  <Revision key={r.version} revision={r} seats={a.seats} />
                ))}
              </article>
            ))}
          </details>
        ))}
    </div>
  );
}
