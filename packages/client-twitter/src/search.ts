import { SearchMode } from "agent-twitter-client";
import { composeContext, elizaLogger } from "@ai16z/eliza";
import { generateMessageResponse, generateText } from "@ai16z/eliza";
import { messageCompletionFooter } from "@ai16z/eliza";
import {
    Content,
    HandlerCallback,
    IAgentRuntime,
    IImageDescriptionService,
    ModelClass,
    ServiceType,
    State,
} from "@ai16z/eliza";
import { stringToUuid } from "@ai16z/eliza";
import { ClientBase } from "./base";
import { buildConversationThread, sendTweet, wait } from "./utils.ts";

const twitterSearchTemplate =
    `{{timeline}}

{{providers}}

Recent interactions between {{agentName}} and other users:
{{recentPostInteractions}}

About {{agentName}} (@{{twitterUserName}}):
{{bio}}
{{topics}}

{{postDirections}}

{{recentPosts}}

# Task: Respond to the following post in the style and perspective of {{agentName}} (aka @{{twitterUserName}}). Write a {{adjective}} response for {{agentName}} to say directly in response to the post. don't generalize.

Feel free to share your thoughts, opinions, advice or open a discussion, as these are more engaging than just stating facts.
Be creative and engaging. Avoid repeating the same opening words from previous interactions that you've made. Vary in your style, wording, content, and tone to keep content fresh, interesting, and engaging.
Don't over advertise ourselves, our products, or services, sneakily providing our core values, goals, and information in a normal, human-like Twitter interaction.
Don't mention the name ToknMinds too much, focus on the benefits and features.
Interact like you are a friend, NOT a salesperson! Be casual and friendly. Don't be too formal. Don't be too casual.
You can refer to yourself as "I" or "me" and the user as "you" or "your", but you don't have to.

{{currentPost}}

IMPORTANT: Your response CANNOT be longer than 2 sentence or 25 words with max 280 characters.
Aim for 1 sentence (5 to 7 words), sometimes try to use emoji, but not really necessary.
` + messageCompletionFooter;

// const twitterSearchTemplate =
//     `
// # About {{agentName}} (@{{twitterUserName}}):
// Bio:
// {{bio}}

// Lore:
// {{lore}}

// Topic:
// {{topics}}

// Providers:
// {{providers}}

// Post Examples:
// {{characterPostExamples}}

// Post Directions:
// {{postDirections}}

// Message Examples:
// {{characterMessageExamples}}

// Message Directions:
// {{messageDirections}}

// ---SEPARATOR---

// {{timeline}}

// Recent interactions between {{agentName}} and other users:
// {{recentPostInteractions}}

// {{recentPosts}}

// # Task: Respond to the following post in the style and perspective of {{agentName}} (aka @{{twitterUserName}}). Write a {{adjective}} response for {{agentName}} to say directly in response to the post. don't generalize.

// Feel free to share your thoughts, opinions, advice or open a discussion, as these are more engaging than just stating facts.
// Be creative and engaging. Avoid repeating the same opening words from previous interactions that you've made. Vary in your style, wording, content, and tone to keep content fresh, interesting, and engaging.
// Don't over advertise ourselves, our products, or services, sneakily providing our core values, goals, and information in a normal, human-like Twitter interaction.
// Don't mention the name LibriX too much, focus on the benefits and features.
// Interact like you are a friend, NOT a salesperson! Be casual and friendly. Don't be too formal. Don't be too casual.
// You can refer to yourself as "I" or "me" and the user as "you" or "your", but you don't have to.
// {{currentPost}}

// IMPORTANT: Your response CANNOT be longer than 30 words.
// Aim for 1-3 sentences maximum. Be direct but easy to understand and engaging.

// Your response should not contain any questions. Make it brief, concise, human-like response.
// No emojis.
// ` + messageCompletionFooter;

export class TwitterSearchClient {
    client: ClientBase;
    runtime: IAgentRuntime;
    twitterUsername: string;
    respondedTweets: Set<string>;

    constructor(client: ClientBase, runtime: IAgentRuntime) {
        this.client = client;
        this.runtime = runtime;
        this.twitterUsername = runtime.getSetting("TWITTER_USERNAME");
        this.respondedTweets = new Set();
        elizaLogger.log(
            "TwitterSearchClient instantiated with username:",
            this.twitterUsername
        );
    }

