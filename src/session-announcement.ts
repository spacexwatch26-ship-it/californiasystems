import { resolve } from "node:path";
import {
  ActionRowBuilder,
  AttachmentBuilder,
  ContainerBuilder,
  MediaGalleryBuilder,
  MediaGalleryItemBuilder,
  MessageFlags,
  PermissionFlagsBits,
  SeparatorBuilder,
  SeparatorSpacingSize,
  StringSelectMenuBuilder,
  TextDisplayBuilder,
  type Channel,
  type Client,
  type GuildTextBasedChannel,
  type MessageCreateOptions,
  type MessageEditOptions,
  type StringSelectMenuInteraction,
} from "discord.js";
import { z } from "zod";
import { config } from "./config.js";
import { database, saveDiscordEvent } from "./database.js";
import { audit } from "./logging.js";
import { v2Flags, v2Message } from "./ui.js";

export const SESSION_PING_ROLE_ID = "1445540290298515568";
export const QUICK_JOIN_LINK = "roblox://placeId=2534724415&launchData=%7B%22psCode%22%3A%22CaliStRp%22%7D";
export const SESSION_ANNOUNCEMENT_REFRESH_INTERVAL_MS = 60_000;

const SESSION_IMAGE = "CSRP-Session.png";
const SESSION_FOOTER_IMAGE = "CSRP-Bottom.png";
const SESSION_ANNOUNCEMENT_PENDING = "sending";
const SESSION_OPTIONS_SELECT_ID = "session-announcement-options";

const serverInformationSchema = z.object({
  CurrentPlayers: z.number().int().nonnegative(),
  MaxPlayers: z.number().int().positive(),
  Queue: z.array(z.number().int().nonnegative()),
});

export type SessionServerStats =
  | { available: true; currentPlayers: number; maxPlayers: number; queueCount: number }
  | { available: false; reason: string };

function isGuildTextChannel(channel: Channel | null): channel is GuildTextBasedChannel {
  return channel !== null
    && channel.isTextBased()
    && !channel.isDMBased()
    && channel.guildId === config.guildId;
}

export async function fetchSessionServerStats(fetcher: typeof fetch = fetch): Promise<SessionServerStats> {
  if (!config.erlcServerKey) {
    return { available: false, reason: "ERLC_SERVER_KEY is not configured in .env." };
  }

  const response = await fetcher("https://api.erlc.gg/v2/server?Queue=true", {
    headers: { "server-key": config.erlcServerKey },
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) {
    throw new Error(`ER:LC API returned HTTP ${response.status}.`);
  }

  const parsed = serverInformationSchema.safeParse(await response.json());
  if (!parsed.success) {
    throw new Error(`ER:LC API response did not contain valid player, max-player, and queue data: ${z.prettifyError(parsed.error)}`);
  }

  return {
    available: true,
    currentPlayers: parsed.data.CurrentPlayers,
    maxPlayers: parsed.data.MaxPlayers,
    queueCount: parsed.data.Queue.length,
  };
}

async function loadSessionServerStats(fetcher: typeof fetch): Promise<SessionServerStats> {
  try {
    return await fetchSessionServerStats(fetcher);
  } catch (error) {
    console.error("Could not load ER:LC server counts for the session announcement:", error);
    return { available: false, reason: "ER:LC server data is temporarily unavailable." };
  }
}

function createSessionAnnouncementContainer(
  stats: SessionServerStats,
  lastUpdatedAt: Date,
  bannerUrl: string,
  footerUrl: string,
): ContainerBuilder {
  const playerCount = stats.available
    ? `\`${stats.currentPlayers}/${stats.maxPlayers}\``
    : `Unavailable — ${stats.reason}`;
  const queueCount = stats.available
    ? `\`${stats.queueCount}/${stats.maxPlayers}\``
    : `Unavailable — ${stats.reason}`;
  const sessionOptions = new StringSelectMenuBuilder()
    .setCustomId(SESSION_OPTIONS_SELECT_ID)
    .setPlaceholder("Click here to see options")
    .addOptions(
      { label: "Quick Join", description: "Get the direct Roblox link to California State Roleplay.", value: "quick-join" },
      { label: "Get Session Pings", description: "Receive future session announcements.", value: "enable" },
      { label: "Remove Session Pings", description: "Stop receiving session announcements.", value: "disable" },
    );
  const container = new ContainerBuilder()
    .setAccentColor(0x4569a8)
    .addMediaGalleryComponents(
      new MediaGalleryBuilder().addItems(
        new MediaGalleryItemBuilder()
          .setURL(bannerUrl)
          .setDescription("California State Roleplay session banner"),
      ),
    )
    .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Large))
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `<@&${SESSION_PING_ROLE_ID}>\n## Session announcement\n> **A California State Roleplay session has commenced!**\n> Join the server and create great roleplays with all departments.`,
      ),
    )
    .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Large))
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent([
        "## Server details",
        "> **Server name:** `California State Roleplay | VC Only`",
        "> **Join code:** `CaliStRp`",
        "> **Owner:** `bluecrewofficial`",
      ].join("\n")),
    )
    .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Large))
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent([
        "## Live status",
        `> **Players:** ${playerCount}`,
        `> **Queue:** ${queueCount}`,
        `> **Last updated:** <t:${Math.floor(lastUpdatedAt.getTime() / 1000)}:R>`,
      ].join("\n")),
    )
    .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Large))
    .addActionRowComponents(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(sessionOptions))
    .addMediaGalleryComponents(
      new MediaGalleryBuilder().addItems(
        new MediaGalleryItemBuilder()
          .setURL(footerUrl)
          .setDescription("California State Roleplay footer"),
      ),
    );

  return container;
}

