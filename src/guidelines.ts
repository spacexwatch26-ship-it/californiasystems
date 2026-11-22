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
  SectionBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  TextDisplayBuilder,
  type ButtonInteraction,
  type MessageCreateOptions,
} from "discord.js";
import { v2Flags } from "./ui.js";

const GUIDELINES_BANNER_IMAGE = "CSRP-Guidelines.png";
const DISCORD_TERMS_URL = "https://discord.com/terms";
const ROBLOX_TERMS_URL = "https://www.roblox.com/info/terms";
const GUIDELINES_PREFIX = "guidelines:";

const DISCORD_REGULATIONS = `California State Roleplay - Discord Regulations
Official Community Standards
Welcome to California State Roleplay (CSRP). Our goal is to provide a welcoming, organized, and enjoyable community for everyone. To help maintain that environment, all members are expected to follow the regulations listed below.
These rules apply to everyone, including regular members, department personnel, supervisors, and community staff. Being part of CSRP means agreeing to follow these standards, along with Discord's Terms of Service and Community Guidelines.
________________

SECTION I — GENERAL COMMUNITY CONDUCT
1.1 | Respect Everyone
Treat everyone in the community with respect. Harassment, bullying, discrimination, unnecessary arguments, and personal attacks will not be tolerated.
1.2 | Appropriate Language
Keep conversations appropriate and respectful. Excessive profanity, offensive remarks, and inappropriate conversations may result in moderation.
1.3 | Follow Discord's Policies
All members must follow Discord's Terms of Service and Community Guidelines. CSRP does not permit activities that violate Discord's platform rules.
1.4 | Respect Staff Members
Staff members are here to help manage the community. If you disagree with a decision, remain respectful and use the proper channels to address your concerns.
1.5 | Keep the Community Peaceful
Do not intentionally start arguments, provoke other members, troll, or create unnecessary drama. Everyone should be able to participate without being constantly disrupted.
________________

SECTION II — HARASSMENT & DISCRIMINATION
2.1 | Harassment
Harassing another member in any form is prohibited. This includes repeatedly bothering someone, sending unwanted messages, bullying, or intentionally making someone feel unsafe.
2.2 | Discrimination
Racism, hate speech, slurs, and discrimination against another individual are strictly prohibited. Everyone deserves to be treated fairly, regardless of their background or personal characteristics.
2.3 | Threats
Threatening another member, making statements intended to intimidate someone, or encouraging violence against others is not allowed.
2.4 | Targeting Other Members
Do not organize groups of people to gang up on, harass, or intentionally disrupt another member or community.
2.5 | Retaliation
Nobody should be punished or targeted for reporting an issue, helping with an investigation, or bringing a legitimate concern to staff.
________________

SECTION III — PRIVACY & PERSONAL INFORMATION
3.1 | Respect Personal Privacy
Do not share another person's private information without their permission. This includes addresses, phone numbers, private accounts, and other personal details.
3.2 | Doxxing
Attempting to find, expose, or distribute someone's private information is strictly prohibited.
3.3 | Private Messages
Do not share private conversations, screenshots, or personal information with the intention of embarrassing, threatening, or harassing another individual.
3.4 | Account Security
Never attempt to access another member's Discord account or obtain their login information.
3.5 | Staff Confidentiality
Private staff discussions, administrative matters, and internal investigations should remain confidential unless an authorized staff member approves their release.
________________

SECTION IV — CONTENT & MEDIA
4.1 | Inappropriate Content
Sexually explicit, pornographic, or otherwise inappropriate content is not permitted anywhere within the CSRP community.
4.2 | Inappropriate Images
Profile pictures, banners, attachments, and other shared media must remain appropriate for a general audience.
4.3 | Graphic Material
Do not post disturbing images or videos containing excessive gore, graphic violence, or other material intended to shock or upset members.
4.4 | Harmful Content
Content that encourages suicide, self-harm, or dangerous behavior is prohibited.
4.5 | Profile Information
Usernames, nicknames, profile pictures, and custom statuses must remain appropriate and must not be used to harass, impersonate, or offend others.
________________

SECTION V — SPAM & SERVER DISRUPTION
5.1 | Message Spam
Avoid flooding channels with repeated messages, unnecessary characters, or duplicate content.
5.2 | Unnecessary Mentions
Do not repeatedly ping members, staff, or department roles without a legitimate reason. The use of @everyone and @here is reserved for authorized announcements.
5.3 | Server Raiding
Attempting to flood the server with messages, accounts, or unwanted activity is strictly prohibited.
5.4 | Advertising
Do not advertise other Discord servers, social media accounts, or services without permission from CSRP Administration.
5.5 | Fake Engagement
Using alternate accounts, bots, or other methods to artificially increase server activity or membership is prohibited.
5.6 | Unauthorized Bots
Do not use self-bots, malicious automation, or unauthorized tools to disrupt the server or interfere with Discord's functionality.
________________

SECTION VI — ACCOUNT SAFETY & IMPERSONATION
6.1 | Impersonation
Do not pretend to be another member, staff member, department supervisor, or Discord representative.
6.2 | False Information
Providing false information to obtain staff positions, department ranks, permissions, or other privileges is prohibited.
6.3 | Account Responsibility
Members are responsible for maintaining the security of their own Discord accounts. Do not use someone else's account to avoid restrictions or misrepresent your identity.
6.4 | Ban Evasion
If you have been removed or banned from the community, do not use another account to get around that restriction.
6.5 | Unauthorized Access
Attempting to gain access to restricted channels, staff areas, or administrative permissions without authorization is prohibited.
________________

SECTION VII — SCAMS & MALICIOUS ACTIVITY
7.1 | Scamming
Do not attempt to scam, deceive, or take advantage of other community members for personal gain.
7.2 | Suspicious Links
Sharing phishing links, fake login pages, or websites designed to steal another person's information is strictly prohibited.
7.3 | Malicious Files
Do not distribute viruses, harmful downloads, or files intended to damage devices or compromise accounts.
7.4 | Illegal Activity
The CSRP Discord server must not be used to organize, promote, or facilitate illegal activities.
7.5 | Restricted Goods & Services
Advertising or arranging transactions involving prohibited or dangerous goods and services is not permitted.
7.6 | Fraudulent Transactions
Fake giveaways, dishonest sales, fraudulent payment requests, and other deceptive financial activities are prohibited.
________________

SECTION VIII — COPYRIGHT & COMMUNITY MATERIALS
8.1 | Respect Other People's Work
Give proper respect to the creators of artwork, graphics, documents, and other original materials. Do not claim someone else's work as your own.
8.2 | Unauthorized Distribution
Do not distribute stolen, pirated, or unlawfully obtained content through the community.
8.3 | Official CSRP Materials
Do not alter or distribute official CSRP documents, logos, or other materials in a way that falsely suggests approval or authorization from the community.
________________

SECTION IX — STAFF & COMMUNITY OPERATIONS
9.1 | Follow Staff Instructions
When a staff member gives a reasonable instruction regarding server operations or moderation, members are expected to cooperate.
9.2 | No Staff Impersonation
Only individuals officially appointed by CSRP Administration may represent themselves as community staff.
9.3 | Staff Responsibilities
Staff members are expected to remain professional, treat members fairly, and use their permissions responsibly.
9.4 | Reporting Issues
If you witness someone breaking the rules, report the situation through the appropriate ticket or reporting channel. Avoid taking matters into your own hands.
9.5 | False Reports
Do not submit fake reports, edit evidence to mislead staff, or make accusations that you know are untrue.
9.6 | Respect Administrative Investigations
Allow staff members to handle reports and investigations without unnecessary interference. Do not pressure individuals involved or attempt to interfere with the review process.
________________

SECTION X — WARNINGS & DISCIPLINARY ACTION
We understand that mistakes can happen. However, repeated or serious violations may result in disciplinary action.
Depending on the situation, CSRP Administration may issue one or more of the following:
10.1 | Verbal Warning
A staff member may issue a verbal warning when a member makes a minor mistake or breaks a rule for the first time.
10.2 | Formal Warning
A formal warning may be issued when a member continues breaking rules or commits a more serious violation.
10.3 | Temporary Restrictions
Members may temporarily lose access to certain channels, permissions, or server activities when necessary.
10.4 | Server Removal
Members who repeatedly disrupt the community or commit serious violations may be removed from the Discord server.
10.5 | Permanent Ban
A permanent ban may be issued for severe violations, repeated misconduct, threats, doxxing, malicious activity, or other serious offenses.
10.6 | Administrative Discretion
Not every situation is the same. Administration will review the circumstances and available evidence before determining the appropriate action. Depending on the severity of a violation, staff may skip earlier disciplinary steps.
10.7 | Appeals
If you believe disciplinary action was issued unfairly, you may submit an appeal through the appropriate CSRP support channel. Appeals should remain respectful and include any relevant evidence.
________________

SECTION XI — FINAL ACKNOWLEDGMENT
California State Roleplay is built around its community. These regulations ensure everyone has a fair, safe, and enjoyable experience.
By remaining a member of CSRP, you agree to follow these regulations, respect other members, and cooperate with community staff when necessary.
CSRP Administration may update these regulations as the community grows. Members are responsible for staying informed of any changes.
Thank you for being part of California State Roleplay.
CALIFORNIA STATE ROLEPLAY
Professionalism. Integrity. Community.
END OF REGULATIONS`;

