import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  MessageFlags,
  PermissionFlagsBits,
  SeparatorBuilder,
  SeparatorSpacingSize,
  TextDisplayBuilder,
  type ButtonInteraction,
  type GuildMember,
  type MessageCreateOptions,
} from "discord.js";
import { database } from "./database.js";
import { audit } from "./logging.js";
import { v2Flags, v2Message } from "./ui.js";

export const STAFF_ROLE_ID = "1445540284405645453";
export const INTERNAL_AFFAIRS_ROLE_ID = "1445540175341158611";
export const ON_SHIFT_ROLE_ID = "1483518371227238564";
export const SHIFT_WEEK_TIME_ZONE = "America/Los_Angeles";

export interface StaffShift {
  id: number;
  member_id: string;
  clocked_in_at: string;
  clocked_out_at: string | null;
  ended_by: string | null;
  end_reason: string | null;
}

export interface ShiftSummary {
  totalMilliseconds: number;
  activeShift: StaffShift | undefined;
  recentShifts: StaffShift[];
}

export class ShiftAdjustmentError extends Error {}

function parseStaffShift(value: unknown): StaffShift {
  if (!value || typeof value !== "object") {
    throw new Error("The shift database returned an invalid row.");
  }
  const row = value as Record<string, unknown>;
  if (
    typeof row.id !== "number"
    || typeof row.member_id !== "string"
    || typeof row.clocked_in_at !== "string"
    || (row.clocked_out_at !== null && typeof row.clocked_out_at !== "string")
    || (row.ended_by !== null && typeof row.ended_by !== "string")
    || (row.end_reason !== null && typeof row.end_reason !== "string")
  ) {
    throw new Error("The shift database returned a row with invalid fields.");
  }
  return {
    id: row.id,
    member_id: row.member_id,
    clocked_in_at: row.clocked_in_at,
    clocked_out_at: row.clocked_out_at,
    ended_by: row.ended_by,
    end_reason: row.end_reason,
  };
}

export function shiftDurationMilliseconds(shift: StaffShift, now: Date): number {
  const startedAt = Date.parse(shift.clocked_in_at);
  const endedAt = shift.clocked_out_at ? Date.parse(shift.clocked_out_at) : now.getTime();
  if (!Number.isFinite(startedAt) || !Number.isFinite(endedAt)) {
    throw new Error(`Shift ${shift.id} contains an invalid timestamp.`);
  }
  return Math.max(0, endedAt - startedAt);
}

