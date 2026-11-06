import ExecutionHistory from "./ExecutionHistory";
import Picker, { roleOptions, seatOptions } from "../ui/Picker";
import { useState } from "react";
import { isEvil, ROLES, roleName } from "../../shared/roles";
import { completedAction } from "../../shared/assistance";
import type { RoomView } from "../../shared/types";
import type { Send } from "../useRoom";
import ExecutionControl from "./ExecutionControl";

export function PlayerEditor({
  room,
  seatId,
  send,
  close,
}: {
  room: RoomView;
  seatId: string;
  send: Send;
  close: () => void;
}) {
  const st = room.storyteller!;
  const seat = room.seats.find((s) => s.id === seatId)!;
  const [version] = useState(st.contextVersion);
  const [actualRoleId, setActual] = useState(
    st.assignments[seatId].actualRoleId,
  );
  const [perceivedRoleId, setPerceived] = useState(
    st.assignments[seatId].perceivedRoleId,
  );
  const [alive, setAlive] = useState(seat.alive);
  const [conditions, setConditions] = useState(
    st.conditions[seatId] ?? {
      poisoned: false,
      drunk: false,
      protected: false,
      note: "",
    },
  );
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const stale = version !== st.contextVersion;
  return (
    <section className="panel player-editor">
      <div className="panel-heading">
        <h3>管理 {seat.number} 号</h3>
        <button onClick={close}>关闭管理</button>
      </div>
      {stale && (
        <p role="alert" className="notice">
          情况有变化，请关掉重开后再保存。
        </p>
      )}
      <div className="form-grid">
        <Picker
          label="真实身份"
          value={actualRoleId}
          options={roleOptions()}
          onChange={(v) => {
            setActual(v);
            setPerceived(v === "drunk" ? "washerwoman" : v);
          }}
          clearable={false}
        />
        {actualRoleId === "drunk" && (
          <Picker
            label="酒鬼认知身份"
            value={perceivedRoleId}
            options={roleOptions(ROLES.filter((r) => r.team === "townsfolk"))}
            onChange={setPerceived}
            clearable={false}
          />
        )}
        <Picker
          label="生死"
          value={String(alive)}
          options={[
            { value: "true", label: "存活" },
            { value: "false", label: "死亡" },
          ]}
          onChange={(v) => setAlive(v === "true")}
          clearable={false}
        />
      </div>
      <div className="condition-options">
        {(
          [
            ["poisoned", "中毒"],
            ["drunk", "醉酒标记"],
            ["protected", "受保护"],
          ] as const
        ).map(([key, label]) => (
          <label className="check-line" key={key}>
            <input
              type="checkbox"
              checked={conditions[key]}
              onChange={(e) =>
                setConditions({ ...conditions, [key]: e.target.checked })
              }
            />
            {label}
          </label>
        ))}
      </div>
      <p className="muted">
        改为存活会撤销对应的处决死亡。
      </p>
      <label className="field">
        私密状态备注
        <textarea
          aria-label="私密状态备注"
          value={conditions.note}
          maxLength={1000}
          onChange={(e) =>
            setConditions({ ...conditions, note: e.target.value })
          }
        />
      </label>
      <label className="field">
        修改原因（选填）
        <input
          aria-label="状态修改原因"
          maxLength={200}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
      </label>
      <button
        className="primary"
        disabled={busy || stale}
        onClick={async () => {
          setBusy(true);
          if (
            await send({
              type: "update_player",
              seatId,
              actualRoleId,
              perceivedRoleId,
              alive,
              conditions,
              reason,
              expectedContextVersion: version,
            })
          )
            close();
          setBusy(false);
        }}
      >
        保存身份与状态
      </button>
      <ExecutionControl room={room} seatId={seatId} send={send} />
    </section>
  );
}