const IN_GAME_REGULATIONS = `California State Roleplay - In-Game Regulations
Official Community Regulations & Standards
________________

SECTION I — GENERAL REGULATIONS
1.1 Compliance With Regulations
All members participating in California State Roleplay (CSRP) are required to follow the established rules and regulations. These standards apply regardless of rank, department affiliation, position, or membership status.
1.2 Respectful Conduct
All players are expected to maintain a respectful and professional attitude. Harassment, discrimination, bullying, excessive arguing, or intentionally disrupting another player's experience is prohibited.
1.3 Roblox Community Standards
All activities must comply with Roblox's Terms of Use and Community Standards. Any activity that violates Roblox policies is strictly prohibited.
1.4 Staff Authority
Instructions provided by authorized CSRP staff members must be followed. Disagreements regarding staff decisions should be addressed through the appropriate reporting or appeals process.
1.5 No Staff Impersonation
Players may not impersonate administrators, moderators, department leadership, or other authorized personnel.
1.6 No Exploiting or Glitching
Exploiting, cheating, abusing game mechanics, or intentionally taking advantage of glitches to obtain an unfair advantage is prohibited.
1.7 No Advertising or Disruption
Unapproved advertisements, excessive spam, trolling, and intentional disruption of active sessions are prohibited.
________________

SECTION II — ROLEPLAY STANDARDS
2.1 Realistic Roleplay (FRP)
All participants must maintain reasonable realism throughout roleplay situations. Actions should reflect believable circumstances and consequences.
Examples of Fail Roleplay include:
* Ignoring significant vehicle collisions.
* Continuing normal activities after serious injuries.
* Performing unrealistic actions that would not reasonably occur.
* Ignoring legitimate roleplay interactions.
* Abusing game mechanics to avoid consequences.
2.2 Random Deathmatch (RDM)
Random Deathmatch is strictly prohibited. Players may not intentionally attack or eliminate another player without a legitimate roleplay justification.
2.3 Vehicle Deathmatch (VDM)
Vehicle Deathmatch is prohibited. Intentionally using a vehicle to strike, injure, or eliminate another player without legitimate roleplay justification is not permitted.
2.4 Metagaming
Players may not use information obtained outside of roleplay to influence their character's in-game decisions.
Examples include:
* Using Discord conversations to locate another player in-game.
* Using livestream information to gain an advantage.
* Acting on information your character has not legitimately obtained.
* Communicating confidential in-game information through out-of-character channels.
2.5 Powergaming
Powergaming is prohibited. Players may not force roleplay outcomes, disregard another player's opportunity to respond, or perform unrealistic actions to gain an unfair advantage.
2.6 Fear Roleplay / Value of Life
Players must recognize realistic threats and consequences. Characters should respond appropriately to dangerous or threatening situations rather than behaving as though they are invulnerable.
2.7 New Life Rule (NLR)
When a player is eliminated and respawns, they must not use their previous character's knowledge to interfere with the same incident.
Players may not return to an active scene to continue a conflict after respawning.
2.8 Combat Logging
Leaving the server to avoid an active roleplay situation, arrest, investigation, or administrative consequence is prohibited.
If a player experiences a legitimate technical issue, they should inform staff as soon as reasonably possible.
2.9 Character Realism
All players must maintain appropriate character appearances and behavior. Avatars should be reasonably consistent with the environment and role being portrayed.
________________

SECTION III — SCENE MANAGEMENT
3.1 Active Scene Participation
Players should only participate in roleplay situations in which they are directly involved or have been appropriately requested to assist.
3.2 Scene Interference
Unnecessary interference with active traffic stops, emergency responses, investigations, and other roleplay situations is prohibited.
3.3 Scene Crowding
Players may not intentionally crowd active roleplay situations, emergency personnel, or staff members performing their responsibilities.
3.4 Scene Escalation
Roleplay situations must develop naturally. Players may not unnecessarily escalate minor disagreements into major incidents without reasonable in-character justification.
3.5 Scene Completion
Participants are expected to allow active roleplay situations to reach a reasonable conclusion. Intentionally abandoning or disrupting an active scene is prohibited.
3.6 Third-Party Involvement
Players who are not involved in an active incident should not interfere unless their participation is reasonably requested or justified.
________________

SECTION IV — VEHICLE & DRIVING REGULATIONS
4.1 Realistic Driving
All players must operate vehicles in a reasonably realistic manner. Driving should reflect normal road conditions and the circumstances of the roleplay situation.
4.2 Reckless Driving
Unnecessary reckless driving, excessive speeding, dangerous collisions, and intentionally disrupting traffic are prohibited outside of appropriate roleplay situations.
4.3 Traffic Regulations
Players are expected to observe traffic signals, road markings, lane direction, and general roadway etiquette when practical.
4.4 Vehicle Restrictions
Players must use vehicles appropriate to their assigned role, department, and approved roleplay scenario.
4.5 Emergency Vehicle Usage
Emergency vehicles may only be operated by authorized personnel when participating in an appropriate roleplay capacity.
4.6 Vehicle Abandonment
Players should not intentionally abandon vehicles in locations where they unnecessarily obstruct active scenes or emergency responses.
4.7 Car Surfing
Standing on, riding on, or intentionally exploiting vehicle positioning while a vehicle is moving is prohibited unless specifically authorized for an approved scenario.
________________

SECTION V — CIVILIAN REGULATIONS
5.1 Civilian Responsibilities
Civilian players are expected to contribute positively to the roleplay environment and maintain believable character behavior.
5.2 Law Enforcement Interactions
Civilians must participate reasonably in legitimate law enforcement interactions. Intentionally disrupting traffic stops, investigations, or other official interactions is prohibited.
5.3 Criminal Roleplay
Criminal roleplay must remain within CSRP regulations and Roblox Community Standards. All criminal scenarios must be conducted with appropriate roleplay justification and respect for other participants.
5.4 Cop Baiting
Intentionally provoking law enforcement solely to initiate a pursuit or disrupt their responsibilities is prohibited.
5.5 Civilian Cooperation
Players must not intentionally obstruct emergency personnel or interfere with legitimate emergency operations.
5.6 Unauthorized Impersonation
Civilians may not falsely represent themselves as law enforcement officers, firefighters, EMS personnel, government officials, or other authorized personnel.
________________

SECTION VI — LAW ENFORCEMENT REGULATIONS
6.1 Professional Conduct
All law enforcement personnel must maintain professionalism while on duty and during official department operations.
6.2 Proper Arrest Procedures
Arrests must be supported by legitimate roleplay circumstances. Randomly arresting, detaining, or interfering with players without justification is prohibited.
6.3 Department Identification
Personnel must use their assigned department uniforms, vehicles, and identification while representing their department.
6.4 Abuse of Authority
Officers may not abuse their assigned authority, misuse department equipment, or intentionally target players without legitimate justification.
6.5 Department Cooperation
Law enforcement personnel are expected to communicate professionally and cooperate with other authorized emergency services when appropriate.
6.6 On-Duty Expectations
Personnel must remain focused on their assigned responsibilities and avoid unnecessary disruptions during official operations.
________________

SECTION VII — FIRE & EMS REGULATIONS
7.1 Emergency Response Conduct
Fire and EMS personnel must maintain professionalism during emergency responses and provide appropriate roleplay interactions.
7.2 Medical Roleplay
Medical situations must be treated with reasonable realism. Personnel should not disregard injuries or perform unrealistic medical interactions.
7.3 Scene Safety
Fire and EMS personnel should avoid unnecessarily interfering with law enforcement operations and should coordinate appropriately during shared incidents.
7.4 Department Equipment
Emergency equipment, uniforms, and vehicles must be used appropriately and in accordance with department requirements.
7.5 Unauthorized Medical Representation
Players may not falsely represent themselves as authorized medical personnel or misuse department identification.
________________

SECTION VIII — STAFF & ADMINISTRATIVE REGULATIONS
8.1 Staff Professionalism
All staff members must maintain impartiality, professionalism, and respectful communication when interacting with community members.
8.2 No Administrative Abuse
Administrative permissions must only be used for legitimate moderation, management, and operational purposes.
8.3 No Mini-Modding
Players who do not hold an authorized staff position may not impersonate staff or attempt to exercise administrative authority.
8.4 Staff Interference
Players may not unnecessarily interrupt staff members while they are handling reports, investigations, or administrative responsibilities.
8.5 Reporting Violations
Players are encouraged to report suspected rule violations through the designated reporting system rather than attempting to personally enforce regulations.
8.6 Evidence and Investigations
Staff may request relevant screenshots, recordings, or other information when reviewing reported incidents.
8.7 Fair Enforcement
Rules must be enforced consistently. Staff members are expected to consider the circumstances, available evidence, and severity of each incident.
________________

SECTION IX — SESSION REGULATIONS
9.1 Session Instructions
All players must follow reasonable instructions issued by authorized session hosts and designated personnel.
9.2 Session Interference
Intentionally disrupting session announcements, briefings, department formations, or official activities is prohibited.
9.3 Department Authorization
Players must receive the appropriate authorization before participating in restricted department activities.
9.4 Session Attendance
Players participating in organized sessions are expected to maintain appropriate conduct and follow the session's established guidelines.
9.5 Session Removal
Staff members and authorized session hosts may remove individuals who repeatedly disrupt operations or violate established regulations.
________________

SECTION X — ENFORCEMENT & DISCIPLINARY ACTION
Violations of these regulations may result in administrative action. Disciplinary decisions will be based on the severity, frequency, and circumstances of the violation.
10.1 Verbal Warning
An initial warning may be issued for minor violations or misunderstandings.
10.2 Formal Warning
A formal warning may be issued when a player continues violating regulations or commits a more significant offense.
10.3 Kick / Removal
Players may be removed from the active server or session for disruptive conduct, repeated violations, or failure to comply with staff instructions.
10.4 Temporary Suspension
Temporary restrictions may be issued for serious or repeated violations.
10.5 Permanent Removal
Permanent removal may be issued for severe misconduct, repeated violations, exploitation, harassment, or other conduct that threatens the community.
10.6`;

