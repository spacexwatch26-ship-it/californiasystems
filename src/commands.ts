import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  ContainerBuilder,
  EmbedBuilder,
  FileUploadBuilder,
  LabelBuilder,
  ModalBuilder,
  MessageFlags,
  PermissionFlagsBits,
  SeparatorBuilder,
  SeparatorSpacingSize,
  SlashCommandBuilder,
  StringSelectMenuBuilder,
  TextDisplayBuilder,
  TextInputBuilder,
  TextInputStyle,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type Client,
  type GuildMember,
  type ModalSubmitInteraction,
  type SlashCommandOptionsOnlyBuilder,
  type StringSelectMenuInteraction,
} from "discord.js";
import { config } from "./config.js";
import { database, listGameEvents, saveGameEvent } from "./database.js";
import { audit, send911 } from "./logging.js";
import {
  SESSION_VOTE_THRESHOLD,
  createSessionVoteMessage,
  saveSessionPoll,
} from "./session-vote.js";
import {
  createSessionEndMessage,
  publishManualSessionStartAnnouncement,
  SESSION_PING_ROLE_ID,
} from "./session-announcement.js";
import {
  clockMemberOut,
  createShiftManagementMessage,
  formatShiftDuration,
  getActiveShift,
  getActiveShifts,
  getMemberShiftSummary,
  getShiftWeekWindow,
  getWeeklyShiftTotals,
  INTERNAL_AFFAIRS_ROLE_ID,
  removeShiftTime,
  ShiftAdjustmentError,
  shiftDurationMilliseconds,
  STAFF_ROLE_ID,
  type StaffShift,
} from "./shifts.js";
import { v2Flags, v2Message } from "./ui.js";
import { addCalendarMonths, createPunishmentMessage } from "./punishment.js";
import { createGuidelinesPanelMessage } from "./guidelines.js";
import { randomInt, randomUUID } from "node:crypto";
import { closeModeratorApplications, openModeratorApplications } from "./moderator-application.js";

type Command = SlashCommandOptionsOnlyBuilder;

export const SESSION_COMMAND_ROLE_ID = "1573500103459741726";

const TICKET_ROLES = {
  "general-support": "1524688682702082159",
  "report-ticket": "1445540175341158611",
  "partnership-ticket": "1475565354838392842",
  "community-support": "1575701190124113941",
} as const;

const TICKET_CATEGORIES = {
  "general-support": {
    label: "General Support",
    description: "Questions, assistance, concerns, and community issues",
    emoji: { id: "1554160947013222541", name: "pin" },
    questions: [{ id: "assistance", label: "What do you need assistance with?" }],
  },
  "report-ticket": {
    label: "Report Ticket",
    description: "Report a staff member for misconduct or policy violations",
    emoji: { id: "1554160354408271912", name: "hammer" },
    questions: [
      { id: "reported_member", label: "Who are you reporting? Include their ID" },
      { id: "report_reason", label: "Why are you reporting this staff member?" },
    ],
  },
  "partnership-ticket": {
    label: "Partnership Ticket",
    description: "Submit a partnership request for your community",
    emoji: { id: "1554160299202846791", name: "partner" },
    questions: [
      { id: "server_name", label: "What is your server's name?" },
      { id: "server_invite", label: "What is your server invite?" },
      { id: "member_count", label: "How many members does it have?" },
    ],
  },
  "community-support": {
    label: "Community Support",
    description: "Shop, giveaway, role, or leadership-related inquiries",
    emoji: { id: "1554160757757968405", name: "crown" },
    questions: [{ id: "assistance", label: "What do you need assistance with?" }],
  },
} as const;

type TicketCategory = keyof typeof TICKET_CATEGORIES;

const TICKET_PARENT_CATEGORIES: Record<TicketCategory, string> = {
  "general-support": "1575701014974042172",
  "report-ticket": "1575701661534658730",
  "partnership-ticket": "1520720368950841414",
  "community-support": "1520720565948776478",
};

const commandBuilders: Command[] = [];
const commandActionDetails = new WeakMap<ChatInputCommandInteraction, string[]>();

function command(name: string, description: string): SlashCommandBuilder {
  const builder = new SlashCommandBuilder().setName(name).setDescription(description);
  commandBuilders.push(builder);
  return builder;
}

function add911Command(name: string): void {
  command(name, "ER:LC 911 call tools")
    .addSubcommand((subcommand) =>
      subcommand.setName("report").setDescription("Submit an ER:LC 911 call")
        .addStringOption((option) => option.setName("location").setDescription("Call location").setRequired(true).setMaxLength(200))
        .addStringOption((option) => option.setName("details").setDescription("Emergency details").setRequired(true).setMaxLength(1000))
        .addStringOption((option) => option.setName("caller").setDescription("Caller name or unit").setRequired(true).setMaxLength(100)),
    )
    .addSubcommand((subcommand) => subcommand.setName("calls").setDescription("Post recent ER:LC 911 calls to the 911 channel"))
    .addSubcommand((subcommand) => subcommand.setName("panel").setDescription("Post the 911 reporting instructions to the 911 channel"));
}

add911Command("911");
add911Command("call911");

command("add", "Add a member to the current support ticket")
  .addUserOption((option) => option.setName("member").setDescription("Member to add").setRequired(true));
command("ticket-panel", "Post the support ticket panel");
command("claim", "Claim the current support ticket");
command("close", "Close the current support ticket")
  .addStringOption((option) => option.setName("reason").setDescription("Closure reason").setMaxLength(500));
command("appeal", "Submit an appeal")
  .addStringOption((option) => option.setName("details").setDescription("Appeal details").setRequired(true).setMaxLength(1500));

command("application-add", "Create or update an application type")
  .addStringOption((option) => option.setName("name").setDescription("Application name").setRequired(true).setMaxLength(80))
  .addStringOption((option) => option.setName("description").setDescription("Description").setRequired(true).setMaxLength(500));
command("application-list", "List configured application types");
command("application-panel", "Post the application panel");
command("application-remove", "Remove an application type")
  .addStringOption((option) => option.setName("name").setDescription("Application name").setRequired(true).setMaxLength(80));
command("app-open", "Open moderator applications");
command("app-close", "Close moderator applications");

command("ban", "Ban a member from this server")
  .addUserOption((option) => option.setName("member").setDescription("Member to ban").setRequired(true))
  .addStringOption((option) => option.setName("reason").setDescription("Reason").setRequired(true).setMaxLength(500));

command("callsign", "Manage staff callsigns")
  .addSubcommand((subcommand) => subcommand.setName("set").setDescription("Assign a callsign")
    .addUserOption((option) => option.setName("member").setDescription("Staff member").setRequired(true))
    .addStringOption((option) => option.setName("callsign").setDescription("Callsigh to assign").setRequired(true).setMaxLength(32)))
  .addSubcommand((subcommand) => subcommand.setName("get").setDescription("Check a member's callsign")
    .addUserOption((option) => option.setName("member").setDescription("Staff member").setRequired(true)))
  .addSubcommand((subcommand) => subcommand.setName("revoke").setDescription("Revoke a callsign")
    .addUserOption((option) => option.setName("member").setDescription("Staff member").setRequired(true)))
  .addSubcommand((subcommand) => subcommand.setName("audit").setDescription("List members without callsigns"));

command("giveaway", "Create and launch a giveaway")
  .addSubcommand((subcommand) => subcommand.setName("create").setDescription("Create a giveaway")
    .addStringOption((option) => option.setName("prize").setDescription("Giveaway prize").setRequired(true).setMaxLength(200)));
command("information-panel", "Post the server information panel");
command("guidelines", "Post the California State Roleplay guidelines panel");
command("self-roles", "Post the self-role panel");

command("infract", "Manage staff infractions")
  .addSubcommand((subcommand) => subcommand.setName("add").setDescription("Record an infraction")
    .addUserOption((option) => option.setName("member").setDescription("Staff member").setRequired(true))
    .addStringOption((option) => option.setName("reason").setDescription("Reason").setRequired(true).setMaxLength(500)))
  .addSubcommand((subcommand) => subcommand.setName("give").setDescription("Issue an infraction to a staff member")
    .addUserOption((option) => option.setName("member").setDescription("Staff member").setRequired(true))
    .addStringOption((option) => option.setName("reason").setDescription("Reason").setRequired(true).setMaxLength(500)))
  .addSubcommand((subcommand) => subcommand.setName("view").setDescription("View a member's infractions")
    .addUserOption((option) => option.setName("member").setDescription("Staff member").setRequired(true)))
  .addSubcommand((subcommand) => subcommand.setName("revoke").setDescription("Revoke an infraction")
    .addIntegerOption((option) => option.setName("record").setDescription("Record ID").setRequired(true).setMinValue(1)));
command("interview-pass", "Record a passed staff interview")
  .addUserOption((option) => option.setName("member").setDescription("Applicant").setRequired(true));
command("loa", "Manage staff leaves of absence")
  .addSubcommand((subcommand) => subcommand.setName("request").setDescription("Submit an LOA request")
    .addStringOption((option) => option.setName("reason").setDescription("Reason").setRequired(true).setMaxLength(500)))
  .addSubcommand((subcommand) => subcommand.setName("list").setDescription("List pending or active LOAs"))
  .addSubcommand((subcommand) => subcommand.setName("review").setDescription("Approve or deny an LOA request")
    .addIntegerOption((option) => option.setName("request").setDescription("Request ID").setRequired(true).setMinValue(1))
    .addBooleanOption((option) => option.setName("approve").setDescription("Approve this request").setRequired(true)))
  .addSubcommand((subcommand) => subcommand.setName("end").setDescription("End your active LOA"));
