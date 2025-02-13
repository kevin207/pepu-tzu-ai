// OD: trying to implement discord logging
//
//
//
// import { Client, TextChannel } from "discord.js";
// import { elizaLogger, ElizaLogger } from "./logger";

// const client = new Client({ intents: [] }); // Initialize your Discord client
// const logChannelId = process.env.DISCORD_LOG_CHANNEL_ID; // Add this to your .env file

// async function sendLogToDiscord(message: string) {
//     const channel = client.channels.cache.get(logChannelId) as TextChannel;
//     if (channel) {
//         await channel.send(message);
//     } else {
//         console.error("Log channel not found");
//     }
// }

// class ExtendedLogger extends ElizaLogger {
//     async log(...args: any[]) {
//         super.log(...args);
//         await sendLogToDiscord(args.join(" "));
//     }

//     async error(...args: any[]) {
//         super.error(...args);
//         await sendLogToDiscord(args.join(" "));
//     }

//     async info(...args: any[]) {
//         super.info(...args);
//         await sendLogToDiscord(args.join(" "));
//     }

//     async debug(...args: any[]) {
//         super.debug(...args);
//         await sendLogToDiscord(args.join(" "));
//     }

//     async success(...args: any[]) {
//         super.success(...args);
//         await sendLogToDiscord(args.join(" "));
//     }

//     async assert(...args: any[]) {
//         super.assert(...args);
//         await sendLogToDiscord(args.join(" "));
//     }

//     async progress(message: string) {
//         super.progress(message);
//         await sendLogToDiscord(message);
//     }
// }

// client.login(process.env.DISCORD_API_TOKEN); // Add this to your .env file

// export const extendedLogger = new ExtendedLogger();
