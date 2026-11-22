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
  type MessageCreateOptions,
} from "discord.js";

const PUNISHMENT_TOP_IMAGE = "CSRP-Punishment-Top.png";
const PUNISHMENT_BOTTOM_IMAGE = "CSRP-Punishment-Bottom.png";

export interface PunishmentCardDetails {
  punishmentId: string;
  targetId: string;
  issuerId: string;
  issuedAt: Date;
  punishmentType: string;
  reason: string;
  expiresAt: Date | null;
}

export function addCalendarMonths(date: Date, months: number): Date {
  const result = new Date(date);
  const originalDay = result.getUTCDate();
  result.setUTCDate(1);
  result.setUTCMonth(result.getUTCMonth() + months);
  const lastDay = new Date(Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0)).getUTCDate();
  result.setUTCDate(Math.min(originalDay, lastDay));
  return result;
}

export function createPunishmentMessage(details: PunishmentCardDetails): MessageCreateOptions {
  const timestamp = (date: Date): number => Math.floor(date.getTime() / 1000);
  const container = new ContainerBuilder()
    .setAccentColor(0x8c65c7)
    .addMediaGalleryComponents(
      new MediaGalleryBuilder().addItems(
        new MediaGalleryItemBuilder()
          .setURL(`attachment://${PUNISHMENT_TOP_IMAGE}`)
          .setDescription("California State Roleplay punishment banner"),
      ),
    )
    .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Large))
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent([
        "## Punishment Issued",
        `> **Punishment ID:** ${details.punishmentId}`,
        "> **Status:** Active",
      ].join("\n")),
    )
    .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Large))
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent([
        "## Personnel Information",
        `> **Target:** <@${details.targetId}>`,
        `> **Issuer:** <@${details.issuerId}>`,
        `> **Date Issued:** <t:${timestamp(details.issuedAt)}:F>`,
      ].join("\n")),
    )
    .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Large))
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent([
        "## Punishment Details",
        `> **Type:** ${details.punishmentType}`,
        `> **Reason:** ${details.reason}`,
        `> **Expiration Date:** ${details.expiresAt ? `<t:${timestamp(details.expiresAt)}:F>` : "No expiration (Termination)"}`,
      ].join("\n")),
    )
    .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Large))
    .addMediaGalleryComponents(
      new MediaGalleryBuilder().addItems(
        new MediaGalleryItemBuilder()
          .setURL(`attachment://${PUNISHMENT_BOTTOM_IMAGE}`)
          .setDescription("California State Roleplay"),
      ),
    );

  return {
    flags: MessageFlags.IsComponentsV2,
    components: [container],
    files: [
      new AttachmentBuilder(resolve(process.cwd(), "assets", PUNISHMENT_TOP_IMAGE), { name: PUNISHMENT_TOP_IMAGE }),
      new AttachmentBuilder(resolve(process.cwd(), "assets", PUNISHMENT_BOTTOM_IMAGE), { name: PUNISHMENT_BOTTOM_IMAGE }),
    ],
    allowedMentions: { parse: [] },
  };
}