command("media", "Submit media for review")
  .addStringOption((option) => option.setName("url").setDescription("Media link").setRequired(true).setMaxLength(500))
  .addStringOption((option) => option.setName("description").setDescription("Description").setRequired(true).setMaxLength(500));

command("mod", "Moderation and in-game call tools")
  .addSubcommand((subcommand) => subcommand.setName("calls").setDescription("View in-game moderator calls"))
  .addSubcommand((subcommand) => subcommand.setName("cases").setDescription("View moderation cases for a member")
    .addUserOption((option) => option.setName("member").setDescription("Member").setRequired(true)))
  .addSubcommand((subcommand) => subcommand.setName("ban").setDescription("Ban a member")
    .addUserOption((option) => option.setName("member").setDescription("Member").setRequired(true))
    .addStringOption((option) => option.setName("reason").setDescription("Reason").setRequired(true).setMaxLength(500)))
  .addSubcommand((subcommand) => subcommand.setName("kick").setDescription("Kick a member")
    .addUserOption((option) => option.setName("member").setDescription("Member").setRequired(true))
    .addStringOption((option) => option.setName("reason").setDescription("Reason").setRequired(true).setMaxLength(500)))
  .addSubcommand((subcommand) => subcommand.setName("mute").setDescription("Timeout a member")
    .addUserOption((option) => option.setName("member").setDescription("Member").setRequired(true))
    .addIntegerOption((option) => option.setName("minutes").setDescription("Timeout length in minutes").setRequired(true).setMinValue(1).setMaxValue(40320))
    .addStringOption((option) => option.setName("reason").setDescription("Reason").setRequired(true).setMaxLength(500)))
  .addSubcommand((subcommand) => subcommand.setName("unmute").setDescription("Remove a member's timeout")
    .addUserOption((option) => option.setName("member").setDescription("Member").setRequired(true)))
  .addSubcommand((subcommand) => subcommand.setName("purge").setDescription("Bulk delete recent messages")
    .addIntegerOption((option) => option.setName("amount").setDescription("Number of messages to delete").setRequired(true).setMinValue(1).setMaxValue(100)));

command("pings", "List configured notification roles");
command("promote", "Manage staff promotion records")
  .addSubcommand((subcommand) => subcommand.setName("add").setDescription("Record a promotion")
    .addUserOption((option) => option.setName("member").setDescription("Staff member").setRequired(true))
    .addStringOption((option) => option.setName("rank").setDescription("New rank").setRequired(true).setMaxLength(100)))
  .addSubcommand((subcommand) => subcommand.setName("give").setDescription("Record a promotion for a staff member")
    .addUserOption((option) => option.setName("member").setDescription("Staff member").setRequired(true))
    .addStringOption((option) => option.setName("rank").setDescription("New rank").setRequired(true).setMaxLength(100)))
  .addSubcommand((subcommand) => subcommand.setName("view").setDescription("View a member's promotion records")
    .addUserOption((option) => option.setName("member").setDescription("Staff member").setRequired(true)))
  .addSubcommand((subcommand) => subcommand.setName("revoke").setDescription("Revoke a promotion record")
    .addIntegerOption((option) => option.setName("record").setDescription("Record ID").setRequired(true).setMinValue(1)));
command("punish", "Issue a staff punishment")
  .addUserOption((option) => option.setName("member").setDescription("Staff member").setRequired(true))
  .addStringOption((option) => option.setName("type").setDescription("Punishment type").setRequired(true)
    .addChoices(
      { name: "Verbal Warning", value: "Verbal Warning" },
      { name: "Written Warning", value: "Written Warning" },
      { name: "Strike", value: "Strike" },
      { name: "Suspension", value: "Suspension" },
      { name: "Termination", value: "Termination" },
    ))
  .addStringOption((option) => option.setName("reason").setDescription("Reason").setRequired(true).setMaxLength(500));
command("punishment-history", "View a staff member's punishment history")
  .addUserOption((option) => option.setName("member").setDescription("Staff member").setRequired(true));
command("punishment-edit", "Edit a staff punishment record")
  .addIntegerOption((option) => option.setName("record").setDescription("Record ID").setRequired(true).setMinValue(1))
  .addStringOption((option) => option.setName("reason").setDescription("Updated reason").setRequired(true).setMaxLength(500));
command("punishment-void", "Void a staff punishment")
  .addIntegerOption((option) => option.setName("record").setDescription("Record ID").setRequired(true).setMinValue(1));
command("queue-add", "Add a member to the advertising queue")
  .addUserOption((option) => option.setName("member").setDescription("Member").setRequired(true));
command("queue-remove", "Remove a member from the advertising queue")
  .addUserOption((option) => option.setName("member").setDescription("Member").setRequired(true));
command("ra", "Request reduced activity")
  .addStringOption((option) => option.setName("reason").setDescription("Reason").setRequired(true).setMaxLength(500));
command("ra-admin", "End a staff member's reduced activity")
  .addUserOption((option) => option.setName("member").setDescription("Staff member").setRequired(true));
command("reinstate", "Reinstate a former staff member")
  .addUserOption((option) => option.setName("member").setDescription("Former staff member").setRequired(true))
  .addStringOption((option) => option.setName("rank").setDescription("Rank").setRequired(true).setMaxLength(100));
command("resign", "Record a staff resignation")
  .addStringOption((option) => option.setName("reason").setDescription("Optional reason").setMaxLength(500));

command("role", "Add or remove a role")
  .addSubcommand((subcommand) => subcommand.setName("add").setDescription("Add a role to a member")
    .addUserOption((option) => option.setName("member").setDescription("Member").setRequired(true))
    .addRoleOption((option) => option.setName("role").setDescription("Role to add").setRequired(true)))
  .addSubcommand((subcommand) => subcommand.setName("remove").setDescription("Remove a role from a member")
    .addUserOption((option) => option.setName("member").setDescription("Member").setRequired(true))
    .addRoleOption((option) => option.setName("role").setDescription("Role to remove").setRequired(true)));
command("roles", "Role management and role panel")
  .addSubcommand((subcommand) => subcommand.setName("panel").setDescription("Post the role panel"))
  .addSubcommand((subcommand) => subcommand.setName("give").setDescription("Give a role to a member")
    .addUserOption((option) => option.setName("member").setDescription("Member").setRequired(true))
    .addRoleOption((option) => option.setName("role").setDescription("Role to give").setRequired(true)))
  .addSubcommand((subcommand) => subcommand.setName("add").setDescription("Add a role to a member")
    .addUserOption((option) => option.setName("member").setDescription("Member").setRequired(true))
    .addRoleOption((option) => option.setName("role").setDescription("Role to add").setRequired(true)))
  .addSubcommand((subcommand) => subcommand.setName("remove").setDescription("Remove a role from a member")
    .addUserOption((option) => option.setName("member").setDescription("Member").setRequired(true))
    .addRoleOption((option) => option.setName("role").setDescription("Role to remove").setRequired(true)));

command("say", "Send a message through the bot in the current channel")
  .addStringOption((option) => option.setName("message").setDescription("Message to send").setRequired(true).setMaxLength(1800))
  .addBooleanOption((option) => option.setName("embed").setDescription("Send the message as an embed").setRequired(true))
  .addBooleanOption((option) => option.setName("mentions").setDescription("Allow mentions in the message"));
command("session-start", "Start a roleplay session");
command("session-vote", "Post the California State Roleplay session vote");
command("session-end", "End the current roleplay session");
command("session-low", "Post a low-player session announcement");
command("shift-management", "Open your staff shift management panel");
command("shift-leadership", "Post the staff hours leaderboard");
command("shift-admin", "Internal Affairs shift administration")
  .addSubcommand((subcommand) => subcommand.setName("active").setDescription("View active staff shifts"))
  .addSubcommand((subcommand) => subcommand.setName("clock-out").setDescription("Force clock out a staff member")
    .addUserOption((option) => option.setName("member").setDescription("Staff member").setRequired(true))
    .addStringOption((option) => option.setName("reason").setDescription("Reason for ending the shift").setMaxLength(500)))
  .addSubcommand((subcommand) => subcommand.setName("history").setDescription("View a member's shift history")
    .addUserOption((option) => option.setName("member").setDescription("Staff member").setRequired(true)))
  .addSubcommand((subcommand) => subcommand.setName("remove-time").setDescription("Remove minutes from a completed shift")
    .addUserOption((option) => option.setName("member").setDescription("Staff member").setRequired(true))
    .addIntegerOption((option) => option.setName("shift").setDescription("Shift record ID").setRequired(true).setMinValue(1))
    .addIntegerOption((option) => option.setName("minutes").setDescription("Minutes to remove").setRequired(true).setMinValue(1))
    .addStringOption((option) => option.setName("reason").setDescription("Reason for the adjustment").setRequired(true).setMaxLength(500)));

function isAdmin(interaction: ChatInputCommandInteraction): boolean {
  return interaction.memberPermissions?.has(PermissionFlagsBits.Administrator) ?? false;
}

async function reply(interaction: ChatInputCommandInteraction, title: string, body: string, ephemeral = true): Promise<void> {
  const message = v2Message(title, body);
  if (interaction.deferred || interaction.replied) {
    if (!message.components || !message.allowedMentions) {
      throw new Error("Could not build a Components V2 reply.");
    }
    await interaction.editReply({
      flags: MessageFlags.IsComponentsV2,
      components: message.components,
      allowedMentions: message.allowedMentions,
    });
  } else {
    await interaction.reply({ ...message, flags: v2Flags(ephemeral) });
  }
}

async function requireAdmin(interaction: ChatInputCommandInteraction): Promise<boolean> {
  if (isAdmin(interaction)) return true;
  await reply(interaction, "Permission denied", "This command requires the Administrator permission.");
  return false;
}