export function formatShiftDuration(milliseconds: number): string {
  const totalMinutes = Math.floor(Math.max(0, milliseconds) / 60_000);
  const days = Math.floor(totalMinutes / 1_440);
  const hours = Math.floor((totalMinutes % 1_440) / 60);
  const minutes = totalMinutes % 60;
  if (days > 0) return `${days}d ${hours}h ${minutes}m`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m`;
  return `${Math.floor(Math.max(0, milliseconds) / 1_000)}s`;
}

export function getActiveShift(memberId: string): StaffShift | undefined {
  const shift = database.prepare(`
    SELECT * FROM staff_shifts
    WHERE member_id = ? AND clocked_out_at IS NULL
  `).get(memberId);
  return shift === undefined ? undefined : parseStaffShift(shift);
}

export function clockIn(memberId: string, now = new Date()): boolean {
  if (getActiveShift(memberId)) return false;
  try {
    database.prepare(`
      INSERT INTO staff_shifts (member_id, clocked_in_at)
      VALUES (?, ?)
    `).run(memberId, now.toISOString());
    return true;
  } catch (error) {
    if (getActiveShift(memberId)) return false;
    throw error;
  }
}

async function setOnShiftRole(member: GuildMember, onShift: boolean, reason: string): Promise<boolean> {
  const role = await member.guild.roles.fetch(ON_SHIFT_ROLE_ID);
  if (!role) {
    throw new Error(`On-shift role ${ON_SHIFT_ROLE_ID} was not found.`);
  }
  const hasRole = member.roles.cache.has(role.id);
  if (hasRole === onShift) return false;

  const botMember = await member.guild.members.fetchMe();
  if (!botMember.permissions.has(PermissionFlagsBits.ManageRoles) || !role.editable) {
    throw new Error("The bot needs Manage Roles, and the on-shift role must be below its highest role.");
  }
  if (onShift) {
    await member.roles.add(role, reason);
  } else {
    await member.roles.remove(role, reason);
  }
  return true;
}

export async function clockMemberIn(member: GuildMember, now = new Date()): Promise<boolean> {
  if (getActiveShift(member.id)) {
    await setOnShiftRole(member, true, "Synchronize the role for an active California State Roleplay shift.");
    return false;
  }

  const roleAdded = await setOnShiftRole(member, true, "Staff member clocked in for a California State Roleplay shift.");
  try {
    const started = clockIn(member.id, now);
    if (!started && roleAdded && !getActiveShift(member.id)) {
      await setOnShiftRole(member, false, "Clock-in could not be recorded.");
    }
    return started;
  } catch (error) {
    if (roleAdded) {
      try {
        await setOnShiftRole(member, false, "Clock-in could not be recorded.");
      } catch (restoreError) {
        console.error(`Could not remove on-shift role from ${member.id} after a failed clock-in:`, restoreError);
      }
    }
    throw error;
  }
}

export function clockOut(
  memberId: string,
  endedBy: string,
  reason?: string,
  now = new Date(),
): StaffShift | undefined {
  const activeShift = getActiveShift(memberId);
  if (!activeShift) return undefined;
  const result = database.prepare(`
    UPDATE staff_shifts
    SET clocked_out_at = ?, ended_by = ?, end_reason = ?
    WHERE id = ? AND clocked_out_at IS NULL
  `).run(now.toISOString(), endedBy, reason ?? null, activeShift.id);
  if (Number(result.changes) !== 1) return undefined;
  return parseStaffShift(database.prepare("SELECT * FROM staff_shifts WHERE id = ?").get(activeShift.id));
}

export function removeShiftTime(memberId: string, shiftId: number, minutes: number): StaffShift | undefined {
  if (!Number.isInteger(minutes) || minutes < 1) {
    throw new ShiftAdjustmentError("Enter a number of minutes greater than zero.");
  }
  const record = database.prepare(`
    SELECT * FROM staff_shifts
    WHERE id = ? AND member_id = ?
  `).get(shiftId, memberId);
  if (record === undefined) return undefined;

  const shift = parseStaffShift(record);
  if (!shift.clocked_out_at) {
    throw new ShiftAdjustmentError("Force-clock out the active shift before removing time from it.");
  }
  const startedAt = Date.parse(shift.clocked_in_at);
  const endedAt = Date.parse(shift.clocked_out_at);
  if (!Number.isFinite(startedAt) || !Number.isFinite(endedAt)) {
    throw new Error(`Shift ${shift.id} contains an invalid timestamp.`);
  }
  const deduction = minutes * 60_000;
  if (endedAt - startedAt < deduction) {
    throw new ShiftAdjustmentError(`Only ${formatShiftDuration(endedAt - startedAt)} is recorded on shift #${shift.id}.`);
  }

  const adjustedEnd = new Date(endedAt - deduction).toISOString();
  const result = database.prepare(`
    UPDATE staff_shifts
    SET clocked_out_at = ?
    WHERE id = ? AND member_id = ? AND clocked_out_at = ?
  `).run(adjustedEnd, shiftId, memberId, shift.clocked_out_at);
  if (Number(result.changes) !== 1) {
    throw new Error(`Shift #${shiftId} changed while its time was being adjusted.`);
  }
  const updated = database.prepare(`
    SELECT * FROM staff_shifts
    WHERE id = ? AND member_id = ?
  `).get(shiftId, memberId);
  if (updated === undefined) {
    throw new Error(`Adjusted shift #${shiftId} could not be reloaded.`);
  }
  return parseStaffShift(updated);
}

export async function clockMemberOut(
  member: GuildMember,
  endedBy: string,
  reason?: string,
  now = new Date(),
): Promise<StaffShift | undefined> {
  if (!getActiveShift(member.id)) return undefined;
  const roleRemoved = await setOnShiftRole(member, false, reason ?? "Staff member clocked out.");
  try {
    const ended = clockOut(member.id, endedBy, reason, now);
    if (!ended && roleRemoved && getActiveShift(member.id)) {
      await setOnShiftRole(member, true, "Restore the on-shift role because the clock-out was not recorded.");
    }
    return ended;
  } catch (error) {
    if (roleRemoved) {
      try {
        await setOnShiftRole(member, true, "Restore the on-shift role because the clock-out failed.");
      } catch (restoreError) {
        console.error(`Could not restore the on-shift role for ${member.id} after a failed clock-out:`, restoreError);
      }
    }
    throw error;
  }
}

