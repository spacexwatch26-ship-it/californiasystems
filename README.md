# California State Roleplay bot

Discord.js bot for California State Roleplay. Discord panels and bot-generated
messages use Discord Components V2 and carry consistent CSRP branding. Discord
command/action logs continue to route to their configured channels. 911
reports/calls go only to their dedicated channel.

## Setup

1. Install Node.js 24 or newer.
2. Run `npm install`.
3. Fill in the provided `.env` with the bot token, application ID, server ID,
   log channel IDs, application review/results channel IDs, webhook secret, and
   optional ERLC server key, ticket staff role, port, and database path.
4. In the Discord Developer Portal, enable the **Server Members Intent** and
   **Message Content Intent**. Invite the bot with `bot` and `applications.commands`
   scopes and grant it View Channels, Send Messages, Read Message History,
   View Audit Log, Manage Channels, Manage Messages, Manage Roles, Manage
   Nicknames, Kick Members, Ban Members, and Moderate Members as needed by enabled commands.
5. Run `npm run register` to register the guild slash commands, then `npm run dev`
   for development or `npm run build && npm start` for production.

The webhook receiver accepts authenticated JSON `POST` requests at
`/erlc/events`. Send `Authorization: Bearer <WEBHOOK_SECRET>` and a JSON object
with an `event` string plus optional `is911` boolean and `details` string. Calls
marked `is911: true` are routed exclusively to the 911 channel. Other ER:LC
webhook events are stored locally but no longer posted to Discord. Keep the
secret private, use HTTPS through a trusted reverse proxy for internet-facing
traffic, and connect only an authorized game-side integration; this bot does
not automate or scrape the game client.

The `.env` file is local-only and ignored by Git. Set `WEBHOOK_SECRET` to a
random value with at least 32 characters. `LOG_CHANNEL_ID` and
`ERLC_911_CHANNEL_ID` must be distinct text channels in the configured server.
`APPLICATION_REVIEW_CHANNEL_ID` and `APPLICATION_RESULTS_CHANNEL_ID` default
to `1573910638202200104` and `1573466220982706327`.
Punishment cards go to `PUNISHMENT_CHANNEL_ID` (default
`1573484685948883024`); punishment command logs go to
`PUNISHMENT_LOG_CHANNEL_ID` (default `1573486551147741356`).
Set `COMMAND_LOG_CHANNEL_ID` to the channel for all slash-command usage and
command action logs other than punishment commands, which use the dedicated
punishment log channel. Each slash command produces one entry with its action
details combined; shift-panel button actions also produce a single command-log
entry without a duplicate generic button entry. Moderation-event posts are
disabled; moderation slash commands remain in their configured command log.
`MODERATION_LOG_CHANNEL_ID` is accepted for compatibility but is not used.
Optional message, member, channel, role, voice, and emoji category IDs remain
accepted for compatibility, but those activity logs are no longer posted to
Discord. Such events remain in the local database. Unset category IDs fall back
to `LOG_CHANNEL_ID`.
Set `SESSION_POLL_CHANNEL_ID` and `SESSION_ANNOUNCEMENT_CHANNEL_ID` to the
channels that should receive polls and session-start posts.
Optionally set `TICKET_STAFF_ROLE_ID` so that role can view newly created tickets.
Set `ERLC_SERVER_KEY` in `.env` to show live ER:LC player and queue counts in
session announcements. Keep this key private and never paste it into source
control or chat.

## Moderator applications

Administrators can use `/app-open` in the channel where the application panel
should appear. Applicants click its button and answer the Google Form questions
in DMs; the applicant's answers are sent to the configured review channel.
Reviewers accept or deny with a required reason. The matching accepted/denied
image and the reason are posted in the results channel, which mentions the
applicant. Accepted applicants receive a unique `MA-######` request ID in the
results post and a DM to include in a ticket for staff onboarding.
`/app-close` disables the current panel and prevents new applications;
applications already in progress can still be submitted. The bot needs the
Direct Messages intent enabled to receive answers.

## Logging and privacy

Discord activity logs are posted for role creation/deletion and role assignment,
channel creation/deletion, member join/leave, voice join/leave, emoji
creation/deletion, and message edit/delete (including bulk deletion). These
posts use the audit banner and are routed to their configured category channels.
New message creation, role removal, channel/member/emoji updates, bans, and
other unlisted activity remain suppressed from Discord.
Game-event routing is unchanged: 911 calls go only to their dedicated channel,
and non-911 game events remain stored locally without Discord posts.
Discord only exposes events available to the bot's enabled gateway intents and
server permissions; it cannot see private messages or ephemeral responses, and
does not provide every action or actor detail as a gateway event. Message
content is retained in the local SQLite database. Messages and reactions in the
dedicated 911 channel are not copied to the general audit channel.
Restrict access to both channels and the database, and follow your community's
notice and retention rules.

The visible slash-command families from the screenshots are registered,
including 911, ticket, moderation, application, callsign, staff-record, LOA,
role, session, and queue commands. `/session-vote` posts a 6-vote interactive
poll with the supplied banner images, custom emojis, and a voter list. Reaching
six votes automatically posts a Components V2 session announcement with the
session banner and footer, player and queue counts in `current/max` format
when `ERLC_SERVER_KEY` is configured, and one dropdown containing Quick Join
and session-ping opt-in/opt-out choices. Live counts refresh every minute, with
a relative “Last updated” timestamp. The poll pings the Session Ping and
Community Member roles; session-start announcements ping the Session Ping role.
Session-end posts use the same branded banner/footer layout and include a
dropdown to opt into the Session Ping role for future notifications. Refresh
edits do not send additional pings, and the announcement does not include staff
counts. Only members with role
`1573500103459741726` can run session commands; voting remains open to everyone.
Shift responses are public. Staff use `/shift-management` for the clock-in/out
panel and `/shift-leadership` for the single-message weekly hours leaderboard.
Weekly totals reset Sunday at midnight Pacific; individual shift records remain
available for history. Clocking in grants role `1483518371227238564`, and
clocking out removes it. `/shift-admin` provides active shifts, force clock-out,
history, and minute deductions from completed shifts, and requires Internal
Affairs role `1445540175341158611`; the management panel requires Staff role
`1445540284405645453`. The bot needs
Manage Roles, with the on-shift and Session Ping roles below its highest role.
`/punish` posts a Components V2 staff card with a unique random 8-digit ID and
privately confirms that ID to the issuer. Verbal Warning, Written Warning,
Strike, and Suspension punishments expire two calendar months after issuance;
Termination has no expiration.
Never put bot tokens, server keys, or webhook secrets in source control or chat.
