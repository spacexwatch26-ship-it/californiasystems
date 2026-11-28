import assert from "node:assert/strict";
import { after, test } from "node:test";
import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import { once } from "node:events";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { MessageFlags } from "discord.js";
import { v2ButtonMessage, v2Flags, v2Message } from "../dist/ui.js";

const databasePath = join(tmpdir(), `california-state-roleplay-${randomUUID()}.sqlite`);
const sessionPollChannelId = "test-session-poll-channel";
const sessionAnnouncementChannelId = "test-session-announcement-channel";
const punishmentChannelId = "test-punishment-channel";
const punishmentLogChannelId = "test-punishment-log-channel";
process.env.DISCORD_TOKEN = "test-token";
process.env.DISCORD_CLIENT_ID = "test-client";
process.env.DISCORD_GUILD_ID = "test-guild";
process.env.LOG_CHANNEL_ID = "test-log-channel";
process.env.COMMAND_LOG_CHANNEL_ID = "test-command-log-channel";
process.env.SESSION_POLL_CHANNEL_ID = sessionPollChannelId;
process.env.SESSION_ANNOUNCEMENT_CHANNEL_ID = sessionAnnouncementChannelId;
process.env.TICKET_LOG_CHANNEL_ID = "test-ticket-log-channel";
process.env.MODERATION_LOG_CHANNEL_ID = "test-moderation-log-channel";
process.env.MESSAGE_LOG_CHANNEL_ID = "test-message-log-channel";
process.env.MEMBER_LOG_CHANNEL_ID = "test-member-log-channel";
process.env.CHANNEL_LOG_CHANNEL_ID = "test-channel-log-channel";
process.env.ROLE_LOG_CHANNEL_ID = "test-role-log-channel";
process.env.VOICE_LOG_CHANNEL_ID = "test-voice-log-channel";
process.env.EMOJI_LOG_CHANNEL_ID = "test-emoji-log-channel";
process.env.ERLC_911_CHANNEL_ID = "test-911-channel";
process.env.APPLICATION_REVIEW_CHANNEL_ID = "test-application-review-channel";
process.env.APPLICATION_RESULTS_CHANNEL_ID = "test-application-results-channel";
process.env.PUNISHMENT_CHANNEL_ID = punishmentChannelId;
process.env.PUNISHMENT_LOG_CHANNEL_ID = punishmentLogChannelId;
process.env.ERLC_SERVER_KEY = "test-server-key";
process.env.WEBHOOK_SECRET = "test-webhook-secret-with-at-least-32-chars";
process.env.STATUS_DASHBOARD_PASSWORD = "test-dashboard-password-1234";
process.env.DATABASE_PATH = databasePath;

const legacyDatabase = new DatabaseSync(databasePath);
legacyDatabase.exec(`
  CREATE TABLE session_polls (
    poll_id TEXT PRIMARY KEY,
    guild_id TEXT NOT NULL,
    channel_id TEXT NOT NULL,
    message_id TEXT NOT NULL UNIQUE,
    notification_role_id TEXT NOT NULL,
    threshold INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    ended_at TEXT
  );
  CREATE TABLE session_votes (
    poll_id TEXT NOT NULL REFERENCES session_polls(poll_id) ON DELETE CASCADE,
    user_id TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (poll_id, user_id)
  );
  CREATE TABLE staff_records (
    id INTEGER PRIMARY KEY,
    record_type TEXT NOT NULL,
    member_id TEXT NOT NULL,
    actor_id TEXT NOT NULL,
    reason TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    revoked_at TEXT
  );
  INSERT INTO session_polls (poll_id, guild_id, channel_id, message_id, notification_role_id, threshold, created_by)
  VALUES ('legacy-poll', 'test-guild', 'test-channel', 'legacy-message', 'old-role', 25, 'test-user');
  INSERT INTO session_votes (poll_id, user_id) VALUES ('legacy-poll', 'legacy-voter');
  INSERT INTO staff_records (record_type, member_id, actor_id, reason)
  VALUES ('punish', 'legacy-staff-member', 'legacy-issuer', 'Existing punishment');
`);
legacyDatabase.close();

const {
  createTicketIntakeModal,
  createTicketPanelMessage,
  executeCommand,
  executeTicketButton,
  executeTicketModal,
  executeTicketSelectMenu,
  getCommandData,
  SESSION_COMMAND_ROLE_ID,
} = await import("../dist/commands.js");
const {
  createGuidelinesPanelMessage,
  executeGuidelinesButton,
  getGuidelinesRuleCounts,
} = await import("../dist/guidelines.js");
const { database } = await import("../dist/database.js");
const { audit } = await import("../dist/logging.js");
const { addCalendarMonths } = await import("../dist/punishment.js");
const { createWebhookServer } = await import("../dist/webhook.js");
const {
  closeModeratorApplications,
  executeModeratorApplicationButton,
  executeModeratorApplicationModal,
  handleModeratorApplicationDM,
  openModeratorApplications,
} = await import("../dist/moderator-application.js");
const {
  createSessionEndMessage,
  createSessionStartMessage,
  executeSessionAnnouncementSelect,
  fetchSessionServerStats,
  QUICK_JOIN_LINK,
  refreshSessionAnnouncements,
  SESSION_ANNOUNCEMENT_REFRESH_INTERVAL_MS,
  SESSION_PING_ROLE_ID,
} = await import("../dist/session-announcement.js");
const {
  clockMemberIn,
  clockMemberOut,
  executeShiftButton,
  getShiftWeekWindow,
  getWeeklyShiftTotals,
  getActiveShift,
  INTERNAL_AFFAIRS_ROLE_ID,
  ON_SHIFT_ROLE_ID,
  removeShiftTime,
  ShiftAdjustmentError,
  STAFF_ROLE_ID,
} = await import("../dist/shifts.js");
const {
  SESSION_VOTE_EMOJI_ID,
  SESSION_VOTE_THRESHOLD,
  SESSION_VOTERS_EMOJI_ID,
  COMMUNITY_MEMBER_ROLE_ID,
  buildSessionVoteContainer,
  createSessionVoteMessage,
  executeSessionVoteButton,
  getSessionPoll,
  getSessionVoters,
  recordSessionVote,
  saveSessionPoll,
} = await import("../dist/session-vote.js");
let webhookServer;

after(async () => {
  if (webhookServer?.listening) {
    await new Promise((resolve) => webhookServer.close(resolve));
  }
  database.close();
  rmSync(databasePath, { force: true });
});

test("bot messages are Components V2 with mentions disabled", () => {
  const message = v2Message("Test", "V2 body");
  assert.ok((message.flags & MessageFlags.IsComponentsV2) !== 0);
  assert.equal(message.embeds, undefined);
  assert.deepEqual(message.allowedMentions, { parse: [] });
  const component = message.components?.[0]?.toJSON();
  assert.equal(component?.type, 17);
  assert.match(component?.components?.[0]?.content, /California State Roleplay/);
  assert.deepEqual(v2Flags(true), ["IsComponentsV2", "Ephemeral"]);

  const panel = v2ButtonMessage("Tickets", "Open one", "Create ticket", "ticket:create");
  assert.ok((panel.flags & MessageFlags.IsComponentsV2) !== 0);
  assert.equal(panel.components?.[0]?.toJSON().components?.[1]?.type, 1);
});

test("ticket panel preserves the support copy and adds the category dropdown", () => {
  const panel = createTicketPanelMessage();
  const container = panel.components[0].toJSON();
  const panelText = container.components
    .filter((component) => component.type === 10)
    .map((component) => component.content)
    .join("\n");
  const menu = container.components.find((component) => component.type === 1).components[0];
  const categories = menu.options.map((option) => option.value);

  assert.ok(panel.flags.includes("IsComponentsV2"));
  assert.equal(panel.embeds, undefined);
  assert.equal(menu.custom_id, "ticket:category");
  assert.deepEqual(categories, ["general-support", "report-ticket", "partnership-ticket", "community-support"]);
  assert.deepEqual(
    menu.options.map((option) => option.emoji.id),
    ["1554160947013222541", "1554160354408271912", "1554160299202846791", "1554160757757968405"],
  );
  assert.match(panelText, /CSRP — Assistance/);
  assert.match(panelText, /Welcome to the \*\*California State Roleplay Support Center!\*\*/);
  assert.match(panelText, /\*\*<:pin:1554160947013222541> \| General Support Ticket\*\*/);
  assert.match(panelText, /> \*- Use this ticket for general questions/);
  assert.match(panelText, /general questions, assistance, concerns, bug reports, or to report community rule violations/);
  assert.match(panelText, /False or malicious reports may result in disciplinary action/);
  assert.match(panelText, /50 or more members/);
  assert.match(panelText, /Management Team & Ownership Team/);
  assert.match(panelText, /Thank you for helping us keep \*\*California State Roleplay\*\* organized and professional/);
  assert.doesNotMatch(panelText, /Morse Roleplay/);
  assert.deepEqual(panel.allowedMentions.roles, [
    "1524688682702082159",
    "1445540175341158611",
    "1475565354838392842",
  ]);
  assert.equal(container.components.filter((component) => component.type === 14).length, 7);
});

test("ticket intake requires report answers and leaves evidence file/link optional", () => {
  const report = createTicketIntakeModal("report-ticket").toJSON();
  const rows = report.components;
  const textInputs = rows
    .filter((component) => component.type === 1)
    .flatMap((row) => row.components);
  const fileLabel = rows.find((component) => component.type === 18);
  const upload = fileLabel.component;

  assert.equal(report.custom_id, "ticket:submit:report-ticket");
  assert.deepEqual(textInputs.map((input) => input.custom_id), ["reported_member", "report_reason", "evidence_link"]);
  assert.equal(textInputs[0].required, true);
  assert.equal(textInputs[1].required, true);
  assert.equal(textInputs[2].required, false);
  assert.equal(fileLabel.label, "Evidence file (optional)");
  assert.equal(upload.custom_id, "evidence");
  assert.equal(upload.required, false);
  assert.equal(upload.min_values, 0);
  assert.equal(upload.max_values, 3);

  for (const category of ["general-support", "partnership-ticket", "community-support"]) {
    const modal = createTicketIntakeModal(category).toJSON();
    assert.ok(modal.components.every((row) => row.components.every((input) => input.required)));
  }
  assert.equal(createTicketIntakeModal("partnership-ticket").toJSON().components.length, 3);
});

