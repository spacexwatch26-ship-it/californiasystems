import "dotenv/config";
import { z } from "zod";

const DEFAULT_APPLICATION_REVIEW_CHANNEL_ID = "1573910638202200104";
const DEFAULT_APPLICATION_RESULTS_CHANNEL_ID = "1573466220982706327";

const optionalEnvValue = z.preprocess(
  (value) => typeof value === "string" && value.trim() === "" ? undefined : value,
  z.string().min(1).optional(),
);

const schema = z.object({
  DISCORD_TOKEN: z.string().min(1),
  DISCORD_CLIENT_ID: z.string().min(1),
  DISCORD_GUILD_ID: z.string().min(1),
  LOG_CHANNEL_ID: z.string().min(1),
  COMMAND_LOG_CHANNEL_ID: z.string().min(1),
  SESSION_POLL_CHANNEL_ID: z.string().min(1),
  SESSION_ANNOUNCEMENT_CHANNEL_ID: z.string().min(1),
  TICKET_LOG_CHANNEL_ID: optionalEnvValue,
  MODERATION_LOG_CHANNEL_ID: optionalEnvValue,
  MESSAGE_LOG_CHANNEL_ID: optionalEnvValue,
  MEMBER_LOG_CHANNEL_ID: optionalEnvValue,
  CHANNEL_LOG_CHANNEL_ID: optionalEnvValue,
  ROLE_LOG_CHANNEL_ID: optionalEnvValue,
  VOICE_LOG_CHANNEL_ID: optionalEnvValue,
  EMOJI_LOG_CHANNEL_ID: optionalEnvValue,
  ERLC_911_CHANNEL_ID: z.string().min(1),
  APPLICATION_REVIEW_CHANNEL_ID: optionalEnvValue,
  APPLICATION_RESULTS_CHANNEL_ID: optionalEnvValue,
  ERLC_SERVER_KEY: optionalEnvValue,
  TICKET_STAFF_ROLE_ID: z.string().optional(),
  WEBHOOK_SECRET: z.string().min(32),
  WEBHOOK_PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  DATABASE_PATH: z.string().default("./data/california-systems.sqlite"),
});

const result = schema.safeParse(process.env);
if (!result.success) {
  throw new Error(`Invalid environment configuration:\n${z.prettifyError(result.error)}`);
}

if (result.data.LOG_CHANNEL_ID === result.data.ERLC_911_CHANNEL_ID) {
  throw new Error("LOG_CHANNEL_ID and ERLC_911_CHANNEL_ID must be different channels.");
}

const applicationReviewChannelId = result.data.APPLICATION_REVIEW_CHANNEL_ID || DEFAULT_APPLICATION_REVIEW_CHANNEL_ID;
const applicationResultsChannelId = result.data.APPLICATION_RESULTS_CHANNEL_ID || DEFAULT_APPLICATION_RESULTS_CHANNEL_ID;
if (applicationReviewChannelId === applicationResultsChannelId) {
  throw new Error("APPLICATION_REVIEW_CHANNEL_ID and APPLICATION_RESULTS_CHANNEL_ID must be different channels.");
}

export const config = {
  token: result.data.DISCORD_TOKEN,
  clientId: result.data.DISCORD_CLIENT_ID,
  guildId: result.data.DISCORD_GUILD_ID,
  logChannelId: result.data.LOG_CHANNEL_ID,
  commandLogChannelId: result.data.COMMAND_LOG_CHANNEL_ID,
  sessionPollChannelId: result.data.SESSION_POLL_CHANNEL_ID,
  sessionAnnouncementChannelId: result.data.SESSION_ANNOUNCEMENT_CHANNEL_ID,
  ticketLogChannelId: result.data.TICKET_LOG_CHANNEL_ID || result.data.LOG_CHANNEL_ID,
  moderationLogChannelId: result.data.MODERATION_LOG_CHANNEL_ID || result.data.LOG_CHANNEL_ID,
  messageLogChannelId: result.data.MESSAGE_LOG_CHANNEL_ID || result.data.LOG_CHANNEL_ID,
  memberLogChannelId: result.data.MEMBER_LOG_CHANNEL_ID || result.data.LOG_CHANNEL_ID,
  channelLogChannelId: result.data.CHANNEL_LOG_CHANNEL_ID || result.data.LOG_CHANNEL_ID,
  roleLogChannelId: result.data.ROLE_LOG_CHANNEL_ID || result.data.LOG_CHANNEL_ID,
  voiceLogChannelId: result.data.VOICE_LOG_CHANNEL_ID || result.data.LOG_CHANNEL_ID,
  emojiLogChannelId: result.data.EMOJI_LOG_CHANNEL_ID || result.data.LOG_CHANNEL_ID,
  calls911ChannelId: result.data.ERLC_911_CHANNEL_ID,
  applicationReviewChannelId,
  applicationResultsChannelId,
  erlcServerKey: result.data.ERLC_SERVER_KEY || undefined,
  ticketStaffRoleId: result.data.TICKET_STAFF_ROLE_ID || undefined,
  webhookSecret: result.data.WEBHOOK_SECRET,
  webhookPort: result.data.WEBHOOK_PORT,
  databasePath: result.data.DATABASE_PATH,
};