async function requireSessionCommandRole(interaction: ChatInputCommandInteraction): Promise<boolean> {
  if (interaction.guild) {
    const member = await interaction.guild.members.fetch(interaction.user.id);
    if (member.roles.cache.has(SESSION_COMMAND_ROLE_ID)) return true;
  }
  await reply(interaction, "Permission denied", "You do not have access to use this command");
  return false;
}

async function requireGuildRole(
  interaction: ChatInputCommandInteraction,
  roleId: string,
  denialMessage: string,
): Promise<GuildMember | undefined> {
  if (!interaction.guild) {
    await reply(interaction, "Server only", "This shift command can only be used in the configured server.");
    return undefined;
  }
  const member = await interaction.guild.members.fetch(interaction.user.id);
  if (member.roles.cache.has(roleId)) return member;
  await reply(interaction, "Permission denied", denialMessage);
  return undefined;
}

async function isTicketStaff(interaction: ChatInputCommandInteraction): Promise<boolean> {
  if (isAdmin(interaction)) return true;
  if (!interaction.guild) return false;
  const member = await interaction.guild.members.fetch(interaction.user.id);
  const supportRoles = ticketStaffRoleIds();
  return member.roles.cache.some((role) => supportRoles.has(role.id));
}

function recordStaffAction(
  type: string,
  memberId: string,
  actorId: string,
  reason: string,
): number {
  const result = database.prepare(`
    INSERT INTO staff_records (record_type, member_id, actor_id, reason)
    VALUES (?, ?, ?, ?)
  `).run(type, memberId, actorId, reason);
  return Number(result.lastInsertRowid);
}

function recordPunishment(
  memberId: string,
  actorId: string,
  punishmentType: string,
  reason: string,
): { id: string; issuedAt: Date; expiresAt: Date | null } {
  const issuedAt = new Date();
  issuedAt.setUTCMilliseconds(0);
  const expiresAt = punishmentType === "Termination" ? null : addCalendarMonths(issuedAt, 2);
  let punishmentId: string;
  do {
    punishmentId = String(randomInt(10_000_000, 100_000_000));
  } while (database.prepare("SELECT 1 FROM staff_records WHERE punishment_id = ?").get(punishmentId));

  database.prepare(`
    INSERT INTO staff_records
      (record_type, member_id, actor_id, reason, created_at, punishment_id, punishment_type, expires_at)
    VALUES ('punish', ?, ?, ?, ?, ?, ?, ?)
  `).run(
    memberId,
    actorId,
    reason,
    issuedAt.toISOString(),
    punishmentId,
    punishmentType,
    expiresAt?.toISOString() ?? null,
  );
  return { id: punishmentId, issuedAt, expiresAt };
}

function records(type: string, memberId: string): Array<{ id: number; reason: string; created_at: string; status: string }> {
  return database.prepare(`
    SELECT id, reason, created_at, status FROM staff_records
    WHERE record_type = ? AND member_id = ? ORDER BY id DESC LIMIT 10
  `).all(type, memberId) as Array<{ id: number; reason: string; created_at: string; status: string }>;
}

function formatRecords(items: Array<{ id: number; reason: string; created_at: string; status: string }>): string {
  return items.length
    ? items.map((item) => `**#${item.id} · ${item.status}** · ${item.created_at}\n${item.reason}`).join("\n\n")
    : "No records found.";
}

async function auditAction(client: Client, interaction: ChatInputCommandInteraction, details: string): Promise<void> {
  const pendingActions = commandActionDetails.get(interaction);
  if (pendingActions) {
    pendingActions.push(details);
    return;
  }
  await audit(client, `/${interaction.commandName}`, details, {
    guildId: interaction.guildId ?? undefined,
    actorId: interaction.user.id,
  });
}

async function postInCurrentChannel(interaction: ChatInputCommandInteraction, title: string, body: string): Promise<void> {
  const channel = interaction.channel;
  if (!channel || !("send" in channel)) {
    throw new Error("This command can only post in a message channel.");
  }
  await channel.send(v2Message(title, body));
}

async function handle911(interaction: ChatInputCommandInteraction): Promise<void> {
  const subcommand = interaction.options.getSubcommand();
  if (subcommand === "report") {
    const caller = interaction.options.getString("caller", true);
    const location = interaction.options.getString("location", true);
    const details = interaction.options.getString("details", true);
    const record = `**Caller:** ${caller}\n**Location:** ${location}\n**Details:** ${details}\n**Reported by:** <@${interaction.user.id}>`;
    saveGameEvent("discord-911-report", true, record);
    await send911(interaction.client, "ER:LC · 911 report", record);
    await reply(interaction, "911 report sent", "Your report was sent to the dedicated 911 channel.");
    return;
  }
  if (!(await requireAdmin(interaction))) return;
  if (subcommand === "panel") {
    await send911(interaction.client, "ER:LC · 911 reporting", "Use `/911 report` to submit a call. ER:LC game events marked as 911 are delivered here.");
    await reply(interaction, "911 panel posted", "The panel was posted to the configured 911 channel.");
  } else {
    const calls = database.prepare(`
      SELECT event_type, details, created_at FROM game_events
      WHERE is_911 = 1 ORDER BY id DESC LIMIT 10
    `).all() as Array<{ event_type: string; details: string; created_at: string }>;
    const listing = calls.length
      ? calls.map((call) => `**${call.event_type}** · ${call.created_at}\n${call.details}`).join("\n\n")
      : "No 911 calls have been received.";
    await send911(interaction.client, "Recent ER:LC 911 calls", listing);
    await reply(interaction, "911 calls posted", "Recent calls were posted to the configured 911 channel.");
  }
}

async function handleTicketCommand(interaction: ChatInputCommandInteraction, client: Client): Promise<boolean> {
  const channelId = interaction.channelId;
  const ticket = database.prepare("SELECT opener_id, claimed_by, status FROM tickets WHERE channel_id = ?").get(channelId) as
    | { opener_id: string; claimed_by: string | null; status: string }
    | undefined;
  if (!ticket || ticket.status !== "open") {
    await reply(interaction, "Not a ticket", "This command can only be used in an open support ticket.");
    return true;
  }

  if (interaction.commandName === "claim") {
    if (!(await isTicketStaff(interaction))) {
      await reply(interaction, "Permission denied", "Only ticket staff can claim tickets.");
      return true;
    }
    const result = database.prepare("UPDATE tickets SET claimed_by = ? WHERE channel_id = ? AND status = 'open' AND claimed_by IS NULL")
      .run(interaction.user.id, channelId);
    if (Number(result.changes) === 0) {
      const current = database.prepare("SELECT claimed_by FROM tickets WHERE channel_id = ?").get(channelId) as
        | { claimed_by: string | null }
        | undefined;
      await reply(interaction, "Already claimed", current?.claimed_by
        ? `This ticket is already claimed by <@${current.claimed_by}>.`
        : "This ticket is no longer available to claim.");
      return true;
    }
    const staffMember = interaction.guild
      ? await interaction.guild.members.fetch(interaction.user.id)
      : undefined;
    if (!staffMember || !interaction.channel || !("send" in interaction.channel)) {
      throw new Error("The claimed ticket channel or staff member could not be resolved.");
    }
    await interaction.channel.send(`*Greeting, I am **${staffMember.displayName}** and I will be assisting you today.*`);
    await auditAction(client, interaction, `Ticket <#${channelId}> claimed by <@${interaction.user.id}>.`);
    await reply(interaction, "Ticket claimed", `You are now assisting the member in <#${channelId}>.`);
    return true;
  }

  if (interaction.commandName === "add") {
    if (!(await isTicketStaff(interaction)) && ticket.opener_id !== interaction.user.id) {
      await reply(interaction, "Permission denied", "Only the ticket opener or an administrator can add members.");
      return true;
    }
    if (!interaction.channel || !("permissionOverwrites" in interaction.channel)) {
      await reply(interaction, "Unsupported channel", "This ticket channel cannot be updated.");
      return true;
    }
    const member = interaction.options.getUser("member", true);
    await interaction.channel.permissionOverwrites.edit(member.id, {
      ViewChannel: true,
      SendMessages: true,
      ReadMessageHistory: true,
    });
    await auditAction(client, interaction, `<@${member.id}> added to ticket <#${channelId}> by <@${interaction.user.id}>.`);
    await reply(interaction, "Member added", `<@${member.id}> can now access this ticket.`);
    return true;
  }

  const reason = interaction.options.getString("reason") ?? "No reason provided.";
  if (!(await isTicketStaff(interaction)) && ticket.opener_id !== interaction.user.id) {
    await reply(interaction, "Permission denied", "Only the ticket opener or ticket staff can close this ticket.");
    return true;
  }
  database.prepare("UPDATE tickets SET status = 'closed', closed_at = datetime('now') WHERE channel_id = ?").run(channelId);
  const channel = interaction.channel;
  if (channel && "permissionOverwrites" in channel) {
    await channel.permissionOverwrites.edit(ticket.opener_id, { SendMessages: false });
  }
  await auditAction(client, interaction, `Ticket <#${channelId}> closed by <@${interaction.user.id}>. Reason: ${reason}`);
  await reply(interaction, "Ticket closed", `This ticket was closed. Reason: ${reason}`);
  return true;
}

function formatActiveShiftList(shifts: StaffShift[], now: Date): string {
  if (!shifts.length) return "No staff members are currently on shift.";
  return shifts.map((shift) => {
    const started = Math.floor(Date.parse(shift.clocked_in_at) / 1000);
    return `> <@${shift.member_id}> · <t:${started}:R> · ${formatShiftDuration(shiftDurationMilliseconds(shift, now))}`;
  }).join("\n");
}