test("ticket dropdown opens the selected form and creates a categorized, role-pinged ticket that staff can claim", async () => {
  let selectedModal;
  assert.equal(await executeTicketSelectMenu({
    customId: "ticket:category",
    values: ["report-ticket"],
    showModal: async (modal) => { selectedModal = modal; },
  }), true);
  assert.equal(selectedModal.toJSON().custom_id, "ticket:submit:report-ticket");

  const channelId = `test-ticket-${randomUUID()}`;
  const openerId = `ticket-opener-${randomUUID()}`;
  const staffId = `ticket-staff-${randomUUID()}`;
  const reportRoleId = "1445540175341158611";
  const sentMessages = [];
  let channelOptions;
  const ticketChannel = {
    id: channelId,
    send: async (message) => { sentMessages.push(message); },
  };
  const logChannel = {
    guildId: "test-guild",
    isTextBased: () => true,
    isDMBased: () => false,
    send: async () => {},
  };
  const client = {
    user: { id: "ticket-bot" },
    channels: { fetch: async () => logChannel },
  };
  const staffMember = {
    displayName: "Example Staff",
    roles: {
      cache: {
        some: (predicate) => predicate({ id: reportRoleId }),
      },
    },
  };
  const guild = {
    id: "test-guild",
    roles: { everyone: { id: "test-everyone" } },
    channels: {
      create: async (options) => {
        channelOptions = options;
        return ticketChannel;
      },
    },
    members: { fetch: async () => staffMember },
  };
  const answerById = {
    reported_member: "Staff member (123456789)",
    report_reason: "I am reporting the behavior described here.",
    evidence_link: "https://example.com/evidence",
  };
  const attachments = new Map([
    ["report-file", { name: "evidence.png", url: "https://cdn.discordapp.com/attachments/evidence.png" }],
  ]);
  const modalInteraction = {
    customId: "ticket:submit:report-ticket",
    guild,
    user: { id: openerId, username: "ticket-opener" },
    client,
    fields: {
      getTextInputValue: (id) => answerById[id],
      getUploadedFiles: () => attachments,
    },
    deferReply: async () => {},
    editReply: async () => {},
  };

  assert.equal(await executeTicketModal(modalInteraction), true);
  assert.equal(channelOptions.parent, "1522888236064706620");
  assert.match(channelOptions.name, /^ticket-\d{4}$/);
  assert.equal(channelOptions.permissionOverwrites.some((overwrite) => overwrite.id === reportRoleId), true);
  assert.equal(sentMessages[0].content, `<@&${reportRoleId}>`);
  assert.ok(sentMessages[0].embeds[0].data.description.includes(`<@&${reportRoleId}>`));
  assert.match(sentMessages[0].embeds[0].data.fields.map((field) => field.value).join("\n"), /Staff member \(123456789\)/);
  assert.equal(sentMessages[0].components[0].toJSON().components[0].custom_id, "ticket:claim");

  const claimInteraction = {
    customId: "ticket:claim",
    channelId,
    channel: ticketChannel,
    guild,
    user: { id: staffId },
    client,
    memberPermissions: { has: () => false },
    deferReply: async () => {},
    editReply: async () => {},
  };
  assert.equal(await executeTicketButton(claimInteraction), true);
  assert.equal(sentMessages[1], "*Greeting, I am **Example Staff** and I will be assisting you today.*");
  database.prepare("DELETE FROM tickets WHERE channel_id = ?").run(channelId);
});

test("ticket close asks for confirmation and deletes only after confirmation", async () => {
  const channelId = `test-close-${randomUUID()}`;
  const openerId = `close-opener-${randomUUID()}`;
  database.prepare(
    "INSERT INTO tickets (channel_id, opener_id, status, ticket_number) VALUES (?, ?, 'open', ?)",
  ).run(channelId, openerId, 9001);

  let deleted = false;
  const ticketChannel = {
    delete: async () => { deleted = true; },
  };
  const logChannel = {
    guildId: "test-guild",
    isTextBased: () => true,
    isDMBased: () => false,
    send: async () => {},
  };
  const client = { channels: { fetch: async () => logChannel } };
  const guild = {
    id: "test-guild",
    members: { fetch: async () => ({ roles: { cache: { some: () => false } } }) },
  };
  let confirmation;
  const closeInteraction = {
    customId: "ticket:close",
    channelId,
    channel: ticketChannel,
    guild,
    user: { id: openerId, tag: "opener#0001" },
    client,
    memberPermissions: { has: () => false },
    reply: async (message) => { confirmation = message; },
  };
  assert.equal(await executeTicketButton(closeInteraction), true);
  assert.equal(deleted, false);
  const confirmationJson = confirmation.components[0].toJSON();
  const confirmationButtons = confirmationJson.components
    .filter((component) => component.type === 1)
    .flatMap((component) => component.components);
  assert.deepEqual(
    confirmationButtons.map((button) => button.custom_id),
    ["ticket:close-confirm", "ticket:close-cancel"],
  );

  const confirmInteraction = {
    customId: "ticket:close-confirm",
    channelId,
    channel: ticketChannel,
    guild,
    user: { id: openerId, tag: "opener#0001" },
    client,
    memberPermissions: { has: () => false },
    deferReply: async () => {},
    editReply: async () => {},
  };
  assert.equal(await executeTicketButton(confirmInteraction), true);
  assert.equal(deleted, true);
  const ticket = database.prepare("SELECT status FROM tickets WHERE channel_id = ?").get(channelId);
  assert.equal(ticket.status, "closed");
  database.prepare("DELETE FROM tickets WHERE channel_id = ?").run(channelId);
});

test("guidelines panel includes private regulation readers and both Terms links", () => {
  const message = createGuidelinesPanelMessage();
  const component = message.components[0].toJSON();
  const sections = component.components.filter((entry) => entry.type === 9);
  const text = component.components
    .flatMap((entry) => entry.type === 10
      ? [entry.content]
      : entry.type === 9
        ? entry.components.filter((sectionEntry) => sectionEntry.type === 10).map((sectionEntry) => sectionEntry.content)
        : [])
    .join("\n");
  const buttons = component.components
    .filter((entry) => entry.type === 1)
    .flatMap((entry) => entry.components);
  const linkButtons = buttons.filter((button) => button.style === 5);
  const sectionButtons = sections.map((section) => section.accessory);

  assert.ok((message.flags & MessageFlags.IsComponentsV2) !== 0);
  assert.match(text, /All members must follow Discord's Terms of Service and Roblox's Terms of Use/);
  assert.match(text, /Banned Weapons\*\*\nComing soon/);
  assert.deepEqual(getGuidelinesRuleCounts(), { discord: 53, ingame: 63 });
  assert.deepEqual(
    sectionButtons.map((button) => button.label),
    ["Read", "Read", "Read", "Read", "Read"],
  );
  assert.deepEqual(
    sectionButtons.map((button) => button.custom_id),
    [
      "guidelines:read:discord",
      "guidelines:read:ingame",
      "guidelines:pending:weapons",
      "guidelines:pending:vehicles",
      "guidelines:pending:roleplays",
    ],
  );
  assert.deepEqual(
    linkButtons.map((button) => button.url),
    ["https://discord.com/terms", "https://www.roblox.com/info/terms"],
  );
  assert.deepEqual(message.files.map((file) => file.name), ["CSRP-Guidelines.png"]);
});

test("/guidelines posts the public panel and privately confirms it", async () => {
  const posted = [];
  const replies = [];
  const actions = [];
  await executeCommand({
    commandName: "guidelines",
    user: { id: "guidelines-admin" },
    memberPermissions: { has: () => true },
    deferred: true,
    channelId: "guidelines-channel",
    channel: { send: async (message) => { posted.push(message); } },
    editReply: async (message) => { replies.push(message); },
  }, actions);

  assert.equal(posted.length, 1);
  assert.ok((posted[0].flags & MessageFlags.IsComponentsV2) !== 0);
  assert.match(replies[0].components[0].toJSON().components[0].content, /Guidelines panel posted/);
  assert.deepEqual(actions, ["Guidelines panel posted in <#guidelines-channel>."]);
});

test("guidelines readers are private, paginated, and omit the unfinished in-game 10.6", async () => {
  let replyPayload;
  let updatePayload;
  const interaction = {
    customId: "guidelines:read:ingame",
    reply: async (payload) => { replyPayload = payload; },
    update: async (payload) => { updatePayload = payload; },
  };

  assert.equal(await executeGuidelinesButton(interaction), true);
  assert.deepEqual(replyPayload.flags, v2Flags(true));
  const firstPageText = replyPayload.components[0].toJSON().components
    .filter((entry) => entry.type === 10)
    .map((entry) => entry.content)
    .join("\n");
  assert.match(firstPageText, /Official Community Regulations & Standards/);
  assert.match(firstPageText, /This guidelines view is private/);

  interaction.customId = "guidelines:page:ingame:10";
  await executeGuidelinesButton(interaction);
  const lastPageText = updatePayload.components[0].toJSON().components
    .filter((entry) => entry.type === 10)
    .map((entry) => entry.content)
    .join("\n");
  assert.match(lastPageText, /10\.5 Permanent Removal/);
  assert.match(lastPageText, /source ends with an unfinished “10\.6”/);
  assert.doesNotMatch(lastPageText, /(?:^|\n)10\.6(?:\s|$)/);
});

