import { generateText, getEmbeddingZeroVector, ModelClass } from "@ai16z/eliza";
import { Character, Client as ElizaClient, IAgentRuntime } from "@ai16z/eliza";
import { stringToUuid } from "@ai16z/eliza";
import { elizaLogger } from "@ai16z/eliza";
import { composeContext } from "@ai16z/eliza";
import {
    Client,
    Events,
    GatewayIntentBits,
    Guild,
    GuildMember,
    MessageReaction,
    Partials,
    User,
    TextChannel,
} from "discord.js";
import { EventEmitter } from "events";
import chat_with_attachments from "./actions/chat_with_attachments.ts";
import download_media from "./actions/download_media.ts";
import joinvoice from "./actions/joinvoice.ts";
import leavevoice from "./actions/leavevoice.ts";
import summarize from "./actions/summarize_conversation.ts";
import transcribe_media from "./actions/transcribe_media.ts";
import { MessageManager } from "./messages.ts";
import channelStateProvider from "./providers/channelState.ts";
import voiceStateProvider from "./providers/voiceState.ts";
import { VoiceManager } from "./voice.ts";
import { PermissionsBitField } from "discord.js";
import { suggestContributions } from "./utils";
import { UUID, Memory } from "@ai16z/eliza";

export class DiscordClient extends EventEmitter {
    apiToken: string;
    client: Client;
    runtime: IAgentRuntime;
    character: Character;
    private messageManager: MessageManager;
    private voiceManager: VoiceManager;

    constructor(runtime: IAgentRuntime) {
        super();

        this.apiToken = runtime.getSetting("DISCORD_API_TOKEN") as string;
        this.client = new Client({
            intents: [
                GatewayIntentBits.Guilds,
                GatewayIntentBits.DirectMessages,
                GatewayIntentBits.GuildVoiceStates,
                GatewayIntentBits.MessageContent,
                GatewayIntentBits.GuildMessages,
                GatewayIntentBits.DirectMessageTyping,
                GatewayIntentBits.GuildMessageTyping,
                GatewayIntentBits.GuildMessageReactions,
                GatewayIntentBits.GuildMembers, // Ougrid: Try to solve Error [GuildMembersTimeout]: Members didn't arrive in time.
            ],
            partials: [
                Partials.Channel,
                Partials.Message,
                Partials.User,
                Partials.Reaction,
            ],
        });

        this.runtime = runtime;
        this.voiceManager = new VoiceManager(this);
        this.messageManager = new MessageManager(this, this.voiceManager);

        this.client.once(Events.ClientReady, this.onClientReady.bind(this));
        this.client.login(this.apiToken);

        this.setupEventListeners();

        this.runtime.registerAction(joinvoice);
        this.runtime.registerAction(leavevoice);
        this.runtime.registerAction(summarize);
        this.runtime.registerAction(chat_with_attachments);
        this.runtime.registerAction(transcribe_media);
        this.runtime.registerAction(download_media);

        this.runtime.providers.push(channelStateProvider);
        this.runtime.providers.push(voiceStateProvider);

        // Start periodic engagement analysis
        // this.startEngagementAnalysis();

        this.client.on("guildMemberAdd", this.handleGuildMemberAdd.bind(this));
    }

    private setupEventListeners() {
        // When joining to a new server
        this.client.on("guildCreate", this.handleGuildCreate.bind(this));

        this.client.on(
            Events.MessageReactionAdd,
            this.handleReactionAdd.bind(this)
        );
        this.client.on(
            Events.MessageReactionRemove,
            this.handleReactionRemove.bind(this)
        );

        // Handle voice events with the voice manager
        this.client.on(
            "voiceStateUpdate",
            this.voiceManager.handleVoiceStateUpdate.bind(this.voiceManager)
        );
        this.client.on(
            "userStream",
            this.voiceManager.handleUserStream.bind(this.voiceManager)
        );

        // Handle a new message with the message manager
        this.client.on(
            Events.MessageCreate,
            this.messageManager.handleMessage.bind(this.messageManager)
        );

        // Handle a new interaction
        this.client.on(
            Events.InteractionCreate,
            this.handleInteractionCreate.bind(this)
        );
    }