async function postShiftLeaderboard(interaction: ChatInputCommandInteraction): Promise<void> {
  const guild = interaction.guild;
  if (!guild) {
    await reply(interaction, "Server only", "The shift leaderboard can only be viewed in the configured server.");
    return;
  }
  const channel = interaction.channel;
  if (!channel || !("send" in channel)) {
    await reply(interaction, "Unsupported channel", "The leaderboard cannot be posted in this channel.");
    return;
  }

  const now = new Date();
  const weekWindow = getShiftWeekWindow(now);
  const allMembers = await guild.members.fetch();
  const staff = [...allMembers.values()]
    .filter((member) => member.roles.cache.has(STAFF_ROLE_ID))
    .sort((left, right) => left.user.username.localeCompare(right.user.username));
  const totals = getWeeklyShiftTotals(now);
  const activeIds = new Set(getActiveShifts().map((shift) => shift.member_id));
  staff.sort((left, right) =>
    (totals.get(right.id) ?? 0) - (totals.get(left.id) ?? 0)
    || left.user.username.localeCompare(right.user.username),
  );
  const rows = staff.map((member, index) => {
    const rank = index + 1;
    const badge = rank === 1 ? "🥇" : rank === 2 ? "🥈" : rank === 3 ? "🥉" : `#${rank}`;
    const onShift = activeIds.has(member.id) ? " · on shift" : "";
    return `**${badge}** <@${member.id}> — \`${formatShiftDuration(totals.get(member.id) ?? 0)}\`${onShift}`;
  });
  const bodyLines = rows.length ? rows : ["No members currently have the Staff role."];
  const bodyChunks: string[] = [];
  let chunk = "";
  for (const line of bodyLines) {
    if (chunk && chunk.length + line.length + 1 > 3_500) {
      bodyChunks.push(chunk);
      chunk = "";
    }
    if (line.length > 3_500) {
      throw new Error("A staff leaderboard row exceeds the Components V2 text limit.");
    }
    chunk = chunk ? `${chunk}\n${line}` : line;
  }
  if (chunk) bodyChunks.push(chunk);

  const weekStartSeconds = Math.floor(weekWindow.start.getTime() / 1000);
  const resetSeconds = Math.floor(weekWindow.end.getTime() / 1000);
  const containers: ContainerBuilder[] = [];
  for (let offset = 0; offset < bodyChunks.length; offset += 8) {
    const container = new ContainerBuilder().setAccentColor(0x4569a8);
    if (offset === 0) {
      container
        .addTextDisplayComponents(
          new TextDisplayBuilder().setContent([
            "## Shift leadership",
            `**Week:** <t:${weekStartSeconds}:D> – <t:${Math.floor((weekWindow.end.getTime() - 1) / 1000)}:D>`,
            `**Resets:** Sunday at midnight Pacific Time · <t:${resetSeconds}:R>`,
            `**Staff:** ${staff.length}`,
          ].join("\n")),
        )
        .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Large));
    } else {
      container.addTextDisplayComponents(new TextDisplayBuilder().setContent("## Shift leadership · continued"));
    }
    for (const content of bodyChunks.slice(offset, offset + 8)) {
      container.addTextDisplayComponents(new TextDisplayBuilder().setContent(content));
    }
    containers.push(container);
  }
  await channel.send({
    flags: MessageFlags.IsComponentsV2,
    components: containers,
    allowedMentions: { parse: [] },
  });

  await auditAction(interaction.client, interaction, `Weekly staff shift leaderboard posted in <#${channel.id}> for ${staff.length} staff members.`);
  await reply(interaction, "Leaderboard posted", `The weekly staff shift leadership panel was posted in <#${channel.id}>.`, false);
}

function formatShiftHistory(shifts: StaffShift[], now: Date): string {
  if (!shifts.length) return "No shift history found.";
  return shifts.map((shift) => {
    const start = Math.floor(Date.parse(shift.clocked_in_at) / 1000);
    const end = shift.clocked_out_at ? ` · ended <t:${Math.floor(Date.parse(shift.clocked_out_at) / 1000)}:R>` : " · in progress";
    const reason = shift.end_reason ? `\n> Reason: ${shift.end_reason}` : "";
    return `**Shift #${shift.id} · <t:${start}:f>**${end}\n> ${formatShiftDuration(shiftDurationMilliseconds(shift, now))}${reason}`;
  }).join("\n\n");
}

export async function executeCommand(
  interaction: ChatInputCommandInteraction,
  actionDetails?: string[],
): Promise<void> {
  if (!actionDetails) {
    await executeCommandImplementation(interaction);
    return;
  }
  commandActionDetails.set(interaction, actionDetails);
  try {
    await executeCommandImplementation(interaction);
  } finally {
    commandActionDetails.delete(interaction);
  }
}

