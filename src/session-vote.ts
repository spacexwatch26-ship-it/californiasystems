import { resolve } from "node:path";
import {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  MediaGalleryBuilder,
  MediaGalleryItemBuilder,
  MessageFlags,
  SeparatorBuilder,
  SeparatorSpacingSize,
  TextDisplayBuilder,
  type ButtonInteraction,
  type MessageCreateOptions,
} from "discord.js";
import { database, saveDiscordEvent } from "./database.js";
import { audit } from "./logging.js";
import { sendSessionStartAnnouncement, SESSION_PING_ROLE_ID } from "./session-announcement.js";
import { v2Flags, v2Message } from "./ui.js";

export const SESSION_VOTE_THRESHOLD = 6;
export const SESSION_VOTE_EMOJI_ID = "1554160854570893392";
export const SESSION_VOTERS_EMOJI_ID = "1573504731723071569";
export const COMMUNITY_MEMBER_ROLE_ID = "1446676911697821890";
const TOP_BANNER = "CSRP-Polls.png";
const BOTTOM_BANNER = "CSRP-Bottom.png";

export interface SessionPoll {
  poll_id: string;
  guild_id: string;
  channel_id: string;
  message_id: string;
  notification_role_id: string | null;
  threshold: number;
  status: "active" | "reached" | "closed";
  created_by: string;
  session_announcement_message_id: string | null;
  session_announcement_channel_id: string | null;
}

export interface VoteResult {
  poll: SessionPoll;
  voteCount: number;
  added: boolean;
  reachedNow: boolean;
}

export function getSessionPoll(pollId: string): SessionPoll | undefined {
  return database.prepare("SELECT * FROM session_polls WHERE poll_id = ?").get(pollId) as SessionPoll | undefined;
}

export function saveSessionPoll(
  poll: Omit<SessionPoll, "status" | "session_announcement_message_id" | "session_announcement_channel_id">,
): void {
  database.prepare(`
    INSERT INTO session_polls
      (poll_id, guild_id, channel_id, message_id, notification_role_id, threshold, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    poll.poll_id,
    poll.guild_id,
    poll.channel_id,
    poll.message_id,
    poll.notification_role_id,
    poll.threshold,
    poll.created_by,
  );
}

export function recordSessionVote(pollId: string, userId: string): VoteResult | undefined {
  const poll = getSessionPoll(pollId);
  if (!poll) return undefined;
  if (poll.status !== "active") {
    const count = database.prepare("SELECT COUNT(*) AS count FROM session_votes WHERE poll_id = ?").get(pollId) as { count: number };
    return { poll, voteCount: count.count, added: false, reachedNow: false };
  }

  const inserted = database.prepare("INSERT OR IGNORE INTO session_votes (poll_id, user_id) VALUES (?, ?)").run(pollId, userId);
  const count = database.prepare("SELECT COUNT(*) AS count FROM session_votes WHERE poll_id = ?").get(pollId) as { count: number };
  let reachedNow = false;
  if (count.count >= poll.threshold) {
    const updated = database.prepare("UPDATE session_polls SET status = 'reached', ended_at = datetime('now') WHERE poll_id = ? AND status = 'active'").run(pollId);
    reachedNow = Number(updated.changes) > 0;
    if (reachedNow) poll.status = "reached";
  }
  return { poll, voteCount: count.count, added: Number(inserted.changes) > 0, reachedNow };
}

export function getSessionVoters(pollId: string): string[] {
  const rows = database.prepare("SELECT user_id FROM session_votes WHERE poll_id = ? ORDER BY created_at, user_id").all(pollId) as Array<{ user_id: string }>;
  return rows.map((row) => row.user_id);
}

export function buildSessionVoteContainer(
  pollId: string,
  notificationRoleId: string | null,
  voteCount: number,
  status: SessionPoll["status"],
  threshold = SESSION_VOTE_THRESHOLD,
  topBannerUrl = `attachment://${TOP_BANNER}`,
  bottomBannerUrl = `attachment://${BOTTOM_BANNER}`,
): ContainerBuilder {
  const statusText = status === "active"
    ? `A new session poll is now live! We need **${threshold} votes** to confirm the next **California State Roleplay** session. Cast your vote to help us get started. Once ${threshold} votes are reached, the session time will be announced.`
    : `The poll reached **${threshold} votes**. The session announcement is being posted now.`;
  const voteButton = new ButtonBuilder()
    .setCustomId(`session-vote:${pollId}`)
    .setLabel("Vote")
    .setStyle(ButtonStyle.Primary)
    .setEmoji({ id: SESSION_VOTE_EMOJI_ID })
    .setDisabled(status !== "active");
  const countButton = new ButtonBuilder()
    .setCustomId(`session-count:${pollId}`)
    .setLabel(`${voteCount}/${threshold}`)
    .setStyle(ButtonStyle.Secondary)
    .setEmoji({ id: SESSION_VOTERS_EMOJI_ID })
    .setDisabled(true);
  const votersButton = new ButtonBuilder()
    .setCustomId(`session-voters:${pollId}`)
    .setLabel("View Voters")
    .setStyle(ButtonStyle.Secondary)
    .setEmoji({ id: SESSION_VOTERS_EMOJI_ID });
  const controls = new ActionRowBuilder<ButtonBuilder>().addComponents(voteButton, countButton, votersButton);
  const notificationRoles = notificationRoleId
    ? [...new Set([notificationRoleId, COMMUNITY_MEMBER_ROLE_ID])]
    : [];
  const notification = notificationRoles.length
    ? `${notificationRoles.map((roleId) => `<@&${roleId}>`).join(" ")}\n`
    : "";

  return new ContainerBuilder()
    .setAccentColor(0x28272d)
    .addMediaGalleryComponents(
      new MediaGalleryBuilder().addItems(
        new MediaGalleryItemBuilder().setURL(topBannerUrl).setDescription("California State Roleplay poll banner"),
      ),
    )
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(`${notification}## Session Poll\n${statusText}`),
    )
    .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Large))
    .addActionRowComponents(controls)
    .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Large))
    .addMediaGalleryComponents(
      new MediaGalleryBuilder().addItems(
        new MediaGalleryItemBuilder().setURL(bottomBannerUrl).setDescription("California State Roleplay footer banner"),
      ),
    );
}