test("slash command definitions serialize without duplicate names", () => {
  const commands = getCommandData().map((command) => command.toJSON());
  const names = commands.map((command) => command.name);
  assert.ok(names.includes("911"));
  assert.ok(names.includes("call911"));
  assert.ok(names.includes("mod"));
  assert.ok(names.includes("session-vote"));
  assert.ok(names.includes("shift-management"));
  assert.ok(names.includes("shift-leadership"));
  assert.ok(names.includes("shift-admin"));
  assert.ok(names.includes("guidelines"));
  assert.ok(names.includes("app-open"));
  assert.ok(names.includes("app-close"));
  assert.ok(!names.includes("shift"));
  const say = commands.find((command) => command.name === "say");
  assert.equal(say.options.find((option) => option.name === "embed").required, true);
  const punish = commands.find((command) => command.name === "punish");
  assert.deepEqual(
    punish.options.find((option) => option.name === "type").choices.map((choice) => choice.value),
    ["Verbal Warning", "Written Warning", "Strike", "Suspension", "Termination"],
  );
  const shiftAdmin = commands.find((command) => command.name === "shift-admin");
  assert.ok(shiftAdmin.options.some((option) => option.name === "remove-time"));
  assert.equal(new Set(names).size, names.length);
  assert.ok(names.length >= 30);
});

test("staff record migration preserves old punishments and adds punishment detail fields", () => {
  const record = database.prepare("SELECT member_id, reason FROM staff_records WHERE id = 1").get();
  assert.equal(record.member_id, "legacy-staff-member");
  assert.equal(record.reason, "Existing punishment");
  const columns = database.prepare("PRAGMA table_info(staff_records)").all().map((column) => column.name);
  assert.ok(columns.includes("punishment_id"));
  assert.ok(columns.includes("punishment_type"));
  assert.ok(columns.includes("expires_at"));
});

test("/say can post an embed or a plain message", async () => {
  const sent = [];
  for (const asEmbed of [true, false]) {
    const options = {
      getString: () => "Test announcement",
      getBoolean: (name) => name === "embed" ? asEmbed : false,
    };
    await executeCommand({
      commandName: "say",
      user: { id: "say-admin" },
      memberPermissions: { has: () => true },
      options,
      channelId: "say-channel",
      channel: { send: async (message) => { sent.push(message); } },
      reply: async () => {},
    }, []);
  }

  assert.equal(sent.length, 2);
  assert.equal(sent[0].embeds[0].toJSON().title, "California State Roleplay");
  assert.equal(sent[0].embeds[0].toJSON().description, "Test announcement");
  assert.equal(sent[0].content, undefined);
  assert.deepEqual(sent[0].allowedMentions, { parse: [] });
  assert.equal(sent[1].content, "Test announcement");
  assert.equal(sent[1].embeds, undefined);
  assert.deepEqual(sent[1].allowedMentions, { parse: [] });
});

