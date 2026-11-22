import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  MessageFlags,
  TextDisplayBuilder,
  type MessageCreateOptions,
} from "discord.js";

export function v2Message(title: string, body: string, color = 0x3478c8): MessageCreateOptions {
  const text = new TextDisplayBuilder().setContent(`## ${title}\n${body}\n\n-# California State Roleplay`.slice(0, 4000));
  const container = new ContainerBuilder().setAccentColor(color).addTextDisplayComponents(text);
  return {
    flags: MessageFlags.IsComponentsV2,
    components: [container],
    allowedMentions: { parse: [] },
  };
}

export function v2ButtonMessage(
  title: string,
  body: string,
  label: string,
  customId: string,
): MessageCreateOptions {
  const text = new TextDisplayBuilder().setContent(`## ${title}\n${body}\n\n-# California State Roleplay`.slice(0, 4000));
  const button = new ButtonBuilder().setCustomId(customId).setLabel(label).setStyle(ButtonStyle.Primary);
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(button);
  const container = new ContainerBuilder()
    .setAccentColor(0x3478c8)
    .addTextDisplayComponents(text)
    .addActionRowComponents(row);
  return { flags: MessageFlags.IsComponentsV2, components: [container], allowedMentions: { parse: [] } };
}

export function v2Flags(ephemeral = false): Array<"IsComponentsV2" | "Ephemeral"> {
  return ephemeral ? ["IsComponentsV2", "Ephemeral"] : ["IsComponentsV2"];
}
