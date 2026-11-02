import { CHOICE_KINDS } from "./action-choice";
import { z } from "zod";
const id = z.string().min(1).max(100);
const setup = z
  .object({
    roleIds: z.array(id).max(22),
    drunkAs: z.string().max(50),
    bluffs: z.array(id).max(3),
    overrideReason: z.string().max(500),
  })
  .strict();
export const commandSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("apply_action"),
      actionId: id,
      effect: z.enum(["poison", "protect", "kill", "none"]),
      response: z.string().trim().min(1).max(2000).default("已收到"),
      force: z.boolean().default(false),
      expectedVersion: z.number().int().min(0),
      expectedContextVersion: z.number().int().min(0),
    })
    .strict(),
  z
    .object({
      type: z.literal("set_condition"),
      seatId: id,
      condition: z.enum(["poisoned", "protected", "drunk"]),
      value: z.boolean(),
      expectedContextVersion: z.number().int().min(0),
    })
    .strict(),
  z
    .object({
      type: z.enum([
        "clear_expired_conditions",
        "keep_expired_conditions",
        "send_evil_info",
      ]),
      expectedContextVersion: z.number().int().min(0),
    })
    .strict(),
  z
    .object({
      type: z.literal("resolve_notice"),
      noticeId: id,
      expectedContextVersion: z.number().int().min(0),
    })
    .strict(),
  z
    .object({
      type: z.literal("confirm_self_kill"),
      deathId: id,
      confirmed: z.literal(true),
      expectedContextVersion: z.number().int().min(0),
    })
    .strict(),
  z
    .object({
      type: z.literal("promote_imp"),
      deathId: id,
      seatId: id,
      confirmed: z.literal(true),
      expectedContextVersion: z.number().int().min(0),
    })
    .strict(),
  z
    .object({
      type: z.literal("start_all_plan"),
      expectedPhaseVersion: z.number().int().min(0),
      expectedPlanVersion: z.number().int().min(0),
    })
    .strict(),
  z
    .object({
      type: z.literal("publish_life"),
      seatIds: z.array(id).min(1).max(13),
      expectedContextVersion: z.number().int().min(0),
    })
    .strict(),
  z
    .object({
      type: z.literal("correct_phase"),
      phase: z.enum(["FIRST_NIGHT", "OTHER_NIGHT", "DAY"]),
      day: z.number().int().min(1).max(999),
      reason: z.string().trim().min(1).max(200),
      expectedPhaseVersion: z.number().int().min(0),
    })
    .strict(),
  z
    .object({
      type: z.literal("correct_execution"),
      executionId: id,
      died: z.boolean(),
      voided: z.boolean(),
      alive: z.boolean(),
      reason: z.string().trim().min(1).max(200),
      expectedContextVersion: z.number().int().min(0),
    })
    .strict(),
  z
    .object({
      type: z.literal("correct_action_response"),
      actionId: id,
      response: z.string().trim().min(1).max(2000),
      reason: z.string().trim().min(1).max(200),
      expectedResponseVersion: z.number().int().min(1),
      expectedContextVersion: z.number().int().min(0),
    })
    .strict(),
  z
    .object({
      type: z.literal("generate_night_plan"),
      expectedPhaseVersion: z.number().int().min(0),
      expectedPlanVersion: z.number().int().min(0),
    })
    .strict(),
  z
    .object({
      type: z.literal("save_plan_item"),
      itemId: id.optional(),
      seatId: z.string().max(100),
      roleId: z.string().max(50),
      prompt: z.string().trim().min(1).max(500),
      targetCount: z.number().int().min(0).max(2),
      note: z.string().max(500),
      expectedPhaseVersion: z.number().int().min(0),
      expectedPlanVersion: z.number().int().min(0),
    })
    .strict(),
  z
    .object({
      type: z.literal("plan_item"),
      itemId: id,
      operation: z.enum([
        "start",
        "skip",
        "offline",
        "delete",
        "up",
        "down",
        "restore",
      ]),
      expectedPhaseVersion: z.number().int().min(0),
      expectedPlanVersion: z.number().int().min(0),
    })
    .strict(),

  z
    .object({
      type: z.literal("update_player"),
      seatId: id,
      actualRoleId: id,
      perceivedRoleId: id,
      alive: z.boolean(),
      conditions: z
        .object({
          poisoned: z.boolean(),
          drunk: z.boolean(),
          protected: z.boolean(),
          note: z.string().max(1000),
        })
        .strict(),
      reason: z.string().trim().max(200).default(""),
      expectedContextVersion: z.number().int().min(0),
    })
    .strict(),
  z
    .object({
      type: z.literal("set_red_herring"),
      seatId: z.string().max(100),
      expectedContextVersion: z.number().int().min(0),
    })
    .strict(),
  z
    .object({
      type: z.literal("execute_player"),
      seatId: id,
      reason: z.string().trim().min(1).max(200),
      confirmed: z.literal(true),
      died: z.boolean().optional(),
      expectedContextVersion: z.number().int().min(0),
    })
    .strict(),
  z
    .object({
      type: z.literal("force_nomination"),
      voteId: id,
      reason: z.string().trim().min(1).max(200),
    })
    .strict(),
  z
    .object({
      type: z.literal("day_timer"),
      operation: z.enum(["start", "pause", "resume", "clear"]),
      expectedTimerId: z.string().nullable().optional(),
      expectedPhaseVersion: z.number().int().min(0).optional(),
      seconds: z.number().int().min(1).max(10800).optional(),
    })
    .strict(),
  z
    .object({ type: z.literal("open_vote"), nominator: id, nominee: id })
    .strict(),
  z
    .object({ type: z.literal("raise_hand"), voteId: id, raised: z.boolean() })
    .strict(),
  z.object({ type: z.literal("start_count"), voteId: id }).strict(),
  z
    .object({
      type: z.literal("count_vote"),
      voteId: id,
      cursor: z.number().int().min(0),
      offlineVote: z.boolean().optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal("cancel_vote"),
      voteId: id,
      reason: z.string().trim().min(1).max(200),
    })
    .strict(),
  z
    .object({
      type: z.literal("set_dead_vote"),
      seatId: id,
      available: z.boolean(),
      reason: z.string().trim().min(1).max(200),
    })
    .strict(),
  z
    .object({
      type: z.literal("resolve_action"),
      actionId: id,
      resolution: z.enum(["CANCELLED", "OFFLINE"]),
      reason: z.string().trim().min(1).max(200),
    })
    .strict(),
  z
    .object({
      type: z.literal("send_action_response"),
      expectedContextVersion: z.number().int().min(0).optional(),
      actionId: id,
      response: z.string().trim().min(1).max(2000),
      expectedVersion: z.number().int().min(0),
    })
    .strict(),
  z.object({ type: z.literal("new_round") }).strict(),
  z
    .object({
      type: z.literal("create_group"),
      name: z.string().trim().min(1).max(30),
      invitees: z.array(id).min(1).max(12),
    })
    .strict(),
  z
    .object({ type: z.literal("invite_group"), groupId: id, seatId: id })
    .strict(),
  z
    .object({
      type: z.literal("respond_invite"),
      invitationId: id,
      accept: z.boolean(),
    })
    .strict(),
  z.object({ type: z.literal("leave_group"), groupId: id }).strict(),
  z
    .object({
      type: z.literal("request_seat"),
      number: z.number().int().min(1).max(13),
    })
    .strict(),
  z.object({ type: z.literal("cancel_seat_request"), requestId: id }).strict(),
  z
    .object({
      type: z.literal("resolve_seat_request"),
      requestId: id,
      accept: z.boolean(),
    })
    .strict(),
  z
    .object({
      type: z.literal("record_vote"),
      nominator: id,
      nominee: id,
      voters: z.array(id).max(13),
      supersedes: id.optional(),
      reason: z.string().trim().max(200),
    })
    .strict(),
  z
    .object({
      type: z.literal("save_notebook"),
      entryId: id.optional(),
      expectedVersion: z.number().int().min(0),
      kind: z.enum(["text", "claim"]),
      target: z.string().max(100),
      day: z.number().int().min(1),
      period: z.enum(["DAY", "NIGHT"]),
      roleId: z.string().max(50),
      source: z.enum(["claimed", "suspected"]),
      body: z.string().trim().max(4000),
      info: z.record(z.string().max(50), z.string().max(200)),
    })
    .strict(),
  z.object({ type: z.literal("save_setup"), setup }).strict(),
  z.object({ type: z.literal("open_registration") }).strict(),
  z.object({ type: z.literal("close_registration") }).strict(),
  z.object({ type: z.literal("remove_player"), seatId: id }).strict(),
  z
    .object({
      type: z.literal("next_phase"),
      expectedReviewKey: z.string().max(12000).optional(),
      publishLifeOnDawn: z.boolean().optional(),
      expectedPhaseVersion: z.number().int().min(0).optional(),
    })
    .strict(),
  z.object({ type: z.literal("end") }).strict(),
  z
    .object({ type: z.literal("set_alive"), seatId: id, alive: z.boolean() })
    .strict(),
  z
    .object({
      type: z.literal("evil_channel"),
      enabled: z.boolean(),
      confirm: z.boolean(),
    })
    .strict(),
  z
    .object({
      type: z.literal("send_message"),
      to: id,
      content: z.string().trim().min(1).max(2000),
    })
    .strict(),
  z
    .object({ type: z.literal("save_note"), note: z.string().max(10000) })
    .strict(),
  z
    .object({
      type: z.literal("move_seat"),
      number: z.number().int().min(1).max(13),
    })
    .strict(),
  z
    .object({
      type: z.literal("request_action"),
      choiceKind: z.enum(CHOICE_KINDS).optional(),
      expectedPhaseVersion: z.number().int().min(0).optional(),
      referenceRoleId: z.string().max(50).optional(),
      seatId: id,
      prompt: z.string().trim().min(1).max(500),
      targetCount: z.number().int().min(0).max(2),
    })
    .strict(),
  z
    .object({
      type: z.literal("submit_action"),
      expectedVersion: z.number().int().min(0).optional(),
      actionId: id,
      targets: z.array(id).max(2),
    })
    .strict(),
  z
    .object({
      type: z.literal("review_action"),
      actionId: id,
      response: z.string().trim().min(1).max(2000),
    })
    .strict(),
  z.object({ type: z.literal("deliver_action"), actionId: id }).strict(),
]);
export type Command = z.infer<typeof commandSchema>;
export const envelopeSchema = z
  .object({
    commandId: z.string().uuid(),
    gameNo: z.number().int().min(1),
    command: commandSchema,
  })
  .strict();