export function createSessionStartMessage(stats: SessionServerStats, lastUpdatedAt = new Date()): MessageCreateOptions {
  const container = createSessionAnnouncementContainer(
    stats,
    lastUpdatedAt,
    `attachment://${SESSION_IMAGE}`,
    `attachment://${SESSION_FOOTER_IMAGE}`,
  );

  return {
    flags: MessageFlags.IsComponentsV2,
    components: [container],
    files: [
      new AttachmentBuilder(resolve(process.cwd(), "assets", SESSION_IMAGE), { name: SESSION_IMAGE }),
      new AttachmentBuilder(resolve(process.cwd(), "assets", SESSION_FOOTER_IMAGE), { name: SESSION_FOOTER_IMAGE }),
    ],
    allowedMentions: { parse: [], roles: [SESSION_PING_ROLE_ID] },
  };
}

export function createSessionEndMessage(): MessageCreateOptions {
  const sessionOptions = new StringSelectMenuBuilder()
    .setCustomId(SESSION_OPTIONS_SELECT_ID)
    .setPlaceholder("Click here to see options")
    .addOptions({
      label: "Receive Session Notification",
      description: "Get notified when the next session starts.",
      value: "enable",
    });
  const container = new ContainerBuilder()
    .setAccentColor(0x4569a8)
    .addMediaGalleryComponents(
      new MediaGalleryBuilder().addItems(
        new MediaGalleryItemBuilder()
          .setURL(`attachment://${SESSION_IMAGE}`)
          .setDescription("California State Roleplay session banner"),
      ),
    )
    .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Large))
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        "> *A California State Roleplay session has ended. Thank you to everyone who joined, created realistic scenes, and made today's roleplay enjoyable and fun!*",
      ),
    )
    .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Large))
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        "> *The server is now closed. We hope you enjoyed the session, and stay tuned for the next session.*",
      ),
    )
    .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Large))
    .addActionRowComponents(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(sessionOptions))
    .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Large))
    .addMediaGalleryComponents(
      new MediaGalleryBuilder().addItems(
        new MediaGalleryItemBuilder()
          .setURL(`attachment://${SESSION_FOOTER_IMAGE}`)
          .setDescription("California State Roleplay footer"),
      ),
    );

  return {
    flags: MessageFlags.IsComponentsV2,
    components: [container],
    files: [
      new AttachmentBuilder(resolve(process.cwd(), "assets", SESSION_IMAGE), { name: SESSION_IMAGE }),
      new AttachmentBuilder(resolve(process.cwd(), "assets", SESSION_FOOTER_IMAGE), { name: SESSION_FOOTER_IMAGE }),
    ],
    allowedMentions: { parse: [] },
  };
}

