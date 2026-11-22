import { randomInt } from "node:crypto";
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
  ModalBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  TextDisplayBuilder,
  TextInputBuilder,
  TextInputStyle,
  type ButtonInteraction,
  type Channel,
  type Client,
  type GuildTextBasedChannel,
  type Message,
  type MessageCreateOptions,
  type ModalSubmitInteraction,
} from "discord.js";
import { config } from "./config.js";
import { database } from "./database.js";
import { v2Flags, v2Message } from "./ui.js";

const BOTTOM_IMAGE = "CSRP-Bottom.png";
const ACCEPTED_IMAGE = "CSRP-Accepted.png";
const DENIED_IMAGE = "CSRP-Denied.png";
const APPLICATION_START_BUTTON = "moderator-app:start";
const STAR_EMOJI = "<:star:1554211049014562826>";
const CROWN_EMOJI = "<:crown:1554160757757968405>";
const PIN_EMOJI = "<:pin:1554160947013222541>";
const MAX_ANSWER_LENGTH = 1500;
const MAX_REVIEW_PAGE_LENGTH = 2200;

export const MODERATOR_APPLICATION_QUESTIONS = [
  "What is your Discord username? (Example : datboi_jeremiah)",
  "What is your Discord ID? (Example : 1303570809050107960)",
  "What is your Roblox username? (Example : Bluecrewoffical)",
  "What timezone are you in? (Example : CST, EST, PST, etc.)",
  "How long have you been a member of California State Roleplay?",
  "Why do you want to become a Moderator?",
  "What qualities do you believe make an effective moderator?",
  "Why should we choose you over other applicants?",
  "How active are you each week, and how often can you assist during roleplay sessions?",
  "A member repeatedly breaks the rules after being warned. How would you handle the situation?",
  "You witness another staff member abusing their permissions. What would you do?",
  "A member begins arguing with you after receiving moderation. How do you respond?",
  "How would you remain fair and unbiased when moderating friends or members you know?",
  "Have you read and do you understand the server rules? (Yes/No)",
  "Do you currently have a good moderation history with little to no recent disciplinary actions? If yes, briefly explain why you believe your history reflects your readiness to become staff.",
] as const;

type ApplicationStatus = "pending" | "accepted" | "denied";

interface ModeratorApplication {
  id: number;
  applicant_id: string;
  answers_json: string;
  status: ApplicationStatus;
  acceptance_id: string | null;
  submitted_at: string;
  reviewed_by: string | null;
  decision_reason: string | null;
  reviewed_at: string | null;
  review_message_id: string | null;
  review_page_message_ids: string | null;
}

interface ApplicationDraft {
  applicant_id: string;
  current_question: number;
  answers_json: string;
}

function applicationRequestId(id: number): string {
  return `MOD-${String(id).padStart(5, "0")}`;
}

function isGuildTextChannel(channel: Channel | null, guildId: string): channel is GuildTextBasedChannel {
  return channel !== null
    && channel.isTextBased()
    && !channel.isDMBased()
    && channel.guildId === guildId;
}

async function fetchConfiguredTextChannel(client: Client, channelId: string, label: string): Promise<GuildTextBasedChannel> {
  const channel = await client.channels.fetch(channelId);
  if (!isGuildTextChannel(channel, config.guildId)) {
    throw new Error(`Configured ${label} channel ${channelId} is not a text channel in the configured server.`);
  }
  return channel;
}

function isModeratorApplicationOpen(): boolean {
  const row = database.prepare("SELECT value FROM application_settings WHERE setting = 'status'").get() as { value: string } | undefined;
  return row?.value === "open";
}

function getModeratorApplication(id: number): ModeratorApplication | undefined {
  const row = database.prepare("SELECT * FROM moderator_applications WHERE id = ?").get(id);
  if (!row) return undefined;
  const status = row.status;
  if (status !== "pending" && status !== "accepted" && status !== "denied") {
    throw new Error(`Moderator application ${id} has an invalid status.`);
  }
  return {
    id: Number(row.id),
    applicant_id: String(row.applicant_id),
    answers_json: String(row.answers_json),
    status,
    acceptance_id: typeof row.acceptance_id === "string" ? row.acceptance_id : null,
    submitted_at: String(row.submitted_at),
    reviewed_by: typeof row.reviewed_by === "string" ? row.reviewed_by : null,
    decision_reason: typeof row.decision_reason === "string" ? row.decision_reason : null,
    reviewed_at: typeof row.reviewed_at === "string" ? row.reviewed_at : null,
    review_message_id: typeof row.review_message_id === "string" ? row.review_message_id : null,
    review_page_message_ids: typeof row.review_page_message_ids === "string" ? row.review_page_message_ids : null,
  };
}

