import {
  Client,
  GatewayIntentBits,
  MessageFlags,
  Partials,
  type ChatInputCommandInteraction,
  type Message,
} from "discord.js";
import { config } from "./config.js";
import { executeCommand, executeTicketButton } from "./commands.js";
import { executeShiftButton } from "./shifts.js";
import { executeGuidelinesButton } from "./guidelines.js";
import { database } from "./database.js";
import { audit } from "./logging.js";
import { v2Flags, v2Message } from "./ui.js";
import { startWebhook } from "./webhook.js";
import { executeSessionVoteButton } from "./session-vote.js";
import {
  executeModeratorApplicationButton,
  executeModeratorApplicationModal,
  handleModeratorApplicationDM,
  publishPendingModeratorApplications,
} from "./moderator-application.js";
import {
  executeSessionAnnouncementSelect,
  publishPendingSessionAnnouncements,
  startSessionAnnouncementRefresh,
} from "./session-announcement.js";

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildModeration,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.GuildInvites,
    GatewayIntentBits.GuildExpressions,
  ],
  partials: [Partials.Channel, Partials.Message, Partials.GuildMember, Partials.User, Partials.Reaction],
});

let sessionAnnouncementRefreshTimer: NodeJS.Timeout | undefined;

function logEvent(
  eventType: string,
  details: string,
  ids: { guildId?: string | undefined; actorId?: string | undefined; subjectId?: string | undefined } = {},
): void {
  void audit(client, eventType, details, ids).catch((error: unknown) => {
    console.error(`Failed to write ${eventType} audit event:`, error);
  });
}

async function executeAndLogCommand(interaction: ChatInputCommandInteraction): Promise<void> {
  const actionDetails: string[] = [];
  let commandFailed = false;
  let commandError: unknown;
  try {
    await executeCommand(interaction, actionDetails);
  } catch (error) {
    commandFailed = true;
    commandError = error;
  }

  const actionSummary = actionDetails.length ? ` Actions: ${actionDetails.join(" | ")}` : "";
  try {
    await audit(
      client,
      "slash command",
      `/${interaction.commandName} invoked by <@${interaction.user.id}> in <#${interaction.channelId}>.${actionSummary}`,
      {
        guildId: interaction.guildId ?? undefined,
        actorId: interaction.user.id,
        subjectId: interaction.id,
      },
    );
  } catch (error) {
    console.error(`/${interaction.commandName} completed, but its command log could not be delivered:`, error);
  }
  if (commandFailed) throw commandError;
}

function describeMessage(message: Message): string {
  const attachments = [...message.attachments.values()].map((item) => item.url).join("\n");
  return [
    `**Author:** <@${message.author.id}> (${message.author.tag})`,
    `**Channel:** <#${message.channelId}>`,
    `**Message ID:** ${message.id}`,
    `**Content:** ${message.content || "(empty or unavailable)"}`,
    attachments ? `**Attachments:**\n${attachments}` : "",
  ].filter(Boolean).join("\n");
}

client.on("messageCreate", (message) => {
  void handleModeratorApplicationDM(message).catch((error: unknown) => {
    console.error(`Could not process moderator application DM from ${message.author.id}:`, error);
  });
});

client.on("messageUpdate", (before, after) => {
  if (!after.guild || after.channelId === config.calls911ChannelId || after.author?.id === client.user?.id) return;
  const oldContent = before.partial ? "(unavailable: message was partial)" : before.content || "(empty)";
  const newContent = after.content || "(empty or unavailable)";
  logEvent("message edited", `**Author:** <@${after.author?.id ?? "unknown"}>\n**Channel:** <#${after.channelId}>\n**Message ID:** ${after.id}\n**Before:** ${oldContent}\n**After:** ${newContent}`, {
    guildId: after.guildId ?? undefined,
    actorId: after.author?.id,
    subjectId: after.id,
  });
});

client.on("messageDelete", (message) => {
  if (!message.guild || message.channelId === config.calls911ChannelId || message.author?.id === client.user?.id) return;
  const description = message.partial
    ? `Deleted message ${message.id} in <#${message.channelId}>; content was unavailable.`
    : describeMessage(message as Message);
  logEvent("message deleted", description, {
    guildId: message.guildId ?? undefined,
    actorId: message.author?.id,
    subjectId: message.id,
  });
});