async function executeCommandImplementation(interaction: ChatInputCommandInteraction): Promise<void> {
  const { commandName } = interaction;
  if (commandName === "911" || commandName === "call911") {
    await handle911(interaction);
    return;
  }

  if (commandName === "ticket-panel") {
    if (!(await requireAdmin(interaction))) return;
    await postTicketPanel(interaction);
    await auditAction(interaction.client, interaction, `Ticket panel posted in <#${interaction.channelId}>.`);
    await reply(interaction, "Ticket panel posted", "Members can now open a private support ticket.");
    return;
  }

  if (commandName === "app-open" || commandName === "app-close") {
    if (!(await requireAdmin(interaction))) return;
    if (commandName === "app-open") {
      const opened = await openModeratorApplications(interaction.client, interaction.guildId, interaction.channelId);
      if (opened) {
        await auditAction(interaction.client, interaction, `Moderator applications opened with a panel in <#${interaction.channelId}>.`);
        await reply(interaction, "Moderator applications opened", `The application panel was posted in <#${interaction.channelId}>.`);
      } else {
        await reply(interaction, "Applications already open", "Moderator applications are already open. Use `/app-close` before opening them again.");
      }
    } else {
      const closed = await closeModeratorApplications(interaction.client);
      if (closed) {
        await auditAction(interaction.client, interaction, "Moderator applications closed.");
        await reply(interaction, "Moderator applications closed", "New applications are no longer being accepted.");
      } else {
        await reply(interaction, "Applications already closed", "Moderator applications are already closed.");
      }
    }
    return;
  }

  if (commandName === "mod") {
    const subcommand = interaction.options.getSubcommand();
    if (subcommand === "calls") {
      if (!(await requireAdmin(interaction))) return;
      const calls = listGameEvents(false, 10);
      await reply(interaction, "In-game moderator calls", calls.length
        ? calls.map((call) => `**${call.event_type}** · ${call.created_at}\n${call.details}`).join("\n\n")
        : "No in-game moderator calls have been received.");
      return;
    }
    if (!(await requireAdmin(interaction))) return;
    const member = interaction.options.getUser("member");
    if (subcommand === "cases" && member) {
      await reply(interaction, `Cases for ${member.username}`, formatRecords(records("moderation", member.id)));
      return;
    }
    if (subcommand === "ban" && member && interaction.guild) {
      const reason = interaction.options.getString("reason", true);
      await interaction.guild.members.ban(member.id, { reason });
      const id = recordStaffAction("moderation", member.id, interaction.user.id, `Ban: ${reason}`);
      await auditAction(interaction.client, interaction, `Banned ${member.tag}. Case #${id}. Reason: ${reason}`);
      await reply(interaction, "Member banned", `${member.tag} was banned. Case #${id}.`);
      return;
    }
    if (subcommand === "kick" && member && interaction.guild) {
      const reason = interaction.options.getString("reason", true);
      const target = await interaction.guild.members.fetch(member.id);
      await target.kick(reason);
      const id = recordStaffAction("moderation", member.id, interaction.user.id, `Kick: ${reason}`);
      await auditAction(interaction.client, interaction, `Kicked ${member.tag}. Case #${id}. Reason: ${reason}`);
      await reply(interaction, "Member kicked", `${member.tag} was kicked. Case #${id}.`);
      return;
    }
    if ((subcommand === "mute" || subcommand === "unmute") && member && interaction.guild) {
      const target = await interaction.guild.members.fetch(member.id);
      if (subcommand === "mute") {
        const minutes = interaction.options.getInteger("minutes", true);
        const reason = interaction.options.getString("reason", true);
        await target.timeout(minutes * 60_000, reason);
        const id = recordStaffAction("moderation", member.id, interaction.user.id, `Timeout ${minutes} minutes: ${reason}`);
        await auditAction(interaction.client, interaction, `Timed out ${member.tag} for ${minutes} minutes. Case #${id}. Reason: ${reason}`);
        await reply(interaction, "Member timed out", `${member.tag} was timed out for ${minutes} minutes.`);
      } else {
        await target.timeout(null, `Timeout removed by ${interaction.user.tag}`);
        await auditAction(interaction.client, interaction, `Removed timeout for ${member.tag}.`);
        await reply(interaction, "Timeout removed", `${member.tag}'s timeout was removed.`);
      }
      return;
    }
    if (subcommand === "purge") {
      const channel = interaction.channel;
      if (!channel || !("bulkDelete" in channel)) {
        await reply(interaction, "Unsupported channel", "Message purging is only available in a text channel.");
        return;
      }
      const amount = interaction.options.getInteger("amount", true);
      const deleted = await channel.bulkDelete(amount, true);
      await auditAction(interaction.client, interaction, `Purged ${deleted.size} messages from <#${interaction.channelId}>.`);
      await reply(interaction, "Messages purged", `Deleted ${deleted.size} recent messages.`);
      return;
    }
    await reply(interaction, "Command unavailable", "This moderation action is not available in this server.");
    return;
  }

  if (["add", "claim", "close"].includes(commandName)) {
    const handled = await handleTicketCommand(interaction, interaction.client);
    if (handled) return;
  }

  if (commandName === "appeal") {
    const details = interaction.options.getString("details", true);
    const id = recordStaffAction("appeal", interaction.user.id, interaction.user.id, details);
    await auditAction(interaction.client, interaction, `Appeal #${id} submitted by <@${interaction.user.id}>.`);
    await reply(interaction, "Appeal submitted", `Your appeal was recorded as #${id}.`);
    return;
  }

  if (["application-add", "application-list", "application-remove"].includes(commandName)) {
    if (!(await requireAdmin(interaction))) return;
    if (commandName === "application-add") {
      const name = interaction.options.getString("name", true);
      const description = interaction.options.getString("description", true);
      database.prepare(`
        INSERT INTO application_types (name, description, updated_by) VALUES (?, ?, ?)
        ON CONFLICT(name) DO UPDATE SET description = excluded.description, updated_by = excluded.updated_by, updated_at = datetime('now')
      `).run(name, description, interaction.user.id);
      await auditAction(interaction.client, interaction, `Application type "${name}" created or updated.`);
      await reply(interaction, "Application type saved", `**${name}** is ready.`);
    } else if (commandName === "application-remove") {
      const name = interaction.options.getString("name", true);
      const result = database.prepare("DELETE FROM application_types WHERE name = ?").run(name);
      await auditAction(interaction.client, interaction, `Application type "${name}" removed.`);
      await reply(interaction, "Application type removed", Number(result.changes) ? `Removed **${name}**.` : `No application type named **${name}** exists.`);
    } else {
      const items = database.prepare("SELECT name, description FROM application_types ORDER BY name").all() as Array<{ name: string; description: string }>;
      await reply(interaction, "Application types", items.length ? items.map((item) => `**${item.name}** — ${item.description}`).join("\n") : "No application types are configured.");
    }
    return;
  }

  if (commandName === "callsign") {
    if (!(await requireAdmin(interaction))) return;
    const action = interaction.options.getSubcommand();
    if (action === "set") {
      const member = interaction.options.getUser("member", true);
      const callsign = interaction.options.getString("callsign", true);
      database.prepare(`
        INSERT INTO callsigns (member_id, callsign, assigned_by) VALUES (?, ?, ?)
        ON CONFLICT(member_id) DO UPDATE SET callsign = excluded.callsign, assigned_by = excluded.assigned_by, updated_at = datetime('now')
      `).run(member.id, callsign, interaction.user.id);
      await auditAction(interaction.client, interaction, `Callsign ${callsign} assigned to ${member.tag}.`);
      await reply(interaction, "Callsign assigned", `${member} is now **${callsign}**.`);
    } else if (action === "get") {
      const member = interaction.options.getUser("member", true);
      const result = database.prepare("SELECT callsign FROM callsigns WHERE member_id = ?").get(member.id) as { callsign: string } | undefined;
      await reply(interaction, "Callsign lookup", result ? `${member} is **${result.callsign}**.` : `${member} has no callsign.`);
    } else if (action === "revoke") {
      const member = interaction.options.getUser("member", true);
      const result = database.prepare("DELETE FROM callsigns WHERE member_id = ?").run(member.id);
      await auditAction(interaction.client, interaction, `Callsign revoked for ${member.tag}.`);
      await reply(interaction, "Callsign revoked", Number(result.changes) ? `Removed ${member}'s callsign.` : `${member} had no callsign.`);
    } else {
      const missing = interaction.guild
        ? await interaction.guild.members.fetch()
        : null;
      const assigned = new Set((database.prepare("SELECT member_id FROM callsigns").all() as Array<{ member_id: string }>).map((row) => row.member_id));
      const list = missing?.filter((member) => !member.user.bot && !assigned.has(member.id)).map((member) => member.toString()).slice(0, 40);
      await reply(interaction, "Callsign audit", list?.length ? list.join("\n") : "All members have callsigns, or there are no members to audit.");
    }
    return;
  }

  if (commandName === "infract" || commandName === "promote") {
    if (!(await requireAdmin(interaction))) return;
    const action = interaction.options.getSubcommand();
    const type = commandName === "infract" ? "infraction" : "promotion";
    if (action === "add" || action === "give") {
      const member = interaction.options.getUser("member", true);
      const reason = commandName === "infract"
        ? interaction.options.getString("reason", true)
        : `Promotion to ${interaction.options.getString("rank", true)}`;
      const id = recordStaffAction(type, member.id, interaction.user.id, reason);
      await auditAction(interaction.client, interaction, `${type} #${id} recorded for ${member.tag}: ${reason}`);
      await reply(interaction, `${type} recorded`, `Record #${id} saved for ${member}.`);
    } else if (action === "view") {
      const member = interaction.options.getUser("member", true);
      await reply(interaction, `${type} records for ${member.username}`, formatRecords(records(type, member.id)));
    } else {
      const id = interaction.options.getInteger("record", true);
      const result = database.prepare("UPDATE staff_records SET status = 'revoked', revoked_at = datetime('now') WHERE id = ? AND record_type = ? AND status = 'active'").run(id, type);
      await auditAction(interaction.client, interaction, `${type} record #${id} revoked.`);
      await reply(interaction, "Record update", Number(result.changes) ? `Record #${id} was revoked.` : `Active ${type} record #${id} was not found.`);
    }
    return;
  }

  if (commandName === "loa" || commandName === "ra") {
    const action = commandName === "ra" ? "request" : interaction.options.getSubcommand();
    if (action === "request") {
      const reason = interaction.options.getString("reason", true);
      const result = database.prepare("INSERT INTO loa_requests (member_id, reason) VALUES (?, ?)").run(interaction.user.id, reason);
      await auditAction(interaction.client, interaction, `LOA request #${Number(result.lastInsertRowid)} submitted by <@${interaction.user.id}>: ${reason}`);
      await reply(interaction, "Request submitted", `Your request #${Number(result.lastInsertRowid)} is pending review.`);
    } else if (action === "end") {
      const result = database.prepare("UPDATE loa_requests SET status = 'ended' WHERE member_id = ? AND status = 'active'").run(interaction.user.id);
      await reply(interaction, "LOA ended", Number(result.changes) ? "Your active LOA has ended." : "You do not have an active LOA.");
    } else {
      if (!(await requireAdmin(interaction))) return;
      if (action === "list") {
        const items = database.prepare("SELECT id, member_id, reason, status FROM loa_requests WHERE status IN ('pending', 'active') ORDER BY id DESC LIMIT 20").all() as Array<{ id: number; member_id: string; reason: string; status: string }>;
        await reply(interaction, "LOA requests", items.length ? items.map((item) => `**#${item.id} · ${item.status}** <@${item.member_id}>\n${item.reason}`).join("\n\n") : "No pending or active LOAs.");
      } else if (action === "review") {
        const id = interaction.options.getInteger("request", true);
        const approve = interaction.options.getBoolean("approve", true);
        const status = approve ? "active" : "denied";
        const result = database.prepare("UPDATE loa_requests SET status = ?, reviewed_by = ? WHERE id = ? AND status = 'pending'").run(status, interaction.user.id, id);
        await auditAction(interaction.client, interaction, `LOA request #${id} ${status}.`);
        await reply(interaction, "LOA reviewed", Number(result.changes) ? `Request #${id} is ${status}.` : `Pending request #${id} was not found.`);
      }
    }
    return;
  }

  if (commandName === "role" || commandName === "roles") {
    const action = interaction.options.getSubcommand();
    if (action === "panel") {
      if (!(await requireAdmin(interaction))) return;
      await postInCurrentChannel(interaction, "Self roles", "Self-assigned roles are not configured yet. Ask an administrator to configure role options.");
      await auditAction(interaction.client, interaction, "Self-role panel posted.");
      await reply(interaction, "Panel posted", "The role panel was posted.");
      return;
    }
    if (!(await requireAdmin(interaction))) return;
    const member = interaction.options.getUser("member", true);
    const roleOption = interaction.options.getRole("role", true);
    const role = await interaction.guild?.roles.fetch(roleOption.id);
    const target = await interaction.guild?.members.fetch(member.id);
    if (!role || !target || !interaction.guild?.members.me?.permissions.has(PermissionFlagsBits.ManageRoles)) {
      await reply(interaction, "Role update unavailable", "The bot is missing Manage Roles or the member could not be found.");
      return;
    }
    if (role.position >= interaction.guild.members.me.roles.highest.position || role.managed) {
      await reply(interaction, "Role hierarchy blocked", "The bot cannot manage that role due to role hierarchy or integration ownership.");
      return;
    }
    const add = action === "add" || action === "give";
    await target.roles[add ? "add" : "remove"](role, `Command by ${interaction.user.tag}`);
    await auditAction(interaction.client, interaction, `${add ? "Added" : "Removed"} role ${role.name} ${add ? "to" : "from"} ${member.tag}.`);
    await reply(interaction, "Role updated", `${add ? "Added" : "Removed"} ${role} ${add ? "to" : "from"} ${member}.`);
    return;
  }

  if (commandName === "application-panel") {
    if (!(await requireAdmin(interaction))) return;
    const opened = await openModeratorApplications(interaction.client, interaction.guildId, interaction.channelId);
    await auditAction(interaction.client, interaction, "Moderator application panel requested.");
    await reply(
      interaction,
      opened ? "Moderator applications opened" : "Applications already open",
      opened
        ? `The application panel was posted in <#${interaction.channelId}>.`
        : "Moderator applications are already open. Use `/app-close` before opening them again.",
    );
    return;
  }

  if (commandName === "information-panel" || commandName === "self-roles") {
    if (!(await requireAdmin(interaction))) return;
    const title = commandName === "self-roles" ? "Self roles" : "California State Roleplay";
    const body = commandName === "self-roles"
      ? "Self-assigned roles are not configured yet."
      : "Welcome to California State Roleplay. Please follow the server rules and staff instructions.";
    await postInCurrentChannel(interaction, title, body);
    await auditAction(interaction.client, interaction, `${title} panel posted.`);
    await reply(interaction, "Panel posted", `The ${title.toLowerCase()} panel was posted.`);
    return;
  }

  if (commandName === "guidelines") {
    if (!(await requireAdmin(interaction))) return;
    const channel = interaction.channel;
    if (!channel || !("send" in channel)) {
      throw new Error("The guidelines panel can only be posted in a message channel.");
    }
    await channel.send(createGuidelinesPanelMessage());
    await auditAction(interaction.client, interaction, `Guidelines panel posted in <#${interaction.channelId}>.`);
    await reply(interaction, "Guidelines panel posted", `The guidelines panel was posted in <#${interaction.channelId}>.`);
    return;
  }

  if (commandName === "ban") {
    if (!(await requireAdmin(interaction)) || !interaction.guild) return;
    const member = interaction.options.getUser("member", true);
    const reason = interaction.options.getString("reason", true);
    await interaction.guild.members.ban(member.id, { reason });
    const id = recordStaffAction("moderation", member.id, interaction.user.id, `Ban: ${reason}`);
    await auditAction(interaction.client, interaction, `Banned ${member.tag}. Case #${id}. Reason: ${reason}`);
    await reply(interaction, "Member banned", `${member.tag} was banned. Case #${id}.`);
    return;
  }

  if (commandName === "queue-add" || commandName === "queue-remove") {
    if (!(await requireAdmin(interaction))) return;
    const member = interaction.options.getUser("member", true);
    const result = commandName === "queue-add"
      ? database.prepare("INSERT OR IGNORE INTO staff_queue (member_id, added_by) VALUES (?, ?)").run(member.id, interaction.user.id)
      : database.prepare("DELETE FROM staff_queue WHERE member_id = ?").run(member.id);
    await auditAction(interaction.client, interaction, `${commandName} ${member.tag} in the advertising queue.`);
    await reply(interaction, "Advertising queue updated", Number(result.changes) ? `${member} was ${commandName === "queue-add" ? "added to" : "removed from"} the queue.` : "No change was needed.");
    return;
  }

  if (commandName === "giveaway") {
    if (!(await requireAdmin(interaction))) return;
    const prize = interaction.options.getString("prize", true);
    const result = database.prepare("INSERT INTO giveaways (prize, created_by) VALUES (?, ?)").run(prize, interaction.user.id);
    await postInCurrentChannel(interaction, "Giveaway", `**Prize:** ${prize}\nReact or contact staff to enter. Giveaway #${Number(result.lastInsertRowid)}.`);
    await auditAction(interaction.client, interaction, `Giveaway #${Number(result.lastInsertRowid)} created. Prize: ${prize}`);
    await reply(interaction, "Giveaway created", `Giveaway #${Number(result.lastInsertRowid)} was posted.`);
    return;
  }

  if (commandName === "say") {
    if (!(await requireAdmin(interaction))) return;
    const text = interaction.options.getString("message", true);
    const asEmbed = interaction.options.getBoolean("embed", true);
    const allowMentions = interaction.options.getBoolean("mentions") ?? false;
    const channel = interaction.channel;
    if (!channel || !("send" in channel)) throw new Error("This command can only be used in a message channel.");
    await channel.send(asEmbed
      ? {
          embeds: [new EmbedBuilder().setColor(0x3478c8).setTitle("California State Roleplay").setDescription(text)],
          allowedMentions: allowMentions ? { parse: ["users", "roles", "everyone"] } : { parse: [] },
        }
      : {
          content: text,
          allowedMentions: allowMentions ? { parse: ["users", "roles", "everyone"] } : { parse: [] },
        });
    await auditAction(interaction.client, interaction, `Sent a bot message in <#${interaction.channelId}>.`);
    await reply(interaction, "Message sent", "Your message was posted.");
    return;
  }

  if (commandName === "session-end") {
    if (!(await requireSessionCommandRole(interaction))) return;
    const channel = await interaction.client.channels.fetch(config.sessionAnnouncementChannelId);
    if (!channel || !channel.isTextBased() || channel.isDMBased() || channel.guildId !== interaction.guildId) {
      await reply(interaction, "Session announcement unavailable", "The configured session announcement channel is not a text channel in this server.");
      return;
    }
    await channel.send(createSessionEndMessage());
    await auditAction(interaction.client, interaction, `session-end announcement posted in <#${channel.id}>.`);
    await reply(interaction, "Session ended", `The session-end announcement was sent to <#${channel.id}>.`);
    return;
  }

  if (commandName === "session-start") {
    if (!(await requireSessionCommandRole(interaction))) return;
    if (!interaction.guildId) {
      await reply(interaction, "Server only", "Session announcements can only be posted in a server.");
      return;
    }
    const messageId = await publishManualSessionStartAnnouncement(interaction.client, interaction.guildId);
    await auditAction(
      interaction.client,
      interaction,
      `session-start announcement posted in <#${config.sessionAnnouncementChannelId}> (message ${messageId}).`,
    );
    await reply(
      interaction,
      "Session started",
      `The session announcement was sent to <#${config.sessionAnnouncementChannelId}> and will refresh every minute.`,
    );
    return;
  }

  if (commandName === "session-low") {
    if (!(await requireSessionCommandRole(interaction))) return;
    const channel = await interaction.client.channels.fetch(config.sessionAnnouncementChannelId);
    if (!channel || !channel.isTextBased() || channel.isDMBased() || channel.guildId !== interaction.guildId) {
      await reply(interaction, "Session announcement unavailable", "The configured session announcement channel is not a text channel in this server.");
      return;
    }
    const body = "There are currently few players in-game. Join if you would like to participate in California State Roleplay.";
    await channel.send({
      ...v2Message("Low player count", `<@&${SESSION_PING_ROLE_ID}>\n${body}`),
      allowedMentions: { parse: [], roles: [SESSION_PING_ROLE_ID] },
    });
    await auditAction(interaction.client, interaction, `${commandName} announcement posted in <#${channel.id}>.`);
    await reply(interaction, "Announcement posted", `The session announcement was sent to <#${channel.id}>.`);
    return;
  }

  if (commandName === "session-vote") {
    if (!(await requireSessionCommandRole(interaction))) return;
    if (!interaction.guild) {
      await reply(interaction, "Server only", "Session polls can only be posted in a server.");
      return;
    }
    const channel = await interaction.client.channels.fetch(config.sessionPollChannelId);
    if (!channel || !channel.isTextBased() || channel.isDMBased() || channel.guildId !== interaction.guild.id) {
      await reply(interaction, "Session poll unavailable", "The configured session poll channel is not a text channel in this server.");
      return;
    }
    const pollId = randomUUID();
    const message = await channel.send(createSessionVoteMessage(pollId, SESSION_PING_ROLE_ID));
    saveSessionPoll({
      poll_id: pollId,
      guild_id: interaction.guild.id,
      channel_id: channel.id,
      message_id: message.id,
      notification_role_id: SESSION_PING_ROLE_ID,
      threshold: SESSION_VOTE_THRESHOLD,
      created_by: interaction.user.id,
    });
    await auditAction(interaction.client, interaction, `Session vote ${pollId} posted in <#${channel.id}> with a ${SESSION_VOTE_THRESHOLD}-vote goal.`);
    await reply(interaction, "Session vote posted", `The poll is live in <#${channel.id}>.`);
    return;
  }

  if (commandName === "punish") {
    if (!(await requireAdmin(interaction))) return;
    const member = interaction.options.getUser("member", true);
    const punishmentType = interaction.options.getString("type", true);
    const reason = interaction.options.getString("reason", true);
    const channel = await interaction.client.channels.fetch(config.punishmentChannelId);
    if (
      !channel
      || !channel.isTextBased()
      || channel.isDMBased()
      || channel.guildId !== interaction.guildId
      || !("send" in channel)
    ) {
      throw new Error(`Configured punishment channel ${config.punishmentChannelId} is not a text channel in this server.`);
    }
    const punishment = recordPunishment(member.id, interaction.user.id, punishmentType, reason);
    await channel.send(createPunishmentMessage({
      punishmentId: punishment.id,
      targetId: member.id,
      issuerId: interaction.user.id,
      issuedAt: punishment.issuedAt,
      punishmentType,
      reason,
      expiresAt: punishment.expiresAt,
    }));
    await auditAction(
      interaction.client,
      interaction,
      `Punishment ${punishment.id} (${punishmentType}) issued to ${member.tag}. Reason: ${reason}`,
    );
    await reply(interaction, "Punishment issued", `This user has been punished. Punishment ID is ${punishment.id}`);
    return;
  }

  if (commandName === "interview-pass" || commandName === "reinstate" || commandName === "resign" || commandName === "ra-admin") {
    if (!(await requireAdmin(interaction))) return;
    if (commandName === "ra-admin") {
      const member = interaction.options.getUser("member", true);
      const result = database.prepare("UPDATE loa_requests SET status = 'ended' WHERE member_id = ? AND status IN ('pending', 'active')").run(member.id);
      await auditAction(interaction.client, interaction, `Reduced activity ended for ${member.tag}.`);
      await reply(interaction, "Reduced activity updated", Number(result.changes) ? `Ended ${member.tag}'s reduced activity.` : `${member.tag} has no pending or active reduced activity.`);
      return;
    }
    const member = interaction.options.getUser("member");
    const reason = interaction.options.getString("reason") ?? commandName;
    const rank = interaction.options.getString("rank");
    const id = recordStaffAction(commandName, member?.id ?? interaction.user.id, interaction.user.id, rank ? `${reason}: ${rank}` : reason);
    await auditAction(interaction.client, interaction, `${commandName} record #${id} created${member ? ` for ${member.tag}` : ""}.`);
    await reply(interaction, "Staff action recorded", `Record #${id} was created.`);
    return;
  }

  if (commandName === "punishment-history") {
    if (!(await requireAdmin(interaction))) return;
    const member = interaction.options.getUser("member", true);
    await reply(interaction, `Punishment history for ${member.username}`, formatRecords(records("punish", member.id)));
    return;
  }

  if (commandName === "punishment-edit") {
    if (!(await requireAdmin(interaction))) return;
    const id = interaction.options.getInteger("record", true);
    const reason = interaction.options.getString("reason", true);
    const result = database.prepare("UPDATE staff_records SET reason = ? WHERE id = ? AND record_type = 'punish' AND status = 'active'").run(reason, id);
    await auditAction(interaction.client, interaction, `Punishment record #${id} edited.`);
    await reply(interaction, "Punishment updated", Number(result.changes) ? `Punishment #${id} was updated.` : `Active punishment #${id} was not found.`);
    return;
  }

  if (commandName === "punishment-void") {
    if (!(await requireAdmin(interaction))) return;
    const id = interaction.options.getInteger("record", true);
    const result = database.prepare("UPDATE staff_records SET status = 'void', revoked_at = datetime('now') WHERE id = ? AND status = 'active'").run(id);
    await auditAction(interaction.client, interaction, `Punishment record #${id} voided.`);
    await reply(interaction, "Punishment updated", Number(result.changes) ? `Punishment #${id} was voided.` : `Active punishment #${id} was not found.`);
    return;
  }

  if (commandName === "media") {
    const url = interaction.options.getString("url", true);
    const description = interaction.options.getString("description", true);
    await auditAction(interaction.client, interaction, `Media submission by <@${interaction.user.id}>: ${url}\n${description}`);
    await reply(interaction, "Media submitted", "Your media submission was sent to staff for review.");
    return;
  }

  if (commandName === "pings") {
    if (!(await requireAdmin(interaction))) return;
    await reply(interaction, "Notification roles", "Notification roles are not configured yet.");
    return;
  }

  if (commandName === "shift-management") {
    const member = await requireGuildRole(interaction, STAFF_ROLE_ID, "You do not have access to use this command.");
    if (!member) return;
    const panel = createShiftManagementMessage(member.id);
    if (!panel.components || !panel.allowedMentions) {
      throw new Error("Could not build the Components V2 shift management panel.");
    }
    await interaction.editReply({
      flags: MessageFlags.IsComponentsV2,
      components: panel.components,
      allowedMentions: panel.allowedMentions,
    });
    return;
  }

  if (commandName === "shift-leadership") {
    await postShiftLeaderboard(interaction);
    return;
  }

  if (commandName === "shift-admin") {
    const actor = await requireGuildRole(interaction, INTERNAL_AFFAIRS_ROLE_ID, "You do not have access to use this command.");
    if (!actor) return;
    const subcommand = interaction.options.getSubcommand();
    if (subcommand === "active") {
      await reply(interaction, "Active staff shifts", formatActiveShiftList(getActiveShifts(), new Date()));
      return;
    }
    const target = interaction.options.getUser("member", true);
    if (subcommand === "history") {
      const summary = getMemberShiftSummary(target.id);
      await reply(
        interaction,
        `Shift history · ${target.username}`,
        `**Lifetime hours:** ${formatShiftDuration(summary.totalMilliseconds)}\n\n${formatShiftHistory(summary.recentShifts, new Date())}`,
      );
      return;
    }
    if (subcommand === "remove-time") {
      const shiftId = interaction.options.getInteger("shift", true);
      const minutes = interaction.options.getInteger("minutes", true);
      const reason = interaction.options.getString("reason", true);
      let updatedShift: StaffShift | undefined;
      try {
        updatedShift = removeShiftTime(target.id, shiftId, minutes);
      } catch (error) {
        if (!(error instanceof ShiftAdjustmentError)) throw error;
        await reply(interaction, "Time not removed", error.message);
        return;
      }
      if (!updatedShift) {
        await reply(interaction, "Shift not found", `Shift #${shiftId} was not found for ${target.username}.`);
        return;
      }
      const now = new Date();
      const duration = formatShiftDuration(shiftDurationMilliseconds(updatedShift, now));
      await auditAction(
        interaction.client,
        interaction,
        `Internal Affairs member <@${actor.id}> removed ${minutes} minutes from shift #${shiftId} for <@${target.id}>. New duration: ${duration}. Reason: ${reason}`,
      );
      await reply(interaction, "Shift time adjusted", `Removed ${minutes} minutes from ${target.username}'s shift #${shiftId}. Remaining duration: ${duration}.`);
      return;
    }

    if (!interaction.guild) {
      await reply(interaction, "Server only", "Shift administration can only be used in the configured server.");
      return;
    }
    if (!getActiveShift(target.id)) {
      await reply(interaction, "No active shift", `${target.username} is not currently on shift.`);
      return;
    }
    const targetMember = await interaction.guild.members.fetch(target.id);
    const reason = interaction.options.getString("reason") ?? "Forced clock-out by Internal Affairs.";
    const now = new Date();
    const endedShift = await clockMemberOut(targetMember, actor.id, reason, now);
    if (!endedShift) {
      await reply(interaction, "No active shift", `${target.username} is no longer on shift.`);
      return;
    }
    await auditAction(
      interaction.client,
      interaction,
      `Internal Affairs member <@${actor.id}> force-clocked out <@${target.id}> after ${formatShiftDuration(shiftDurationMilliseconds(endedShift, now))}. Reason: ${reason}`,
    );
    await reply(interaction, "Shift ended", `${target.username}'s shift was ended. Duration: ${formatShiftDuration(shiftDurationMilliseconds(endedShift, now))}.`);
    return;
  }

  await reply(interaction, "Not implemented", `/${commandName} is listed but needs server-specific setup before it can be enabled.`);
}