export function getMemberShiftSummary(memberId: string, now = new Date()): ShiftSummary {
  const shifts = database.prepare(`
    SELECT * FROM staff_shifts
    WHERE member_id = ?
    ORDER BY clocked_in_at DESC, id DESC
  `).all(memberId).map(parseStaffShift);
  return {
    totalMilliseconds: shifts.reduce((total, shift) => total + shiftDurationMilliseconds(shift, now), 0),
    activeShift: shifts.find((shift) => shift.clocked_out_at === null),
    recentShifts: shifts.slice(0, 5),
  };
}

export function getShiftTotals(now = new Date()): Map<string, number> {
  const shifts = database.prepare("SELECT * FROM staff_shifts").all().map(parseStaffShift);
  const totals = new Map<string, number>();
  for (const shift of shifts) {
    totals.set(shift.member_id, (totals.get(shift.member_id) ?? 0) + shiftDurationMilliseconds(shift, now));
  }
  return totals;
}

function getZonedDateParts(date: Date): { year: number; month: number; day: number; weekday: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: SHIFT_WEEK_TIME_ZONE,
    year: "numeric",
    month: "numeric",
    day: "numeric",
    weekday: "short",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const weekdayValue = values.weekday;
  const yearValue = values.year;
  const monthValue = values.month;
  const dayValue = values.day;
  if (!weekdayValue || !yearValue || !monthValue || !dayValue) {
    throw new Error("Could not determine the current shift week in Pacific time.");
  }
  const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(weekdayValue);
  const year = Number(yearValue);
  const month = Number(monthValue);
  const day = Number(dayValue);
  if (weekday < 0 || !Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
    throw new Error("Could not determine the current shift week in Pacific time.");
  }
  return { year, month, day, weekday };
}

function pacificMidnightUtc(year: number, month: number, day: number): Date {
  const approximateUtc = Date.UTC(year, month - 1, day);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: SHIFT_WEEK_TIME_ZONE,
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
    hourCycle: "h23",
  }).formatToParts(new Date(approximateUtc));
  const values = Object.fromEntries(parts.map((part) => [part.type, Number(part.value)]));
  const yearValue = Number(values.year);
  const monthValue = Number(values.month);
  const dayValue = Number(values.day);
  const hourValue = Number(values.hour);
  const minuteValue = Number(values.minute);
  const secondValue = Number(values.second);
  if (![yearValue, monthValue, dayValue, hourValue, minuteValue, secondValue].every(Number.isFinite)) {
    throw new Error("Could not calculate midnight in Pacific time.");
  }
  const localAsUtc = Date.UTC(
    yearValue,
    monthValue - 1,
    dayValue,
    hourValue,
    minuteValue,
    secondValue,
  );
  return new Date(approximateUtc - (localAsUtc - approximateUtc));
}

export function getShiftWeekWindow(now = new Date()): { start: Date; end: Date } {
  const localDate = getZonedDateParts(now);
  const sunday = new Date(Date.UTC(localDate.year, localDate.month - 1, localDate.day - localDate.weekday));
  const nextSunday = new Date(sunday.getTime() + 7 * 24 * 60 * 60 * 1000);
  return {
    start: pacificMidnightUtc(sunday.getUTCFullYear(), sunday.getUTCMonth() + 1, sunday.getUTCDate()),
    end: pacificMidnightUtc(nextSunday.getUTCFullYear(), nextSunday.getUTCMonth() + 1, nextSunday.getUTCDate()),
  };
}

export function getWeeklyShiftTotals(now = new Date()): Map<string, number> {
  const weekStart = getShiftWeekWindow(now).start.getTime();
  const currentTime = now.getTime();
  const shifts = database.prepare("SELECT * FROM staff_shifts").all().map(parseStaffShift);
  const totals = new Map<string, number>();
  for (const shift of shifts) {
    const shiftStart = Date.parse(shift.clocked_in_at);
    const shiftEnd = Math.min(
      shift.clocked_out_at ? Date.parse(shift.clocked_out_at) : currentTime,
      currentTime,
    );
    if (!Number.isFinite(shiftStart) || !Number.isFinite(shiftEnd)) {
      throw new Error(`Shift ${shift.id} contains an invalid timestamp.`);
    }
    const overlap = Math.max(0, shiftEnd - Math.max(shiftStart, weekStart));
    if (overlap > 0) {
      totals.set(shift.member_id, (totals.get(shift.member_id) ?? 0) + overlap);
    }
  }
  return totals;
}

export function getActiveShifts(): StaffShift[] {
  return database.prepare(`
    SELECT * FROM staff_shifts
    WHERE clocked_out_at IS NULL
    ORDER BY clocked_in_at ASC
  `).all().map(parseStaffShift);
}