client.on("messageDeleteBulk", (messages, channel) => {
  if (!("guild" in channel) || !channel.guild || channel.id === config.calls911ChannelId) return;
  const ids = [...messages.keys()].slice(0, 100).join(", ");
  logEvent("messages bulk deleted", `${messages.size} messages deleted in <#${channel.id}>.\n**Message IDs:** ${ids || "unavailable"}`, {
    guildId: channel.guild.id,
  });
});

client.on("guildMemberAdd", (member) => {
  logEvent("member joined", `<@${member.id}> joined the server.`, { guildId: member.guild.id, subjectId: member.id });
});

client.on("guildMemberRemove", (member) => {
  logEvent("member left", `${member.user.tag} (${member.id}) left the server.`, { guildId: member.guild.id, subjectId: member.id });
});

client.on("guildMemberUpdate", (before, after) => {
  const addedRoles = after.roles.cache.filter((role) => !before.roles.cache.has(role.id));
  const removedRoles = before.roles.cache.filter((role) => !after.roles.cache.has(role.id));
  for (const role of addedRoles.values()) {
    logEvent("role added", `<@&${role.id}> (${role.name}) was added to <@${after.id}>.`, {
      guildId: after.guild.id,
      actorId: undefined,
      subjectId: after.id,
    });
  }
  for (const role of removedRoles.values()) {
    logEvent("role removed", `<@&${role.id}> (${role.name}) was removed from <@${after.id}>.`, {
      guildId: after.guild.id,
      actorId: undefined,
      subjectId: after.id,
    });
  }

  if (before.nickname === after.nickname) return;
  logEvent("member updated", `**Member:** <@${after.id}>\n**Nickname:** ${before.nickname ?? "none"} → ${after.nickname ?? "none"}`, {
    guildId: after.guild.id,
    subjectId: after.id,
  });
});

client.on("guildBanAdd", (ban) => {
  logEvent("member banned", `${ban.user.tag} (${ban.user.id}) was banned.\n**Reason:** ${ban.reason ?? "not provided"}`, {
    guildId: ban.guild.id,
    subjectId: ban.user.id,
  });
});

client.on("guildBanRemove", (ban) => {
  logEvent("member unbanned", `${ban.user.tag} (${ban.user.id}) was unbanned.`, {
    guildId: ban.guild.id,
    subjectId: ban.user.id,
  });
});

client.on("channelCreate", (channel) => {
  if (!("guild" in channel) || !channel.guild || !("name" in channel)) return;
  logEvent("channel created", `${channel} (${channel.name}) was created.`, { guildId: channel.guild.id, subjectId: channel.id });
});

client.on("channelDelete", (channel) => {
  if (!("guild" in channel) || !channel.guild || !("name" in channel)) return;
  logEvent("channel deleted", `Channel ${channel.name} (${channel.id}) was deleted.`, { guildId: channel.guild.id, subjectId: channel.id });
});

client.on("channelUpdate", (before, after) => {
  if (!("guild" in after) || !after.guild || !("name" in after) || !("name" in before)) return;
  logEvent("channel updated", `Channel ${after.id}: name "${before.name}" → "${after.name}".`, { guildId: after.guild.id, subjectId: after.id });
});

client.on("threadCreate", (thread) => {
  logEvent("thread created", `Thread **${thread.name}** (${thread.id}) created in <#${thread.parentId ?? "unknown"}>.`, {
    guildId: thread.guild.id,
    subjectId: thread.id,
  });
});

client.on("threadDelete", (thread) => {
  logEvent("thread deleted", `Thread **${thread.name}** (${thread.id}) deleted from <#${thread.parentId ?? "unknown"}>.`, {
    guildId: thread.guild.id,
    subjectId: thread.id,
  });
});

client.on("threadUpdate", (before, after) => {
  logEvent("thread updated", `Thread ${after.id}: name "${before.name}" → "${after.name}", archived ${before.archived} → ${after.archived}, locked ${before.locked} → ${after.locked}.`, {
    guildId: after.guild.id,
    subjectId: after.id,
  });
});

client.on("webhooksUpdate", (channel) => {
  if (!("guild" in channel) || !channel.guild) return;
  logEvent("webhooks updated", `Webhook configuration updated in <#${channel.id}>.`, { guildId: channel.guild.id, subjectId: channel.id });
});

client.on("guildUpdate", (before, after) => {
  if (before.name === after.name && before.icon === after.icon && before.verificationLevel === after.verificationLevel) return;
  logEvent("server updated", `Server **${before.name}** updated to **${after.name}**.`, { guildId: after.id });
});

client.on("roleCreate", (role) => {
  logEvent("role created", `Role ${role.name} (${role.id}) was created.`, { guildId: role.guild.id, subjectId: role.id });
});

