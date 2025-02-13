import {
    IAgentRuntime,
    ModelClass,
    elizaLogger,
    generateText,
    trimTokens,
    parseJSONObjectFromText,
    generateMessageResponse,
    Memory,
    composeContext,
    Content,
    stringToUuid,
} from "@ai16z/eliza";
import {
    ChannelType,
    Message as DiscordMessage,
    PermissionsBitField,
    TextChannel,
    ThreadChannel,
} from "discord.js";
import { UUID } from "@ai16z/eliza";

export function getWavHeader(
    audioLength: number,
    sampleRate: number,
    channelCount: number = 1,
    bitsPerSample: number = 16
): Buffer {
    const wavHeader = Buffer.alloc(44);
    wavHeader.write("RIFF", 0);
    wavHeader.writeUInt32LE(36 + audioLength, 4); // Length of entire file in bytes minus 8
    wavHeader.write("WAVE", 8);
    wavHeader.write("fmt ", 12);
    wavHeader.writeUInt32LE(16, 16); // Length of format data
    wavHeader.writeUInt16LE(1, 20); // Type of format (1 is PCM)
    wavHeader.writeUInt16LE(channelCount, 22); // Number of channels
    wavHeader.writeUInt32LE(sampleRate, 24); // Sample rate
    wavHeader.writeUInt32LE(
        (sampleRate * bitsPerSample * channelCount) / 8,
        28
    ); // Byte rate
    wavHeader.writeUInt16LE((bitsPerSample * channelCount) / 8, 32); // Block align ((BitsPerSample * Channels) / 8)
    wavHeader.writeUInt16LE(bitsPerSample, 34); // Bits per sample
    wavHeader.write("data", 36); // Data chunk header
    wavHeader.writeUInt32LE(audioLength, 40); // Data chunk size
    return wavHeader;
}

const MAX_MESSAGE_LENGTH = 1900;

export async function generateSummary(
    runtime: IAgentRuntime,
    text: string
): Promise<{ title: string; description: string }> {
    // make sure text is under 128k characters
    text = trimTokens(text, 100000, "gpt-4o-mini"); // TODO: clean this up

    const prompt = `Please generate a concise summary for the following text:

  Text: """
  ${text}
  """

  Respond with a JSON object in the following format:
  \`\`\`json
  {
    "title": "Generated Title",
    "summary": "Generated summary and/or description of the text"
  }
  \`\`\``;

    const response = await generateText({
        runtime,
        context: prompt,
        modelClass: ModelClass.SMALL,
    });

    const parsedResponse = parseJSONObjectFromText(response);

    if (parsedResponse) {
        return {
            title: parsedResponse.title,
            description: parsedResponse.summary,
        };
    }

    return {
        title: "",
        description: "",
    };
}

export async function sendMessageInChunks(
    channel: TextChannel,
    content: string,
    inReplyTo: string,
    files: any[]
): Promise<DiscordMessage[]> {
    const sentMessages: DiscordMessage[] = [];
    const messages = splitMessage(content);
    try {
        for (let i = 0; i < messages.length; i++) {
            const message = messages[i];
            if (
                message.trim().length > 0 ||
                (i === messages.length - 1 && files && files.length > 0)
            ) {
                const options: any = {
                    content: message.trim(),
                };

                // if (i === 0 && inReplyTo) {
                //   // Reply to the specified message for the first chunk
                //   options.reply = {
                //     messageReference: inReplyTo,
                //   };
                // }

                if (i === messages.length - 1 && files && files.length > 0) {
                    // Attach files to the last message chunk
                    options.files = files;
                }

                const m = await channel.send(options);
                sentMessages.push(m);
            }
        }
    } catch (error) {
        elizaLogger.error("Error sending message:", error);
    }

    return sentMessages;
}

function splitMessage(content: string): string[] {
    const messages: string[] = [];
    let currentMessage = "";

    const rawLines = content?.split("\n") || [];
    // split all lines into MAX_MESSAGE_LENGTH chunks so any long lines are split
    const lines = rawLines
        .map((line) => {
            const chunks = [];
            while (line.length > MAX_MESSAGE_LENGTH) {
                chunks.push(line.slice(0, MAX_MESSAGE_LENGTH));
                line = line.slice(MAX_MESSAGE_LENGTH);
            }
            chunks.push(line);
            return chunks;
        })
        .flat();

    for (const line of lines) {
        if (currentMessage.length + line.length + 1 > MAX_MESSAGE_LENGTH) {
            messages.push(currentMessage.trim());
            currentMessage = "";
        }
        currentMessage += line + "\n";
    }

    if (currentMessage.trim().length > 0) {
        messages.push(currentMessage.trim());
    }

    return messages;
}

