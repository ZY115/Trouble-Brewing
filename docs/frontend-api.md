# 前端接入：夜间反馈、座位笔记、说书人工作台

结束提示、最终裁定和精简复盘见 [结束与复盘接口](endgame-api.md)。

本次仅调整后端及共享接口，保留现有页面。无需数据库迁移；原命令继续可用。
所有新增数据都随现有 Socket.IO `state` 推送，也包含在鉴权后的 `GET /api/rooms/:code/state` 中。
类型见 `shared/workspace.ts`，命令格式见 `shared/commands.ts`。

## 1. 夜间结果立即显示

读取 `room.playerWorkspace.results`：只包含当前玩家已正式送达的裁定，**包括当前夜晚**。
每项提供 `actionId / night / prompt / targets / response / version / sentAt / history`。
`response` 是最新裁定，`history` 保留旧版。以 `actionId + version` 判断新结果或更正，不能只按条数判断。
旧存档的 `sentAt` 可能缺失。重连会返回本局全部已送达结果；新一局清空。

后端原来就即时推送 `DELIVERED` 行动；实际延迟来自 `src/player/visibility.ts` 的 `revealedActions()`：

```ts
// 当前过滤条件应去掉；也可直接改用 playerWorkspace.results。
!(isNight(room) && a.night === room.day);
```

前端仍需修改：

- `src/player/InformationHistory.tsx`：夜间结果的入口、展示及“天亮后查看”文案。
- `src/player/PlayerNight.tsx`、`src/player/PlayerApp.tsx`：提交后的提示。
- `src/storyteller/NightStage.tsx` 及其他出现“天亮后查看裁定”的文案。
- `tests/player-visibility.test.ts`：目前验证的是旧前端行为，接入时同步更新。

说书人仍用 `send_action_response`（推荐）、`apply_action` 或 `review_action` 后 `deliver_action`。
仅审核、不发送的草稿不会出现在玩家接口中。发送时带 `expectedVersion`（玩家选择版本）和 `expectedContextVersion`（说书人看到的真实状态版本），避免按过时目标或状态裁定。
更正用 `correct_action_response`，带 `expectedResponseVersion` 和 `expectedContextVersion`。
这些私密结果与生死公布互相独立：夜间死亡仍由说书人决定何时公布，天亮默认统一公布。

## 2. 圆桌和笔记使用同一份座位数据

读取 `room.playerWorkspace.notebook`：

| 字段          | 用法                                                                                              |
| ------------- | ------------------------------------------------------------------------------------------------- |
| `seats`       | 按号码排序；每项包含公开 `seat`、该座位的 `notes`、最新 `claimed` 自报身份和 `suspected` 个人判断 |
| `general`     | 未关联座位的文字笔记                                                                              |
| `archived`    | 已移除但可恢复的笔记                                                                              |
| `defaultDate` | 新建笔记默认的第几天/夜                                                                           |

圆桌选人和笔记详情都用稳定的 `seat.id`，不要以可变的号码当主键。
`notes` 最新保存的排在前面；每项包含 `entryId / kind / target / latest`。
`latest` 是当前版本；完整历史继续从 `room.notebook` 按 `entryId` 取 `revisions`。
历史日期用各版本的 `day / period`，历史号码用该版本的 `seatNumbers`，不要用当前号码替换旧记录。
身份标注只来自本人笔记，后端不会自动填真实身份，也不会读取其他玩家的笔记。

新增简短命令示例（仍装入现有 `command` 信封）：

```ts
// 选中座位后记一句话；不传 target 就是普通笔记。
{ type: "add_note", target: seatId, body: "他说第二天再解释" }

// 记录他自报共情者；只标注身份时可省略 info。
{ type: "add_note", target: seatId, roleId: "empath",
  source: "claimed", info: { number: "1" } }

// 我的判断。source 默认 suspected；body、info 可省略。
{ type: "add_note", target: seatId, roleId: "poisoner" }

// 修改已有判断，保留旧版；改身份而不传 info 会清空新版信息表。
{ type: "edit_notebook", entryId, expectedVersion: latest.version,
  patch: { roleId: "fortuneteller" } }

// 补充信息。info 整体替换，允许 {} 清空；字段定义沿用 shared/claims.ts。
{ type: "edit_notebook", entryId, expectedVersion: latest.version,
  patch: { info: { a: seatA, b: seatB, result: "否" } } }

// 移除标注但保留历史；恢复时改为 false。
{ type: "edit_notebook", entryId, expectedVersion: latest.version,
  patch: { archived: true } }
```