client.on("roleDelete", (role) => {
  logEvent("role deleted", `Role ${role.name} (${role.id}) was deleted.`, { guildId: role.guild.id, subjectId: role.id });
});

client.on("emojiCreate", (emoji) => {
  logEvent("emoji created", `Emoji :${emoji.name ?? "unnamed"}: (${emoji.id}) was created.`, {
    guildId: emoji.guild.id,
    subjectId: emoji.id,
  });
});

client.on("emojiDelete", (emoji) => {
  logEvent("emoji deleted", `Emoji :${emoji.name ?? "unnamed"}: (${emoji.id}) was deleted.`, {
    guildId: emoji.guild.id,
    subjectId: emoji.id,
  });
});

client.on("emojiUpdate", (before, after) => {
  if (before.name === after.name && before.animated === after.animated) return;
  logEvent("emoji updated", `Emoji ${after.id}: name "${before.name ?? "unnamed"}" → "${after.name ?? "unnamed"}", animated ${before.animated} → ${after.animated}.`, {
    guildId: after.guild.id,
    subjectId: after.id,
  });
});

client.on("voiceStateUpdate", (before, after) => {
  const member = after.member ?? before.member;
  if (before.channelId === after.channelId) return;
  if (before.channelId) {
    logEvent("voice left", `<@${member?.id ?? "unknown"}> left <#${before.channelId}>.`, {
      guildId: after.guild.id,
      subjectId: member?.id,
    });
  }
  if (after.channelId) {
    logEvent("voice joined", `<@${member?.id ?? "unknown"}> joined <#${after.channelId}>.`, {
      guildId: after.guild.id,
      subjectId: member?.id,
    });
  }
});

client.on("guildAuditLogEntryCreate", (entry, guild) => {
  logEvent("server audit log", `**Action:** ${entry.action}\n**Actor:** ${entry.executor?.tag ?? "unknown"} (${entry.executorId ?? "unknown"})\n**Target:** ${entry.targetId ?? "unknown"}\n**Reason:** ${entry.reason ?? "not provided"}`, {
    guildId: guild.id,
    actorId: entry.executorId ?? undefined,
    subjectId: entry.targetId ?? undefined,
  });
});

client.on("inviteCreate", (invite) => {
  logEvent("invite created", `Invite ${invite.code} created by ${invite.inviter?.tag ?? "unknown"} in <#${invite.channelId}>.`, {
    guildId: invite.guild?.id,
    actorId: invite.inviter?.id,
  });
});

client.on("inviteDelete", (invite) => {
  logEvent("invite deleted", `Invite ${invite.code} was deleted from <#${invite.channelId}>.`, { guildId: invite.guild?.id });
});

client.on("messageReactionAdd", (reaction, user) => {
  if (user.id === client.user?.id || !reaction.message.guild || reaction.message.channelId === config.calls911ChannelId) return;
  logEvent("reaction added", `<@${user.id}> reacted ${reaction.emoji} to message ${reaction.message.id} in <#${reaction.message.channelId}>.`, {
    guildId: reaction.message.guildId ?? undefined,
    actorId: user.id,
    subjectId: reaction.message.id,
  });
});

client.on("messageReactionRemove", (reaction, user) => {
  if (user.id === client.user?.id || !reaction.message.guild || reaction.message.channelId === config.calls911ChannelId) return;
  logEvent("reaction removed", `<@${user.id}> removed ${reaction.emoji} from message ${reaction.message.id} in <#${reaction.message.channelId}>.`, {
    guildId: reaction.message.guildId ?? undefined,
    actorId: user.id,
    subjectId: reaction.message.id,
  });
});