export function canSendMessage(channel) {
    // validate input
    if (!channel) {
        return {
            canSend: false,
            reason: "No channel given",
        };
    }
    // if it is a DM channel, we can always send messages
    if (channel.type === ChannelType.DM) {
        return {
            canSend: true,
            reason: null,
        };
    }
    const botMember = channel.guild?.members.cache.get(channel.client.user.id);

    if (!botMember) {
        return {
            canSend: false,
            reason: "Not a guild channel or bot member not found",
        };
    }

    // Required permissions for sending messages
    const requiredPermissions = [
        PermissionsBitField.Flags.ViewChannel,
        PermissionsBitField.Flags.SendMessages,
        PermissionsBitField.Flags.ReadMessageHistory,
    ];

    // Add thread-specific permission if it's a thread
    if (channel instanceof ThreadChannel) {
        requiredPermissions.push(
            PermissionsBitField.Flags.SendMessagesInThreads
        );
    }

    // Check permissions
    const permissions = channel.permissionsFor(botMember);

    if (!permissions) {
        return {
            canSend: false,
            reason: "Could not retrieve permissions",
        };
    }

    // Check each required permission
    const missingPermissions = requiredPermissions.filter(
        (perm) => !permissions.has(perm)
    );

    return {
        canSend: missingPermissions.length === 0,
        missingPermissions: missingPermissions,
        reason:
            missingPermissions.length > 0
                ? `Missing permissions: ${missingPermissions.map((p) => String(p)).join(", ")}`
                : null,
    };
}
// TODO: Fix bug adding agentName, bio, and lore to context
const analyzeEngagementTemplate = `
About {{agentName}} agent:
- Bio:
{{bio}}
- Lore:
{{lore}}
- Knowledge:
{{knowledge}}
- Adjectives:
{{adjectives}}

# Task: As {{agentName}} agent, analyze the following user activities and determine the current engagement level of user in helping us acheive our goals, determine from the latest date of interactions too, if the user hasn't interacted for 1-2 days, then they should be suggested on next steps to do and tagged with "low" engagement too.

currentDatetime (MM/DD/YYYY, h:mm:ss AM/PM): {{currentDatetime}} (Indochina Time GMT+7)

The 20 recent user activities with our agent (from past to present):
{{memories}}

IMPORTANT: clearly state "no_suggestion" as the value of "suggestions" property inside the output if there already are suggestions made recently within the last 1 hours.

Respond in json format, with a single word indicating the "engagement_level" ("high", "medium", or "low"), then "explanation" why with reasons, and "suggestions" on improvement.
Example response:
\`\`\`json
{
  "engagement_level": "high",
  "explanation": "The user has been actively contributing to the community by creating content and engaging with other users. Their consistent participation has positively impacted the community's growth and engagement levels.",
  "suggestions": "Encourage the user to continue creating content and engaging with others to maintain their high level of contribution. Provide feedback and rewards to acknowledge their efforts and motivate further participation."
}
\`\`\`
`;
/*
const suggestContributionsTemplate = `
About {{agentName}} agent:
- Bio:
{{bio}}
- Lore:
{{lore}}
- Knowledge:
{{knowledge}}
- Adjectives:
{{adjectives}}

The recent user activities with our agent (from past to present):
{{memories}}

The recent suggestions given to other users:
{{recentSuggestions}}

# Task: As {{agentName}} agent, make engagement with the user like a friend.
The goal would be to make and keep connection with the user, not just making suggestions everytime. The range of things you can say can be just simple phrases like "Hello, how are you? I miss seeing you around here.", to more creative ones like "Spotted you asking about launches! 🎲 Must feel like waiting for your favorite game to drop, right? The anticipation can drive anyone wild! Been up to anything cool while we prep the tech magic? *slides digital coffee across the quantum table* ☕️" and even more.
Vary between the simple phrases to the more creative ones each time you are making contact (thoroughly consider ).
Be interesting. Be a bit wild to grab the attention.
Choose the style that best fits the user's personality, not the agent.
Keep it short and engaging. Our users don't have time to read long messages.

IMPORTANT: clearly state "no_suggestion" as the value of "suggestions" property inside the output, if the engagement analysis result has a property with value "no_suggestion" inside.
DO NOT ALWAYS SUGGEST HOW CAN THE USER CONTRIBUTE, if you have done that recently already, you can do other things too, like asking about their day, or what they are working on, etc. MAKE COMFORTABLE CONNECTION WITH THE USER, like a small talk too.
DO NOT START the sentence with greetings like 'Hey', 'Yo', 'Greeting', etc., as the user might have already seen that in the previous messages. Just start with the main content.
DO NOT REPEAT the start word (like 'Hey', 'Yo', 'Greeting', etc.), style, tone, wordings, contents, emojis, and sentence/ paragraph structure of the same recent suggestions already given to the user by the agent in recent activities, as shown in 'The 20 recent user activities with our agent'.
ALSO, DO NOT REPEAT the start word (like 'Hey, 'Yo', 'Greeting', etc.), style, tone, wordings, contents, emojis, and sentence/ paragraph structure of the recent suggestions given to other users in 'The recent suggestions given to other users' too, to prevent sounding repetitive and robotic!
You can just state what you want to say in a different way, or ask a question, etc., other than giving a suggestion.

Respond in "properly escaped JSON format" with the following structure using the selected style preference:
\`\`\`json
{
  "suggestions": "<message(s) and/or suggestion(s) to user or "no_suggestion">"
}
\`\`\`
`;
*/