export function createTicketPanelMessage() {
  const categories = Object.entries(TICKET_CATEGORIES) as Array<[TicketCategory, (typeof TICKET_CATEGORIES)[TicketCategory]]>;
  const sections = [
    "### <:pin:1554160947013222541> | General Support Ticket\n> - Use this ticket for general questions, assistance, concerns, bug reports, or to report community rule violations.",
    "### <:hammer:1554160354408271912> | Report Ticket\n> - Report a staff member for misconduct or policy violations. All reports must include sufficient evidence (screenshots, videos, or other supporting documentation). False or malicious reports may result in disciplinary action.",
    "### <:partner:1554160299202846791> | Partnership Ticket\n> - Interested in partnering with **California State Roleplay**? Open this ticket to submit a partnership request. Your community must have **50 or more members**, maintain a professional environment, and meet our partnership requirements. View requirements in the **#dashboard** channel.",
    "### <:crown:1554160757757968405> | Community Support Ticket\n> - Contact the **Management Team & Ownership Team** regarding shop purchases, giveaway claims, role requests, administrative assistance, or other leadership-related inquiries.",
    [
      "### <:pin:1554160947013222541> | Before Opening a Ticket",
      "• Open only **one ticket per issue**.",
      "• Clearly explain your concern and provide as much information as possible.",
      "• Attach any relevant evidence to help us resolve your issue.",
      "• Remain respectful and professional throughout the support process.",
    ].join("\n"),
    "*Thank you for helping us keep **California State Roleplay** organized and professional. Our staff will assist you as soon as possible.*",
  ];
  const menu = new StringSelectMenuBuilder()
    .setCustomId("ticket:category")
    .setPlaceholder("Select a ticket category")
    .addOptions(categories.map(([category, details]) => ({
      label: details.label,
      description: details.description,
      value: category,
      emoji: details.emoji,
    })));
  const container = new ContainerBuilder()
    .setAccentColor(0xe4b84b)
    .addTextDisplayComponents(new TextDisplayBuilder().setContent([
      "## CSRP — Assistance",
      "",
      "*Welcome to the **California State Roleplay Support Center!** If you require assistance, please select the ticket that best matches your needs. Opening the correct ticket helps our team assist you as quickly and efficiently as possible.*",
    ].join("\n")));
  for (const section of sections) {
    container
      .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small))
      .addTextDisplayComponents(new TextDisplayBuilder().setContent(section));
  }
  container
    .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small))
    .addActionRowComponents(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu));
  return {
    flags: ["IsComponentsV2"] as const,
    components: [container],
    allowedMentions: { parse: [], roles: [...new Set(Object.values(TICKET_ROLES))] },
  };
}