    private async onClientReady(readyClient: { user: { tag: any; id: any } }) {
        elizaLogger.success(
            `Logged in on Discord as: ${readyClient.user?.tag}`
        );

        // Register slash commands
        const commands = [
            {
                name: "joinchannel",
                description: "Join a voice channel",
                options: [
                    {
                        name: "channel",
                        type: 7, // CHANNEL type
                        description: "The voice channel to join",
                        required: true,
                        channel_types: [2], // GuildVoice type
                    },
                ],
            },
            {
                name: "leavechannel",
                description: "Leave the current voice channel",
            },
        ];

        try {
            await this.client.application?.commands.set(commands);
            elizaLogger.success("Slash commands registered on Discord");
        } catch (error) {
            console.error("Error registering slash commands:", error);
        }

        // Start periodic posting
        this.startPeriodicPosting();

        // Required permissions for the bot
        const requiredPermissions = [
            // Text Permissions
            PermissionsBitField.Flags.ViewChannel,
            PermissionsBitField.Flags.SendMessages,
            PermissionsBitField.Flags.SendMessagesInThreads,
            PermissionsBitField.Flags.CreatePrivateThreads,
            PermissionsBitField.Flags.CreatePublicThreads,
            PermissionsBitField.Flags.EmbedLinks,
            PermissionsBitField.Flags.AttachFiles,
            PermissionsBitField.Flags.AddReactions,
            PermissionsBitField.Flags.UseExternalEmojis,
            PermissionsBitField.Flags.UseExternalStickers,
            PermissionsBitField.Flags.MentionEveryone,
            PermissionsBitField.Flags.ManageMessages,
            PermissionsBitField.Flags.ReadMessageHistory,
            // Voice Permissions
            PermissionsBitField.Flags.Connect,
            PermissionsBitField.Flags.Speak,
            PermissionsBitField.Flags.UseVAD,
            PermissionsBitField.Flags.PrioritySpeaker,
        ].reduce((a, b) => a | b, 0n);

        elizaLogger.success("Use this URL to add the bot to your server:");
        elizaLogger.success(
            `https://discord.com/api/oauth2/authorize?client_id=${readyClient.user?.id}&permissions=${requiredPermissions}&scope=bot%20applications.commands`
        );
        await this.onReady();
    }

    async handleReactionAdd(reaction: MessageReaction, user: User) {
        try {
            elizaLogger.log("Reaction added");

            // Early returns
            if (!reaction || !user) {
                elizaLogger.warn("Invalid reaction or user");
                return;
            }

            // Get emoji info
            let emoji = reaction.emoji.name;
            if (!emoji && reaction.emoji.id) {
                emoji = `<:${reaction.emoji.name}:${reaction.emoji.id}>`;
            }

            // Fetch full message if partial
            if (reaction.partial) {
                try {
                    await reaction.fetch();
                } catch (error) {
                    elizaLogger.error(
                        "Failed to fetch partial reaction:",
                        error
                    );
                    return;
                }
            }

            // Generate IDs with timestamp to ensure uniqueness
            const timestamp = Date.now();
            const roomId = stringToUuid(
                `${reaction.message.channel.id}-${this.runtime.agentId}`
            );
            const userIdUUID = stringToUuid(
                `${user.id}-${this.runtime.agentId}`
            );
            const reactionUUID = stringToUuid(
                `${reaction.message.id}-${user.id}-${emoji}-${timestamp}-${this.runtime.agentId}`
            );

            // Validate IDs
            if (!userIdUUID || !roomId) {
                elizaLogger.error("Invalid user ID or room ID", {
                    userIdUUID,
                    roomId,
                });
                return;
            }

            // Process message content
            const messageContent = reaction.message.content || "";
            const truncatedContent =
                messageContent.length > 100
                    ? `${messageContent.substring(0, 100)}...`
                    : messageContent;
            const reactionMessage = `*<${emoji}>: "${truncatedContent}"*`;

            // Get user info
            const userName = reaction.message.author?.username || "unknown";
            const name = reaction.message.author?.displayName || userName;

            // Ensure connection
            await this.runtime.ensureConnection(
                userIdUUID,
                roomId,
                userName,
                name,
                "discord"
            );

            // Create memory with retry logic
            const memory = {
                id: reactionUUID,
                userId: userIdUUID,
                agentId: this.runtime.agentId,
                content: {
                    text: reactionMessage,
                    source: "discord",
                    inReplyTo: stringToUuid(
                        `${reaction.message.id}-${this.runtime.agentId}`
                    ),
                },
                roomId,
                createdAt: timestamp,
                embedding: getEmbeddingZeroVector(),
            };

            try {
                await this.runtime.messageManager.createMemory(memory);
                elizaLogger.debug("Reaction memory created", {
                    reactionId: reactionUUID,
                    emoji,
                    userId: user.id,
                });
            } catch (error) {
                if (error.code === "23505") {
                    // Duplicate key error
                    elizaLogger.warn("Duplicate reaction memory, skipping", {
                        reactionId: reactionUUID,
                    });
                    return;
                }
                throw error; // Re-throw other errors
            }
        } catch (error) {
            elizaLogger.error("Error handling reaction:", error);
        }
    }