function generateAcceptanceId(): string {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const acceptanceId = `MA-${randomInt(100_000, 1_000_000)}`;
    const existing = database.prepare("SELECT 1 FROM moderator_applications WHERE acceptance_id = ?").get(acceptanceId);
    if (!existing) return acceptanceId;
  }
  throw new Error("Could not generate a unique moderator acceptance ID.");
}

async function editV2Reply(
  interaction: ButtonInteraction | ModalSubmitInteraction,
  title: string,
  body: string,
): Promise<void> {
  const message = v2Message(title, body);
  if (!message.components) throw new Error("Could not build a Components V2 application response.");
  await interaction.editReply({
    flags: MessageFlags.IsComponentsV2,
    components: message.components,
    allowedMentions: { parse: [] },
  });
}

function getApplicationPanel(): { channel_id: string; message_id: string } | undefined {
  const channel = database.prepare("SELECT value FROM application_settings WHERE setting = 'panel_channel_id'").get() as { value: string } | undefined;
  const message = database.prepare("SELECT value FROM application_settings WHERE setting = 'panel_message_id'").get() as { value: string } | undefined;
  return channel && message ? { channel_id: channel.value, message_id: message.value } : undefined;
}

function bottomImageGallery(): MediaGalleryBuilder {
  return new MediaGalleryBuilder().addItems(
    new MediaGalleryItemBuilder()
      .setURL(`attachment://${BOTTOM_IMAGE}`)
      .setDescription("California State Roleplay"),
  );
}

function brandedMessage(title: string, body: string, color = 0x3478c8): MessageCreateOptions {
  const container = new ContainerBuilder()
    .setAccentColor(color)
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(`## ${title}\n${body}\n\n-# California State Roleplay`),
    )
    .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Large))
    .addMediaGalleryComponents(bottomImageGallery());
  return {
    flags: MessageFlags.IsComponentsV2,
    components: [container],
    files: [new AttachmentBuilder(resolve(process.cwd(), "assets", BOTTOM_IMAGE), { name: BOTTOM_IMAGE })],
    allowedMentions: { parse: [] },
  };
}

function buildApplicationPanel(open: boolean): MessageCreateOptions {
  const button = new ButtonBuilder()
    .setCustomId(APPLICATION_START_BUTTON)
    .setLabel(open ? "Start Application" : "Applications Closed")
    .setStyle(ButtonStyle.Primary)
    .setDisabled(!open);
  const container = new ContainerBuilder()
    .setAccentColor(0x3478c8)
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `## ${STAR_EMOJI} CSRP · Staff Application\n\n> ${open
          ? "Are you interested in joining the California State Roleplay Staff Team? Feel free to apply for the Staff Team by applying below."
          : "Staff applications are currently closed. Please check back later."}`,
      ),
    )
    .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Large))
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent([
        `## ${CROWN_EMOJI} Important Information`,
        `${PIN_EMOJI} Applications are reviewed by the **Management Team & Ownership Team only**.`,
        `${PIN_EMOJI} Do not ask for your application to be reviewed. Doing so will result in an **automatic denial** of your Staff Team Application.`,
        `${PIN_EMOJI} Applications are read whenever the Management Team & Ownership Team are available. Please do not ping them or ask for an update. This may vary depending on the amount of submissions.`,
      ].join("\n")),
    )
    .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Large))
    .addActionRowComponents(new ActionRowBuilder<ButtonBuilder>().addComponents(button))
    .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Large))
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `*${STAR_EMOJI} Good luck to everybody applying! We wish everyone the best of luck, and thank you for your interest in joining the California State Roleplay Staff Team and helping us make the server better.*`,
      ),
    );
  return {
    flags: MessageFlags.IsComponentsV2,
    components: [container],
    allowedMentions: { parse: [] },
  };
}