    async start() {
        elizaLogger.log("Initializing Twitter search loop...");

        const handleSearchLoop = () => {
            elizaLogger.log("Executing search loop...");
            this.engageWithSearchTerms();
            const waitTime =
                // (Math.floor(Math.random() * (10 - 5 + 1)) + 5) * 60 * 1000; // 5-10 minutes
                (Math.floor(Math.random() * (30 - 15 + 1)) + 5) * 60 * 1000; // 15-30 minutes
            // (Math.floor(Math.random() * (10 - 5 + 1)) + 5) * 60 * 1000; // 5-10 minutes
            // (Math.floor(Math.random() * (120 - 60 + 1)) + 60) * 60 * 1000; // 60-120 minutes
            // (Math.floor(Math.random() * (90 - 60 + 1)) + 60) * 60 * 1000; // 60-90 minutes
            elizaLogger.log(
                `Next search will be in ${waitTime / 1000 / 60} minutes.`
            );
            setTimeout(handleSearchLoop, waitTime);
        };

        handleSearchLoop();
    }

    private async engageWithSearchTerms() {
        try {
            // const searchTerm = [...this.runtime.character.topics][
            //     Math.floor(Math.random() * this.runtime.character.topics.length)
            // ];

            // Make searchTerm from randomly selected 4 topics from the character topics list all fours as a string in this format: "(<item1> OR <item2> OR <item3> OR <item4>)"
            const searchTerm = [...this.runtime.character.topics]
                .sort(() => Math.random() - 0.5)
                .slice(0, 4)
                .map((topic) => `(${topic})`)
                .join(" OR ")
                .replace(/^(.*)$/, "($1)");

            elizaLogger.log("Search term:", searchTerm);

            const [currentDate, previousDate] = [new Date(), new Date()];
            const MAX_TWEETS = 15;
            previousDate.setDate(currentDate.getDate() - 1);

            const searchQuery = `${searchTerm} until:${currentDate.toISOString().split("T")[0]} since:${previousDate.toISOString().split("T")[0]} AND place_country:US`;
            // const searchQuery = searchTerm + " lang:en" + " place_country:PH";
            // // const searchQuery = searchTerm + " place_country:PH";
            /*const searchQuery =
                searchTerm +
                " (place_country:PH OR place_country:ID OR place_country:TH)"; // Use the 2-letter ISO country code*/
            /*const searchQuery =
                searchTerm +
                " ((place_country:PH OR place_country:ID OR place_country:TH) OR" +
                ' (bio:entrepreneur OR bio:"business owner" OR bio:founder OR bio:CEO OR bio:"Managing Director"))';*/
            /*const searchQuery =
                searchTerm +
                " ((place_country:PH OR place_country:ID OR place_country:TH) OR" +
                ' (bio:Crypto OR bio:Blockchain OR bio:Web3 OR bio:DeFi OR bio:DAO OR bio:NFT OR bio:Decentralization OR bio:Bitcoin OR bio:Ethereum OR bio:AI OR bio:"Machine Learning" OR bio:"Artificial Intelligence"))';*/
            /*const searchQuery =
                searchTerm +
                ' OR (bio:Crypto OR bio:Blockchain OR bio:Web3 OR bio:DeFi OR bio:DAO OR bio:NFT OR bio:Decentralization OR bio:Bitcoin OR bio:Ethereum OR bio:AI OR bio:"Machine Learning" OR bio:"Artificial Intelligence")';*/
            /*
            NOTE: this is INCLUSIVE (mathematical) OR, nor EXCLUSIVE OR in human natural language.
            (Found_Country_Result OR Found_in_Bio_Result)
            T OR T: T
            T OR F: T
            F OR T: T
            F OR F: F

            -- INCLUSIVE AND --
            T AND T: T
            T AND F: F
            F AND T: F
            F AND F: F
            */
            // const searchQuery = searchTerm + "AND place_country:US"; // Use 2-letter ISO alpha-2 country code
            // const searchQuery = searchTerm + " place_country:US"; // Use 2-letter ISO alpha-2 country code
            /*const searchQuery =
                searchTerm +
                " ((place_country:US) OR" +
                ' (bio:entrepreneur OR bio:"business owner" OR bio:founder OR bio:CEO OR bio:"Managing Director"))';*/
            /*
            NOTE: this is INCLUSIVE (mathematical) OR, not EXCLUSIVE OR in human natural language.
            (Found_Country_Result OR Found_in_Bio_Result)
            T OR T: T
            T OR F: T
            F OR T: T
            F OR F: F

            INCLUSIVE AND
            T AND T: T
            T AND F: F
            F AND T: F
            F AND F: F
            */

            // TODO: we wait 5 seconds here to avoid getting rate limited on startup, but we should queue
            await new Promise((resolve) => setTimeout(resolve, 5000));
            const recentTweets = await this.client.fetchSearchTweets(
                searchQuery,
                MAX_TWEETS,
                SearchMode.Top
            );

            const homeTimeline = await this.client.fetchHomeTimeline(25);

            await this.client.cacheTimeline(homeTimeline);

            const formattedHomeTimeline =
                `# ${this.runtime.character.name}'s Home Timeline\n\n` +
                homeTimeline
                    .map((tweet) => {
                        return `ID: ${tweet.id}\nFrom: ${tweet.name} (@${tweet.username})${tweet.inReplyToStatusId ? ` In reply to: ${tweet.inReplyToStatusId}` : ""}\nText: ${tweet.text}\n---\n`;
                    })
                    .join("\n");

            // randomly slice .tweets down to MAX_TWEETS
            // randomly slice .tweets down to MAX_TWEETS
            const slicedTweets = recentTweets.tweets
                .sort(() => Math.random() - 0.5)
                .slice(0, MAX_TWEETS);

            if (slicedTweets.length === 0) {
                console.log(
                    "No valid tweets found for the search query",
                    // searchTerm
                    searchQuery
                );
                return;
            }

            const prompt = `
              Here are some tweets related to the search term "${searchTerm}":

              ${[...slicedTweets, ...homeTimeline]
                  .filter((tweet) => {
                      // ignore tweets where any of the thread tweets contain a tweet by the bot
                      const thread = tweet.thread;
                      const botTweet = thread.find(
                          (t) => t.username === this.twitterUsername
                      );
                      return !botTweet;
                  })
                  .map(
                      (tweet) => `
                ID: ${tweet.id}${tweet.inReplyToStatusId ? ` In reply to: ${tweet.inReplyToStatusId}` : ""}
                From: ${tweet.name} (@${tweet.username})
                Text: ${tweet.text}
              `
                  )
                  .join("\n")}

  Which tweet is the most interesting and relevant for us to reply to? Please provide only the ID of the tweet in your response.
  Notes:
    - Respond to English tweets only
    - Respond to tweets that don't have a lot of hashtags, links, URLs or images
    - Respond to tweets that are not retweets
    - Respond to tweets that has not been replied by us before.
    - Respond to tweets where there is an easy exchange of ideas to have with the user
    - ONLY respond to tweets where it's not from: TokenMinds (@tokenminds_co)
    - ONLY respond to tweets where it's not been replied by TokenMinds (@tokenminds_co)
    - ONLY respond with the ID of the tweet`;

            const mostInterestingTweetResponse = await generateText({
                runtime: this.runtime,
                context: prompt,
                // modelClass: ModelClass.SMALL,
                modelClass: ModelClass.MEDIUM,
            });

            const tweetId =
                mostInterestingTweetResponse.match(/\d+/)?.[0] || "";
            console.log("Extracted tweet ID:", tweetId);
            if (!tweetId) {
                console.log(
                    "No valid tweet ID extracted from response:",
                    mostInterestingTweetResponse
                );
                return;
            }

            const selectedTweet = slicedTweets.find(
                (tweet) =>
                    tweet.id.toString().includes(tweetId) ||
                    tweetId.includes(tweet.id.toString())
            );

            if (!selectedTweet) {
                console.log("No matching tweet found for the selected ID");
                return console.log("Selected tweet ID:", tweetId);
            }

            console.log("Selected tweet to reply to:", selectedTweet?.text);

            if (selectedTweet.username === this.twitterUsername) {
                console.log("Skipping tweet from bot itself");
                return;
            }

            // Check if the tweet has already been replied to
            const existingResponse =
                await this.runtime.messageManager.getMemoryById(
                    stringToUuid(selectedTweet.id + "-" + this.runtime.agentId)
                );

            if (
                existingResponse ||
                this.respondedTweets.has(selectedTweet.id)
            ) {
                console.log(
                    `Skipping already replied tweet: ${selectedTweet.id}`
                );
                return;
            }

            const conversationId = selectedTweet.conversationId;
            const roomId = stringToUuid(
                conversationId + "-" + this.runtime.agentId
            );

            const userIdUUID = stringToUuid(selectedTweet.userId as string);

            await this.runtime.ensureConnection(
                userIdUUID,
                roomId,
                selectedTweet.username,
                selectedTweet.name,
                "twitter"
            );

            // crawl additional conversation tweets, if there are any
            await buildConversationThread(selectedTweet, this.client);

            const message = {
                id: stringToUuid(selectedTweet.id + "-" + this.runtime.agentId),
                agentId: this.runtime.agentId,
                content: {
                    text: selectedTweet.text,
                    url: selectedTweet.permanentUrl,
                    inReplyTo: selectedTweet.inReplyToStatusId
                        ? stringToUuid(
                              selectedTweet.inReplyToStatusId +
                                  "-" +
                                  this.runtime.agentId
                          )
                        : undefined,
                },
                userId: userIdUUID,
                roomId,
                // Timestamps are in seconds, but we need them in milliseconds
                createdAt: selectedTweet.timestamp * 1000,
            };

            if (!message.content.text) {
                return { text: "", action: "IGNORE" };
            }

            // Fetch replies and retweets
            const replies = selectedTweet.thread;
            const replyContext = replies
                .filter((reply) => reply.username !== this.twitterUsername)
                .map((reply) => `@${reply.username}: ${reply.text}`)
                .join("\n");

            let tweetBackground = "";
            if (selectedTweet.isRetweet) {
                const originalTweet = await this.client.requestQueue.add(() =>
                    this.client.twitterClient.getTweet(selectedTweet.id)
                );
                tweetBackground = `Retweeting @${originalTweet.username}: ${originalTweet.text}`;
            }

            // Generate image descriptions using GPT-4 vision API
            const imageDescriptions = [];
            for (const photo of selectedTweet.photos) {
                const description = await this.runtime
                    .getService<IImageDescriptionService>(
                        ServiceType.IMAGE_DESCRIPTION
                    )
                    .describeImage(photo.url);
                imageDescriptions.push(description);
            }

            let state = await this.runtime.composeState(message, {
                twitterClient: this.client.twitterClient,
                twitterUserName: this.twitterUsername,
                timeline: formattedHomeTimeline,
                tweetContext: `${tweetBackground}

              Original Post:
              By @${selectedTweet.username}
              ${selectedTweet.text}${replyContext.length > 0 && `\nReplies to original post:\n${replyContext}`}
              ${`Original post text: ${selectedTweet.text}`}
              ${selectedTweet.urls.length > 0 ? `URLs: ${selectedTweet.urls.join(", ")}\n` : ""}${imageDescriptions.length > 0 ? `\nImages in Post (Described): ${imageDescriptions.join(", ")}\n` : ""}
              `,
            });

            await this.client.saveRequestMessage(message, state as State);

            const context = composeContext({
                state,
                template:
                    this.runtime.character.templates?.twitterSearchTemplate ||
                    twitterSearchTemplate,
            });

            const responseContent = await generateMessageResponse({
                runtime: this.runtime,
                context,
                modelClass: ModelClass.LARGE,
            });

            responseContent.inReplyTo = message.id;

            const response = responseContent;

            if (!response.text) {
                console.log("Returning: No response text found");
                return;
            }

            console.log(
                `Bot would respond to tweet ${selectedTweet.id} with: ${response.text}`
            );

            try {
                const callback: HandlerCallback = async (response: Content) => {
                    const memories = await sendTweet(
                        this.client,
                        response,
                        message.roomId,
                        this.twitterUsername,
                        tweetId
                    );
                    return memories;
                };

                const responseMessages = await callback(responseContent);

                state = await this.runtime.updateRecentMessageState(state);

                for (const responseMessage of responseMessages) {
                    await this.runtime.messageManager.createMemory(
                        responseMessage,
                        false
                    );
                }

                state = await this.runtime.updateRecentMessageState(state);

                await this.runtime.evaluate(message, state);

                await this.runtime.processActions(
                    message,
                    responseMessages,
                    state,
                    callback
                );

                // Add the tweet ID to the set of responded tweets
                this.respondedTweets.add(selectedTweet.id);

                const responseInfo = `Context:\n\n${context}\n\nSelected Post: ${selectedTweet.id} - ${selectedTweet.username}: ${selectedTweet.text}\nAgent's Output:\n${response.text}`;

                await this.runtime.cacheManager.set(
                    `twitter/tweet_generation_${selectedTweet.id}.txt`,
                    responseInfo
                );

                await wait();
            } catch (error) {
                console.error(`Error sending response post: ${error}`);
            }
        } catch (error) {
            console.error("Error engaging with search terms:", error);
        }
    }
}