function reserveSessionAnnouncement(pollId: string): boolean {
  const result = database.prepare(`
    UPDATE session_polls
    SET session_announcement_message_id = ?
    WHERE poll_id = ? AND status = 'reached' AND session_announcement_message_id IS NULL
  `).run(SESSION_ANNOUNCEMENT_PENDING, pollId);
  return Number(result.changes) === 1;
}

export async function sendSessionStartAnnouncement(
  client: Client,
  pollId: string,
  fetcher: typeof fetch = fetch,
): Promise<string | undefined> {
  if (!reserveSessionAnnouncement(pollId)) return undefined;

  try {
    const poll = database.prepare("SELECT * FROM session_polls WHERE poll_id = ?").get(pollId) as
      | { guild_id: string; channel_id: string; status: string }
      | undefined;
    if (!poll || poll.status !== "reached") {
      database.prepare(`
        UPDATE session_polls
        SET session_announcement_message_id = NULL, session_announcement_channel_id = NULL
        WHERE poll_id = ? AND session_announcement_message_id = ?
      `)
        .run(pollId, SESSION_ANNOUNCEMENT_PENDING);
      return undefined;
    }

    const channel = await client.channels.fetch(config.sessionAnnouncementChannelId);
    if (!isGuildTextChannel(channel)) {
      throw new Error(`Session announcement channel ${config.sessionAnnouncementChannelId} is not a text channel in the configured server.`);
    }

    const stats = await loadSessionServerStats(fetcher);
    const message = await channel.send(createSessionStartMessage(stats));
    const saved = database.prepare(`
      UPDATE session_polls
      SET session_announcement_message_id = ?, session_announcement_channel_id = ?
      WHERE poll_id = ? AND session_announcement_message_id = ?
    `).run(message.id, config.sessionAnnouncementChannelId, pollId, SESSION_ANNOUNCEMENT_PENDING);
    if (Number(saved.changes) !== 1) {
      throw new Error(`Could not save the session announcement message for poll ${pollId}.`);
    }

    void audit(
      client,
      "Session start announced",
      `The session start for poll ${pollId} was posted in <#${config.sessionAnnouncementChannelId}>.`,
      { guildId: poll.guild_id, subjectId: message.id },
    ).catch((error: unknown) => {
      console.error("Session started, but its audit log could not be delivered:", error);
    });
    return message.id;
  } catch (error) {
    database.prepare(`
      UPDATE session_polls
      SET session_announcement_message_id = NULL, session_announcement_channel_id = NULL
      WHERE poll_id = ? AND session_announcement_message_id = ?
    `).run(pollId, SESSION_ANNOUNCEMENT_PENDING);
    const errorDetails = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    saveDiscordEvent({
      eventType: "session start announcement failed",
      subjectId: pollId,
      details: errorDetails,
    });
    throw error;
  }
}

export async function refreshSessionAnnouncements(
  client: Client,
  fetcher: typeof fetch = fetch,
): Promise<void> {
  const announcements = database.prepare(`
    SELECT poll_id, guild_id, session_announcement_message_id, session_announcement_channel_id
    FROM session_polls
    WHERE status = 'reached'
      AND session_announcement_message_id IS NOT NULL
      AND session_announcement_message_id != ?
  `).all(SESSION_ANNOUNCEMENT_PENDING) as Array<{
    poll_id: string;
    guild_id: string;
    session_announcement_message_id: string;
    session_announcement_channel_id: string | null;
  }>;
  if (announcements.length === 0) return;

  const stats = await loadSessionServerStats(fetcher);
  for (const announcement of announcements) {
    try {
      const channelId = announcement.session_announcement_channel_id ?? config.sessionAnnouncementChannelId;
      const channel = await client.channels.fetch(channelId);
      if (!isGuildTextChannel(channel)) {
        throw new Error(`Session announcement channel ${channelId} is not a text channel in the configured server.`);
      }

      const message = await channel.messages.fetch(announcement.session_announcement_message_id);
      const attachments = [...message.attachments.values()];
      const banner = attachments.find((attachment) => attachment.name === SESSION_IMAGE);
      const footer = attachments.find((attachment) => attachment.name === SESSION_FOOTER_IMAGE);
      if (!banner || !footer) {
        throw new Error(`Session announcement ${message.id} is missing its banner or footer attachment.`);
      }

      const update: MessageEditOptions = {
        flags: MessageFlags.IsComponentsV2,
        components: [
          createSessionAnnouncementContainer(stats, new Date(), banner.url, footer.url),
        ],
        allowedMentions: { parse: [] },
        attachments: attachments.map((attachment) => ({ id: attachment.id })),
      };
      await message.edit(update);
    } catch (error) {
      console.error(`Could not refresh session announcement for poll ${announcement.poll_id}:`, error);
      const errorDetails = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
      try {
        saveDiscordEvent({
          eventType: "session announcement update failed",
          guildId: announcement.guild_id,
          subjectId: announcement.session_announcement_message_id,
          details: errorDetails,
        });
      } catch (logError) {
        console.error(`Could not save the refresh failure for poll ${announcement.poll_id}:`, logError);
      }
    }
  }
}