test("/punish posts a branded V2 card and privately returns a unique ID", async () => {
  assert.equal(
    addCalendarMonths(new Date("2024-01-31T12:00:00.000Z"), 2).toISOString(),
    "2024-03-31T12:00:00.000Z",
  );
  assert.equal(
    addCalendarMonths(new Date("2024-12-31T12:00:00.000Z"), 2).toISOString(),
    "2025-02-28T12:00:00.000Z",
  );
  const sent = [];
  const replies = [];
  const actions = [];
  const client = {
    channels: {
      fetch: async (id) => ({
        id,
        guildId: "test-guild",
        isTextBased: () => true,
        isDMBased: () => false,
        send: async (message) => { sent.push({ channelId: id, message }); },
      }),
    },
  };
  const target = { id: `punishment-target-${randomUUID()}`, tag: "Target#0001" };
  await executeCommand({
    commandName: "punish",
    user: { id: "punishment-issuer" },
    guildId: "test-guild",
    guild: {
      members: {
        fetch: async () => ({ roles: { cache: { has: (roleId) => roleId === INTERNAL_AFFAIRS_ROLE_ID } } }),
      },
    },
    memberPermissions: { has: () => true },
    options: {
      getUser: () => target,
      getString: (name) => name === "type" ? "Written Warning" : "Failure to meet quota",
    },
    client,
    reply: async (payload) => { replies.push(payload); },
  }, actions);

  assert.equal(sent.length, 1);
  assert.equal(sent[0].channelId, punishmentChannelId);
  const publicMessage = sent[0].message;
  assert.ok((publicMessage.flags & MessageFlags.IsComponentsV2) !== 0);
  assert.deepEqual(publicMessage.allowedMentions, { parse: [], users: [target.id] });
  assert.deepEqual(publicMessage.files.map((file) => file.name), [
    "CSRP-Punishment-Top.png",
    "CSRP-Punishment-Bottom.png",
  ]);
  const components = publicMessage.components[0].toJSON().components;
  assert.equal(components[0].items[0].media.url, "attachment://CSRP-Punishment-Top.png");
  assert.equal(components[8].items[0].media.url, "attachment://CSRP-Punishment-Bottom.png");
  for (const index of [1, 3, 5, 7]) {
    assert.equal(components[index].type, 14);
    assert.equal(components[index].spacing, 2);
  }
  assert.match(components[2].content, /## Punishment Issued/);
  assert.match(components[2].content, /> \*\*Status:\*\* Active/);
  assert.match(components[4].content, /## Personnel Information/);
  assert.match(components[4].content, new RegExp(`<@${target.id}>`));
  assert.match(components[6].content, /## Punishment Details/);
  assert.match(components[6].content, /Written Warning/);
  assert.match(components[6].content, /Failure to meet quota/);

  const punishmentId = components[2].content.match(/Punishment ID:\*\* (\d{8})/)[1];
  const record = database.prepare(`
    SELECT member_id, actor_id, punishment_type, reason, created_at, expires_at
    FROM staff_records WHERE punishment_id = ?
  `).get(punishmentId);
  assert.equal(record.member_id, target.id);
  assert.equal(record.actor_id, "punishment-issuer");
  assert.equal(record.punishment_type, "Written Warning");
  assert.equal(record.reason, "Failure to meet quota");
  const issuedAt = new Date(record.created_at);
  const expiresAt = new Date(record.expires_at);
  assert.equal(
    (expiresAt.getUTCFullYear() - issuedAt.getUTCFullYear()) * 12 + expiresAt.getUTCMonth() - issuedAt.getUTCMonth(),
    2,
  );
  assert.equal(expiresAt.getUTCDate(), issuedAt.getUTCDate());
  assert.equal(replies.length, 1);
  assert.deepEqual(replies[0].flags, v2Flags(true));
  assert.match(replies[0].components[0].toJSON().components[0].content, new RegExp(
    `This user has been punished\\. Punishment ID is ${punishmentId}`,
  ));
  assert.equal(actions.length, 1);

  const terminationTarget = { id: `termination-target-${randomUUID()}`, tag: "Terminated#0001" };
  const terminationReplies = [];
  await executeCommand({
    commandName: "punish",
    user: { id: "punishment-issuer" },
    guildId: "test-guild",
    guild: {
      members: {
        fetch: async () => ({ roles: { cache: { has: (roleId) => roleId === INTERNAL_AFFAIRS_ROLE_ID } } }),
      },
    },
    memberPermissions: { has: () => true },
    options: {
      getUser: () => terminationTarget,
      getString: (name) => name === "type" ? "Termination" : "Termination",
    },
    client,
    reply: async (payload) => { terminationReplies.push(payload); },
  }, []);
  assert.equal(sent[1].channelId, punishmentChannelId);
  const terminationComponents = sent[1].message.components[0].toJSON().components;
  const terminationCard = terminationComponents[6].content;
  assert.match(terminationCard, /No expiration \(Termination\)/);
  const terminationId = terminationComponents[2].content.match(/Punishment ID:\*\* (\d{8})/)?.[1];
  assert.ok(terminationId);
  assert.equal(database.prepare("SELECT expires_at FROM staff_records WHERE punishment_id = ?").get(terminationId).expires_at, null);
  assert.notEqual(terminationId, punishmentId);
  assert.match(terminationReplies[0].components[0].toJSON().components[0].content, new RegExp(terminationId));
});

test("punishment commands require the Internal Affairs role even for administrators", async () => {
  const replies = [];
  const sent = [];
  await executeCommand({
    commandName: "punish",
    user: { id: "not-internal-affairs" },
    guildId: "test-guild",
    guild: {
      members: {
        fetch: async () => ({ roles: { cache: { has: () => false } } }),
      },
    },
    memberPermissions: { has: () => true },
    options: {
      getUser: () => ({ id: "punishment-target", tag: "Target#0001" }),
      getString: (name) => name === "type" ? "Written Warning" : "Test reason",
    },
    client: { channels: { fetch: async () => ({ send: async (message) => sent.push(message) }) } },
    reply: async (payload) => replies.push(payload),
  }, []);

  assert.equal(sent.length, 0);
  assert.match(replies[0].components[0].toJSON().components[0].content, /Only Internal Affairs can use punishment commands/);
});

test("session-end announcement matches the branded session card and offers notification opt-in", () => {
  const message = createSessionEndMessage();
  assert.ok((message.flags & MessageFlags.IsComponentsV2) !== 0);
  assert.deepEqual(message.files.map((file) => file.name), ["CSRP-Session.png", "CSRP-Bottom.png"]);
  assert.deepEqual(message.allowedMentions, { parse: [] });
  const panel = message.components[0].toJSON();
  assert.equal(panel.components[0].items[0].media.url, "attachment://CSRP-Session.png");
  assert.match(panel.components[2].content, /A California State Roleplay session has ended/);
  assert.match(panel.components[4].content, /The server is now closed/);
  assert.equal(panel.components[6].components[0].options[0].label, "Receive Session Notification");
  assert.equal(panel.components[6].components[0].options[0].value, "enable");
  assert.equal(panel.components[7].type, 14);
  assert.equal(panel.components[8].items[0].media.url, "attachment://CSRP-Bottom.png");
});

test("clocking in grants the on-shift role and clocking out removes it", async () => {
  const memberId = `shift-test-${randomUUID()}`;
  const roles = new Map();
  const onShiftRole = { id: ON_SHIFT_ROLE_ID, editable: true };
  const member = {
    id: memberId,
    guild: {
      roles: { fetch: async (id) => (id === ON_SHIFT_ROLE_ID ? onShiftRole : null) },
      members: { fetchMe: async () => ({ permissions: { has: () => true } }) },
    },
    roles: {
      cache: roles,
      add: async (role) => { roles.set(role.id, role); },
      remove: async (role) => { roles.delete(role.id); },
    },
  };

  assert.equal(await clockMemberIn(member), true);
  assert.equal(roles.has(ON_SHIFT_ROLE_ID), true);
  assert.ok(getActiveShift(memberId));
  assert.ok(await clockMemberOut(member, memberId));
  assert.equal(roles.has(ON_SHIFT_ROLE_ID), false);
  assert.equal(getActiveShift(memberId), undefined);
});

test("weekly shift totals reset at Sunday midnight Pacific and clip shifts to the week", () => {
  const memberId = `weekly-shift-test-${randomUUID()}`;
  const now = new Date("2026-11-25T18:00:00.000Z");
  const week = getShiftWeekWindow(now);
  assert.equal(week.start.toISOString(), "2026-11-22T08:00:00.000Z");
  assert.equal(week.end.toISOString(), "2026-11-29T08:00:00.000Z");
  const springWeek = getShiftWeekWindow(new Date("2026-03-11T12:00:00.000Z"));
  assert.equal(springWeek.start.toISOString(), "2026-03-08T08:00:00.000Z");
  assert.equal(springWeek.end.toISOString(), "2026-03-15T07:00:00.000Z");
  database.prepare(`
    INSERT INTO staff_shifts (member_id, clocked_in_at, clocked_out_at)
    VALUES (?, ?, ?)
  `).run(memberId, "2026-11-22T07:30:00.000Z", "2026-11-22T08:30:00.000Z");
  database.prepare(`
    INSERT INTO staff_shifts (member_id, clocked_in_at, clocked_out_at)
    VALUES (?, ?, ?)
  `).run(memberId, "2026-11-20T12:00:00.000Z", "2026-11-21T12:00:00.000Z");

  assert.equal(getWeeklyShiftTotals(now).get(memberId), 30 * 60 * 1000);
});

test("Internal Affairs time deduction updates a completed shift but preserves its record", () => {
  const memberId = `shift-adjustment-test-${randomUUID()}`;
  const startedAt = "2026-11-22T09:00:00.000Z";
  const endedAt = "2026-11-22T10:00:00.000Z";
  const insert = database.prepare(`
    INSERT INTO staff_shifts (member_id, clocked_in_at, clocked_out_at)
    VALUES (?, ?, ?)
  `).run(memberId, startedAt, endedAt);
  const shiftId = Number(insert.lastInsertRowid);
  const updated = removeShiftTime(memberId, shiftId, 15);
  assert.equal(updated?.clocked_in_at, startedAt);
  assert.equal(updated?.clocked_out_at, "2026-11-22T09:45:00.000Z");
  assert.equal(getWeeklyShiftTotals(new Date("2026-11-25T18:00:00.000Z")).get(memberId), 45 * 60 * 1000);
  assert.throws(() => removeShiftTime(memberId, shiftId, 60), ShiftAdjustmentError);

  const activeMemberId = `active-adjustment-test-${randomUUID()}`;
  const activeShift = database.prepare(`
    INSERT INTO staff_shifts (member_id, clocked_in_at)
    VALUES (?, ?)
  `).run(activeMemberId, startedAt);
  assert.throws(
    () => removeShiftTime(activeMemberId, Number(activeShift.lastInsertRowid), 1),
    ShiftAdjustmentError,
  );
});

test("separate shift management command opens the panel and its buttons manage the shift", async () => {
  const memberId = `shift-command-test-${randomUUID()}`;
  const roles = new Map([[STAFF_ROLE_ID, { id: STAFF_ROLE_ID }]]);
  const onShiftRole = { id: ON_SHIFT_ROLE_ID, editable: true };
  const member = {
    id: memberId,
    guild: {
      roles: { fetch: async (id) => (id === ON_SHIFT_ROLE_ID ? onShiftRole : null) },
      members: { fetchMe: async () => ({ permissions: { has: () => true } }) },
    },
    roles: {
      cache: roles,
      add: async (role) => { roles.set(role.id, role); },
      remove: async (role) => { roles.delete(role.id); },
    },
  };
  const logMessages = [];
  let panel;
  await executeCommand({
    commandName: "shift-management",
    user: { id: memberId },
    guild: { members: { fetch: async () => member } },
    editReply: async (payload) => { panel = payload; },
  });
  assert.ok((panel.flags & MessageFlags.IsComponentsV2) !== 0);
  assert.equal(panel.components[0].toJSON().components[4].components[0].custom_id, `shift:clock-in:${memberId}`);

  const interaction = {
    customId: `shift:clock-in:${memberId}`,
    user: { id: memberId },
    guildId: "test-guild",
    guild: { id: "test-guild", members: { fetch: async () => member } },
    client: {
      channels: {
        fetch: async (id) => ({
          id,
          guildId: "test-guild",
          isTextBased: () => true,
          isDMBased: () => false,
          send: async (message) => { logMessages.push(message); },
        }),
      },
    },
    update: async (payload) => { panel = payload; },
  };
  await executeShiftButton(interaction);
  assert.ok(getActiveShift(memberId));
  assert.equal(roles.has(ON_SHIFT_ROLE_ID), true);
  assert.equal(panel.components[0].toJSON().components[4].components[0].custom_id, `shift:clock-out:${memberId}`);

  interaction.customId = `shift:clock-out:${memberId}`;
  await executeShiftButton(interaction);
  assert.equal(getActiveShift(memberId), undefined);
  assert.equal(roles.has(ON_SHIFT_ROLE_ID), false);
  assert.equal(logMessages.length, 2);
});

test("separate shift leadership command posts a Components V2 staff leaderboard", async () => {
  const staffIds = Array.from({ length: 25 }, () => `leadership-${randomUUID()}`);
  const members = new Map(staffIds.map((id, index) => [
    id,
    { id, user: { username: `Staff ${index + 1}` }, roles: { cache: new Map([[STAFF_ROLE_ID, {}]]) } },
  ]));
  const leaderboardPosts = [];
  const auditPosts = [];
  const replies = [];
  const actionDetails = [];
  await executeCommand({
    commandName: "shift-leadership",
    user: { id: "leadership-viewer" },
    guildId: "test-guild",
    guild: { members: { fetch: async () => members } },
    channelId: "leadership-channel",
    channel: {
      id: "leadership-channel",
      send: async (message) => { leaderboardPosts.push(message); },
    },
    client: {
      channels: {
        fetch: async (id) => ({
          id,
          guildId: "test-guild",
          isTextBased: () => true,
          isDMBased: () => false,
          send: async (message) => { auditPosts.push(message); },
        }),
      },
    },
    reply: async (payload) => { replies.push(payload); },
  }, actionDetails);
  assert.equal(leaderboardPosts.length, 1);
  assert.equal(auditPosts.length, 0);
  assert.equal(actionDetails.length, 1);
  assert.match(actionDetails[0], /Weekly staff shift leaderboard posted/);
  assert.ok((leaderboardPosts[0].flags & MessageFlags.IsComponentsV2) !== 0);
  const leaderboard = leaderboardPosts[0].components
    .map((container) => container.toJSON().components.map((component) => component.content ?? "").join("\n"))
    .join("\n");
  assert.match(leaderboard, /Shift leadership/);
  assert.match(leaderboard, /Week:/);
  assert.match(leaderboard, /Resets:/);
  for (const id of staffIds) assert.ok(leaderboard.includes(`<@${id}>`));
  assert.deepEqual(leaderboardPosts[0].allowedMentions, { parse: [] });
  assert.match(replies[0].components[0].toJSON().components[0].content, /weekly staff shift leadership panel was posted/);
  assert.deepEqual(replies[0].flags, v2Flags(false));
});

test("shift-admin requires Internal Affairs even when the caller is an administrator", async () => {
  const replies = [];
  await executeCommand({
    commandName: "shift-admin",
    user: { id: "unauthorized-ia-user" },
    guild: {
      members: {
        fetch: async () => ({ roles: { cache: new Map([[STAFF_ROLE_ID, { id: STAFF_ROLE_ID }]]) } }),
      },
    },
    memberPermissions: { has: () => true },
    options: { getSubcommand: () => "active" },
    deferred: true,
    replied: false,
    editReply: async (payload) => { replies.push(payload); },
  });
  assert.equal(INTERNAL_AFFAIRS_ROLE_ID, "1445540175341158611");
  assert.equal(replies.length, 1);
  assert.equal(replies[0].flags, MessageFlags.IsComponentsV2);
  assert.match(replies[0].components[0].toJSON().components[0].content, /You do not have access to use this command/);
});

test("session commands require the configured role, even for administrators", async () => {
  const replies = [];
  for (const commandName of ["session-start", "session-end", "session-low", "session-vote"]) {
    await executeCommand({
      commandName,
      user: { id: "unauthorized-user" },
      guild: {
        members: {
          fetch: async () => ({ roles: { cache: new Map() } }),
        },
      },
      memberPermissions: { has: () => true },
      deferred: false,
      replied: false,
      reply: async (payload) => { replies.push(payload); },
    });
  }
  assert.equal(SESSION_COMMAND_ROLE_ID, "1573500103459741726");
  assert.equal(replies.length, 4);
  for (const response of replies) {
    assert.deepEqual(response.flags, v2Flags(true));
    assert.match(response.components[0].toJSON().components[0].content, /You do not have access to use this command/);
  }
});

test("session managers post the Components V2 session-end card without a role ping", async () => {
  const delivered = [];
  const replies = [];
  const client = {
    channels: {
      fetch: async (id) => ({
        id,
        guildId: "test-guild",
        isTextBased: () => true,
        isDMBased: () => false,
        send: async (message) => {
          delivered.push({ channelId: id, message });
          return { id: `message-${delivered.length}` };
        },
      }),
    },
  };
  await executeCommand({
    commandName: "session-end",
    user: { id: "session-manager" },
    guildId: "test-guild",
    guild: {
      id: "test-guild",
      members: {
        fetch: async () => ({ roles: { cache: new Map([[SESSION_COMMAND_ROLE_ID, { id: SESSION_COMMAND_ROLE_ID }]]) } }),
      },
    },
    client,
    channelId: "invocation-channel",
    deferred: false,
    replied: false,
    reply: async (payload) => { replies.push(payload); },
  });

  assert.equal(SESSION_PING_ROLE_ID, "1445540290298515568");
  assert.equal(delivered.length, 2);
  assert.equal(delivered[0].channelId, sessionAnnouncementChannelId);
  assert.deepEqual(delivered[0].message.allowedMentions, { parse: [] });
  assert.match(delivered[0].message.components[0].toJSON().components[2].content, /session has ended/);
  assert.deepEqual(replies[0].flags, v2Flags(true));
});

test("manual session-start uses the six-vote card and refreshes its server status", async () => {
  const delivered = [];
  const replies = [];
  let editedMessage;
  const message = {
    id: "manual-session-start-message",
    attachments: new Map([
      ["session-banner", { id: "session-banner", name: "CSRP-Session.png", url: "https://cdn.example/session.png" }],
      ["session-footer", { id: "session-footer", name: "CSRP-Bottom.png", url: "https://cdn.example/footer.png" }],
    ]),
    edit: async (payload) => { editedMessage = payload; },
  };
  const channel = {
    id: sessionAnnouncementChannelId,
    guildId: "test-guild",
    isTextBased: () => true,
    isDMBased: () => false,
    send: async (payload) => {
      delivered.push(payload);
      return message;
    },
    messages: {
      fetch: async (id) => {
        assert.equal(id, message.id);
        return message;
      },
    },
  };
  const client = {
    channels: {
      fetch: async (id) => {
        assert.equal(id, sessionAnnouncementChannelId);
        return channel;
      },
    },
  };
  let apiCalls = 0;
  const fetcher = async () => {
    apiCalls += 1;
    const currentPlayers = apiCalls === 1 ? 10 : 17;
    return {
      ok: true,
      status: 200,
      json: async () => ({ CurrentPlayers: currentPlayers, MaxPlayers: 40, Queue: apiCalls === 1 ? [] : [1, 2] }),
    };
  };

  const originalFetch = globalThis.fetch;
  globalThis.fetch = fetcher;
  try {
    await executeCommand({
      commandName: "session-start",
      user: { id: "session-manager" },
      guildId: "test-guild",
      guild: {
        members: {
          fetch: async () => ({ roles: { cache: new Map([[SESSION_COMMAND_ROLE_ID, {}]]) } }),
        },
      },
      client,
      channelId: "invocation-channel",
      deferred: false,
      replied: false,
      reply: async (payload) => { replies.push(payload); },
    }, []);
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.equal(delivered.length, 1);
  assert.deepEqual(delivered[0].files.map((file) => file.name), ["CSRP-Session.png", "CSRP-Bottom.png"]);
  assert.deepEqual(delivered[0].allowedMentions, { parse: [], roles: [SESSION_PING_ROLE_ID] });
  const initialPanel = delivered[0].components[0].toJSON();
  assert.equal(initialPanel.components[0].items[0].media.url, "attachment://CSRP-Session.png");
  assert.match(initialPanel.components[6].content, /> \*\*Players:\*\* `10\/40`/);
  assert.ok(database.prepare("SELECT message_id FROM manual_session_announcements WHERE message_id = ?").get(message.id));
  assert.match(replies[0].components[0].toJSON().components[0].content, /will refresh every minute/);

  await refreshSessionAnnouncements(client, fetcher);
  assert.equal(apiCalls, 2);
  const refreshedPanel = editedMessage.components[0].toJSON();
  assert.match(refreshedPanel.components[6].content, /> \*\*Players:\*\* `17\/40`/);
  assert.match(refreshedPanel.components[6].content, /> \*\*Queue:\*\* `2\/40`/);
  assert.deepEqual(editedMessage.allowedMentions, { parse: [] });
  database.prepare("DELETE FROM manual_session_announcements WHERE message_id = ?").run(message.id);
});

test("session managers post the poll in its configured channel and ping both audience roles", async () => {
  const delivered = [];
  const replies = [];
  const client = {
    channels: {
      fetch: async (id) => ({
        id,
        guildId: "test-guild",
        isTextBased: () => true,
        isDMBased: () => false,
        send: async (message) => {
          delivered.push({ channelId: id, message });
          return { id: id === sessionPollChannelId ? "posted-poll" : "audit-log" };
        },
      }),
    },
  };
  await executeCommand({
    commandName: "session-vote",
    user: { id: "session-manager" },
    guildId: "test-guild",
    guild: {
      id: "test-guild",
      members: {
        fetch: async () => ({ roles: { cache: new Map([[SESSION_COMMAND_ROLE_ID, { id: SESSION_COMMAND_ROLE_ID }]]) } }),
      },
    },
    memberPermissions: { has: () => false },
    client,
    channelId: "invocation-channel",
    channel: { send: async () => assert.fail("Poll should not use the invocation channel.") },
    deferred: false,
    replied: false,
    reply: async (payload) => { replies.push(payload); },
  });

  assert.deepEqual(delivered.map((entry) => entry.channelId), [sessionPollChannelId, "test-command-log-channel"]);
  const pollMessage = delivered[0].message;
  assert.deepEqual(pollMessage.allowedMentions, {
    parse: [],
    roles: [SESSION_PING_ROLE_ID, COMMUNITY_MEMBER_ROLE_ID],
  });
  const pollContent = pollMessage.components[0].toJSON().components[1].content;
  assert.match(pollContent, new RegExp(`<@&${SESSION_PING_ROLE_ID}>`));
  assert.match(pollContent, new RegExp(`<@&${COMMUNITY_MEMBER_ROLE_ID}>`));
  assert.match(replies[0].components[0].toJSON().components[0].content, new RegExp(`<#${sessionPollChannelId}>`));
});

test("audit events route to their configured category channels", async () => {
  const delivered = [];
  const mockClient = {
    channels: {
      fetch: async (id) => ({
        id,
        guildId: "test-guild",
        isTextBased: () => true,
        isDMBased: () => false,
        send: async (message) => delivered.push({ id, message }),
      }),
    },
  };
  const cases = [
    ["ticket opened", "test-ticket-log-channel"],
    ["/claim", "test-command-log-channel"],
    ["/ban", "test-command-log-channel"],
    ["member banned", null],
    ["slash command", "test-command-log-channel", "/ban invoked by <@user>"],
    ["slash command", "test-command-log-channel", "/911 invoked by <@user>"],
    ["slash command", punishmentLogChannelId, "/punish invoked by <@user>"],
    ["slash command", punishmentLogChannelId, "/punishment-edit invoked by <@user>"],
    ["slash command", punishmentLogChannelId, "/punishment-history invoked by <@user>"],
    ["slash command", punishmentLogChannelId, "/punishment-void invoked by <@user>"],
    ["message created", null],
    ["message edited", "test-message-log-channel"],
    ["message deleted", "test-message-log-channel"],
    ["messages bulk deleted", "test-message-log-channel"],
    ["reaction added", null],
    ["button interaction", "test-ticket-log-channel", 'Button "ticket:create" clicked'],
    ["member joined", "test-member-log-channel"],
    ["member left", "test-member-log-channel"],
    ["member updated", null],
    ["channel created", "test-channel-log-channel"],
    ["channel deleted", "test-channel-log-channel"],
    ["channel updated", null],
    ["role created", "test-role-log-channel"],
    ["role deleted", "test-role-log-channel"],
    ["role added", "test-role-log-channel"],
    ["role removed", null],
    ["role updated", null],
    ["voice joined", "test-voice-log-channel"],
    ["voice left", "test-voice-log-channel"],
    ["voice state updated", null],
    ["emoji created", "test-emoji-log-channel"],
    ["emoji deleted", "test-emoji-log-channel"],
    ["emoji updated", null],
  ];

  for (const [eventType, channelId, details = "test event"] of cases) {
    await audit(mockClient, eventType, details, { guildId: "test-guild" });
  }
  assert.deepEqual(
    delivered.map((entry) => entry.id),
    cases.filter(([, channelId]) => channelId !== null).map(([, channelId]) => channelId),
  );
  assert.ok(database.prepare("SELECT id FROM discord_events WHERE event_type = 'member banned'").get());
  for (const [eventType, channelId] of cases.filter(([, destination]) => destination === null)) {
    assert.ok(database.prepare("SELECT id FROM discord_events WHERE event_type = ?").get(eventType));
  }
  assert.equal(delivered[0].message.files[0].name, "CSRP-Bottom.png");
  assert.equal(delivered[0].message.components[0].toJSON().components.filter((component) => component.type === 12).length, 1);
  const categoryLog = delivered.find((entry) => entry.id === "test-message-log-channel").message;
  assert.deepEqual(categoryLog.files.map((file) => file.name), ["CSRP-Audit.png", "CSRP-Bottom.png"]);
  const categoryComponents = categoryLog.components[0].toJSON().components;
  assert.equal(categoryComponents[0].items[0].media.url, "attachment://CSRP-Audit.png");
  assert.match(categoryComponents[2].content, /## Message Edited/);
  assert.match(categoryComponents[2].content, /- \*\*Time:\*\* <t:\d+:F>/);
  assert.equal(categoryComponents[4].items[0].media.url, "attachment://CSRP-Bottom.png");
});

test("moderator applications use the command channel, DM form, review actions, and matching results", async () => {
  const createMockChannel = (id) => {
    const sent = [];
    const messages = new Map();
    return {
      id,
      guildId: "test-guild",
      sent,
      isTextBased: () => true,
      isDMBased: () => false,
      send: async (payload) => {
        const message = {
          id: `${id}-${sent.length + 1}`,
          payload,
          edit: async (updated) => {
            message.payload = updated;
            return message;
          },
        };
        sent.push(message);
        messages.set(message.id, message);
        return message;
      },
      messages: {
        fetch: async (messageId) => {
          const message = messages.get(messageId);
          if (!message) throw new Error(`Unknown mock message ${messageId}`);
          return message;
        },
      },
    };
  };
  const panelChannel = createMockChannel("test-app-command-channel");
  const reviewChannel = createMockChannel("test-application-review-channel");
  const resultsChannel = createMockChannel("test-application-results-channel");
  const applicantNotifications = [];
  const channels = new Map([
    [panelChannel.id, panelChannel],
    [reviewChannel.id, reviewChannel],
    [resultsChannel.id, resultsChannel],
  ]);
  const mockClient = {
    channels: {
      fetch: async (id) => channels.get(id) ?? null,
    },
    users: {
      fetch: async (id) => ({
        send: async (payload) => applicantNotifications.push({ id, payload }),
      }),
    },
  };

  assert.equal(await openModeratorApplications(mockClient, "test-guild", panelChannel.id), true);
  assert.equal(panelChannel.sent.length, 1);
  assert.ok((panelChannel.sent[0].payload.flags & MessageFlags.IsComponentsV2) !== 0);
  const panelComponents = panelChannel.sent[0].payload.components[0].toJSON().components;
  assert.ok(panelComponents[0].content.includes("<:star:1554211049014562826>"));
  const informationText = panelComponents.find((component) => component.type === 10 && /Important Information/.test(component.content)).content;
  assert.ok(informationText.includes("<:crown:1554160757757968405>"));
  assert.equal((informationText.match(/<:pin:1554160947013222541>/g) ?? []).length, 3);
  assert.equal(panelComponents.find((component) => component.type === 1).components[0].label, "Start Application");

  const dmMessages = [];
  const applicant = {
    id: "test-moderator-applicant",
    send: async (payload) => dmMessages.push(payload),
  };
  const startInteraction = {
    customId: "moderator-app:start",
    user: applicant,
    deferReply: async () => {},
    editReply: async (payload) => dmMessages.push(payload),
  };
  assert.equal(await executeModeratorApplicationButton(startInteraction), true);
  assert.ok(dmMessages.length >= 3);

  const answers = [
    "test_applicant",
    "1303570809050107960",
    "RobloxApplicant",
    "PST",
    "One year",
    "I want to support the community.",
    "Patience and fairness.",
    "I am reliable and respectful.",
    "Several evenings each week.",
    "I would document the behavior and follow the moderation process.",
    "I would document it and report it to leadership.",
    "I would stay professional and explain the action calmly.",
    "I would apply the same rules consistently.",
    "Yes",
    "I have no recent disciplinary actions.",
  ];
  for (const content of answers) {
    assert.equal(await handleModeratorApplicationDM({
      author: { id: applicant.id, bot: false, send: applicant.send },
      guildId: null,
      content,
      client: mockClient,
    }), true);
  }

  const application = database.prepare(`
    SELECT id, applicant_id, answers_json, status, review_message_id
    FROM moderator_applications WHERE applicant_id = ?
  `).get(applicant.id);
  assert.equal(application.status, "pending");
  assert.equal(JSON.parse(application.answers_json).length, 15);
  assert.ok(application.review_message_id);
  const reviewMessage = reviewChannel.sent.find((message) => message.id === application.review_message_id);
  assert.ok(reviewMessage);
  const reviewComponents = reviewMessage.payload.components[0].toJSON().components;
  const decisionIds = reviewComponents.flatMap((component) => component.components ?? []).map((component) => component.custom_id);
  assert.ok(decisionIds.includes(`moderator-app:decision:${application.id}:accept`));
  assert.ok(decisionIds.includes(`moderator-app:decision:${application.id}:deny`));

  let acceptModal;
  assert.equal(await executeModeratorApplicationButton({
    customId: `moderator-app:decision:${application.id}:accept`,
    channelId: reviewChannel.id,
    user: { id: "test-reviewer" },
    showModal: async (modal) => { acceptModal = modal; },
  }), true);
  assert.ok(acceptModal);
  await executeModeratorApplicationModal({
    customId: `moderator-app:decision:${application.id}:accept`,
    user: { id: "test-reviewer" },
    client: mockClient,
    fields: { getTextInputValue: () => "Strong, thoughtful answers." },
    deferReply: async () => {},
    editReply: async () => {},
  });
  const acceptedApplication = database.prepare("SELECT status FROM moderator_applications WHERE id = ?").get(application.id);
  assert.equal(acceptedApplication.status, "accepted");
  const acceptanceId = database.prepare("SELECT acceptance_id FROM moderator_applications WHERE id = ?").get(application.id).acceptance_id;
  assert.match(acceptanceId, /^MA-\d{6}$/);
  assert.ok(resultsChannel.sent[0].payload.files.some((file) => file.name === "CSRP-Accepted.png"));
  assert.deepEqual(resultsChannel.sent[0].payload.allowedMentions.users, [applicant.id]);
  const acceptedResultText = resultsChannel.sent[0].payload.components[0].toJSON().components
    .filter((component) => component.type === 10)
    .map((component) => component.content)
    .join("\n");
  assert.match(acceptedResultText, /Staff Application Accepted/);
  assert.match(acceptedResultText, /<:pin:1554160947013222541> \*\*Application Feedback\*\*/);
  assert.match(acceptedResultText, /Strong, thoughtful answers/);
  assert.doesNotMatch(acceptedResultText, /Request ID/);
  const acceptedDM = applicantNotifications[0].payload;
  const acceptedDMText = acceptedDM.components[0].toJSON().components
    .filter((component) => component.type === 10)
    .map((component) => component.content)
    .join("\n");
  assert.equal(acceptedDMText, acceptedResultText);
  assert.deepEqual(acceptedDM.files.map((file) => file.name), resultsChannel.sent[0].payload.files.map((file) => file.name));

  const deniedInsert = database.prepare(`
    INSERT INTO moderator_applications (applicant_id, answers_json, submitted_at, review_message_id, review_page_message_ids)
    VALUES (?, ?, ?, ?, ?)
  `).run("test-denied-applicant", JSON.stringify(answers), new Date().toISOString(), "review-denied-message", JSON.stringify(["review-denied-message"]));
  const deniedId = Number(deniedInsert.lastInsertRowid);
  const deniedReviewMessage = {
    id: "review-denied-message",
    edit: async (payload) => {
      deniedReviewMessage.payload = payload;
      return deniedReviewMessage;
    },
  };
  reviewChannel.messages.fetch = async (messageId) => {
    if (messageId !== deniedReviewMessage.id) throw new Error(`Unknown mock message ${messageId}`);
    return deniedReviewMessage;
  };
  let denyModal;
  await executeModeratorApplicationButton({
    customId: `moderator-app:decision:${deniedId}:deny`,
    channelId: reviewChannel.id,
    user: { id: "test-reviewer" },
    showModal: async (modal) => { denyModal = modal; },
  });
  assert.ok(denyModal);
  await executeModeratorApplicationModal({
    customId: `moderator-app:decision:${deniedId}:deny`,
    user: { id: "test-reviewer" },
    client: mockClient,
    fields: { getTextInputValue: () => "Please gain more experience before reapplying." },
    deferReply: async () => {},
    editReply: async () => {},
  });
  assert.ok(resultsChannel.sent[1].payload.files.some((file) => file.name === "CSRP-Denied.png"));
  assert.deepEqual(resultsChannel.sent[1].payload.allowedMentions.users, ["test-denied-applicant"]);
  const deniedResultText = resultsChannel.sent[1].payload.components[0].toJSON().components
    .filter((component) => component.type === 10)
    .map((component) => component.content)
    .join("\n");
  assert.match(deniedResultText, /Staff Application Denied/);
  assert.doesNotMatch(deniedResultText, /whitelist/i);
  assert.doesNotMatch(deniedResultText, /Request ID/);
  assert.match(deniedResultText, /<:pin:1554160947013222541> \*\*Application Feedback\*\*/);
  assert.match(deniedResultText, /Please gain more experience before reapplying/);
  const deniedDM = applicantNotifications[1].payload;
  const deniedDMText = deniedDM.components[0].toJSON().components
    .filter((component) => component.type === 10)
    .map((component) => component.content)
    .join("\n");
  assert.equal(deniedDMText, deniedResultText);
  assert.deepEqual(deniedDM.files.map((file) => file.name), resultsChannel.sent[1].payload.files.map((file) => file.name));
  assert.equal(database.prepare("SELECT acceptance_id FROM moderator_applications WHERE id = ?").get(deniedId).acceptance_id, null);

  assert.equal(await closeModeratorApplications(mockClient), true);
  assert.equal(database.prepare("SELECT value FROM application_settings WHERE setting = 'status'").get().value, "closed");
});

test("webhook keeps 911 calls in their channel and does not post game events", async () => {
  const loggedEventsBefore = database.prepare("SELECT COUNT(*) AS count FROM discord_events").get().count;
  const gameEventsBefore = database.prepare("SELECT COUNT(*) AS count FROM game_events").get().count;
  const delivered = [];
  const mockClient = {
    channels: {
      fetch: async (id) => ({
        id,
        guildId: "test-guild",
        isTextBased: () => true,
        isDMBased: () => false,
        send: async (message) => delivered.push({ id, message }),
      }),
    },
  };
  webhookServer = createWebhookServer(mockClient);
  webhookServer.listen(0, "127.0.0.1");
  await once(webhookServer, "listening");
  const address = webhookServer.address();
  assert.ok(address && typeof address !== "string");
  const endpoint = `http://127.0.0.1:${address.port}/erlc/events`;
  const headers = {
    authorization: `Bearer ${process.env.WEBHOOK_SECRET}`,
    "content-type": "application/json",
  };

  const callResponse = await fetch(endpoint, {
    method: "POST",
    headers,
    body: JSON.stringify({ event: "911", is911: true, details: "Test emergency" }),
  });
  assert.equal(callResponse.status, 202);
  assert.deepEqual(delivered.map((entry) => entry.id), ["test-911-channel"]);
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM discord_events").get().count, loggedEventsBefore);

  const otherResponse = await fetch(endpoint, {
    method: "POST",
    headers,
    body: JSON.stringify({ event: "mod-call", details: "Test moderation request" }),
  });
  assert.equal(otherResponse.status, 202);
  assert.deepEqual(delivered.map((entry) => entry.id), ["test-911-channel"]);

  const commandResponse = await fetch(endpoint, {
    method: "POST",
    headers,
    body: JSON.stringify({ event: "Command", details: "A staff member used an ER:LC command." }),
  });
  assert.equal(commandResponse.status, 202);
  assert.deepEqual(delivered.map((entry) => entry.id), ["test-911-channel"]);

  const commandExecutedResponse = await fetch(endpoint, {
    method: "POST",
    headers,
    body: JSON.stringify({ event: "ERLCCommandExecuted", details: "An ER:LC command was executed." }),
  });
  assert.equal(commandExecutedResponse.status, 202);
  assert.deepEqual(delivered.map((entry) => entry.id), ["test-911-channel"]);
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM discord_events").get().count, loggedEventsBefore);
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM game_events").get().count, gameEventsBefore + 4);

  const unauthorized = await fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ event: "911", is911: true, details: "Must not be accepted" }),
  });
  assert.equal(unauthorized.status, 401);
  assert.equal(delivered.length, 1);
  await new Promise((resolve, reject) => {
    webhookServer.close((error) => error ? reject(error) : resolve());
  });
  webhookServer = undefined;
});

test("status website serves public data and protects editable content", async () => {
  const discordEventsBefore = database.prepare("SELECT COUNT(*) AS count FROM discord_events").get().count;
  const gameEventsBefore = database.prepare("SELECT COUNT(*) AS count FROM game_events").get().count;
  webhookServer = createWebhookServer({});
  webhookServer.listen(0, "127.0.0.1");
  await once(webhookServer, "listening");
  const address = webhookServer.address();
  assert.ok(address && typeof address !== "string");
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    const homePage = await fetch(baseUrl);
    assert.equal(homePage.status, 200);
    assert.match(await homePage.text(), /Bot status &amp; development/);
    const editorPage = await fetch(`${baseUrl}/admin`);
    assert.equal(editorPage.status, 200);
    assert.match(await editorPage.text(), /Sign in to edit/);

    const initialDataResponse = await fetch(`${baseUrl}/api/status`);
    assert.equal(initialDataResponse.status, 200);
    const initialData = await initialDataResponse.json();
    assert.equal(initialData.status.status, "operational");
    assert.deepEqual(initialData.updates, []);

    const unauthorizedEdit = await fetch(`${baseUrl}/api/admin/status`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status: "offline", message: "Unauthorized edit" }),
    });
    assert.equal(unauthorizedEdit.status, 401);

    const rejectedLogin = await fetch(`${baseUrl}/api/admin/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password: "incorrect-password" }),
    });
    assert.equal(rejectedLogin.status, 401);

    const login = await fetch(`${baseUrl}/api/admin/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password: process.env.STATUS_DASHBOARD_PASSWORD }),
    });
    assert.equal(login.status, 200);
    const cookie = login.headers.get("set-cookie").split(";")[0];
    const session = await fetch(`${baseUrl}/api/admin/session`, { headers: { cookie } });
    assert.deepEqual(await session.json(), { authenticated: true });

    const savedStatus = await fetch(`${baseUrl}/api/admin/status`, {
      method: "PUT",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ status: "maintenance", message: "Scheduled maintenance tonight." }),
    });
    assert.equal(savedStatus.status, 200);
    assert.equal((await savedStatus.json()).status.status, "maintenance");

    const createdUpdate = await fetch(`${baseUrl}/api/admin/updates`, {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ title: "Website launch", content: "The status page is live.", category: "release" }),
    });
    assert.equal(createdUpdate.status, 201);
    const created = (await createdUpdate.json()).update;
    assert.equal(created.title, "Website launch");

    const editedUpdate = await fetch(`${baseUrl}/api/admin/updates/${created.id}`, {
      method: "PUT",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ title: "Website launch", content: "Status and development updates are editable.", category: "development" }),
    });
    assert.equal(editedUpdate.status, 200);
    assert.equal((await editedUpdate.json()).update.category, "development");

    const publicData = await fetch(`${baseUrl}/api/status`).then((response) => response.json());
    assert.equal(publicData.status.message, "Scheduled maintenance tonight.");
    assert.equal(publicData.updates[0].content, "Status and development updates are editable.");

    const deletedUpdate = await fetch(`${baseUrl}/api/admin/updates/${created.id}`, {
      method: "DELETE",
      headers: { cookie },
    });
    assert.equal(deletedUpdate.status, 200);
    const logout = await fetch(`${baseUrl}/api/admin/logout`, {
      method: "POST",
      headers: { cookie },
    });
    assert.equal(logout.status, 200);

    const afterLogout = await fetch(`${baseUrl}/api/admin/status`, {
      method: "PUT",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ status: "operational", message: "Not allowed" }),
    });
    assert.equal(afterLogout.status, 401);
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM discord_events").get().count, discordEventsBefore);
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM game_events").get().count, gameEventsBefore);
  } finally {
    await new Promise((resolve, reject) => {
      webhookServer.close((error) => error ? reject(error) : resolve());
    });
    webhookServer = undefined;
  }
});