// Simpler prompt, remove recentSuggestions
const suggestContributionsTemplate = `
About {{agentName}} agent:
- Bio:
{{bio}}
- Lore:
{{lore}}
- Knowledge:
{{knowledge}}
- Adjectives:
{{adjectives}}

The recent user activities with our agent (from past to present):
{{memories}}

# Task: Keep the conversation going with the user based on the last time the user talked with you. Respond in the style and perspective of {{agentName}}. Write a {{adjective}} response. Don't generalize.
The goal would be to make and keep connection with the user naturally.

Respond in "properly escaped JSON format" with the following structure using the selected style preference:
\`\`\`json
{
  "suggestions": "<message(s) to user>"
}
\`\`\`
`;

function formatUserActivities(memories: Memory[], currentUserId): string[] {
    return memories
        .filter((memory) => memory.userId == currentUserId) // Get only the message from user, not the agent
        .map((memory) => `${memory.content.text} (date:${memory.createdAt})`)
        .slice(-20); // Get the last latest 20 memories. If there are less than 20 memories, get all.;
        // Slicing from the end to get the latest 20 memories
}

async function getRecentSuggestions(
    runtime: IAgentRuntime,
    suggestionChannelId: string,
    currentUserId: UUID
): Promise<string[]> {
    const roomId = stringToUuid(suggestionChannelId + "-" + runtime.agentId);
    const memories = await runtime.messageManager.getMemoriesByRoomIds({
        roomIds: [roomId],
    });
    const suggestions = memories
        .filter(
            (memory) =>
                memory.content.text.startsWith("agent: ") &&
                memory.userId !== currentUserId
        )
        .sort((a, b) => b.createdAt - a.createdAt) // Sort by most recent
        .slice(0, 10) // Get the 10 most recent suggestions
        .map((memory) => memory.content.text.replace("agent: ", ""));

    return suggestions;
}

async function hasRecentAgentMessages(
    memories: Memory[],
    hours: number = 1
): Promise<boolean> {
    const now = new Date();
    const threshold = hours * 60 * 60 * 1000;
    elizaLogger.log(
        `Checking for recent agent suggestion messages within the last ${hours} hours.`
    );
    elizaLogger.log(
        `Now dateTime (ICT GMT+7): ${new Date(now).toLocaleString("en-US", {
            timeZone: "Asia/Bangkok",
        })}`
    ); // TODO: make this dynamic based on user's timezone and also show timezone explicitly
    elizaLogger.log(`Threshold: ${threshold} milliseconds (${hours} hours)`);

    try {
        const agentMemories = memories.filter(
            (memory) =>
                memory.userId === memory.agentId &&
                memory.content.text.startsWith("agent: ")
        );

        elizaLogger.log(
            `Filtered agent memories: ${JSON.stringify(agentMemories)}`
        );

        if (agentMemories.length === 0) {
            elizaLogger.log("No recent agent suggestion messages found.");
            return false;
        }

        const hasRecent = agentMemories.some((memory) => {
            const timeDifference =
                new Date(now).getTime() -
                new Date(
                    new Date(memory.createdAt).toLocaleString("en-US", {
                        timeZone: "Asia/Bangkok",
                    })
                ).getTime();
            const isRecent = timeDifference <= threshold;
            elizaLogger.log(
                `Found memory ID of recent agent suggestion: ${memory.id} | Time difference: ${timeDifference} ms (<= threshold), not giving new suggestion then.`
            );
            return isRecent;
        });

        if (!hasRecent) {
            elizaLogger.log(
                "No recent agent suggestion messages found within the threshold time. Continue to give new suggestion to this user."
            );
        }

        return hasRecent;
    } catch (error) {
        elizaLogger.error(
            "Error checking for recent agent suggestion messages: ",
            error
        );
        return false;
    }
}