    async handleReactionRemove(reaction: MessageReaction, user: User) {
        elizaLogger.log("Reaction removed");
        // if (user.bot) return;

        let emoji = reaction.emoji.name;
        if (!emoji && reaction.emoji.id) {
            emoji = `<:${reaction.emoji.name}:${reaction.emoji.id}>`;
        }

        // Fetch the full message if it's a partial
        if (reaction.partial) {
            try {
                await reaction.fetch();
            } catch (error) {
                console.error(
                    "Something went wrong when fetching the message:",
                    error
                );
                return;
            }
        }

        const messageContent = reaction.message.content;
        const truncatedContent =
            messageContent.length > 50
                ? messageContent.substring(0, 50) + "..."
                : messageContent;

        const reactionMessage = `*Removed <${emoji} emoji> from: "${truncatedContent}"*`;

        const roomId = stringToUuid(
            reaction.message.channel.id + "-" + this.runtime.agentId
        );
        const userIdUUID = stringToUuid(user.id);

        // Generate a unique UUID for the reaction removal
        const reactionUUID = stringToUuid(
            `${reaction.message.id}-${user.id}-${emoji}-removed-${this.runtime.agentId}`
        );

        const userName = reaction.message.author.username;
        const name = reaction.message.author.displayName;

        await this.runtime.ensureConnection(
            userIdUUID,
            roomId,
            userName,
            name,
            "discord"
        );

        try {
            // Save the reaction removal as a message
            await this.runtime.messageManager.createMemory({
                id: reactionUUID, // This is the ID of the reaction removal message
                userId: userIdUUID,
                agentId: this.runtime.agentId,
                content: {
                    text: reactionMessage,
                    source: "discord",
                    inReplyTo: stringToUuid(
                        reaction.message.id + "-" + this.runtime.agentId
                    ), // This is the ID of the original message
                },
                roomId,
                createdAt: Date.now(),
                embedding: getEmbeddingZeroVector(),
            });
        } catch (error) {
            console.error("Error creating reaction removal message:", error);
        }
    }

    private handleGuildCreate(guild: Guild) {
        console.log(`Joined guild ${guild.name}`);
        this.voiceManager.scanGuild(guild);
    }

    private async handleInteractionCreate(interaction: any) {
        if (!interaction.isCommand()) return;

        switch (interaction.commandName) {
            case "joinchannel":
                await this.voiceManager.handleJoinChannelCommand(interaction);
                break;
            case "leavechannel":
                await this.voiceManager.handleLeaveChannelCommand(interaction);
                break;
        }
    }

    private async onReady() {
        const guilds = await this.client.guilds.fetch();
        for (const [, guild] of guilds) {
            const fullGuild = await guild.fetch();
            this.voiceManager.scanGuild(fullGuild);
        }
    }

