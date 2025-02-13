import bodyParser from "body-parser";
import cors from "cors";
import express, { Request as ExpressRequest } from "express";
import multer from "multer";
import {
    elizaLogger,
    generateCaption,
    generateImage,
    Media,
    MemoryManager,
} from "@ai16z/eliza";
import { composeContext } from "@ai16z/eliza";
import { generateMessageResponse } from "@ai16z/eliza";
import { messageCompletionFooter } from "@ai16z/eliza";
import { AgentRuntime } from "@ai16z/eliza";
import {
    Content,
    Memory,
    ModelClass,
    Client,
    IAgentRuntime,
} from "@ai16z/eliza";
import { stringToUuid } from "@ai16z/eliza";
import { settings } from "@ai16z/eliza";
import { createApiRouter } from "./api.ts";
import { Server } from "http";
import * as fs from "fs";
import * as path from "path";
import { validateUUIDWithResponse } from "./utils.ts";

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const uploadDir = path.join(process.cwd(), "data", "uploads");
        // Create the directory if it doesn't exist
        if (!fs.existsSync(uploadDir)) {
            fs.mkdirSync(uploadDir, { recursive: true });
        }
        cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
        cb(null, `${uniqueSuffix}-${file.originalname}`);
    },
});

const upload = multer({ storage });

export const messageHandlerTemplate =
    // {{goals}}
    `# Action Examples
{{actionExamples}}
(Action examples are for reference only. Do not use the information from them in your response.)

# Knowledge
{{knowledge}}

# Task: Generate dialog and actions for the character {{agentName}}.
About {{agentName}}:
{{bio}}
{{lore}}

{{providers}}

{{attachments}}

# Capabilities
Note that {{agentName}} is capable of reading/seeing/hearing various forms of media, including images, videos, audio, plaintext and PDFs. Recent attachments have been included above under the "Attachments" section.

{{messageDirections}}

{{recentMessages}}

{{actions}}

# Instructions: Write the next message for {{agentName}}.
` + messageCompletionFooter;

export class DirectClient {
    public app: express.Application;
    private agents: Map<string, AgentRuntime>;
    private server: Server; // Store server instance