type RegulationCategory = "discord" | "ingame";
type PendingCategory = "weapons" | "vehicles" | "roleplays";
type RegulationPage = { title: string; content: string };

function parseRegulations(document: string): RegulationPage[] {
  return document
    .replace(/^\uFEFF/, "")
    .trim()
    .split(/^_{8,}\s*$/gm)
    .map((section) => section.trim())
    .filter(Boolean)
    .map((section) => {
      const [title = "Regulations", ...content] = section.split(/\r?\n/);
      return { title, content: content.join("\n").trim() };
    });
}

const regulationPages: Record<RegulationCategory, RegulationPage[]> = {
  discord: parseRegulations(DISCORD_REGULATIONS),
  ingame: parseRegulations(IN_GAME_REGULATIONS.replace(/\r?\n10\.6\s*$/, "")),
};
const inGameEnforcementPage = regulationPages.ingame.find((page) => page.title.startsWith("SECTION X"));
if (inGameEnforcementPage) {
  inGameEnforcementPage.content +=
    "\n\nNote: The supplied source ends with an unfinished “10.6” and provides no rule text. The incomplete entry is omitted rather than guessed.";
}

function ruleCount(pages: RegulationPage[]): number {
  return pages.reduce((total, page) => total + (page.content.match(/^\d+\.\d+\b/gm)?.length ?? 0), 0);
}