export function startSessionAnnouncementRefresh(client: Client): NodeJS.Timeout {
  let refreshInProgress = false;
  const timer = setInterval(() => {
    if (refreshInProgress) return;
    refreshInProgress = true;
    void refreshSessionAnnouncements(client)
      .catch((error: unknown) => {
        console.error("Session announcement refresh failed:", error);
      })
      .finally(() => {
        refreshInProgress = false;
      });
  }, SESSION_ANNOUNCEMENT_REFRESH_INTERVAL_MS);
  timer.unref();
  return timer;
}

export async function publishPendingSessionAnnouncements(client: Client): Promise<void> {
  database.prepare(`
    UPDATE session_polls
    SET session_announcement_message_id = NULL
    WHERE session_announcement_message_id = ?
  `).run(SESSION_ANNOUNCEMENT_PENDING);
  const pending = database.prepare(`
    SELECT poll_id FROM session_polls
    WHERE status = 'reached' AND session_announcement_message_id IS NULL
  `).all() as Array<{ poll_id: string }>;

  for (const poll of pending) {
    try {
      await sendSessionStartAnnouncement(client, poll.poll_id);
    } catch (error) {
      console.error(`Could not publish the session announcement for poll ${poll.poll_id}:`, error);
    }
  }
}

export async function executeSessionAnnouncementSelect(interaction: StringSelectMenuInteraction): Promise<boolean> {
  if (interaction.customId !== SESSION_OPTIONS_SELECT_ID) return false;
  const action = interaction.values[0];
  if (action === "quick-join") {
    await interaction.reply({
      ...v2Message("Quick Join", `[Open California State Roleplay in Roblox](${QUICK_JOIN_LINK})`),
      flags: v2Flags(true),
    });
    return true;
  }

  if (!interaction.guild || interaction.guildId !== config.guildId) {
    await interaction.reply({ ...v2Message("Session pings unavailable", "This option is only available in the California State Roleplay server."), flags: v2Flags(true) });
    return true;
  }
  if (action !== "enable" && action !== "disable") {
    await interaction.reply({ ...v2Message("Session pings unchanged", "Choose one of the listed session ping options."), flags: v2Flags(true) });
    return true;
  }

  const role = await interaction.guild.roles.fetch(SESSION_PING_ROLE_ID);
  if (!role) {
    throw new Error(`Session ping role ${SESSION_PING_ROLE_ID} was not found.`);
  }
  const botMember = await interaction.guild.members.fetchMe();
  if (!botMember.permissions.has(PermissionFlagsBits.ManageRoles) || !role.editable) {
    throw new Error("The bot needs Manage Roles, and the session ping role must be below the bot's highest role.");
  }
  const member = await interaction.guild.members.fetch(interaction.user.id);
  const alreadyHasRole = member.roles.cache.has(role.id);
  if (action === "enable" && !alreadyHasRole) {
    await member.roles.add(role, "Member opted into California State Roleplay session pings.");
  } else if (action === "disable" && alreadyHasRole) {
    await member.roles.remove(role, "Member opted out of California State Roleplay session pings.");
  }

  const confirmation = action === "enable"
    ? alreadyHasRole ? "You already have the Session Ping role." : "You will now receive California State Roleplay session pings."
    : alreadyHasRole ? "You will no longer receive session pings." : "You do not currently have the Session Ping role.";
  await interaction.reply({ ...v2Message("Session Ping Role", confirmation), flags: v2Flags(true) });
  return true;
}