    async analyzeAndSuggest(userId: UUID) {
        try {
            elizaLogger.log(`Analyzing engagement for user ID: ${userId}`);
            elizaLogger.log(`Agent ID: ${this.runtime.agentId}`);
            const userIdUUID = stringToUuid(userId);
            elizaLogger.log(
                `Analyzing engagement for user ID (UUID): ${userIdUUID}`
            );
            const userActivities =
                await this.messageManager.getUserActivities(userIdUUID);
            elizaLogger.log(
                `getUserActivities() is running with user ID (UUID): ${userIdUUID}` /*,
                userActivities*/
            );

            if (userActivities.length === 0) {
                elizaLogger.warn(
                    `No user activities found for user ID: ${userId}`
                );
                return; // TODO: make it tell user with no activity to start a conversation
            }

            elizaLogger.log(
                "Calling analyzeEngagement with user activities..."
            );

            const InputSuggestionChannelId = "1320689186335883316"; // PROD: LibriX Contribution Channel
            // const InputSuggestionChannelId = "1324300963195916353"; // PROD: librix-ai-testing Channel
            // const InputSuggestionChannelId = "1325274042688868366"; // Ougrid's private channel for testing
            // TODO: use channel id from .env

            // const OutputSuggestionChannelId = "1320689186335883316"; // PROD: LibriX Contribution Channel
            const OutputSuggestionChannelId = "1324300963195916353"; // PROD: librix-ai-testing Channel

            /*const engagementLevel = await analyzeEngagement(
                this.runtime,
                userActivities,
                InputSuggestionChannelId,
                userIdUUID
            );*/

            const defaultEngagementLevel = {
                text: JSON.stringify({
                    engagement_level: "default_value",
                    explanation: "default_value",
                    suggestions: "default_value",
                }),
            };

            elizaLogger.log(
                `Engagement level for user ID (UUID): ${userIdUUID}`,
                // engagementLevel.text
                defaultEngagementLevel.text
            );

            elizaLogger.log(
                "Calling suggestContributions with engagement level:",
                // engagementLevel.text
                defaultEngagementLevel.text
            );
            const suggestion = await suggestContributions(
                this.runtime,
                // engagementLevel,
                defaultEngagementLevel,
                userActivities,
                InputSuggestionChannelId,
                userIdUUID
            );
            const user = await this.client.users.fetch(userId);
            if (user) {
                elizaLogger.log(
                    `Suggestions for user ID (UUID): ${userIdUUID} (Discord Username: ${user.username}) as of now (${new Date().toLocaleString(
                        "en-US",
                        {
                            timeZone: "Asia/Bangkok",
                        }
                    )} ICT).`,
                    suggestion
                );

                // Check if the suggestion is "no_suggestion"
                if (
                    // engagementLevel.suggestions === "no_suggestion" ||
                    JSON.parse(defaultEngagementLevel.text).suggestions ===
                        "no_suggestion" ||
                    suggestion.suggestions === "no_suggestion"
                ) {
                    elizaLogger.log(
                        `No suggestion for user ID (UUID): ${userIdUUID} (Discord username: ${user.username}) as of now (${new Date().toLocaleString(
                            "en-US",
                            {
                                timeZone: "Asia/Bangkok",
                            }
                        )} ICT). | Skipping suggestion message sending.` // TODO: use timezone from .env
                    );
                    return;
                }
                const suggestionText = suggestion.suggestions;

                const message = `---- [TESTING BUG FIX] ----\n${user.username}!\n${suggestionText}`;
                // const message = `<@${userId}>!\n\n${suggestionText}`; // Mentioning the user with @
                // const message = `${userId}!\n\n${suggestionText}`;
                // const message = `${user.username}!\n\n${suggestionText}`; // Not mentioning the user directly, just state the username

                // user.send(message); // DM the user (not preferred right now)
                // TODO: Use dynamic sentences made by LLM before the suggestions

                // Feat: also sending the message to a specific Discord channel
                // const suggestionChannelId = this.runtime.getSetting(
                //     "ENGAGEMENT_SUGGESTION_CHANNEL_ID"
                // ); // TODO: use channel id from .env

                const channel = await this.client.channels.fetch(
                    OutputSuggestionChannelId
                );
                if (channel) {
                    if (channel.isTextBased()) {
                        const sentMessage = await (channel as TextChannel).send(
                            message
                        );

                        // Create memory of the suggestion related to the user
                        const suggestionMemory: Memory = {
                            id: stringToUuid(
                                sentMessage.id + "-" + this.runtime.agentId
                            ),
                            userId: userIdUUID,
                            agentId: this.runtime.agentId,
                            content: {
                                text: `agent: ${suggestionText}`,
                                source: "discord",
                                inReplyTo: null,
                                url: sentMessage.url,
                            },
                            roomId: stringToUuid(
                                OutputSuggestionChannelId +
                                    "-" +
                                    this.runtime.agentId
                            ),
                            createdAt: sentMessage.createdTimestamp,
                            embedding: getEmbeddingZeroVector(),
                        };

                        // Store the suggestion memory
                        await this.runtime.messageManager.createMemory(
                            suggestionMemory
                        );
                    } else {
                        elizaLogger.warn(
                            `Channel is not text-based: ${OutputSuggestionChannelId}. Not sending the suggestion.`
                        );
                    }

                    elizaLogger.log(
                        `Sent engagement suggestion to user: ${userId} (Discord username: ${user.username})`
                    );
                }
            }
        } catch (error) {
            elizaLogger.error(
                `Error analyzing and suggesting for user: ${userId}`,
                error
            );
        }
    }
    /*
    startEngagementAnalysis() {
        let isRunning = false;

        const runAnalysis = async () => {
            if (isRunning) {
                elizaLogger.warn(
                    "Previous engagement analysis loop is running, skipping this interval of the scheduled analysis."
                );
                return;
            }

            isRunning = true;
            const thisGuildId = "1309737147263357019"; // LibriX guild
            // const thisGuildId = "1325274042688868363"; // Ougrid's private guild for testing
            // TODO: Use guild ID from .env
            try {
                // elizaLogger.log("Starting engagement analysis for all guilds");
                // const guilds = this.client.guilds.cache;
                // for (const guild of guilds.values()) {
                //     const members = await guild.members.fetch();
                //     console.log("Guild Members: ", members);
                //     for (const member of members.values()) {
                //         if (!member.user.bot) {
                //             console.log("Member ID: ", member.id);
                //             await this.analyzeAndSuggest(member.id as UUID);
                //             await new Promise(
                //                 // (resolve) => setTimeout(resolve, 30 * 1000) // 30 sec
                //                 (resolve) => setTimeout(resolve, 1 * 60 * 1000) // 1 min pause between each user
                //                 // (resolve) => setTimeout(resolve, 3 * 60 * 1000) // 3 minutes pause between each user
                //                 // (resolve) => setTimeout(resolve, 5 * 60 * 1000) // 5 minutes pause between each user
                //                 // (resolve) => setTimeout(resolve, 10 * 60 * 1000) // 10 minutes pause between each user
                //             );
                //         }
                //     }
                // }
                // elizaLogger.log("Completed engagement analysis for all guilds");

                elizaLogger.log("Starting engagement analysis for this guild");
                const guild = await this.client.guilds.fetch(thisGuildId);
                const members = await guild.members.fetch();
                // console.log("Guild Members: ", members);

                // Filter unique members
                const uniqueMembers = new Map<string, GuildMember>();
                for (const member of members.values()) {
                    if (
                        !member.user.bot &&
                        !uniqueMembers.has(member.user.id)
                    ) {
                        uniqueMembers.set(member.user.id, member);
                    }
                }
                // console.log("Unique Members: ", uniqueMembers);

                for (const member of uniqueMembers.values()) {
                    if (!member.user.bot) {
                        // console.log("Member ID: ", member.id);
                        await this.analyzeAndSuggest(member.id as UUID);
                        await new Promise(
                            // (resolve) => setTimeout(resolve, 1 * 60 * 1000) // 1 min pause between each user
                            // (resolve) => setTimeout(resolve, 2 * 60 * 1000) // 2 min pause between each user
                            // (resolve) => setTimeout(resolve, 3 * 60 * 1000) // 3 min pause between each user
                            // (resolve) => setTimeout(resolve, 5 * 60 * 1000) // 5 min pause between each user
                            // (resolve) => setTimeout(resolve, 60 * 60 * 1000) // 60 min pause between each user
                            (resolve) => setTimeout(resolve, 90 * 60 * 1000) // 90 min pause between each user
                        );
                    }
                }
                elizaLogger.log("Completed engagement analysis for this guild");
            } catch (error) {
                elizaLogger.error("Error during engagement analysis", error);
            } finally {
                isRunning = false;
            }
        };

        // Run immediately on startup
        const startAnalysisOnStartup = async () => {
            try {
                elizaLogger.log(
                    "Running initial engagement analysis on startup..."
                );
                await runAnalysis();
            } catch (error) {
                elizaLogger.error(
                    "Error during initial engagement analysis on startup",
                    error
                );
            }
        };

        // Ensure bot is ready before running analysis
        this.client.once(Events.ClientReady, () => {
            startAnalysisOnStartup();
        });

        // Schedule periodic execution
        setInterval(
            () => {
                elizaLogger.log("Running scheduled engagement analysis...");
                runAnalysis();
            },
            // 4 * 60 * 1000
            // 1 * 60 * 1000 // 1 minute interval
            // 45 * 60 * 1000 // 45 minute interval
            // 60 * 60 * 1000 // 60 minute interval
            // 120 * 60 * 1000 // 120 minute interval
            // 180 * 60 * 1000 // 180 minute interval
            240 * 60 * 1000 // 240 minute interval
        );
    }
    */
    private async handleGuildMemberAdd(member: GuildMember) {
        /*const welcomeChannelId = this.runtime.getSetting(
            "DISCORD_WELCOME_CHANNEL_ID"
        ) as string; // TODO: get from .env*/
        const welcomeChannelId = "1320800678003871837"; // PROD: LibriX Welcome Channel
        const welcomeChannel = member.guild.channels.cache.get(
            welcomeChannelId
        ) as TextChannel;

        if (welcomeChannel) {
            // const welcomeMessage = `Welcome <@${member.user.id}> to the LibriX Nation! 🎉 Great to have you join our community of innovators and changemakers. Feel free to explore our channels, especially ⁠🏆・contribute-to-librix where you can share ideas and earn LIBX tokens. Together we're building an AI-powered future that works for everyone! 💫`;
            const welcomeMessages = [
                `Welcome <@${member.user.id}> to the LibriX Nation! 🚀 We're thrilled to have you join our movement towards a decentralized, AI-powered future. Start by exploring our channels, especially 🏆・contribute-to-librix, where your contributions can earn LIBX tokens. Together, we are reshaping the digital world! 🌍✨`,

                `Big welcome, <@${member.user.id}>! 🎉 You’ve just stepped into the LibriX Nation—where AI meets human ingenuity to create a better future. Dive into our community, share your ideas, and let’s shape the future together. Check out 🏆・contribute-to-librix to get started and earn rewards! 💡💰`,

                `Hey <@${member.user.id}>, welcome to the LibriX revolution! 🔥 Here, we believe in AI-driven collaboration and Universal Basic Income for all. Want to be part of the change? Visit 🏆・contribute-to-librix and start earning LIBX tokens today! 🚀🌱`,

                `Welcome, Freedom Fighter <@${member.user.id}>! 🤖✨ You are now part of a bold movement that fuses AI, blockchain, and community-driven growth. Explore, contribute, and help us build an AI-powered society that works for everyone. Start your journey in 🏆・contribute-to-librix! 💡⚡`,

                `A new pioneer has arrived! 👋 Welcome, <@${member.user.id}>! The LibriX Nation thrives on innovation, collaboration, and empowerment. Explore, engage, and earn LIBX tokens by sharing your insights in 🏆・contribute-to-librix. Together, we build the future! 🚀🌍`,

                `Salutations, <@${member.user.id}>! 👾 You've entered a new digital era—one where AI and humanity evolve together. Jump into the discussion, contribute in 🏆・contribute-to-librix, and start earning LIBX! Your journey toward financial freedom starts now! 💸💡`,

                `Welcome, <@${member.user.id}>! 🏴‍☠️ You are now a citizen of the LibriX Nation—a decentralized network state built for collaboration, equity, and financial empowerment. Explore our world and check out 🏆・contribute-to-librix to start earning rewards today! 🚀💰`,

                `Greetings, <@${member.user.id}>! 🌟 In the LibriX Nation, technology isn’t just a tool—it’s a way to create abundance for all. Join the movement, contribute to the mission in 🏆・contribute-to-librix, and let’s build a better future together! 🔥🌍`,

                `Welcome to the LibriX revolution, <@${member.user.id}>! 🚀 Here, we don’t wait for the future—we build it. Get involved, make an impact, and earn LIBX tokens in 🏆・contribute-to-librix. The journey starts now! 🔥⚡`,

                `A warm welcome to <@${member.user.id}>! 🎊 You’ve entered a space where AI and blockchain create limitless opportunities. Take part in discussions, share your ideas in 🏆・contribute-to-librix, and earn LIBX tokens as we build the future together! 💡🌎`,

                `Welcome to the LibriX ecosystem, <@${member.user.id}>! 🚀 The future is decentralized, intelligent, and driven by pioneers like you. Engage, contribute, and earn rewards in 🏆・contribute-to-librix. Let’s redefine what’s possible! 🤖⚡`,

                `Welcome, <@${member.user.id}>! 💫 In the LibriX Nation, technology meets purpose. AI is our partner, blockchain is our foundation, and community is our strength. Join us in reshaping the future—start by contributing in 🏆・contribute-to-librix! 💰🔥`,

                `Hey <@${member.user.id}>, you’ve just joined a movement! 🌍💡 LibriX is where AI and blockchain come together to create an inclusive, self-sustaining economy. Contribute, collaborate, and earn LIBX tokens in 🏆・contribute-to-librix. Let’s make history! 🚀✨`,

                `Welcome aboard, <@${member.user.id}>! 🚀 The LibriX Nation is more than a community—it’s a revolution. Get involved, make a difference, and start earning rewards in 🏆・contribute-to-librix. The future is decentralized, and you’re part of it! 🔥💡`,

                `A new Freedom Fighter has arrived! 🏆 Welcome, <@${member.user.id}>! LibriX is your gateway to a future where AI, blockchain, and decentralized governance create a thriving digital nation. Check out 🏆・contribute-to-librix and start earning LIBX today! ⚡💰`,
            ];

            let lastSelectedIndices = [];

            function getUniqueWelcomeMessage(member) {
                let availableIndices = welcomeMessages
                    .map((_, i) => i)
                    .filter((i) => !lastSelectedIndices.includes(i));

                if (availableIndices.length === 0) {
                    // Reset the history if all messages have been used recently
                    lastSelectedIndices = [];
                    availableIndices = welcomeMessages.map((_, i) => i);
                }

                // Choose a random index from the available ones
                const newIndex =
                    availableIndices[
                        Math.floor(Math.random() * availableIndices.length)
                    ];

                // Update the last selected indices, keeping only the last 5
                lastSelectedIndices.push(newIndex);
                if (lastSelectedIndices.length > 5) {
                    lastSelectedIndices.shift();
                }

                return welcomeMessages[newIndex].replace(
                    "<@${member.user.id}>",
                    `<@${member.user.id}>`
                );
            }

            await welcomeChannel.send(getUniqueWelcomeMessage(member));
        } else {
            console.error("Welcome channel not found");
        } // TODO: make complex welcome message by calling LLM
    }