test("session vote panel uses the supplied emoji and large separators", () => {
  const component = buildSessionVoteContainer("poll-id", "role-id", 1, "active").toJSON();
  const controls = component.components[3].components;
  assert.equal(SESSION_VOTE_THRESHOLD, 6);
  assert.equal(controls[0].emoji.id, SESSION_VOTE_EMOJI_ID);
  assert.equal(controls[1].label, "1/6");
  assert.equal(controls[1].emoji.id, SESSION_VOTERS_EMOJI_ID);
  assert.equal(controls[2].label, "View Voters");
  assert.equal(controls[2].emoji.id, SESSION_VOTERS_EMOJI_ID);
  assert.equal(component.components[2].spacing, 2);
  assert.equal(component.components[4].spacing, 2);
  assert.match(component.components[1].content, /<@&role-id>/);

  const noPing = buildSessionVoteContainer("poll-id", null, 0, "active").toJSON();
  assert.doesNotMatch(noPing.components[1].content, /<@&/);
  const post = createSessionVoteMessage("poll-id", null);
  assert.deepEqual(post.files.map((file) => file.name), ["CSRP-Polls.png", "CSRP-Bottom.png"]);
});

test("session votes are unique per voter and close at the configured threshold", () => {
  const pollId = randomUUID();
  saveSessionPoll({
    poll_id: pollId,
    guild_id: "test-guild",
    channel_id: "test-channel",
    message_id: `message-${pollId}`,
    notification_role_id: "test-role",
    threshold: SESSION_VOTE_THRESHOLD,
    created_by: "test-user",
  });
  const firstVote = recordSessionVote(pollId, "voter-1");
  assert.equal(firstVote?.voteCount, 1);
  assert.equal(firstVote?.added, true);
  assert.equal(firstVote?.reachedNow, false);
  let result;
  for (let voter = 2; voter <= 6; voter += 1) {
    result = recordSessionVote(pollId, `voter-${voter}`);
    assert.equal(result?.voteCount, voter);
    assert.equal(result?.added, true);
    assert.equal(result?.reachedNow, voter === 6);
  }
  assert.equal(result?.poll.status, "reached");
  assert.equal(recordSessionVote(pollId, "voter-7")?.added, false);
});