export function getGuidelinesRuleCounts(): Record<RegulationCategory, number> {
  return {
    discord: ruleCount(regulationPages.discord),
    ingame: ruleCount(regulationPages.ingame),
  };
}

function separator(): SeparatorBuilder {
  return new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Large);
}

function panelButton(label: string, customId: string): ButtonBuilder {
  return new ButtonBuilder().setCustomId(customId).setLabel(label).setStyle(ButtonStyle.Primary);
}

function panelSection(title: string, detail: string, customId: string): SectionBuilder {
  return new SectionBuilder()
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(`**${title}**\n${detail}`))
    .setButtonAccessory(panelButton("Read", customId));
}

export function createGuidelinesPanelMessage(): MessageCreateOptions {
  const counts = getGuidelinesRuleCounts();
  const container = new ContainerBuilder()
    .setAccentColor(0x4569a8)
    .addMediaGalleryComponents(
      new MediaGalleryBuilder().addItems(
        new MediaGalleryItemBuilder()
          .setURL(`attachment://${GUIDELINES_BANNER_IMAGE}`)
          .setDescription("California State Roleplay guidelines banner"),
      ),
    )
    .addSeparatorComponents(separator())
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        "## California State Roleplay Guidelines\nRead these regulations before participating in CSRP. All members must follow the CSRP rules, Discord's Terms of Service, and Roblox's Terms of Use. Violations may result in moderation.",
      ),
    )
    .addSeparatorComponents(separator())
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent("### Regulations"),
    )
    .addSectionComponents(
      panelSection("📞 Discord Regulations", `${counts.discord} rules`, `${GUIDELINES_PREFIX}read:discord`),
      panelSection("🛡️ In-Game Regulations", `${counts.ingame} rules`, `${GUIDELINES_PREFIX}read:ingame`),
    )
    .addSeparatorComponents(separator())
    .addTextDisplayComponents(new TextDisplayBuilder().setContent("### Banned Items"))
    .addSectionComponents(
      panelSection("🔫 Banned Weapons", "Coming soon", `${GUIDELINES_PREFIX}pending:weapons`),
      panelSection("🚘 Banned Vehicles", "Coming soon", `${GUIDELINES_PREFIX}pending:vehicles`),
      panelSection("🎭 Banned Roleplays", "Coming soon", `${GUIDELINES_PREFIX}pending:roleplays`),
    )
    .addSeparatorComponents(separator())
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        "### Terms of Service\nAll members must follow Discord's Terms of Service and Roblox's Terms of Use.",
      ),
    )
    .addActionRowComponents(
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setLabel("Discord Terms of Service")
          .setStyle(ButtonStyle.Link)
          .setURL(DISCORD_TERMS_URL),
        new ButtonBuilder()
          .setLabel("Roblox Terms of Use")
          .setStyle(ButtonStyle.Link)
          .setURL(ROBLOX_TERMS_URL),
      ),
    )
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent("-# California State Roleplay · Use Read to open a private guidelines view."),
    );

  return {
    flags: MessageFlags.IsComponentsV2,
    components: [container],
    files: [new AttachmentBuilder(resolve(process.cwd(), "assets", GUIDELINES_BANNER_IMAGE), { name: GUIDELINES_BANNER_IMAGE })],
    allowedMentions: { parse: [] },
  };
}