export async function openModeratorApplications(client: Client, guildId: string | null, channelId: string): Promise<boolean> {
  if (guildId !== config.guildId) {
    throw new Error("Moderator applications can only be opened in the configured server.");
  }
  if (isModeratorApplicationOpen()) return false;

  const channel = await fetchConfiguredTextChannel(client, channelId, "application panel");
  const panel = await channel.send(buildApplicationPanel(true));
  database.prepare(`
    INSERT INTO application_settings (setting, value) VALUES ('status', 'open')
    ON CONFLICT(setting) DO UPDATE SET value = excluded.value
  `).run();
  database.prepare(`
    INSERT INTO application_settings (setting, value) VALUES ('panel_channel_id', ?)
    ON CONFLICT(setting) DO UPDATE SET value = excluded.value
  `).run(channel.id);
  database.prepare(`
    INSERT INTO application_settings (setting, value) VALUES ('panel_message_id', ?)
    ON CONFLICT(setting) DO UPDATE SET value = excluded.value
  `).run(panel.id);
  return true;
}

export async function closeModeratorApplications(client: Client): Promise<boolean> {
  const wasOpen = isModeratorApplicationOpen();
  database.prepare(`
    INSERT INTO application_settings (setting, value) VALUES ('status', 'closed')
    ON CONFLICT(setting) DO UPDATE SET value = excluded.value
  `).run();
  if (!wasOpen) return false;

  const panel = getApplicationPanel();
  if (panel) {
    const channel = await fetchConfiguredTextChannel(client, panel.channel_id, "application panel");
    const message = await channel.messages.fetch(panel.message_id);
    const disabledPanel = buildApplicationPanel(false);
    if (!disabledPanel.components) throw new Error("Could not build the closed application panel.");
    await message.edit({
      components: disabledPanel.components,
      allowedMentions: { parse: [] },
    });
  }
  return true;
}

function questionPromptText(index: number, continuation = false): string {
  const prompt = [
    `**Question ${index + 1} of ${MODERATOR_APPLICATION_QUESTIONS.length}**\n${MODERATOR_APPLICATION_QUESTIONS[index]}`,
    "Reply with your answer in this DM. Answers are required; type `cancel` to stop.",
  ];
  if (continuation) prompt.unshift("Your application is already in progress. You can continue here.");
  return prompt.join("\n\n");
}

function createQuestionPrompt(index: number, continuation = false): MessageCreateOptions {
  return v2Message("Moderator Application", questionPromptText(index, continuation));
}

function parseDraftAnswers(answersJson: string): string[] {
  const answers: unknown = JSON.parse(answersJson);
  if (!Array.isArray(answers) || answers.some((answer) => typeof answer !== "string")) {
    throw new Error("A moderator application draft contains invalid answers.");
  }
  return answers;
}

function validateAnswer(index: number, rawAnswer: string): string | undefined {
  const answer = rawAnswer.trim();
  if (!answer) return "Please enter an answer before continuing.";
  if (answer.length > MAX_ANSWER_LENGTH) {
    return `Please keep each answer under ${MAX_ANSWER_LENGTH + 1} characters.`;
  }
  if (index === 1 && !/^\d{17,20}$/.test(answer)) {
    return "Please enter a numeric Discord ID between 17 and 20 digits.";
  }
  if (index === 13 && !/^(yes|no)$/i.test(answer)) {
    return "Please answer Yes or No.";
  }
  return undefined;
}

