import { REST, Routes } from "discord.js";
import { config } from "./config.js";
import { getCommandData } from "./commands.js";

const rest = new REST({ version: "10" }).setToken(config.token);

try {
  const commands = getCommandData().map((command) => command.toJSON());
  await rest.put(Routes.applicationGuildCommands(config.clientId, config.guildId), { body: commands });
  console.log(`Registered ${commands.length} guild commands.`);
} catch (error) {
  console.error("Could not register Discord commands:", error);
  process.exitCode = 1;
}