    constructor() {
        elizaLogger.log("DirectClient constructor");
        this.app = express();
        this.app.use(cors());
        this.agents = new Map();

        this.app.use(bodyParser.json());
        this.app.use(bodyParser.urlencoded({ extended: true }));

        const apiRouter = createApiRouter(this.agents);
        this.app.use(apiRouter);

        // Define an interface that extends the Express Request interface
        interface CustomRequest extends ExpressRequest {
            file: Express.Multer.File;
        }

        // Update the route handler to use CustomRequest instead of express.Request
        this.app.post(
            "/:agentId/whisper",
            upload.single("file"),
            async (req: CustomRequest, res: express.Response) => {
                const agentId = validateUUIDWithResponse(
                    req.params.agentId,
                    res,
                    "AgentId"
                );
                if (!agentId) return;
                const audioFile = req.file; // Access the uploaded file using req.file

                if (!audioFile) {
                    res.status(400).json({
                        error: "No audio file provided",
                    });
                    return;
                }

                let runtime = this.agents.get(agentId);

                // if runtime is null, look for runtime with the same name
                if (!runtime) {
                    runtime = Array.from(this.agents.values()).find(
                        (a) =>
                            a.character.name.toLowerCase() ===
                            agentId.toLowerCase()
                    );
                }

                if (!runtime) {
                    res.status(404).json({
                        error: "Agent not found",
                    });
                    return;
                }

                const formData = new FormData();
                const audioBlob = new Blob([audioFile.buffer], {
                    type: audioFile.mimetype,
                });
                formData.append("file", audioBlob, audioFile.originalname);
                formData.append("model", "whisper-1");

                const response = await fetch(
                    "https://api.openai.com/v1/audio/transcriptions",
                    {
                        method: "POST",
                        headers: {
                            Authorization: `Bearer ${runtime.token}`,
                        },
                        body: formData,
                    }
                );

                const data = await response.json();
                res.json(data);
            }
        );

        this.app.post(
            "/:agentId/message",
            upload.single("file"),
            async (req: express.Request, res: express.Response) => {
                elizaLogger.info("Request body:", req.body);
                const agentId = validateUUIDWithResponse(
                    req.params.agentId,
                    res,
                    "AgentId"
                );
                if (!agentId) return;
                const roomId = stringToUuid(
                    req.body.roomId ?? "default-room-" + agentId
                );
                const userId = stringToUuid(req.body.userId ?? "user");

                let runtime = this.agents.get(agentId);
                // if runtime is null, look for runtime with the same name
                if (!runtime) {
                    runtime = Array.from(this.agents.values()).find(
                        (a) =>
                            a.character.name.toLowerCase() ===
                            agentId.toLowerCase()
                    );
                }

                if (!runtime) {
                    res.status(404).json({
                        error: "Agent not found",
                    });
                    return;
                }

                await runtime.ensureConnection(
                    userId,
                    roomId,
                    req.body.userName,
                    req.body.name,
                    "direct"
                );

                const memoryManager = new MemoryManager({
                    runtime,
                    tableName: "messages",
                });

                const isNew = await memoryManager
                    .countMemories(roomId)
                    .then((count) => count === 0);

                const text = req.body.text;
                const messageId = stringToUuid(Date.now().toString());

                const attachments: Media[] = [];
                if (req.file) {
                    const filePath = path.join(
                        process.cwd(),
                        "data",
                        "uploads",
                        req.file.filename
                    );
                    attachments.push({
                        id: stringToUuid(Date.now().toString()),
                        url: filePath,
                        title: req.file.originalname,
                        source: "direct",
                        description: `Uploaded file ${req.file.originalname}`,
                        text: "",
                    });
                }

                const content: Content = {
                    text,
                    attachments,
                    source: "direct",
                    inReplyTo: undefined,
                };

                const userMessage = {
                    content,
                    userId,
                    agentId: runtime.agentId,
                    roomId,
                };

                const memory: Memory = {
                    id: messageId,
                    ...userMessage,
                    agentId: runtime.agentId,
                    userId,
                    roomId,
                    content,
                    createdAt: Date.now(),
                };

                if (content.text) {
                    await runtime.messageManager.addEmbeddingToMemory(memory);
                    await runtime.messageManager.createMemory(memory);
                }

                const state = await runtime.composeState(userMessage, {
                    agentName: runtime.character.name,
                });

                const context = composeContext({
                    state,
                    template: messageHandlerTemplate,
                });

                const response = await generateMessageResponse({
                    runtime: runtime,
                    context,
                    modelClass: ModelClass.LARGE,
                });

                // save response to memory
                const responseMessage: Memory = {
                    ...userMessage,
                    id: stringToUuid(Date.now().toString()),
                    userId: runtime.agentId,
                    content: response,
                    createdAt: Date.now(),
                };

                if (response.text) {
                    await runtime.messageManager.addEmbeddingToMemory(
                        responseMessage
                    );
                    await runtime.messageManager.createMemory(responseMessage);
                }

                if (!response) {
                    res.status(500).json({
                        error: "Failed to generate response",
                    });
                    return;
                }

                let message = null as Content | null;
                let messageMemmory = null as Memory | null;
                const responseId = stringToUuid(Date.now().toString());
                const responseCreatedAt = Date.now();

                await runtime.evaluate(memory, state);

                await runtime.processActions(
                    memory,
                    [responseMessage],
                    state,
                    async (newMessages) => {
                        message = newMessages;
                        messageMemmory = {
                            agentId: runtime.agentId,
                            userId: runtime.agentId,
                            roomId,
                            id: responseId,
                            createdAt: responseCreatedAt,
                            content: message,
                        };

                        await runtime.messageManager.addEmbeddingToMemory(
                            messageMemmory
                        );
                        await runtime.messageManager.createMemory(
                            messageMemmory
                        );

                        return [memory];
                    }
                );

                if (message) {
                    res.json({
                        isNew,
                        response: {
                            id: responseId,
                            agentId: runtime.agentId,
                            userId: runtime.agentId,
                            roomId,
                            createdAt: responseCreatedAt,
                            content: message,
                        },
                        message: messageMemmory,
                    });
                } else {
                    res.json({
                        isNew,
                        response: {
                            id: responseMessage.id,
                            agentId: runtime.agentId,
                            userId: runtime.agentId,
                            roomId,
                            createdAt: responseCreatedAt,
                            content: response,
                        },
                    });
                }
            }
        );

        this.app.post(
            "/:agentId/image",
            async (req: express.Request, res: express.Response) => {
                const agentId = validateUUIDWithResponse(
                    req.params.agentId,
                    res,
                    "AgentId"
                );
                if (!agentId) return;
                const agent = this.agents.get(agentId);
                if (!agent) {
                    res.status(404).json({
                        error: "Agent not found",
                    });
                    return;
                }

                const images = await generateImage({ ...req.body }, agent);
                const imagesRes: { image: string; caption: string }[] = [];
                if (images.data && images.data.length > 0) {
                    for (let i = 0; i < images.data.length; i++) {
                        const caption = await generateCaption(
                            { imageUrl: images.data[i] },
                            agent
                        );
                        imagesRes.push({
                            image: images.data[i],
                            caption: caption.title,
                        });
                    }
                }
                res.json({ images: imagesRes });
            }
        );

        this.app.get(
            "/:agentId/chat",
            async (req: express.Request, res: express.Response) => {
                const agentId = validateUUIDWithResponse(
                    req.params.agentId,
                    res,
                    "AgentId"
                );
                if (!agentId) return;
                const roomId = validateUUIDWithResponse(
                    req.query.roomId,
                    res,
                    "RoomId"
                );
                if (!roomId) return;
                const start = parseInt(req.query.start as string) || 0;
                const end = parseInt(req.query.end as string) || Date.now();
                const count = parseInt(req.query.count as string) || 10;

                let runtime = this.agents.get(agentId);
                // if runtime is null, look for runtime with the same name
                if (!runtime) {
                    runtime = Array.from(this.agents.values()).find(
                        (a) =>
                            a.character.name.toLowerCase() ===
                            agentId.toLowerCase()
                    );
                }

                if (!runtime) {
                    res.status(404).json({
                        error: "Agent not found",
                    });
                    return;
                }

                const memoryManager = new MemoryManager({
                    runtime,
                    tableName: "messages",
                });

                const memories = await memoryManager.getMemories({
                    roomId,
                    count,
                    start,
                    end,
                    unique: true,
                });

                res.json(
                    memories.map((m) => {
                        return {
                            id: m.id,
                            agentId: m.agentId,
                            userId: m.userId,
                            content: {
                                text: m.content.text,
                                action: m.content.action,
                                source: m.content.source,
                                url: m.content.url,
                                inReplyTo: m.content.inReplyTo,
                                attachments: m.content.attachments?.map(
                                    (attachment) => ({
                                        id: attachment.id,
                                        url: attachment.url,
                                        title: attachment.title,
                                        source: attachment.source,
                                        description: attachment.description,
                                        text: attachment.text,
                                    })
                                ),
                            },
                            roomId: m.roomId,
                            unique: m.unique,
                            createdAt: m.createdAt,
                        };
                    })
                );
            }
        );

        this.app.get(
            "/:agentId/chat/:chatId",
            async (req: express.Request, res: express.Response) => {
                const agentId = validateUUIDWithResponse(
                    req.params.agentId,
                    res,
                    "AgentId"
                );
                if (!agentId) return;
                const chatId = validateUUIDWithResponse(
                    req.params.chatId,
                    res,
                    "ChatId"
                );
                if (!chatId) return;

                let runtime = this.agents.get(agentId);
                // if runtime is null, look for runtime with the same name
                if (!runtime) {
                    runtime = Array.from(this.agents.values()).find(
                        (a) =>
                            a.character.name.toLowerCase() ===
                            agentId.toLowerCase()
                    );
                }

                if (!runtime) {
                    res.status(404).json({
                        error: "Agent not found",
                    });
                    return;
                }

                const memoryManager = new MemoryManager({
                    runtime,
                    tableName: "messages",
                });

                const chatDetails = await memoryManager.getMemoryById(chatId);
                res.json(chatDetails);
            }
        );

        this.app.delete(
            "/:agentId/rooms",
            async (req: express.Request, res: express.Response) => {
                const agentId = validateUUIDWithResponse(
                    req.params.agentId,
                    res,
                    "AgentId"
                );
                if (!agentId) return;
                const userId = validateUUIDWithResponse(
                    req.query.userId,
                    res,
                    "UserId"
                );
                if (!userId) return;
                const roomId = validateUUIDWithResponse(
                    req.query.roomId,
                    res,
                    "RoomId"
                );
                if (!roomId) return;

                let runtime = this.agents.get(agentId);

                if (!runtime) {
                    runtime = Array.from(this.agents.values()).find(
                        (a) =>
                            a.character.name.toLowerCase() ===
                            agentId.toLowerCase()
                    );
                }

                if (!runtime) {
                    res.status(404).json({
                        error: "Agent not found",
                    });
                    return;
                }

                const memoryManager = new MemoryManager({
                    runtime,
                    tableName: "messages",
                });

                const isExists = await memoryManager
                    .countMemories(roomId)
                    .then((count) => count > 0);

                if (!isExists) {
                    res.status(404).json({
                        error: "Room not found",
                    });
                    return;
                }

                if (userId === runtime.agentId) {
                    res.status(403).json({
                        error: "Agent cannot delete room",
                    });
                    return;
                }

                const isBelongsToCurrentUser = await runtime.databaseAdapter
                    .getRoomsForParticipant(userId)
                    .then((rooms) => rooms.includes(roomId));
                if (!isBelongsToCurrentUser) {
                    res.status(403).json({
                        error: "Room does not belong to the user",
                    });
                    return;
                }

                await memoryManager.removeAllMemories(roomId);

                res.json({ success: true });
            }
        );

        this.app.get(
            "/:agentId/rooms",
            async (req: express.Request, res: express.Response) => {
                const agentId = validateUUIDWithResponse(
                    req.params.agentId,
                    res,
                    "AgentId"
                );
                if (!agentId) return;
                const userId = validateUUIDWithResponse(
                    req.query.userId,
                    res,
                    "UserId"
                );
                if (!userId) return;

                let runtime = this.agents.get(agentId);

                if (!runtime) {
                    runtime = Array.from(this.agents.values()).find(
                        (a) =>
                            a.character.name.toLowerCase() ===
                            agentId.toLowerCase()
                    );
                }

                if (!runtime) {
                    res.status(404).json({
                        error: "Agent not found",
                    });
                    return;
                }

                const roomIds =
                    await runtime.databaseAdapter.getRoomsForParticipant(
                        userId
                    );
                res.json(roomIds);
            }
        );

        this.app.post(
            "/fine-tune",
            async (req: express.Request, res: express.Response) => {
                try {
                    const response = await fetch(
                        "https://api.bageldb.ai/api/v1/asset",
                        {
                            method: "POST",
                            headers: {
                                "Content-Type": "application/json",
                                "X-API-KEY": `${process.env.BAGEL_API_KEY}`,
                            },
                            body: JSON.stringify(req.body),
                        }
                    );

                    const data = await response.json();
                    res.json(data);
                } catch (error) {
                    res.status(500).json({
                        error: "Please create an account at bakery.bagel.net and get an API key. Then set the BAGEL_API_KEY environment variable.",
                        details: error.message,
                    });
                }
            }
        );

        this.app.get(
            "/fine-tune/:assetId",
            async (req: express.Request, res: express.Response) => {
                const assetId = req.params.assetId;
                const downloadDir = path.join(
                    process.cwd(),
                    "downloads",
                    assetId
                );

                console.log("Download directory:", downloadDir);

                try {
                    console.log("Creating directory...");
                    await fs.promises.mkdir(downloadDir, { recursive: true });

                    console.log("Fetching file...");
                    const fileResponse = await fetch(
                        `https://api.bageldb.ai/api/v1/asset/${assetId}/download`,
                        {
                            headers: {
                                "X-API-KEY": `${process.env.BAGEL_API_KEY}`,
                            },
                        }
                    );

                    if (!fileResponse.ok) {
                        throw new Error(
                            `API responded with status ${fileResponse.status}: ${await fileResponse.text()}`
                        );
                    }

                    console.log("Response headers:", fileResponse.headers);

                    const fileName =
                        fileResponse.headers
                            .get("content-disposition")
                            ?.split("filename=")[1]
                            ?.replace(/"/g, "") || "default_name.txt";

                    console.log("Saving as:", fileName);

                    const arrayBuffer = await fileResponse.arrayBuffer();
                    const buffer = Buffer.from(arrayBuffer);

                    const filePath = path.join(downloadDir, fileName);
                    console.log("Full file path:", filePath);

                    await fs.promises.writeFile(filePath, buffer);

                    // Verify file was written
                    const stats = await fs.promises.stat(filePath);
                    console.log(
                        "File written successfully. Size:",
                        stats.size,
                        "bytes"
                    );

                    res.json({
                        success: true,
                        message: "Single file downloaded successfully",
                        downloadPath: downloadDir,
                        fileCount: 1,
                        fileName: fileName,
                        fileSize: stats.size,
                    });
                } catch (error) {
                    console.error("Detailed error:", error);
                    res.status(500).json({
                        error: "Failed to download files from BagelDB",
                        details: error.message,
                        stack: error.stack,
                    });
                }
            }
        );
    }

    public registerAgent(runtime: AgentRuntime) {
        this.agents.set(runtime.agentId, runtime);
    }

    public unregisterAgent(runtime: AgentRuntime) {
        this.agents.delete(runtime.agentId);
    }

    public start(port: number) {
        this.server = this.app.listen(port, () => {
            elizaLogger.success(`Server running at http://localhost:${port}/`);
        });

        // Handle graceful shutdown
        const gracefulShutdown = () => {
            elizaLogger.log("Received shutdown signal, closing server...");
            this.server.close(() => {
                elizaLogger.success("Server closed successfully");
                process.exit(0);
            });

            // Force close after 5 seconds if server hasn't closed
            setTimeout(() => {
                elizaLogger.error(
                    "Could not close connections in time, forcefully shutting down"
                );
                process.exit(1);
            }, 5000);
        };

        // Handle different shutdown signals
        process.on("SIGTERM", gracefulShutdown);
        process.on("SIGINT", gracefulShutdown);
    }

    public stop() {
        if (this.server) {
            this.server.close(() => {
                elizaLogger.success("Server stopped");
            });
        }
    }
}

export const DirectClientInterface: Client = {
    start: async (_runtime: IAgentRuntime) => {
        elizaLogger.log("DirectClientInterface start");
        const client = new DirectClient();
        const serverPort = parseInt(settings.SERVER_PORT || "3000");
        elizaLogger.log("Starting server on port", serverPort);
        client.start(serverPort);
        return client;
    },
    stop: async (_runtime: IAgentRuntime, client?: any) => {
        if (client instanceof DirectClient) {
            client.stop();
        }
    },
};

export default DirectClientInterface;