async function sendApplicationResult(client: Client, application: ModeratorApplication): Promise<void> {
  const channel = await fetchConfiguredTextChannel(client, config.applicationResultsChannelId, "application results");
  const accepted = application.status === "accepted";
  const image = accepted ? ACCEPTED_IMAGE : DENIED_IMAGE;
  const imageDescription = accepted ? "Moderator application accepted" : "Moderator application denied";
  const decision = accepted ? "Accepted" : "Denied";
  const timestamp = Math.floor(Date.parse(application.reviewed_at ?? new Date().toISOString()) / 1000);
  const container = new ContainerBuilder()
    .setAccentColor(0x8298c2)
    .addMediaGalleryComponents(
      new MediaGalleryBuilder().addItems(
        new MediaGalleryItemBuilder()
          .setURL(`attachment://${image}`)
          .setDescription(imageDescription),
      ),
    )
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent([
        `## Moderator Application ${decision}`,
        `**Request ID:** ${applicationRequestId(application.id)}`,
        ...(application.acceptance_id ? [`**Staff Request ID:** ${application.acceptance_id}`] : []),
        `**Applicant:** <@${application.applicant_id}>`,
        `**Reviewer:** <@${application.reviewed_by}>`,
        `**Reason:** ${application.decision_reason ?? "No reason provided."}`,
        `**Decision date:** <t:${timestamp}:F>`,
      ].join("\n")),
    )
    .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Large))
    .addMediaGalleryComponents(bottomImageGallery());
  await channel.send({
    flags: MessageFlags.IsComponentsV2,
    components: [container],
    files: [
      new AttachmentBuilder(resolve(process.cwd(), "assets", image), { name: image }),
      new AttachmentBuilder(resolve(process.cwd(), "assets", BOTTOM_IMAGE), { name: BOTTOM_IMAGE }),
    ],
    allowedMentions: { parse: [], users: [application.applicant_id] },
  });
}

async function sendAcceptanceIdToApplicant(client: Client, application: ModeratorApplication): Promise<boolean> {
  if (!application.acceptance_id) {
    throw new Error(`Accepted application ${applicationRequestId(application.id)} is missing its staff request ID.`);
  }
  try {
    const applicant = await client.users.fetch(application.applicant_id);
    await applicant.send(v2Message(
      "Moderator Application Accepted",
      `Your staff application was accepted. Your staff request ID is **${application.acceptance_id}**. Include this ID when opening a ticket to request staff onboarding.`,
    ));
    return true;
  } catch (error) {
    console.error(`Could not DM the staff request ID for application ${applicationRequestId(application.id)}:`, error);
    return false;
  }
}

function groupReviewAnswers(answers: string[]): string[][] {
  const pages: string[][] = [];
  let page: string[] = [];
  let pageLength = 0;
  answers.forEach((answer, index) => {
    const item = `**${index + 1}. ${MODERATOR_APPLICATION_QUESTIONS[index]}**\n${answer}`;
    if (page.length && pageLength + item.length + 2 > MAX_REVIEW_PAGE_LENGTH) {
      pages.push(page);
      page = [];
      pageLength = 0;
    }
    page.push(item);
    pageLength += item.length + 2;
  });
  if (page.length) pages.push(page);
  return pages;
}

function buildReviewPage(
  application: ModeratorApplication,
  items: string[],
  page: number,
  pageCount: number,
  includeDecisionButtons: boolean,
): MessageCreateOptions {
  const statusText = application.status === "pending"
    ? "Pending review"
    : application.status === "accepted" ? "Accepted" : "Denied";
  const submittedTimestamp = Math.floor(Date.parse(application.submitted_at) / 1000);
  const header = [
    `## Moderator Application · ${applicationRequestId(application.id)}`,
    `**Status:** ${statusText}`,
    `**Applicant:** <@${application.applicant_id}>`,
    `**Submitted:** <t:${submittedTimestamp}:F>`,
    `**Page:** ${page + 1}/${pageCount}`,
  ];
  if (application.reviewed_by) {
    if (application.acceptance_id) header.push(`**Staff Request ID:** ${application.acceptance_id}`);
    header.push(`**Reviewed by:** <@${application.reviewed_by}>`);
    header.push(`**Decision reason:** ${application.decision_reason ?? "No reason provided."}`);
    if (application.reviewed_at) {
      header.push(`**Decision date:** <t:${Math.floor(Date.parse(application.reviewed_at) / 1000)}:F>`);
    }
  }
  const container = new ContainerBuilder()
    .setAccentColor(0x3478c8)
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(`${header.join("\n")}\n\n${items.join("\n\n")}`),
    )
    .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Large));
  if (includeDecisionButtons && application.status === "pending") {
    container.addActionRowComponents(
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(`moderator-app:decision:${application.id}:accept`)
          .setLabel("Accept")
          .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
          .setCustomId(`moderator-app:decision:${application.id}:deny`)
          .setLabel("Deny")
          .setStyle(ButtonStyle.Danger),
      ),
    );
  }
  container.addMediaGalleryComponents(bottomImageGallery());
  return {
    flags: MessageFlags.IsComponentsV2,
    components: [container],
    files: [new AttachmentBuilder(resolve(process.cwd(), "assets", BOTTOM_IMAGE), { name: BOTTOM_IMAGE })],
    allowedMentions: { parse: [] },
  };
}