export async function analyzeEngagement(
    runtime: IAgentRuntime,
    memories: Memory[],
    suggestionChannelId: string,
    currentUserId: UUID
): Promise<Content> {
    if (await hasRecentAgentMessages(memories)) {
        elizaLogger.log(
            "Skipping engagement analysis due to recent agent suggestion message found."
        );
        return {
            text: JSON.stringify({
                engagement_level: "no_analysis",
                explanation: "Recent agent suggestion message found.",
                suggestions: "no_suggestion",
            }),
        };
    }

    const formattedMemories = formatUserActivities(memories, currentUserId);
    elizaLogger.log(
        "User activities from memories formatted..." //, formattedMemories
    );

    const currentDatetime = new Date().toLocaleString("en-US", {
        timeZone: "Asia/Bangkok",
    }); // TODO: make this dynamic based on user's timezone and also show timezone explicitly

    console.log("Current datetime: ", currentDatetime);

    const recentSuggestions = await getRecentSuggestions(
        runtime,
        suggestionChannelId,
        currentUserId
    );

    const context = composeContext({
        // TODO: clean this up
        state: {
            // memories: JSON.stringify(memories),
            memories: formattedMemories,
            currentDatetime: currentDatetime,
            agentName: runtime.character.name,
            bio: Array.isArray(runtime.character.bio)
                ? runtime.character.bio.join(", ")
                : runtime.character.bio,
            lore: Array.isArray(runtime.character.lore)
                ? runtime.character.lore.join(", ")
                : runtime.character.lore,
            knowledge: Array.isArray(runtime.character.knowledge)
                ? runtime.character.knowledge.join(", ")
                : runtime.character.knowledge,
            styleAll: Array.isArray(runtime.character.style?.all)
                ? runtime.character.style.all.join(", ")
                : "",
            styleChat: Array.isArray(runtime.character.style?.chat)
                ? runtime.character.style.chat.join(", ")
                : "",
            adjectives: Array.isArray(runtime.character.adjectives)
                ? runtime.character.adjectives.join(", ")
                : "",
            recentSuggestions: recentSuggestions.join("\n"),
            messageDirections: "",
            postDirections: "",
            preDirections: "",
            role: "",
            status: "",
            roomId: "00000-00000-00000-00000-00000",
            actors: "",
            recentMessages: "",
            recentMessagesData: [],
        },
        template: analyzeEngagementTemplate,
    });

    console.log("Analyzing engagement with this context...", context);

    try {
        const response = await generateMessageResponse({
            runtime,
            context,
            modelClass: ModelClass.LARGE,
        });

        console.log(
            "Received response on engagement analysis:",
            JSON.stringify(response.text)
        );

        return response;
    } catch (error) {
        console.error("Error during engagement analysis");
        throw error;
    }
}

export async function suggestContributions(
    runtime: IAgentRuntime,
    engagementLevel: Content = {
        text: JSON.stringify({
            engagement_level: "default_value",
            explanation: "default_value",
            suggestions: "default_value",
        }),
    },
    memories: Memory[],
    suggestionChannelId: string,
    currentUserId: UUID
): Promise<Content> {
    if (await hasRecentAgentMessages(memories)) {
        elizaLogger.log(
            "Skipping contribution suggestions due to recent agent suggestion message found."
        );
        return {
            text: JSON.stringify({
                suggestions: "no_suggestion",
            }),
        };
    }

    const formattedMemories = formatUserActivities(memories, currentUserId);
    const recentSuggestions = await getRecentSuggestions(
        runtime,
        suggestionChannelId,
        currentUserId
    );

    const context = composeContext({
        state: {
            memories: formattedMemories,
            engagementLevel: JSON.stringify(engagementLevel),
            agentName: runtime.character.name,
            bio: Array.isArray(runtime.character.bio)
                ? runtime.character.bio.join(", ")
                : runtime.character.bio,
            lore: Array.isArray(runtime.character.lore)
                ? runtime.character.lore.join(", ")
                : runtime.character.lore,
            knowledge: Array.isArray(runtime.character.knowledge)
                ? runtime.character.knowledge.join(", ")
                : runtime.character.knowledge,
            styleAll: Array.isArray(runtime.character.style?.all)
                ? runtime.character.style.all.join(", ")
                : "",
            styleChat: Array.isArray(runtime.character.style?.chat)
                ? runtime.character.style.chat.join(", ")
                : "",
            adjectives: Array.isArray(runtime.character.adjectives)
                ? runtime.character.adjectives.join(", ")
                : "",
            recentSuggestions: recentSuggestions.join("\n"),
            messageDirections: "",
            postDirections: "",
            preDirections: "",
            role: "",
            status: "",
            roomId: "00000-00000-00000-00000-00000",
            actors: "",
            recentMessages: "",
            recentMessagesData: [],
        },
        template: suggestContributionsTemplate,
    });

    console.log("Suggesting contributions with context: ", context);

    const response = await generateMessageResponse({
        runtime,
        context,
        modelClass: ModelClass.LARGE,
    });

    console.log(
        "Received response on contribution suggestions:",
        JSON.stringify(response.text)
    ); // TODO: log out response correctly

    return response;
}