client.on("interactionCreate", (interaction) => {
  if (interaction.isModalSubmit()) {
    void executeModeratorApplicationModal(interaction).catch(async (error: unknown) => {
      console.error("Moderator application review failed:", error);
      if (interaction.replied || interaction.deferred) {
        await interaction.followUp({ ...v2Message("Decision Not Completed", "The application decision could not be completed. Check the bot logs."), flags: v2Flags(true) }).catch((replyError: unknown) => {
          console.error("Could not send moderator application decision error:", replyError);
        });
      } else {
        await interaction.reply({ ...v2Message("Decision Not Completed", "The application decision could not be completed. Check the bot logs."), flags: v2Flags(true) }).catch((replyError: unknown) => {
          console.error("Could not send moderator application decision error:", replyError);
        });
      }
    });
    return;
  }
  if (interaction.isStringSelectMenu()) {
    logEvent("select menu interaction", `Select menu "${interaction.customId}" selected by <@${interaction.user.id}> in <#${interaction.channelId}>.`, {
      guildId: interaction.guildId ?? undefined,
      actorId: interaction.user.id,
    });
    void executeSessionAnnouncementSelect(interaction).catch((error: unknown) => {
      console.error("Session announcement selection failed:", error);
      if (!interaction.replied && !interaction.deferred) {
        void interaction.reply({ ...v2Message("Selection not applied", "The requested session option could not be applied. Check the bot permissions and server logs."), flags: v2Flags(true) }).catch((replyError: unknown) => {
          console.error("Could not send session selection response:", replyError);
        });
      }
    });
    return;
  }
  if (interaction.isButton()) {
    const isShiftButton = interaction.customId.startsWith("shift:");
    const isApplicationButton = interaction.customId.startsWith("moderator-app:");
    if (!isShiftButton && !isApplicationButton) {
      logEvent("button interaction", `Button "${interaction.customId}" clicked by <@${interaction.user.id}> in <#${interaction.channelId}>.`, {
        guildId: interaction.guildId ?? undefined,
        actorId: interaction.user.id,
      });
    }
    void executeModeratorApplicationButton(interaction).then(async (applicationHandled) => {
      if (applicationHandled) return;
      const guidelinesHandled = await executeGuidelinesButton(interaction);
      if (guidelinesHandled) return;
      const handled = await executeShiftButton(interaction);
      if (handled) return;
      const sessionHandled = await executeSessionVoteButton(interaction);
      if (!sessionHandled) await executeTicketButton(interaction);
    }).catch((error: unknown) => {
      console.error("Component button action failed:", error);
      if (!interaction.replied && !interaction.deferred) {
        void interaction.reply({ ...v2Message("Action failed", "This button action failed. Check bot permissions and server logs."), flags: v2Flags(!isShiftButton) }).catch((replyError: unknown) => {
          console.error("Could not send component failure response:", replyError);
        });
      }
    });
    return;
  }
  if (!interaction.isChatInputCommand()) return;
  const isShiftCommand = ["shift-management", "shift-leadership", "shift-admin"].includes(interaction.commandName);
  const deferredReply = isShiftCommand
    ? interaction.deferReply()
    : interaction.deferReply({ flags: MessageFlags.Ephemeral });
  void deferredReply.then(() => executeAndLogCommand(interaction)).catch(async (error: unknown) => {
    console.error(`/${interaction.commandName} failed:`, error);
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp({ ...v2Message("Command failed", "The action failed. Check bot permissions and server logs."), flags: v2Flags(!isShiftCommand) }).catch((replyError: unknown) => {
        console.error("Could not send command failure response:", replyError);
      });
    } else {
      await interaction.reply({ ...v2Message("Command failed", "The action failed. Check bot permissions and server logs."), flags: v2Flags(!isShiftCommand) }).catch((replyError: unknown) => {
        console.error("Could not send command failure response:", replyError);
      });
    }
  });
});

client.once("clientReady", () => {
  console.log(`California State Roleplay bot logged in as ${client.user?.tag}.`);
  const guild = client.guilds.cache.get(config.guildId);
  if (!guild) {
    console.error(`Configured guild ${config.guildId} is not available in the bot cache.`);
  } else if (guild.members.me && guild.members.me.nickname !== "California State Roleplay") {
    void guild.members.me.setNickname("California State Roleplay").catch((error: unknown) => {
      console.error("Could not set the bot's server nickname to California State Roleplay:", error);
    });
  }
  const server = startWebhook(client);
  server.on("listening", () => console.log(`ER:LC webhook listening on port ${config.webhookPort}.`));
  server.on("error", (error) => console.error("ER:LC webhook server failed:", error));
  void publishPendingSessionAnnouncements(client).then(() => {
    sessionAnnouncementRefreshTimer = startSessionAnnouncementRefresh(client);
  }).catch((error: unknown) => {
    console.error("Could not initialize session announcement updates:", error);
  });
  void publishPendingModeratorApplications(client);
});

function shutdown(): void {
  if (sessionAnnouncementRefreshTimer) clearInterval(sessionAnnouncementRefreshTimer);
  database.close();
  client.destroy();
  process.exit(0);
}

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);

void client.login(config.token).catch((error: unknown) => {
  console.error("Discord login failed:", error);
  process.exitCode = 1;
});