async function publishModeratorApplication(client: Client, id: number): Promise<void> {
  const application = getModeratorApplication(id);
  if (!application) throw new Error(`Moderator application ${id} was not found.`);
  if (application.review_message_id) return;

  const answers = parseDraftAnswers(application.answers_json);
  if (answers.length !== MODERATOR_APPLICATION_QUESTIONS.length) {
    throw new Error(`Moderator application ${id} has an incomplete answer set.`);
  }
  const pages = groupReviewAnswers(answers);
  const channel = await fetchConfiguredTextChannel(client, config.applicationReviewChannelId, "application review");
  const messages = [];
  for (let index = 0; index < pages.length; index += 1) {
    const pageItems = pages[index];
    if (!pageItems) throw new Error(`Moderator application ${id} is missing review page ${index + 1}.`);
    messages.push(await channel.send(buildReviewPage(
      application,
      pageItems,
      index,
      pages.length,
      index === 0,
    )));
  }
  const firstMessage = messages[0];
  if (!firstMessage) throw new Error(`Moderator application ${id} could not be published.`);
  database.prepare(`
    UPDATE moderator_applications
    SET review_message_id = ?, review_page_message_ids = ?
    WHERE id = ? AND review_message_id IS NULL
  `).run(firstMessage.id, JSON.stringify(messages.map((message) => message.id)), id);
}

export async function publishPendingModeratorApplications(client: Client): Promise<void> {
  const pending = database.prepare(`
    SELECT id FROM moderator_applications
    WHERE status = 'pending' AND review_message_id IS NULL
    ORDER BY id
  `).all() as Array<{ id: number }>;
  for (const application of pending) {
    try {
      await publishModeratorApplication(client, application.id);
    } catch (error) {
      console.error(`Could not publish moderator application ${applicationRequestId(application.id)}:`, error);
    }
  }
}

async function startApplication(interaction: ButtonInteraction): Promise<void> {
  if (!isModeratorApplicationOpen()) {
    await editV2Reply(interaction, "Applications Closed", "Moderator applications are not currently being accepted.");
    return;
  }
  const pending = database.prepare(`
    SELECT id FROM moderator_applications
    WHERE applicant_id = ? AND status = 'pending'
    ORDER BY id DESC LIMIT 1
  `).get(interaction.user.id) as { id: number } | undefined;
  if (pending) {
    await editV2Reply(interaction,
      "Application Already Submitted",
      `Your application **${applicationRequestId(pending.id)}** is still pending review.`,
    );
    return;
  }

  let draft = database.prepare(`
    SELECT applicant_id, current_question, answers_json
    FROM moderator_application_drafts WHERE applicant_id = ?
  `).get(interaction.user.id) as ApplicationDraft | undefined;
  if (!draft) {
    database.prepare(`
      INSERT INTO moderator_application_drafts (applicant_id, current_question, answers_json)
      VALUES (?, 0, '[]')
    `).run(interaction.user.id);
    draft = { applicant_id: interaction.user.id, current_question: 0, answers_json: "[]" };
  }

  const introduction = v2Message(
    "Moderator Application",
    [
      "Please answer all questions honestly! Using AI will result in an AUTOMATIC Fail.",
      "Your answers will be sent to the staff review channel. Type `cancel` at any time to stop.",
    ].join("\n\n"),
  );
  try {
    await interaction.user.send(introduction);
    await interaction.user.send(createQuestionPrompt(draft.current_question, draft.current_question > 0));
  } catch (error) {
    if (draft.current_question === 0 && draft.answers_json === "[]") {
      database.prepare("DELETE FROM moderator_application_drafts WHERE applicant_id = ?").run(interaction.user.id);
    }
    throw error;
  }
}