新建可选传 `day / period`，默认当前日期；编辑默认保留原记录日期，也可明确修改。
文字笔记必须有正文；身份笔记必须有目标和有效角色。不能通过编辑更换笔记对象或类型；请另建一条。
`claimed` 和 `suspected` 分别取当前未归档记录中最新的一条，不表示玩家真实身份。
归档最新记录后，如果还有更早的未归档记录，会显示更早的标注；若要清空某类标注，需归档该座位该类的所有记录。

`expectedVersion` 必须来自开始编辑时的版本，不能发送前用最新状态悄悄替换。
冲突时服务端拒绝覆盖：保留输入草稿，让玩家查看最新记录后再保存。
每次独立操作用新 `commandId`；网络重试同一操作复用原 `commandId`，并始终携带 `gameNo`。

等待入座时不返回 `playerWorkspace`，也禁止上述笔记命令。结束后可补记；续局清空当前笔记。玩家接口的 `pastNotebooks / pastPublicRecords / pastRecaps` 始终为空，不能把上一局内容带回玩家页面；同一局内的笔记修改历史仍保留。
保存笔记只向本人的连接推送，不向说书人或其他玩家发送笔记活动通知；不记电子笔记不会影响游戏推进。

## 3. 说书人集中工作台

读取 `room.storyteller.workbench`，仅说书人有此字段：

| 字段                 | 用法                                                                                                                       |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `nightQueue`         | 本夜清单按实际调整后的夜序排列；清单外手动行动附后；同一行动只计一次                                                       |
| `counts`             | `unstarted` 未开始、`manual` 说书人手动检查、`waiting` 等玩家选择、`ruling` 等说书人裁定、`completed` 已发送/取消/线下完成 |
| `nextRulingActionId` | 夜序中首个可裁定行动，仅建议，不自动执行                                                                                   |
| `seats`              | 按编号排序，关联该玩家本夜的 `actionIds` 和与说书人的全部 `messageIds`，附待裁定/待选择数量                                |
| `attention`          | 规则提醒 ID、首夜邪恶信息是否未发、过期状态数、尚未公开的死亡/复活座位、正在进行的投票 ID                                  |
| `phaseTransition`    | 当前阶段转换的核对内容、阻挡状态和版本；仅夜晚/白天提供                                                                    |

用 `actionIds` 从 `room.actions` 取完整行动、目标和 `reference`，用 `messageIds` 从 `room.messages` 取私聊；不含玩家之间的私聊或任何玩家笔记。
`reference.actual / evidence / warnings / suggestedResponse / impaired` 仍用于先展示真实情况，再由说书人自由裁定。不得把这些参考字段发送给玩家。
`APPROVED` 尚未发送，仍属于 `ruling`。取消和线下完成也计入 `completed`，显示具体完成方式时查看原行动 `status`。
进入白天后 `nightQueue` 为空、各项计数归零，座位卡仍可查看刚过去那夜的行动及私聊。

阶段确认弹窗用 `phaseTransition.publish`（天亮公布生死）或 `hold`（暂不公布）的 `lines / blocked / key`。
确认后发送：

```ts
{ type: "next_phase", publishLifeOnDawn: true,
  expectedPhaseVersion: workbench.phaseTransition.expectedPhaseVersion,
  expectedReviewKey: workbench.phaseTransition.publish.key }
```

暂不公布时必须同时改用 `publishLifeOnDawn: false` 和 `hold.key`。
提交的是用户在确认框里实际看到的快照；若期间状态变化，服务端拒绝旧确认，前端重新展示最新核对内容。
工作台只提供整理后的状态和建议，不额外强制流程、不自动裁定、不代替说书人结束游戏。
