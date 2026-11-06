import { useState } from "react";
import Picker, { roleOptions } from "../ui/Picker";
import { Check, Shuffle, AlertCircle, Save } from "lucide-react";
import presets from "../../shared/presets.json";
import { ROLES, TEAM_NAMES } from "../../shared/roles";
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
  onSaved,
}: {
  room: RoomView;
  send: Send;
  onSaved?: () => void;
}) {
  const [draft, setDraft] = useState<Setup>(() =>
    structuredClone(room.storyteller!.setup),
  );
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const locked =
    room.registration.open || !["LOBBY", "SETUP"].includes(room.phase);
  const issues = validateSetup(room.capacity, draft);
  const dirty = JSON.stringify(draft) !== JSON.stringify(room.storyteller!.setup);
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
          <Picker
            label="酒鬼看到的镇民身份"
            disabled={locked}
            value={draft.drunkAs}
            options={roleOptions(ROLES.filter((r) => r.team === "townsfolk" && !draft.roleIds.includes(r.id)))}
            onChange={(v) =>
              change({
                ...draft,
                drunkAs: v,
                bluffs: defaultBluffs(draft.roleIds, v),
              })
            }
            clearable={false}
          />
        )}
        <div className="bluffs">
          <h4>恶魔的三个假身份</h4>
          <div className="bluff-selects">
            {[0, 1, 2].map((index) => (
              <Picker
                key={index}
                label={`假身份 ${index + 1}`}
                disabled={locked}
                value={draft.bluffs[index] ?? ""}
                options={roleOptions(
                  ROLES.filter(
                    (r) =>
                      ["townsfolk", "outsider"].includes(r.team) &&
                      !draft.roleIds.includes(r.id) &&
                      draft.drunkAs !== r.id,
                  ),
                )}
                onChange={(v) => {
                  const bluffs = [...draft.bluffs];
                  bluffs[index] = v;
                  change({ ...draft, bluffs });
                }}
                placeholder="请选择"
              />
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
              <p>人数与身份配置符合标准规则。</p>
            )}
          </div>
        </div>
        {(issues.some((i) => i.level === "error") || !!draft.overrideReason) && (
        <label className="field">
          房规说明（非标准配置需要填写）
          <textarea
            disabled={locked}
            value={draft.overrideReason}
            onChange={(e) =>
              change({ ...draft, overrideReason: e.target.value })
            }
            placeholder="写下修改原因。"
          />
        </label>
        )}
        <div className={`form-footer setup-footer${dirty ? " dirty" : ""}`}>
          <span>
            {locked
              ? "已开放入场或已发身份，配板不能再改"
              : saved
                ? "✓ 配板已保存"
                : dirty
                  ? "有改动还没保存"
                  : "当前就是已保存的配板"}
          </span>
          <button
            className="primary"
            disabled={locked || busy}
            onClick={async () => {
              setBusy(true);
              const ok = await send({ type: "save_setup", setup: draft });
              setSaved(ok);
              setBusy(false);
              if (ok) onSaved?.();
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