function createRegulationPagePayload(category: RegulationCategory, pageIndex: number) {
  const pages = regulationPages[category];
  const page = pages[pageIndex];
  if (!page) throw new RangeError(`Guidelines page ${pageIndex} is not available for ${category}.`);
  if (page.content.length > 4000) {
    throw new RangeError(`Guidelines page "${page.title}" exceeds Discord's 4,000 character limit.`);
  }

  const title = new TextDisplayBuilder().setContent(`## ${page.title}`);
  const content = new TextDisplayBuilder().setContent(page.content || "No additional text was provided for this section.");
  const status = new TextDisplayBuilder().setContent(
    `-# Page ${pageIndex + 1} of ${pages.length} · This guidelines view is private.`,
  );
  const navigation = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`${GUIDELINES_PREFIX}page:${category}:${pageIndex - 1}`)
      .setLabel("Previous")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(pageIndex === 0),
    new ButtonBuilder()
      .setCustomId(`${GUIDELINES_PREFIX}page:${category}:${pageIndex + 1}`)
      .setLabel("Next")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(pageIndex === pages.length - 1),
  );
  const container = new ContainerBuilder()
    .setAccentColor(0x4569a8)
    .addTextDisplayComponents(title)
    .addSeparatorComponents(separator())
    .addTextDisplayComponents(content)
    .addSeparatorComponents(separator())
    .addTextDisplayComponents(status)
    .addActionRowComponents(navigation);

  return { components: [container], allowedMentions: { parse: [] } };
}