export async function executeModeratorApplicationButton(interaction: ButtonInteraction): Promise<boolean> {
  if (interaction.customId === APPLICATION_START_BUTTON) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2 });
    await startApplication(interaction);
    await editV2Reply(interaction, "Check Your DMs", "The moderator application questions were sent privately.");
    return true;
  }

  const match = /^moderator-app:decision:(\d+):(accept|deny)$/.exec(interaction.customId);
  if (!match) return false;
  if (interaction.channelId !== config.applicationReviewChannelId) {
    await interaction.reply({ ...v2Message("Review Unavailable", "This decision button is only valid in the application review channel."), flags: v2Flags(true) });
    return true;
  }
  const id = Number(match[1]);
  const application = database.prepare("SELECT applicant_id, status FROM moderator_applications WHERE id = ?").get(id) as { applicant_id: string; status: string } | undefined;
  if (!application || application.status !== "pending") {
    await interaction.reply({ ...v2Message("Already Reviewed", "This application is no longer pending review."), flags: v2Flags(true) });
    return true;
  }
  if (application.applicant_id === interaction.user.id) {
    await interaction.reply({ ...v2Message("Not Allowed", "You cannot review your own application."), flags: v2Flags(true) });
    return true;
  }

  const decision = match[2] === "accept" ? "Accept" : "Deny";
  const modal = new ModalBuilder()
    .setCustomId(`moderator-app:decision:${id}:${match[2]}`)
    .setTitle(`${decision} Moderator Application`)
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId("decision_reason")
          .setLabel("Reason")
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(true)
          .setMinLength(2)
          .setMaxLength(1000),
      ),
    );
  await interaction.showModal(modal);
  return true;
}

async function updateReviewCard(client: Client, application: ModeratorApplication): Promise<void> {
  if (!application.review_message_id) return;
  const channel = await fetchConfiguredTextChannel(client, config.applicationReviewChannelId, "application review");
  const answers = parseDraftAnswers(application.answers_json);
  const pages = groupReviewAnswers(answers);
  const pageMessageIds = application.review_page_message_ids
    ? JSON.parse(application.review_page_message_ids) as string[]
    : [application.review_message_id];
  if (pageMessageIds.length !== pages.length) {
    throw new Error(`Moderator application ${application.id} has an incomplete set of review messages.`);
  }
  for (let index = 0; index < pageMessageIds.length; index += 1) {
    const messageId = pageMessageIds[index];
    const pageItems = pages[index];
    if (!messageId || !pageItems) {
      throw new Error(`Moderator application ${application.id} is missing review page ${index + 1}.`);
    }
    const message = await channel.messages.fetch(messageId);
    const updatedCard = buildReviewPage(application, pageItems, index, pages.length, false);
    if (!updatedCard.components || !updatedCard.files) {
      throw new Error("Could not build the updated moderator application card.");
    }
    await message.edit({
      flags: MessageFlags.IsComponentsV2,
      components: updatedCard.components,
      files: updatedCard.files,
      allowedMentions: { parse: [] },
    });
  }
}