test("legacy session polls migrate to role-free 6-vote polls without losing votes", () => {
  const poll = getSessionPoll("legacy-poll");
  assert.equal(poll?.threshold, 6);
  assert.equal(poll?.notification_role_id, "old-role");
  assert.deepEqual(getSessionVoters("legacy-poll"), ["legacy-voter"]);
});

test("any member can vote and the shared poll starts a session at six votes", async () => {
  const pollId = randomUUID();
  saveSessionPoll({
    poll_id: pollId,
    guild_id: "test-guild",
    channel_id: "test-channel",
    message_id: `message-${pollId}`,
    notification_role_id: null,
    threshold: SESSION_VOTE_THRESHOLD,
    created_by: "test-user",
  });
  let updatedMessage;
  const sentMessages = [];
  const privateReplies = [];
  let announcementCount = 0;
  let apiRequest;
  const fetcher = async (url, options) => {
    apiRequest = { url, options };
    return {
      ok: true,
      status: 200,
      json: async () => ({ CurrentPlayers: 12, MaxPlayers: 40, Queue: [123, 456] }),
    };
  };
  for (let voter = 1; voter <= 6; voter += 1) {
    const interaction = {
      customId: `session-vote:${pollId}`,
      message: {
        id: `message-${pollId}`,
        attachments: voter === 1 ? [] : [
          { id: "top-id", name: "CSRP-Polls.png", url: "https://cdn.example/top.png" },
          { id: "bottom-id", name: "CSRP-Bottom.png", url: "https://cdn.example/bottom.png" },
        ],
        edit: async (payload) => { updatedMessage = payload; },
      },
      channelId: "test-channel",
      guildId: "test-guild",
      user: { id: `voter-${voter}` },
      deferUpdate: async () => {},
      followUp: async (payload) => { privateReplies.push(payload); },
      client: {
        channels: {
          fetch: async (id) => ({
            id,
            guildId: "test-guild",
            isTextBased: () => true,
            isDMBased: () => false,
            send: async (message) => {
              sentMessages.push({ channelId: id, message });
              if (id === sessionAnnouncementChannelId) return { id: `announcement-${++announcementCount}` };
              return { id: `log-message-${sentMessages.length}` };
            },
          }),
        },
      },
    };

    assert.equal(await executeSessionVoteButton(interaction, fetcher), true);
    assert.equal(getSessionVoters(pollId).length, voter);
    assert.equal(announcementCount, voter === 6 ? 1 : 0);
    const panel = updatedMessage.components[0].toJSON();
    assert.equal(panel.components[3].components[1].label, `${voter}/6`);
    assert.equal(panel.components[3].components[0].disabled, voter === 6);
    assert.equal(updatedMessage.attachments, undefined);
    assert.deepEqual(updatedMessage.allowedMentions, { parse: [] });
    assert.deepEqual(privateReplies[voter - 1].flags, v2Flags(true));
    assert.match(privateReplies[voter - 1].components[0].toJSON().components[0].content, /Your vote has been casted\./);
  }

  assert.equal(announcementCount, 1);
  assert.equal(sentMessages.filter((entry) => entry.channelId === sessionAnnouncementChannelId).length, 1);
  assert.equal(getSessionPoll(pollId)?.session_announcement_message_id, "announcement-1");
  assert.equal(getSessionPoll(pollId)?.session_announcement_channel_id, sessionAnnouncementChannelId);
  assert.equal(apiRequest.url, "https://api.erlc.gg/v2/server?Queue=true");
  assert.equal(apiRequest.options.headers["server-key"], "test-server-key");
  const announcement = sentMessages.find((entry) => entry.channelId === sessionAnnouncementChannelId).message;
  assert.deepEqual(announcement.files.map((file) => file.name), ["CSRP-Session.png", "CSRP-Bottom.png"]);
  const announcementPanel = announcement.components[0].toJSON();
  assert.equal(announcementPanel.components.length, 10);
  assert.match(announcementPanel.components[2].content, new RegExp(`<@&${SESSION_PING_ROLE_ID}>`));
  assert.match(announcementPanel.components[2].content, /## Session announcement/);
  assert.match(announcementPanel.components[2].content, /A California State Roleplay session has commenced/);
  assert.equal(announcementPanel.components[4].content, [
    "## Server details",
    "> **Server name:** `California State Roleplay | VC Only`",
    "> **Join code:** `CaliStRp`",
    "> **Owner:** `bluecrewofficial`",
  ].join("\n"));
  const liveStatus = announcementPanel.components[6].content;
  assert.match(liveStatus, /## Live status/);
  assert.match(liveStatus, /> \*\*Players:\*\* `12\/40`/);
  assert.match(liveStatus, /> \*\*Queue:\*\* `2\/40`/);
  assert.match(liveStatus, /> \*\*Last updated:\*\* <t:\d+:R>/);
  assert.doesNotMatch(liveStatus, /STAFF/i);
  for (const index of [1, 3, 5, 7]) {
    assert.equal(announcementPanel.components[index].type, 14);
    assert.equal(announcementPanel.components[index].spacing, 2);
  }
  const optionsMenu = announcementPanel.components[8].components[0];
  assert.equal(optionsMenu.custom_id, "session-announcement-options");
  assert.equal(optionsMenu.placeholder, "Click here to see options");
  assert.deepEqual(optionsMenu.options.map((option) => option.value), ["quick-join", "enable", "disable"]);
  assert.deepEqual(announcement.allowedMentions, { parse: [], roles: [SESSION_PING_ROLE_ID] });
  database.prepare("UPDATE session_polls SET session_announcement_message_id = NULL WHERE poll_id = ?").run(pollId);
});

test("session announcements refresh every minute with live counts and a relative updated time", async () => {
  const pollId = randomUUID();
  saveSessionPoll({
    poll_id: pollId,
    guild_id: "test-guild",
    channel_id: "test-channel",
    message_id: `message-${pollId}`,
    notification_role_id: null,
    threshold: SESSION_VOTE_THRESHOLD,
    created_by: "test-user",
  });
  const messageId = "announcement-to-refresh";
  database.prepare(`
    UPDATE session_polls
    SET status = 'reached', session_announcement_message_id = ?
    WHERE poll_id = ?
  `).run(messageId, pollId);

  const attachments = new Map([
    ["banner-id", { id: "banner-id", name: "CSRP-Session.png", url: "https://cdn.example/session.png" }],
    ["footer-id", { id: "footer-id", name: "CSRP-Bottom.png", url: "https://cdn.example/footer.png" }],
  ]);
  let editedMessage;
  const fetchedMessage = {
    id: messageId,
    attachments,
    edit: async (payload) => { editedMessage = payload; },
  };
  let apiCalls = 0;
  const fetcher = async () => {
    apiCalls += 1;
    return {
      ok: true,
      status: 200,
      json: async () => ({ CurrentPlayers: 21, MaxPlayers: 50, Queue: [123] }),
    };
  };
  const client = {
    channels: {
      fetch: async (channelId) => {
        assert.equal(channelId, sessionAnnouncementChannelId);
        return {
          guildId: "test-guild",
          isTextBased: () => true,
          isDMBased: () => false,
          messages: {
            fetch: async (id) => {
              assert.equal(id, messageId);
              return fetchedMessage;
            },
          },
        };
      },
    },
  };
  const updateStartedAt = Math.floor(Date.now() / 1000);
  await refreshSessionAnnouncements(client, fetcher);

  assert.equal(SESSION_ANNOUNCEMENT_REFRESH_INTERVAL_MS, 60_000);
  assert.equal(apiCalls, 1);
  assert.ok(editedMessage);
  assert.ok((editedMessage.flags & MessageFlags.IsComponentsV2) !== 0);
  assert.deepEqual(editedMessage.attachments, [{ id: "banner-id" }, { id: "footer-id" }]);
  assert.deepEqual(editedMessage.allowedMentions, { parse: [] });
  const panel = editedMessage.components[0].toJSON();
  assert.match(panel.components[0].items[0].media.url, /session\.png$/);
  assert.match(panel.components[9].items[0].media.url, /footer\.png$/);
  const liveStatus = panel.components[6].content;
  assert.match(liveStatus, /> \*\*Players:\*\* `21\/50`/);
  assert.match(liveStatus, /> \*\*Queue:\*\* `1\/50`/);
  const timestamp = liveStatus.match(/Last updated:\*\* <t:(\d+):R>/);
  assert.ok(timestamp);
  assert.ok(Number(timestamp[1]) >= updateStartedAt);
  assert.ok(Number(timestamp[1]) <= Math.floor(Date.now() / 1000));
});

test("a failed poll refresh reports the vote as saved without claiming the display updated", async () => {
  const pollId = randomUUID();
  saveSessionPoll({
    poll_id: pollId,
    guild_id: "test-guild",
    channel_id: "test-channel",
    message_id: `message-${pollId}`,
    notification_role_id: null,
    threshold: SESSION_VOTE_THRESHOLD,
    created_by: "test-user",
  });
  const privateReplies = [];
  const previousConsoleError = console.error;
  console.error = () => {};
  try {
    await executeSessionVoteButton({
      customId: `session-vote:${pollId}`,
      message: {
        id: `message-${pollId}`,
        attachments: [],
        edit: async () => { throw new Error("test edit failure"); },
      },
      channelId: "test-channel",
      guildId: "test-guild",
      user: { id: "test-voter" },
      deferUpdate: async () => {},
      editReply: async () => { throw new Error("test fallback failure"); },
      followUp: async (payload) => { privateReplies.push(payload); },
    });
  } finally {
    console.error = previousConsoleError;
  }

  assert.deepEqual(getSessionVoters(pollId), ["test-voter"]);
  const message = privateReplies[0].components[0].toJSON().components[0].content;
  assert.match(message, /Your vote was counted/);
  assert.match(message, /could not be updated/);
  assert.doesNotMatch(message, /Your vote has been casted/);
  const failureLog = database.prepare(
    "SELECT details FROM discord_events WHERE event_type = 'session poll update failed' ORDER BY id DESC LIMIT 1",
  ).get();
  assert.match(failureLog.details, /test edit failure/);
  assert.match(failureLog.details, /test fallback failure/);
});

test("the interaction webhook updates the poll when a normal message edit is rejected", async () => {
  const pollId = randomUUID();
  saveSessionPoll({
    poll_id: pollId,
    guild_id: "test-guild",
    channel_id: "test-channel",
    message_id: `message-${pollId}`,
    notification_role_id: null,
    threshold: SESSION_VOTE_THRESHOLD,
    created_by: "test-user",
  });
  let updatedMessage;
  const privateReplies = [];
  await executeSessionVoteButton({
    customId: `session-vote:${pollId}`,
    message: {
      id: `message-${pollId}`,
      attachments: [],
      edit: async () => { throw new Error("bot message edit rejected"); },
    },
    channelId: "test-channel",
    guildId: "test-guild",
    user: { id: "test-voter" },
    deferUpdate: async () => {},
    editReply: async (payload) => { updatedMessage = payload; },
    followUp: async (payload) => { privateReplies.push(payload); },
  });

  assert.equal(getSessionVoters(pollId).length, 1);
  assert.equal(updatedMessage.components[0].toJSON().components[3].components[1].label, "1/6");
  assert.match(privateReplies[0].components[0].toJSON().components[0].content, /Your vote has been casted\./);
});

test("session dropdown returns the join link and lets members opt into pings", async () => {
  const replies = [];
  await executeSessionAnnouncementSelect({
    customId: "session-announcement-options",
    values: ["quick-join"],
    reply: async (payload) => { replies.push(payload); },
  });
  const quickJoinReply = replies[0].components[0].toJSON().components[0].content;
  assert.ok(quickJoinReply.includes(QUICK_JOIN_LINK));
  assert.deepEqual(replies[0].flags, v2Flags(true));

  const addedRoles = [];
  const member = {
    roles: {
      cache: new Map(),
      add: async (role) => { addedRoles.push(role.id); },
      remove: async () => {},
    },
  };
  await executeSessionAnnouncementSelect({
    customId: "session-announcement-options",
    values: ["enable"],
    guildId: "test-guild",
    guild: {
      id: "test-guild",
      roles: { fetch: async (id) => ({ id, editable: true }) },
      members: {
        fetchMe: async () => ({ permissions: { has: () => true } }),
        fetch: async () => member,
      },
    },
    user: { id: "test-user" },
    reply: async (payload) => { replies.push(payload); },
  });
  assert.deepEqual(addedRoles, [SESSION_PING_ROLE_ID]);
  assert.match(replies[1].components[0].toJSON().components[0].content, /receive California State Roleplay session pings/);
});