export default function StorytellerTable({
  room,
  send,
  navigate,
  onSeat,
}: {
  room: RoomView;
  send: Send;
  navigate: (tab: string) => void;
  onSeat?: (seatId: string) => void;
}) {
  const st = room.storyteller!;
  const [selected, setSelected] = useState("");
  const [redHerring, setRedHerring] = useState(st.redHerring ?? "");
  const [redVersion, setRedVersion] = useState(st.contextVersion);
  const active = !["LOBBY", "SETUP", "ENDED"].includes(room.phase);
  const living = room.seats.filter((s) => s.alive).length;
  const pending = room.actions.filter(
    (a) => a.night === room.day && !completedAction(a),
  );
  return (
    <div>
      <div className="section-title">
        <div>
          <h2>总体信息表</h2>
          <p>
            {living} 人存活 · {room.seats.length - living} 人死亡 · 待办{" "}
            {pending.length} 项
          </p>
        </div>
        <button
          onClick={() => navigate(room.phase === "DAY" ? "public" : "night")}
        >
          {room.phase === "DAY" ? "进入公开投票" : "处理夜间待办"}
        </button>
      </div>
      <div className="panel table-scroll">
        <table className="state-table">
          <caption>
            第 {room.day} {room.phase === "DAY" ? "天" : "夜"}
          </caption>
          <thead>
            <tr>
              <th>号码</th>
              <th>真实 / 认知身份</th>
              <th>生死</th>
              <th>死者票</th>
              <th>状态</th>
              <th>本夜待办</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {room.seats.map((s) => {
              const a = st.assignments[s.id];
              const c = st.conditions[s.id];
              const tasks = room.actions.filter(
                (t) => t.seatId === s.id && t.night === room.day,
              );
              const remaining = tasks.filter((t) => !completedAction(t));
              const flags = [
                c?.poisoned && "中毒",
                (c?.drunk || a?.actualRoleId === "drunk") && "醉酒",
                c?.protected && "受保护",
                st.redHerring === s.id && "占卜误判",
              ].filter(Boolean);
              return (
                <tr key={s.id}>
                  <th scope="row">{s.number} 号</th>
                  <td>
                    {roleName(a?.actualRoleId)}
                    {a?.actualRoleId !== a?.perceivedRoleId && (
                      <small>认知：{roleName(a?.perceivedRoleId)}</small>
                    )}
                  </td>
                  <td>
                    {s.alive ? "存活" : "死亡"}
                    {s.alive !== st.publishedAlive[s.id] && (
                      <small className="pending-life">
                        未公布 · 玩家仍见
                        {st.publishedAlive[s.id] ? "存活" : "死亡"}
                      </small>
                    )}
                  </td>
                  <td>
                    {s.alive
                      ? "—"
                      : s.deadVoteAvailable
                        ? "剩余 1 票"
                        : "已用完"}
                  </td>
                  <td>
                    {flags.join(" · ") || "—"}
                    {c?.note && (
                      <details>
                        <summary>备注</summary>
                        <p>{c.note}</p>
                      </details>
                    )}
                  </td>
                  <td>
                    {remaining.length
                      ? `${remaining.length} 项待处理`
                      : tasks.length
                        ? "已处理"
                        : "—"}
                    {tasks.length > 0 && (
                      <details>
                        <summary>展开信息</summary>
                        {tasks.map((t) => (
                          <div className="table-task" key={t.id}>
                            <span>{t.prompt}</span>
                            <small>
                              目标：
                              {t.targets
                                .map(
                                  (id) =>
                                    `${room.seats.find((p) => p.id === id)?.number} 号`,
                                )
                                .join("、") || "无"}
                            </small>
                            <small>反馈：{t.response ?? "未发送"}</small>
                          </div>
                        ))}
                      </details>
                    )}
                  </td>
                  <td>
                    <button
                      disabled={!active || !a}
                      onClick={() => (onSeat ? onSeat(s.id) : setSelected(s.id))}
                    >
                      管理 {s.number} 号
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <ExecutionHistory room={room} send={send} />
      {selected && (
        <div
          className="modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-label="玩家状态管理"
        >
          <PlayerEditor
            key={selected}
            room={room}
            seatId={selected}
            send={send}
            close={() => setSelected("")}
          />
        </div>
      )}
      {active && (
        <details className="panel">
          <summary>占卜误判目标与状态说明</summary>
          <p>
            当前误判目标：
            {st.redHerring
              ? `${room.seats.find((s) => s.id === st.redHerring)?.number} 号`
              : "未设置"}
          </p>
          <Picker
            label="误判目标"
            value={redHerring}
            options={[
              { value: "", label: "未设置" },
              ...seatOptions(room.seats.filter((s) => !isEvil(st.assignments[s.id]?.actualRoleId))),
            ]}
            onChange={(v) => {
              setRedHerring(v);
              setRedVersion(st.contextVersion);
            }}
            clearable={false}
          />
          <button
            onClick={() =>
              void send({
                type: "set_red_herring",
                seatId: redHerring,
                expectedContextVersion: redVersion,
              })
            }
          >
            保存误判目标
          </button>
        </details>
      )}
    </div>
  );
}