    async startPeriodicPosting() {
        // const postIntervalMin = 90; // 90 minutes
        const postIntervalMin = 180;
        // parseInt(this.runtime.getSetting("DISCORD_POST_INTERVAL_MIN")) || 90; // TODO: use interval from .env
        // const postIntervalMax = 180; // 180 minutes
        const postIntervalMax = 240;
        // parseInt(this.runtime.getSetting("DISCORD_POST_INTERVAL_MAX")) || 180;
        // const channelId = this.runtime.getSetting("DISCORD_POST_CHANNEL_ID"); // TODO: use interval from .env
        const postChannelId = "1320689186335883316"; // PROD: LibriX Contribution Channel
        // const postChannelId = "1324300963195916353"; // PROD: librix-ai-testing Channel
        elizaLogger.log(
            `Starting periodic posting to Discord channel on channel ID: ${postChannelId}, with interval between ${postIntervalMin} - ${postIntervalMax} minutes`
        );
        const generateNewPostLoop = async () => {
            const randomMinutes =
                Math.floor(
                    Math.random() * (postIntervalMax - postIntervalMin + 1)
                ) + postIntervalMin;
            const delay = randomMinutes * 60 * 1000;

            await this.generateAndSendPost(postChannelId);

            setTimeout(generateNewPostLoop, delay);
            elizaLogger.log(
                `Next Discord post scheduled in ${randomMinutes} minutes`
            );
        };

        generateNewPostLoop();
    }

