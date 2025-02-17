import { Client, elizaLogger, IAgentRuntime } from "@ai16z/eliza";
import { ClientBase } from "./base.ts";
import { validateTwitterConfig } from "./environment.ts";
import { TwitterInteractionClient } from "./interactions.ts";
import { TwitterPostClient } from "./post.ts";
import { TwitterSearchClient } from "./search.ts";

class TwitterManager {
    client: ClientBase;
    post: TwitterPostClient;
    search: TwitterSearchClient;
    interaction: TwitterInteractionClient;
    constructor(runtime: IAgentRuntime, enableSearch: boolean) {
        this.client = new ClientBase(runtime);
        this.post = new TwitterPostClient(this.client, runtime);

        if (enableSearch) {
            elizaLogger.warn("Twitter/X client running in a mode that:");
            elizaLogger.warn("1. violates consent of random users");
            elizaLogger.warn("2. burns your rate limit");
            elizaLogger.warn("3. can get your account banned");
            elizaLogger.warn("use at your own risk");
            elizaLogger.warn(
                "Initializing Twitter search client from TwitterManager"
            );
            this.search = new TwitterSearchClient(this.client, runtime);
            if (this.search) {
                elizaLogger.log("Twitter search client instantiated.");
            } else {
                elizaLogger.log("Twitter search client failed to instantiate.");
            }
        } else {
            elizaLogger.warn("Search not enabled.");
        }

        this.interaction = new TwitterInteractionClient(this.client, runtime);
    }
}

export const TwitterClientInterface: Client = {
    async start(runtime: IAgentRuntime) {
        await validateTwitterConfig(runtime);

        elizaLogger.log("Twitter client started");

        const manager = new TwitterManager(runtime, true);

        await manager.client.init();

        await manager.post.start();

        await manager.interaction.start();

        // manager.search = new TwitterSearchClient(manager.client, runtime);
        // await manager.search.start();

        return manager;
    },
    async stop(_runtime: IAgentRuntime) {
        elizaLogger.warn("Twitter client does not support stopping yet");
    },
};

export default TwitterClientInterface;
