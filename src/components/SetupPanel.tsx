import { useState } from "react";
import { Check, Shuffle, AlertCircle, Save } from "lucide-react";
import presets from "../../shared/presets.json";
import { ROLES, TEAM_NAMES, roleName } from "../../shared/roles";
import {
  randomSetup,
  defaultBluffs,
  expectedCounts,
  TEAMS,
  validateSetup,
  type Setup,
} from "../../shared/setup";
import type { RoomView } from "../../shared/types";
import type { Send } from "../useRoom";
export default function SetupPanel({
  room,
  send,
  showQr,
}: {
  room: RoomView;
  send: Send;
  showQr: () => void;
}) {
  const [draft, setDraft] = useState<Setup>(() =>
    structuredClone(room.storyteller!.setup),
  );
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const locked =
    room.registration.open || !["LOBBY", "SETUP"].includes(room.phase);
  const issues = validateSetup(room.capacity, draft);
  const expected = expectedCounts(
    room.capacity,
    draft.roleIds.includes("baron"),
  );
  const change = (next: Setup) => {
    setDraft(next);
    setSaved(false);
  };
  function toggle(id: string) {
    const roleIds = draft.roleIds.includes(id)
      ? draft.roleIds.filter((r) => r !== id)
      : [...draft.roleIds, id];
    const drunkAs = roleIds.includes("drunk")
      ? draft.drunkAs && !roleIds.includes(draft.drunkAs)
        ? draft.drunkAs
        : (ROLES.find((r) => r.team === "townsfolk" && !roleIds.includes(r.id))
            ?.id ?? "")
      : "";
    change({
      ...draft,
      roleIds,
      drunkAs,
      bluffs: defaultBluffs(roleIds, drunkAs),
    });
  }
  return (
    <div className="setup-page">
      <div className="section-title">
        <div>
          <h2>配板</h2>
          <p>选择预设或手动修改角色。</p>
        </div>
        <span className="tag">{room.capacity} 人剧本</span>
      </div>
      <button
        className="scan-button"
        disabled={busy || locked}
        onClick={async () => {
          setBusy(true);
          if (await send({ type: "save_setup", setup: draft })) {
            setSaved(true);
            showQr();
          }
          setBusy(false);
        }}
      >
        保存配板并展示二维码
      </button>
      <button
        disabled={locked || busy}
        onClick={() => {
          let next = randomSetup(room.capacity);
          for (
            let i = 0;
            i < 100 &&
            [...next.roleIds].sort().join(",") ===
              [...draft.roleIds].sort().join(",");
            i++
          )
            next = randomSetup(room.capacity);
          change(next);
        }}
      >
        随机生成新配板
      </button>
      <p className="muted">
        按人数与男爵规则生成合法组合，酒鬼认知和假身份一并配置；可自行调整，不代表平衡保证。
      </p>
      <details>
        <summary>预设配板（每人数 12 套）</summary>
        <div className="preset-grid">
          {presets
            .filter((p) => p.count === room.capacity)
            .map((preset, i) => (
              <button
                disabled={locked}
                key={preset.id}
                className={`preset ${JSON.stringify(draft.roleIds) === JSON.stringify(preset.setup.roleIds) ? "selected" : ""}`}
                onClick={() => change(structuredClone(preset.setup))}
              >
                <span className="eyebrow">方案 0{i + 1}</span>
                <strong>{preset.name}</strong>
                <p>{preset.description}</p>
                <span>
                  <Shuffle size={13} /> 使用这组角色
                </span>
              </button>
            ))}
        </div>
      </details>
      <div className="panel role-picker">
        <div className="panel-heading">
          <h3>自定义配板</h3>
          <span>
            {draft.roleIds.length} / {room.capacity} 已选择
          </span>
        </div>
        {TEAMS.map((team, i) => (
          <div className={`role-group ${team}`} key={team}>
            <div className="role-group-heading">
              <strong>{TEAM_NAMES[team]}</strong>
              <small>
                已选{" "}
                {
                  draft.roleIds.filter(
                    (id) => ROLES.find((r) => r.id === id)?.team === team,
                  ).length
                }{" "}
                · 标准 {expected[i]}
              </small>
            </div>
            <div className="role-grid">
              {ROLES.filter((r) => r.team === team).map((r) => (
                <button
                  disabled={locked}
                  aria-pressed={draft.roleIds.includes(r.id)}
                  className={`role-choice ${draft.roleIds.includes(r.id) ? "chosen" : ""}`}
                  key={r.id}
                  onClick={() => toggle(r.id)}
                >
                  <span className="role-symbol">{r.name.slice(0, 1)}</span>
                  <span>
                    <strong>{r.name}</strong>
                    <small>{r.hint}</small>
                  </span>
                  {draft.roleIds.includes(r.id) && <Check size={15} />}
                </button>
              ))}
            </div>
          </div>
        ))}
        {draft.roleIds.includes("drunk") && (
          <label className="field">
            酒鬼看到的镇民身份
            <select
              disabled={locked}
              value={draft.drunkAs}
              onChange={(e) =>
                change({
                  ...draft,
                  drunkAs: e.target.value,
                  bluffs: defaultBluffs(draft.roleIds, e.target.value),
                })
              }
            >
              {ROLES.filter(
                (r) => r.team === "townsfolk" && !draft.roleIds.includes(r.id),
              ).map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <div className="bluffs">
          <h4>恶魔的三个假身份</h4>
          <p>仅在说书人确认首夜信息发放后，对小恶魔显示。</p>
          <div className="bluff-selects">
            {[0, 1, 2].map((index) => (
              <select
                key={index}
                aria-label={`恶魔假身份${index + 1}`}
                disabled={locked}
                value={draft.bluffs[index] ?? ""}
                onChange={(e) => {
                  const bluffs = [...draft.bluffs];
                  bluffs[index] = e.target.value;
                  change({ ...draft, bluffs });
                }}
              >
                <option value="">请选择</option>
                {ROLES.filter(
                  (r) =>
                    ["townsfolk", "outsider"].includes(r.team) &&
                    !draft.roleIds.includes(r.id) &&
                    draft.drunkAs !== r.id,
                ).map((r) => (
                  <option key={r.id} value={r.id}>
                    {roleName(r.id)}
                  </option>
                ))}
              </select>
            ))}
          </div>
        </div>
        <div className={`validation ${issues.length ? "has-issues" : ""}`}>
          <AlertCircle size={18} />
          <div>
            {issues.length ? (
              issues.map((issue, index) => (
                <p key={index}>
                  {issue.level === "error" ? "配置提醒" : "体验建议"}：
                  {issue.message}
                </p>
              ))
            ) : (
              <p>人数与身份配置符合标准规则。预设不代表胜率保证。</p>
            )}
          </div>
        </div>
        <label className="field">
          房规说明（采用非标准阵营配置时填写）
          <textarea
            disabled={locked}
            value={draft.overrideReason}
            onChange={(e) =>
              change({ ...draft, overrideReason: e.target.value })
            }
            placeholder="说明这次修改的原因；会保留在说书人事件记录中。"
          />
        </label>
        <div className="form-footer">
          <span>
            {locked
              ? "入场已开放或身份已发放；配板已锁定"
              : saved
                ? "✓ 配板已保存"
                : "保存后在房间总览开放入场"}
          </span>
          <button
            className="primary"
            disabled={locked || busy}
            onClick={async () => {
              setBusy(true);
              setSaved(await send({ type: "save_setup", setup: draft }));
              setBusy(false);
            }}
          >
            <Save size={16} />
            保存配板
          </button>
        </div>
      </div>
    </div>
  );
}