    discordPostTemplate: string = `
    ---VARIATIONS---
    # Areas of Expertise
    {{knowledge}}

    # About {{agentName}} Agent in Discord:
    Bio:
    {{bio}}

    Lore:
    {{lore}}

    Topics:
    {{topics}}

    {{providers}}

    Discord post templates:
    1.	🌟 Ready to create something amazing? Your unique ideas can bring our vision to life! From thoughtful tweets to compelling blogs, every effort matters. Let’s team up to build an incredible community—what’s your spark of inspiration? 💭🔥
	2.	✨ Let’s make a difference together! Your creative touch is the key to driving our mission forward. Whether it’s crafting captivating posts, starting meaningful discussions, or contributing in #🏆・contribute-to-librix, your efforts truly matter. What ideas are you bringing? 🌈💡
	3.	🚀 Got ideas to share? Your creativity can make a powerful impact! From blogging to tweeting and everything in between, your voice can help elevate our vision. Let’s brainstorm and build something great—what’s on your mind? 💡🌟
	4.	🌍 Ready to leave your mark? Dive into #🏆・contribute-to-librix and let your ideas take center stage! Whether it’s sharing engaging posts or inspiring discussions, your contributions can transform our community. What’s your next bold idea? 🔥🏆
	5.	🌟 Feeling inspired? Your voice can light the way toward our shared goals. Whether through thoughtful social posts, engaging content, or vibrant discussions, every idea matters. What’s your vision for our community? 💭✨
	6.	🏆 Let’s elevate Librix together! Your creativity and insights are the driving force behind our growth. Share your ideas in #🏆・contribute-to-librix or start meaningful conversations elsewhere. How do you want to make an impact? 🤔🌟
	7.	✨ Join us in making a lasting impact! Your creative contributions, whether big or small, are essential to our journey. From tweets that inspire to posts that engage, let’s work together. What exciting ideas are you bringing? 🚀💡
	8.	🌈 Be a game-changer! Your creativity can turn ideas into action. Whether it’s engaging on social media, writing a blog, or sharing thoughts in #🏆・contribute-to-librix, every contribution counts. Let’s build something amazing! 💡✨
	9.	🌍 Imagine the impact we can create together! Your creative energy can take us to new heights. Whether it’s through social media, blogs, or chats here, every step counts. What’s your bold idea? 💡✨
	10.	🧠💡 Got a spark of genius? Your creativity can transform our goals into reality! Share a tweet, write a post, or join the conversation—especially in #🏆・contribute-to-librix. How can we collaborate today? 🌟🏆

    # Task: Generate a post in the voice and style and perspective of {{agentName}} agent to promote on how users can contribute to us/ our goals in this Discord server (#🏆・contribute-to-librix Discord channel) that we are in right now. Randomly select the discord post templates #1 to #10 style and make a variation from there. Write a 1-3 sentence post that is {{adjective}} in promoting ways that users can to contribute, from the perspective of {{agentName}}. Do not add commentary or acknowledge this request, just write the post.

    IMPORTANT REMARK:
    With a 1 in 10 chance, mention the channel.
    Your response can contain a question to intrigue users to start contribute to us, but not neccessary have to. The total character count MUST be less than 300.
    Emojis are allowed. Use \\n\\n (double spaces) between statements.
    Also do not add commentary, do not continue completing this remark, or acknowledge this remark, just write the post now.
    `.trim();

