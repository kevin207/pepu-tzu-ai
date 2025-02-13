import { IAgentRuntime } from "@ai16z/eliza";
import { z } from "zod";

export const discordEnvSchema = z.object({
    DISCORD_APPLICATION_ID: z
        .string()
        .min(1, "Discord application ID is required"),
    DISCORD_API_TOKEN: z.string().min(1, "Discord API token is required"),
    DISCORD_CHANNEL_CONTRIBUTION_ID: z
        .string()
        .min(1, "Discord contribution channel ID is required"),
    DISCORD_CHANNEL_SETTING_GOALS_ID: z
        .string()
        .min(1, "Discord setting goals channel ID is required"),
});

export type DiscordConfig = z.infer<typeof discordEnvSchema>;

export async function validateDiscordConfig(
    runtime: IAgentRuntime
): Promise<DiscordConfig> {
    try {
        const config = {
            DISCORD_APPLICATION_ID:
                runtime.getSetting("DISCORD_APPLICATION_ID") ||
                process.env.DISCORD_APPLICATION_ID,
            DISCORD_API_TOKEN:
                runtime.getSetting("DISCORD_API_TOKEN") ||
                process.env.DISCORD_API_TOKEN,
            DISCORD_CHANNEL_CONTRIBUTION_ID:
                runtime.getSetting("DISCORD_CHANNEL_CONTRIBUTION_ID") ||
                process.env.DISCORD_CHANNEL_CONTRIBUTION_ID,
            DISCORD_CHANNEL_SETTING_GOALS_ID:
                runtime.getSetting("DISCORD_CHANNEL_SETTING_GOALS_ID") ||
                process.env.DISCORD_CHANNEL_SETTING_GOALS,
        };
        console.log("Discord config", config);

        return discordEnvSchema.parse(config);
    } catch (error) {
        if (error instanceof z.ZodError) {
            const errorMessages = error.errors
                .map((err) => `${err.path.join(".")}: ${err.message}`)
                .join("\n");
            throw new Error(
                `Discord configuration validation failed:\n${errorMessages}`
            );
        }
        throw error;
    }
}