function createShiftManagementContainer(memberId: string, now: Date): ContainerBuilder {
  const summary = getMemberShiftSummary(memberId, now);
  const weeklyHours = getWeeklyShiftTotals(now).get(memberId) ?? 0;
  const weekWindow = getShiftWeekWindow(now);
  const activeShift = summary.activeShift;
  const recent = summary.recentShifts.length
    ? summary.recentShifts.map((shift) => {
      const duration = formatShiftDuration(shiftDurationMilliseconds(shift, now));
      const state = shift.clocked_out_at ? "" : " · in progress";
      return `> <t:${Math.floor(Date.parse(shift.clocked_in_at) / 1000)}:f> — ${duration}${state}`;
    }).join("\n")
    : "> No shifts recorded yet.";
  const control = new ButtonBuilder()
    .setCustomId(`shift:${activeShift ? "clock-out" : "clock-in"}:${memberId}`)
    .setLabel(activeShift ? "End shift" : "Start shift")
    .setStyle(activeShift ? ButtonStyle.Danger : ButtonStyle.Success);

  return new ContainerBuilder()
    .setAccentColor(activeShift ? 0x2e9d62 : 0x4569a8)
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent([
        "## Shift management",
        `**Status:** ${activeShift ? "On shift" : "Off shift"}`,
        activeShift
          ? `**Clocked in:** <t:${Math.floor(Date.parse(activeShift.clocked_in_at) / 1000)}:R>`
          : "Use the button below when you are ready to start.",
      ].join("\n")),
    )
    .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Large))
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent([
        "## Your hours",
        `**This week:** \`${formatShiftDuration(weeklyHours)}\``,
        `**Resets:** <t:${Math.floor(weekWindow.end.getTime() / 1000)}:R> (Pacific time)`,
        `**Recent shifts (${summary.recentShifts.length}):**`,
        recent,
      ].join("\n")),
    )
    .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Large))
    .addActionRowComponents(new ActionRowBuilder<ButtonBuilder>().addComponents(control));
}

export function createShiftManagementMessage(memberId: string, now = new Date()): MessageCreateOptions {
  return {
    flags: MessageFlags.IsComponentsV2,
    components: [createShiftManagementContainer(memberId, now)],
    allowedMentions: { parse: [] },
  };
}

export async function executeShiftButton(interaction: ButtonInteraction): Promise<boolean> {
  const [, action, ownerId] = interaction.customId.split(":", 3);
  if (!action || !ownerId || !["clock-in", "clock-out"].includes(action)) return false;

  const respond = async (title: string, body: string): Promise<void> => {
    await interaction.reply({ ...v2Message(title, body), flags: v2Flags(false) });
  };
  if (interaction.user.id !== ownerId) {
    await respond("Shift panel unavailable", "This shift panel belongs to another member.");
    return true;
  }
  if (!interaction.guild || interaction.guild.id !== interaction.guildId) {
    await respond("Shift controls unavailable", "Shift controls are only available in the configured server.");
    return true;
  }

  const member = await interaction.guild.members.fetch(interaction.user.id);
  if (!member.roles.cache.has(STAFF_ROLE_ID)) {
    await respond("Permission denied", "You need the Staff role to manage your shift.");
    return true;
  }

  const now = new Date();
  let auditDetails: string;
  if (action === "clock-in") {
    if (!await clockMemberIn(member, now)) {
      await respond("Already on shift", "You are already clocked in.");
      return true;
    }
    auditDetails = `<@${member.id}> clocked in.`;
  } else {
    const endedShift = await clockMemberOut(member, member.id, undefined, now);
    if (!endedShift) {
      await respond("Not on shift", "You are not currently clocked in.");
      return true;
    }
    auditDetails = `<@${member.id}> clocked out after ${formatShiftDuration(shiftDurationMilliseconds(endedShift, now))}.`;
  }

  try {
    await audit(interaction.client, "/shift", auditDetails, {
      guildId: interaction.guild.id,
      actorId: member.id,
      subjectId: member.id,
    });
  } catch (error) {
    console.error("Shift changed, but the shift audit log could not be delivered:", error);
  }
  const panel = createShiftManagementMessage(member.id, now);
  if (!panel.components || !panel.allowedMentions) {
    throw new Error("Could not build the Components V2 shift management panel.");
  }
  await interaction.update({
    flags: MessageFlags.IsComponentsV2,
    components: panel.components,
    allowedMentions: panel.allowedMentions,
  });
  return true;
}