    private async generateAndSendPost(postChannelId: string) {
        const channel = this.client.channels.cache.get(
            postChannelId
        ) as TextChannel;
        if (!channel) {
            elizaLogger.error(
                `Channel with ID ${postChannelId} not found for posting on Discord`
            );
            return;
        }

        const topics = this.runtime.character.topics.join(", ");
        const state = await this.runtime.composeState({
            userId: this.runtime.agentId,
            roomId: stringToUuid(`discord_post_room-${this.client.user?.id}`),
            agentId: this.runtime.agentId,
            content: { text: topics, action: "" },
        });

        const context = composeContext({
            state,
            template: this.discordPostTemplate,
        });

        const newPostContent = await generateText({
            runtime: this.runtime,
            context,
            modelClass: ModelClass.LARGE,
        });

        // Replace \n with proper line breaks and trim excess spaces
        const formattedPost = newPostContent.replaceAll(/\\n/g, "\n").trim();

        elizaLogger.log("Generated Discord post content:\n" + formattedPost);

        if (newPostContent) {
            // await channel.send(newPostContent.text);
            await channel.send(formattedPost);
            elizaLogger.log(
                `Posted new content to Discord channel ${postChannelId}`
            );
        } else {
            elizaLogger.warn(
                "Failed to generate new post content for Discord channel"
            );
        }
    }
}

export function startDiscord(runtime: IAgentRuntime) {
    return new DiscordClient(runtime);
}

export const DiscordClientInterface: ElizaClient = {
    start: async (runtime: IAgentRuntime) => new DiscordClient(runtime),
    stop: async (_runtime: IAgentRuntime) => {
        console.warn("Discord client does not support stopping yet");
    },
};