export async function executeModeratorApplicationModal(interaction: ModalSubmitInteraction): Promise<boolean> {
  const match = /^moderator-app:decision:(\d+):(accept|deny)$/.exec(interaction.customId);
  if (!match) return false;
  await interaction.deferReply({ flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2 });

  const id = Number(match[1]);
  const decision: ApplicationStatus = match[2] === "accept" ? "accepted" : "denied";
  const reason = interaction.fields.getTextInputValue("decision_reason").trim();
  if (reason.length < 2) {
    await editV2Reply(interaction, "Reason Required", "Please provide a reason of at least two characters.");
    return true;
  }

  const reviewedAt = new Date().toISOString();
  const acceptanceId = decision === "accepted" ? generateAcceptanceId() : null;
  const updated = database.prepare(`
    UPDATE moderator_applications
    SET status = ?, acceptance_id = ?, reviewed_by = ?, decision_reason = ?, reviewed_at = ?
    WHERE id = ? AND status = 'pending'
  `).run(decision, acceptanceId, interaction.user.id, reason, reviewedAt, id);
  if (Number(updated.changes) === 0) {
    await editV2Reply(interaction, "Already Reviewed", "This application is no longer pending review.");
    return true;
  }

  let application = getModeratorApplication(id);
  if (!application) throw new Error(`Moderator application ${id} disappeared after review.`);
  try {
    await sendApplicationResult(interaction.client, application);
  } catch (error) {
    database.prepare(`
      UPDATE moderator_applications
      SET status = 'pending', acceptance_id = NULL, reviewed_by = NULL, decision_reason = NULL, reviewed_at = NULL
      WHERE id = ? AND reviewed_by = ?
    `).run(id, interaction.user.id);
    throw error;
  }

  application = getModeratorApplication(id);
  if (!application) throw new Error(`Moderator application ${id} disappeared after its result was sent.`);
  const acceptanceDMDelivered = application.status !== "accepted"
    ? true
    : await sendAcceptanceIdToApplicant(interaction.client, application);
  let reviewCardUpdated = true;
  try {
    await updateReviewCard(interaction.client, application);
  } catch (error) {
    reviewCardUpdated = false;
    console.error(`Application ${applicationRequestId(id)} was decided, but its review card could not be updated:`, error);
  }
  const statusText = application.status === "accepted" ? "Application Accepted" : "Application Denied";
  const response = [
    `The result was posted in <#${config.applicationResultsChannelId}> and the applicant was mentioned.`,
    application.acceptance_id ? `Staff request ID: **${application.acceptance_id}**.` : "",
    acceptanceDMDelivered ? "" : "The ID is visible in the results channel, but its DM could not be delivered.",
    reviewCardUpdated ? "" : "The review card could not be updated.",
  ].filter(Boolean).join(" ");
  await editV2Reply(interaction,
    statusText,
    response,
  );
  return true;
}

export async function handleModeratorApplicationDM(message: Message): Promise<boolean> {
  if (message.author.bot || message.guildId !== null) return false;
  const draft = database.prepare(`
    SELECT applicant_id, current_question, answers_json
    FROM moderator_application_drafts WHERE applicant_id = ?
  `).get(message.author.id) as ApplicationDraft | undefined;
  if (!draft) return false;

  const answer = message.content.trim();
  if (answer.toLowerCase() === "cancel") {
    database.prepare("DELETE FROM moderator_application_drafts WHERE applicant_id = ?").run(message.author.id);
    await message.author.send(v2Message("Application Cancelled", "Your moderator application draft was cancelled."));
    return true;
  }
  const validationError = validateAnswer(draft.current_question, answer);
  if (validationError) {
    await message.author.send(v2Message(
      "Answer Needed",
      `${validationError}\n\n${questionPromptText(draft.current_question)}`,
    ));
    return true;
  }

  const answers = parseDraftAnswers(draft.answers_json);
  answers.push(answer);
  const nextQuestion = draft.current_question + 1;
  if (nextQuestion < MODERATOR_APPLICATION_QUESTIONS.length) {
    database.prepare(`
      UPDATE moderator_application_drafts
      SET current_question = ?, answers_json = ?, updated_at = datetime('now')
      WHERE applicant_id = ?
    `).run(nextQuestion, JSON.stringify(answers), message.author.id);
    await message.author.send(createQuestionPrompt(nextQuestion));
    return true;
  }

  const inserted = database.prepare(`
    INSERT INTO moderator_applications (applicant_id, answers_json, submitted_at)
    VALUES (?, ?, ?)
  `).run(message.author.id, JSON.stringify(answers), new Date().toISOString());
  const applicationId = Number(inserted.lastInsertRowid);
  database.prepare("DELETE FROM moderator_application_drafts WHERE applicant_id = ?").run(message.author.id);
  try {
    await publishModeratorApplication(message.client, applicationId);
  } catch (error) {
    await message.author.send(v2Message(
      "Application Saved",
      `Your application ${applicationRequestId(applicationId)} was saved, but could not be posted to the review channel. Staff have been notified to retry it.`,
    ));
    throw error;
  }
  await message.author.send(v2Message(
    "Application Submitted",
    `Your moderator application **${applicationRequestId(applicationId)}** was sent to the review team. You will be mentioned when a decision is posted.`,
  ));
  return true;
}
