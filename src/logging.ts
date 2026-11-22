import { resolve } from "node:path";
import {
  AttachmentBuilder,
  ContainerBuilder,
  MediaGalleryBuilder,
  MediaGalleryItemBuilder,
  MessageFlags,
  SeparatorBuilder,
  SeparatorSpacingSize,
  TextDisplayBuilder,
  type Channel,
  type Client,
  type GuildTextBasedChannel,
  type MessageCreateOptions,
} from "discord.js";
import { config } from "./config.js";
import { saveDiscordEvent } from "./database.js";

const LOG_FOOTER_IMAGE = "CSRP-Bottom.png";

const moderationCommands = new Set([
  "/appeal",
  "/ban",
  "/infract",
  "/interview-pass",
  "/mod",
  "/promote",
  "/punish",
  "/punishment-edit",
  "/punishment-history",
  "/punishment-void",
  "/ra-admin",
  "/reinstate",
  "/resign",
]);

const punishmentCommands = new Set([
  "/punish",
  "/punishment-edit",
  "/punishment-history",
  "/punishment-void",
]);

function getLogChannelId(eventType: string, details: string): string {
  let type = eventType.toLowerCase();
  if (type === "slash command") {
    const commandName = details.match(/\/([a-z0-9-]+)\s+invoked/i)?.[1];
    if (commandName) type = `/${commandName.toLowerCase()}`;
  }

  if (punishmentCommands.has(type)) return config.punishmentLogChannelId;
  if (type === "slash command" || type.startsWith("/")) return config.commandLogChannelId;

  if (type === "button interaction") {
    const customId = details.match(/Button "([^"]+)"/i)?.[1]?.toLowerCase() ?? "";
    if (customId.startsWith("ticket:")) return config.ticketLogChannelId;
    if (customId.startsWith("role:") || customId.startsWith("roles:")) return config.roleLogChannelId;
    return config.logChannelId;
  }

  if (type.includes("ticket") || ["/add", "/claim", "/close"].includes(type)) {
    return config.ticketLogChannelId;
  }
  if (
    moderationCommands.has(type)
    || type === "server audit log"
    || type === "member banned"
    || type === "member unbanned"
  ) {
    return config.moderationLogChannelId;
  }
  if (
    type === "message edited"
    || type === "message deleted"
    || type === "messages bulk deleted"
  ) {
    return config.messageLogChannelId;
  }
  if (type.startsWith("member ")) return config.memberLogChannelId;
  if (
    type.startsWith("channel ")
    || type.startsWith("thread ")
    || type === "webhooks updated"
    || type === "server updated"
    || type.startsWith("invite ")
  ) {
    return config.channelLogChannelId;
  }
  if (type.startsWith("role ") || type === "/role" || type === "/roles") return config.roleLogChannelId;
  if (type.startsWith("voice ")) return config.voiceLogChannelId;
  if (type.startsWith("emoji ")) return config.emojiLogChannelId;
  return config.logChannelId;
}

function isTextChannel(channel: Channel | null): channel is GuildTextBasedChannel {
  return channel !== null && channel.isTextBased() && !channel.isDMBased() && channel.guildId === config.guildId;
}

function shouldSuppressDiscordEvent(eventType: string): boolean {
  const type = eventType.toLowerCase();
  return type === "server audit log"
    || type === "member banned"
    || type === "member unbanned"
    || type.startsWith("message ")
    || type.startsWith("messages ")
    || type.startsWith("reaction ")
    || type.startsWith("voice ")
    || type.startsWith("member ")
    || type.startsWith("role ")
    || type.startsWith("emoji ")
    || type.startsWith("channel ")
    || type.startsWith("thread ")
    || type === "webhooks updated"
    || type === "server updated"
    || type.startsWith("invite ")
    || type.startsWith("erlc ")
    || type.startsWith("game ")
    || type.startsWith("in-game ");
}

function createLogMessage(title: string, details: string, color = 0x3478c8): MessageCreateOptions {
  const container = new ContainerBuilder()
    .setAccentColor(color)
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(`## ${title}\n${details}\n\n-# California State Roleplay`.slice(0, 4000)),
    )
    .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Large))
    .addMediaGalleryComponents(
      new MediaGalleryBuilder().addItems(
        new MediaGalleryItemBuilder()
          .setURL(`attachment://${LOG_FOOTER_IMAGE}`)
          .setDescription("California State Roleplay footer"),
      ),
    );

  return {
    flags: MessageFlags.IsComponentsV2,
    components: [container],
    files: [new AttachmentBuilder(resolve(process.cwd(), "assets", LOG_FOOTER_IMAGE), { name: LOG_FOOTER_IMAGE })],
    allowedMentions: { parse: [] },
  };
}

export async function audit(
  client: Client,
  eventType: string,
  details: string,
  ids: { guildId?: string | undefined; actorId?: string | undefined; subjectId?: string | undefined } = {},
): Promise<void> {
  saveDiscordEvent({ eventType, details, ...ids });
  if (shouldSuppressDiscordEvent(eventType)) return;
  const channelId = getLogChannelId(eventType, details);
  const channel = await client.channels.fetch(channelId);
  if (!isTextChannel(channel)) {
    throw new Error(`Configured log channel ${channelId} is not a guild text channel.`);
  }
  await channel.send(createLogMessage(`Audit · ${eventType}`, details));
}

export async function send911(client: Client, title: string, details: string): Promise<void> {
  const channel = await client.channels.fetch(config.calls911ChannelId);
  if (!isTextChannel(channel)) {
    throw new Error(`Configured 911 channel ${config.calls911ChannelId} is not a guild text channel.`);
  }
  await channel.send(createLogMessage(title, details, 0xd93f3f));
}