function createPendingListPayload(category: PendingCategory): MessageCreateOptions {
  const titles: Record<PendingCategory, string> = {
    weapons: "Banned Weapons",
    vehicles: "Banned Vehicles",
    roleplays: "Banned Roleplays",
  };
  const container = new ContainerBuilder()
    .setAccentColor(0x4569a8)
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `## ${titles[category]}\nThis list has not been provided yet. It will be added when the banned-item information is available.\n\n-# California State Roleplay · This message is private.`,
      ),
    );
  return { components: [container], allowedMentions: { parse: [] } };
}

function isRegulationCategory(value: string | undefined): value is RegulationCategory {
  return value === "discord" || value === "ingame";
}

function isPendingCategory(value: string | undefined): value is PendingCategory {
  return value === "weapons" || value === "vehicles" || value === "roleplays";
}

export async function executeGuidelinesButton(interaction: ButtonInteraction): Promise<boolean> {
  if (!interaction.customId.startsWith(GUIDELINES_PREFIX)) return false;
  const [, action, category, pageText] = interaction.customId.split(":");

  if (action === "pending" && isPendingCategory(category)) {
    await interaction.reply({
      ...createPendingListPayload(category),
      flags: v2Flags(true),
    });
    return true;
  }

  if ((action === "read" || action === "page") && isRegulationCategory(category)) {
    const pageIndex = action === "read" ? 0 : Number(pageText);
    if (!Number.isInteger(pageIndex) || pageIndex < 0 || pageIndex >= regulationPages[category].length) {
      await interaction.reply({
        components: [
          new ContainerBuilder()
            .setAccentColor(0x4569a8)
            .addTextDisplayComponents(
              new TextDisplayBuilder().setContent("## Guidelines unavailable\nThat guidelines page could not be found."),
            ),
        ],
        flags: v2Flags(true),
        allowedMentions: { parse: [] },
      });
      return true;
    }

    const payload = createRegulationPagePayload(category, pageIndex);
    if (action === "read") {
      await interaction.reply({ ...payload, flags: v2Flags(true) });
    } else {
      await interaction.update(payload);
    }
    return true;
  }

  await interaction.reply({
    components: [
      new ContainerBuilder()
        .setAccentColor(0x4569a8)
        .addTextDisplayComponents(
          new TextDisplayBuilder().setContent("## Guidelines unavailable\nThis guidelines action is not available."),
        ),
    ],
    flags: v2Flags(true),
    allowedMentions: { parse: [] },
  });
  return true;
}