async function postTicketPanel(interaction: ChatInputCommandInteraction): Promise<void> {
  const channel = interaction.channel;
  if (!channel || !("send" in channel)) {
    throw new Error("The ticket panel must be posted in a message channel.");
  }
  await channel.send(createTicketPanelMessage());
}

export function createTicketIntakeModal(category: TicketCategory): ModalBuilder {
  const details = TICKET_CATEGORIES[category];
  const modal = new ModalBuilder()
    .setCustomId(`ticket:submit:${category}`)
    .setTitle(`${details.label} Intake`)
    .addComponents(...details.questions.map((question) =>
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId(question.id)
          .setLabel(question.label)
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(true)
          .setMaxLength(1000),
      ),
    ));
  if (category === "report-ticket") {
    modal.addComponents(
      new LabelBuilder()
        .setLabel("Evidence file (optional)")
        .setDescription("Attach up to three files. If you have a link, use the field below instead.")
        .setFileUploadComponent(
          new FileUploadBuilder()
            .setCustomId("evidence")
            .setRequired(false)
            .setMinValues(0)
            .setMaxValues(3),
        ),
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId("evidence_link")
          .setLabel("Evidence link (optional)")
          .setStyle(TextInputStyle.Short)
          .setRequired(false)
          .setMaxLength(1000),
      ),
    );
  }
  return modal;
}