export function createSessionVoteMessage(
  pollId: string,
  notificationRoleId: string | null,
): MessageCreateOptions {
  const topPath = resolve(process.cwd(), "assets", TOP_BANNER);
  const bottomPath = resolve(process.cwd(), "assets", BOTTOM_BANNER);
  return {
    flags: MessageFlags.IsComponentsV2,
    components: [buildSessionVoteContainer(pollId, notificationRoleId, 0, "active")],
    files: [
      new AttachmentBuilder(topPath, { name: TOP_BANNER }),
      new AttachmentBuilder(bottomPath, { name: BOTTOM_BANNER }),
    ],
    allowedMentions: notificationRoleId
      ? { parse: [], roles: [...new Set([notificationRoleId, COMMUNITY_MEMBER_ROLE_ID])] }
      : { parse: [] },
  };
}

export async function executeSessionVoteButton(
  interaction: ButtonInteraction,
  fetcher: typeof fetch = fetch,
): Promise<boolean> {
  const [action, pollId] = interaction.customId.split(":", 2);
  if (!pollId || !["session-vote", "session-voters", "session-count"].includes(action ?? "")) return false;

  const poll = getSessionPoll(pollId);
  if (!poll || interaction.message.id !== poll.message_id || interaction.channelId !== poll.channel_id || interaction.guildId !== poll.guild_id) {
    await interaction.reply({ ...v2Message("Poll unavailable", "This session poll is no longer available."), flags: v2Flags(true) });
    return true;
  }

  if (action === "session-voters") {
    const voters = getSessionVoters(pollId);
    const voterList = voters.length
      ? voters.slice(0, 100).map((id) => `• <@${id}>`).join("\n") + (voters.length > 100 ? `\n…and ${voters.length - 100} more.` : "")
      : "No votes have been cast yet.";
    await interaction.reply({
      ...v2Message(`Session Poll Voters · ${voters.length}/${poll.threshold}`, voterList),
      flags: v2Flags(true),
    });
    return true;
  }

  if (action === "session-count") {
    await interaction.reply({ ...v2Message("Session poll", "The current total is shown on the poll."), flags: v2Flags(true) });
    return true;
  }

  if (poll.status !== "active") {
    await interaction.reply({ ...v2Message("Voting closed", "The session vote has reached its goal."), flags: v2Flags(true) });
    return true;
  }

  await interaction.deferUpdate();

  let result: VoteResult | undefined;
  try {
    result = recordSessionVote(pollId, interaction.user.id);
  } catch (error) {
    console.error("Could not save session vote:", error);
    await interaction.followUp({
      ...v2Message("Vote not recorded", "We couldn't save your vote. Please try again."),
      flags: v2Flags(true),
    });
    return true;
  }
  if (!result) {
    await interaction.followUp({ ...v2Message("Poll unavailable", "This session poll is no longer available."), flags: v2Flags(true) });
    return true;
  }

  const announceReachedSession = async () => {
    if (!result.reachedNow) return;
    try {
      await sendSessionStartAnnouncement(interaction.client, pollId, fetcher);
    } catch (error) {
      console.error("The poll reached its goal but the session announcement could not be posted:", error);
      await interaction.followUp({
        ...v2Message("Session announcement pending", `The ${SESSION_VOTE_THRESHOLD}-vote goal was met, but I couldn't post the session announcement. Staff have been notified.`),
        flags: v2Flags(true),
      });
    }
    void audit(
      interaction.client,
      "Session vote threshold reached",
      `Poll ${pollId} reached ${result.voteCount}/${poll.threshold} votes.`,
      { guildId: poll.guild_id, actorId: interaction.user.id, subjectId: poll.message_id },
    ).catch((error: unknown) => {
      console.error("Session vote threshold audit could not be delivered:", error);
    });
  };

  const topBannerUrl = interaction.message.attachments.find((attachment) => attachment.name === TOP_BANNER)?.url
    ?? `attachment://${TOP_BANNER}`;
  const bottomBannerUrl = interaction.message.attachments.find((attachment) => attachment.name === BOTTOM_BANNER)?.url
    ?? `attachment://${BOTTOM_BANNER}`;
  const updatePayload = {
    components: [buildSessionVoteContainer(
      pollId,
      poll.notification_role_id,
      result.voteCount,
      result.poll.status,
      poll.threshold,
      topBannerUrl,
      bottomBannerUrl,
    )],
    allowedMentions: { parse: [] },
  };
  try {
    await interaction.message.edit(updatePayload);
  } catch (messageEditError) {
    try {
      await interaction.editReply(updatePayload);
    } catch (interactionEditError) {
      const describeError = (error: unknown) => error instanceof Error ? `${error.name}: ${error.message}` : String(error);
      const errorDetails = `Message edit: ${describeError(messageEditError)}; interaction edit: ${describeError(interactionEditError)}`;
      saveDiscordEvent({
        eventType: "session poll update failed",
        guildId: poll.guild_id,
        actorId: interaction.user.id,
        subjectId: poll.message_id,
        details: `Poll ${pollId}: ${errorDetails}`,
      });
      console.error("Session poll count was saved but both message update methods failed:", {
        messageEditError,
        interactionEditError,
      });
      await interaction.followUp({
        ...v2Message("Vote recorded", "Your vote was counted, but the public poll counter could not be updated. Please notify staff."),
        flags: v2Flags(true),
      });
      await announceReachedSession();
      return true;
    }
  }

  if (!result.added) {
    await interaction.followUp({ ...v2Message("Already voted", "Your vote is already counted."), flags: v2Flags(true) });
  } else {
    await interaction.followUp({
      ...v2Message("Vote recorded", "Your vote has been casted."),
      flags: v2Flags(true),
    });
  }
  await announceReachedSession();
  return true;
}