export async function executeTicketSelectMenu(interaction: StringSelectMenuInteraction): Promise<boolean> {
  if (interaction.customId !== "ticket:category") return false;
  const category = interaction.values[0];
  if (!category || !Object.hasOwn(TICKET_CATEGORIES, category)) {
    await interaction.reply({ ...v2Message("Category unavailable", "Choose one of the ticket categories shown in the menu."), flags: v2Flags(true) });
    return true;
  }
  await interaction.showModal(createTicketIntakeModal(category as TicketCategory));
  return true;
}

function ticketControls(): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId("ticket:claim").setLabel("Claim ticket").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId("ticket:close").setLabel("Close ticket").setStyle(ButtonStyle.Danger),
  );
}

function ticketStaffRoleIds(): Set<string> {
  const roles = new Set<string>(Object.values(TICKET_ROLES));
  if (config.ticketStaffRoleId) roles.add(config.ticketStaffRoleId);
  return roles;
}

async function isTicketStaffButton(interaction: ButtonInteraction): Promise<boolean> {
  if (interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) return true;
  if (!interaction.guild) return false;
  const member = await interaction.guild.members.fetch(interaction.user.id);
  const roles = ticketStaffRoleIds();
  return member.roles.cache.some((role) => roles.has(role.id));
}

async function editTicketButtonReply(interaction: ButtonInteraction, title: string, body: string): Promise<void> {
  const message = v2Message(title, body);
  if (!message.components || !message.allowedMentions) {
    throw new Error("Could not build a Components V2 ticket response.");
  }
  await interaction.editReply({
    flags: MessageFlags.IsComponentsV2,
    components: message.components,
    allowedMentions: message.allowedMentions,
  });
}

async function editTicketModalReply(interaction: ModalSubmitInteraction, title: string, body: string): Promise<void> {
  const message = v2Message(title, body);
  if (!message.components || !message.allowedMentions) {
    throw new Error("Could not build a Components V2 ticket response.");
  }
  await interaction.editReply({
    flags: MessageFlags.IsComponentsV2,
    components: message.components,
    allowedMentions: message.allowedMentions,
  });
}

async function createTicketFromModal(interaction: ModalSubmitInteraction, category: TicketCategory): Promise<void> {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const guild = interaction.guild;
  if (!guild || guild.id !== config.guildId) {
    await editTicketModalReply(interaction, "Ticket unavailable", "Tickets can only be opened in the configured server.");
    return;
  }

  const existing = database.prepare("SELECT channel_id FROM tickets WHERE opener_id = ? AND status = 'open'").get(interaction.user.id) as
    | { channel_id: string }
    | undefined;
  if (existing) {
    const channel = await guild.channels.fetch(existing.channel_id);
    if (channel) {
      await editTicketModalReply(interaction, "Ticket already open", `Your current ticket is ${channel}.`);
      return;
    }
    database.prepare("UPDATE tickets SET status = 'closed', closed_at = datetime('now') WHERE channel_id = ?").run(existing.channel_id);
  }

  const details = TICKET_CATEGORIES[category];
  const answers = details.questions.map((question) => ({
    label: question.label,
    value: interaction.fields.getTextInputValue(question.id).trim(),
  }));
  const evidence = category === "report-ticket"
    ? interaction.fields.getUploadedFiles("evidence", false)
    : null;
  const evidenceLink = category === "report-ticket"
    ? interaction.fields.getTextInputValue("evidence_link").trim()
    : "";
  const slug = interaction.user.username.toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-").slice(0, 40);
  const permissionOverwrites = [
    { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
    { id: interaction.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.AttachFiles] },
    { id: interaction.client.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.ManageChannels] },
    ...[...new Set([TICKET_ROLES[category], config.ticketStaffRoleId].filter((roleId): roleId is string => Boolean(roleId)))].map((roleId) => ({
      id: roleId,
      allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory],
    })),
  ];
  const ticketChannel = await guild.channels.create({
    name: `ticket-${category}-${slug || "member"}-${Date.now().toString(36)}`,
    type: ChannelType.GuildText,
    parent: TICKET_PARENT_CATEGORIES[category],
    permissionOverwrites,
  });
  database.prepare("INSERT INTO tickets (channel_id, opener_id) VALUES (?, ?)").run(ticketChannel.id, interaction.user.id);

  const intakeEmbed = new EmbedBuilder()
    .setColor(0xe4b84b)
    .setTitle(`${details.label} | Ticket Intake`)
    .setDescription(`Welcome <@${interaction.user.id}>. Your private support request is open.\n<@&${TICKET_ROLES[category]}>`)
    .addFields(
      { name: "Ticket category", value: details.label, inline: true },
      { name: "Submitted by", value: `<@${interaction.user.id}>`, inline: true },
      ...answers.map((answer) => ({ name: answer.label, value: answer.value || "Not provided", inline: false })),
    )
    .setFooter({ text: "A staff member can claim this ticket using the controls below." })
    .setTimestamp();
  if (evidence?.size) {
    intakeEmbed.addFields({
      name: "Attached evidence",
      value: [...evidence.values()].map((attachment) => `[${attachment.name}](<${attachment.url}>)`).join("\n").slice(0, 1024),
    });
  }
  if (evidenceLink) {
    intakeEmbed.addFields({ name: "Evidence link", value: evidenceLink });
  }
  await ticketChannel.send({
    embeds: [intakeEmbed],
    components: [ticketControls()],
    allowedMentions: { parse: [], roles: [TICKET_ROLES[category]], users: [interaction.user.id] },
  });
  await audit(interaction.client, "ticket opened", `Ticket <#${ticketChannel.id}> opened by <@${interaction.user.id}> for ${details.label}.`, {
    guildId: guild.id,
    actorId: interaction.user.id,
    subjectId: ticketChannel.id,
  });
  await editTicketModalReply(interaction, "Ticket created", `Your private ${details.label.toLowerCase()} ticket is ${ticketChannel}.`);
}

export async function executeTicketModal(interaction: ModalSubmitInteraction): Promise<boolean> {
  const match = /^ticket:submit:(general-support|report-ticket|partnership-ticket|community-support)$/.exec(interaction.customId);
  if (!match) return false;
  await createTicketFromModal(interaction, match[1] as TicketCategory);
  return true;
}

export async function executeTicketButton(interaction: ButtonInteraction): Promise<boolean> {
  if (interaction.customId === "ticket:create") {
    await interaction.reply({ ...v2Message("Choose a category", "Use the dropdown in the support panel to select the right ticket type."), flags: v2Flags(true) });
    return true;
  }
  if (interaction.customId !== "ticket:claim" && interaction.customId !== "ticket:close") return false;
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const ticket = database.prepare("SELECT opener_id, claimed_by, status FROM tickets WHERE channel_id = ?").get(interaction.channelId) as
    | { opener_id: string; claimed_by: string | null; status: string }
    | undefined;
  if (!ticket || ticket.status !== "open" || !interaction.guild) {
    await editTicketButtonReply(interaction, "Ticket unavailable", "This control only works in an open support ticket.");
    return true;
  }

  if (interaction.customId === "ticket:claim") {
    if (!(await isTicketStaffButton(interaction))) {
      await editTicketButtonReply(interaction, "Permission denied", "Only ticket staff can claim tickets.");
      return true;
    }
    const result = database.prepare("UPDATE tickets SET claimed_by = ? WHERE channel_id = ? AND status = 'open' AND claimed_by IS NULL")
      .run(interaction.user.id, interaction.channelId);
    if (Number(result.changes) === 0) {
      const current = database.prepare("SELECT claimed_by FROM tickets WHERE channel_id = ?").get(interaction.channelId) as
        | { claimed_by: string | null }
        | undefined;
      await editTicketButtonReply(interaction, "Already claimed", current?.claimed_by
        ? `This ticket is already claimed by <@${current.claimed_by}>.`
        : "This ticket is no longer available to claim.");
      return true;
    }
    const staffMember = await interaction.guild.members.fetch(interaction.user.id);
    if (!interaction.channel || !("send" in interaction.channel)) {
      throw new Error("The claimed ticket channel cannot send messages.");
    }
    await interaction.channel.send(`*Greeting, I am **${staffMember.displayName}** and I will be assisting you today.*`);
    await audit(interaction.client, "ticket claimed", `Ticket <#${interaction.channelId}> claimed by <@${interaction.user.id}>.`, {
      guildId: interaction.guild.id,
      actorId: interaction.user.id,
      subjectId: interaction.channelId,
    });
    await editTicketButtonReply(interaction, "Ticket claimed", `You are now assisting the member in <#${interaction.channelId}>.`);
    return true;
  }

  if (!(await isTicketStaffButton(interaction)) && ticket.opener_id !== interaction.user.id) {
    await editTicketButtonReply(interaction, "Permission denied", "Only the ticket opener or ticket staff can close this ticket.");
    return true;
  }
  database.prepare("UPDATE tickets SET status = 'closed', closed_at = datetime('now') WHERE channel_id = ?").run(interaction.channelId);
  const channel = interaction.channel;
  if (channel && "permissionOverwrites" in channel) {
    await channel.permissionOverwrites.edit(ticket.opener_id, { SendMessages: false });
  }
  await audit(interaction.client, "ticket closed", `Ticket <#${interaction.channelId}> closed by <@${interaction.user.id}>.`, {
    guildId: interaction.guild.id,
    actorId: interaction.user.id,
    subjectId: interaction.channelId,
  });
  await editTicketButtonReply(interaction, "Ticket closed", "This support ticket has been closed.");
  return true;
}

export function getCommandData(): Command[] {
  return commandBuilders;
}
