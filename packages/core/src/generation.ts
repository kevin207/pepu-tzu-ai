import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createGroq } from "@ai-sdk/groq";
import { createOpenAI } from "@ai-sdk/openai";
import { RecursiveCharacterTextSplitter } from "langchain/text_splitter";
import {
    generateObject as aiGenerateObject,
    generateText as aiGenerateText,
    GenerateObjectResult,
} from "ai";
import { Buffer } from "buffer";
import { createOllama } from "ollama-ai-provider";
import OpenAI from "openai";
import { encodingForModel, TiktokenModel } from "js-tiktoken";
import Together from "together-ai";
import { ZodSchema } from "zod";
import { elizaLogger } from "./index.ts";
import { getModel, models } from "./models.ts";
import {
    parseBooleanFromText,
    parseJsonArrayFromText,
    parseJSONObjectFromText,
    parseShouldRespondFromText,
} from "./parsing.ts";
import settings from "./settings.ts";
import {
    Content,
    IAgentRuntime,
    IImageDescriptionService,
    ITextGenerationService,
    ModelClass,
    ModelProviderName,
    ServiceType,
    SearchResponse,
} from "./types.ts";
import { fal } from "@fal-ai/client";

/**
 * Send a message to the model for a text generateText - receive a string back and parse how you'd like
 * @param opts - The options for the generateText request.
 * @param opts.context The context of the message to be completed.
 * @param opts.stop A list of strings to stop the generateText at.
 * @param opts.model The model to use for generateText.
 * @param opts.frequency_penalty The frequency penalty to apply to the generateText.
 * @param opts.presence_penalty The presence penalty to apply to the generateText.
 * @param opts.temperature The temperature to apply to the generateText.
 * @param opts.max_context_length The maximum length of the context to apply to the generateText.
 * @returns The completed message.
 */

const RETRY_DELAY = 1500;

export async function generateText({
    runtime,
    context,
    modelClass,
    stop,
}: {
    runtime: IAgentRuntime;
    context: string;
    modelClass: string;
    stop?: string[];
}): Promise<string> {
    if (!context) {
        console.error("generateText context is empty");
        return "";
    }

    const startTime = performance.now();
    elizaLogger.info("Generating text with options:", {
        modelProvider: runtime.modelProvider,
        model: modelClass,
    });

    const provider = runtime.modelProvider;
    const endpoint =
        runtime.character.modelEndpointOverride || models[provider].endpoint;
    let model = models[provider].model[modelClass];

    // if runtime.getSetting("LLAMACLOUD_MODEL_LARGE") is true and modelProvider is LLAMACLOUD, then use the large model
    if (
        (runtime.getSetting("LLAMACLOUD_MODEL_LARGE") &&
            provider === ModelProviderName.LLAMACLOUD) ||
        (runtime.getSetting("TOGETHER_MODEL_LARGE") &&
            provider === ModelProviderName.TOGETHER)
    ) {
        model =
            runtime.getSetting("LLAMACLOUD_MODEL_LARGE") ||
            runtime.getSetting("TOGETHER_MODEL_LARGE");
    }

    if (
        (runtime.getSetting("LLAMACLOUD_MODEL_SMALL") &&
            provider === ModelProviderName.LLAMACLOUD) ||
        (runtime.getSetting("TOGETHER_MODEL_SMALL") &&
            provider === ModelProviderName.TOGETHER)
    ) {
        model =
            runtime.getSetting("LLAMACLOUD_MODEL_SMALL") ||
            runtime.getSetting("TOGETHER_MODEL_SMALL");
    }

    elizaLogger.info("Selected model:", model);

    const temperature = models[provider].settings.temperature;
    const frequency_penalty = models[provider].settings.frequency_penalty;
    const presence_penalty = models[provider].settings.presence_penalty;
    const max_context_length = models[provider].settings.maxInputTokens;
    const max_response_length = models[provider].settings.maxOutputTokens;

    const apiKey = runtime.token;

    try {
        elizaLogger.debug(
            `Trimming context to max length of ${max_context_length} tokens.`
        );
        context = trimTokens(context, max_context_length, "gpt-4o");

        let response: string;
        let generationId: string;
        const agenticEnabled = runtime.getSetting("AGENTIC_ENABLED") ?? false;

        const _stop = stop || models[provider].settings.stop;
        elizaLogger.debug(
            `Using provider: ${provider}, model: ${model}, temperature: ${temperature}, max response length: ${max_response_length}`
        );

        switch (provider) {
            // OPENAI & LLAMACLOUD shared same structure.
            case ModelProviderName.OPENAI:
            case ModelProviderName.ETERNALAI:
            case ModelProviderName.ALI_BAILIAN:
            case ModelProviderName.VOLENGINE:
            case ModelProviderName.LLAMACLOUD:
            case ModelProviderName.TOGETHER: {
                elizaLogger.debug("Initializing OpenAI model.");
                const openai = createOpenAI({ apiKey, baseURL: endpoint });

                const { text: openaiResponse } = await aiGenerateText({
                    model: openai.languageModel(model),
                    prompt: context,
                    system:
                        runtime.character.system ??
                        settings.SYSTEM_PROMPT ??
                        undefined,
                    temperature: temperature,
                    maxTokens: max_response_length,
                    frequencyPenalty: frequency_penalty,
                    presencePenalty: presence_penalty,
                });

                response = openaiResponse;
                elizaLogger.debug("Received response from OpenAI model.");
                break;
            }

            case ModelProviderName.GOOGLE: {
                const google = createGoogleGenerativeAI();

                const { text: googleResponse } = await aiGenerateText({
                    model: google(model),
                    prompt: context,
                    system:
                        runtime.character.system ??
                        settings.SYSTEM_PROMPT ??
                        undefined,
                    temperature: temperature,
                    maxTokens: max_response_length,
                    frequencyPenalty: frequency_penalty,
                    presencePenalty: presence_penalty,
                });

                response = googleResponse;
                elizaLogger.debug("Received response from Google model.");
                break;
            }

            case ModelProviderName.ANTHROPIC: {
                elizaLogger.debug("Initializing Anthropic model.");

                const anthropic = createAnthropic({ apiKey });

                const { text: anthropicResponse } = await aiGenerateText({
                    model: anthropic.languageModel(model),
                    prompt: context,
                    system:
                        runtime.character.system ??
                        settings.SYSTEM_PROMPT ??
                        undefined,
                    temperature: temperature,
                    maxTokens: max_response_length,
                    frequencyPenalty: frequency_penalty,
                    presencePenalty: presence_penalty,
                });

                response = anthropicResponse;
                elizaLogger.debug("Received response from Anthropic model.");
                break;
            }

            case ModelProviderName.CLAUDE_VERTEX: {
                elizaLogger.debug("Initializing Claude Vertex model.");

                const anthropic = createAnthropic({ apiKey });

                const { text: anthropicResponse } = await aiGenerateText({
                    model: anthropic.languageModel(model),
                    prompt: context,
                    system:
                        runtime.character.system ??
                        settings.SYSTEM_PROMPT ??
                        undefined,
                    temperature: temperature,
                    maxTokens: max_response_length,
                    frequencyPenalty: frequency_penalty,
                    presencePenalty: presence_penalty,
                });

                response = anthropicResponse;
                elizaLogger.debug(
                    "Received response from Claude Vertex model."
                );
                break;
            }

            case ModelProviderName.GROK: {
                elizaLogger.debug("Initializing Grok model.");
                const grok = createOpenAI({ apiKey, baseURL: endpoint });

                const { text: grokResponse } = await aiGenerateText({
                    model: grok.languageModel(model, {
                        parallelToolCalls: false,
                    }),
                    prompt: context,
                    system:
                        runtime.character.system ??
                        settings.SYSTEM_PROMPT ??
                        undefined,
                    temperature: temperature,
                    maxTokens: max_response_length,
                    frequencyPenalty: frequency_penalty,
                    presencePenalty: presence_penalty,
                });

                response = grokResponse;
                elizaLogger.debug("Received response from Grok model.");
                break;
            }

            case ModelProviderName.GROQ: {
                const groq = createGroq({ apiKey });

                const { text: groqResponse } = await aiGenerateText({
                    model: groq.languageModel(model),
                    prompt: context,
                    temperature: temperature,
                    system:
                        runtime.character.system ??
                        settings.SYSTEM_PROMPT ??
                        undefined,
                    maxTokens: max_response_length,
                    frequencyPenalty: frequency_penalty,
                    presencePenalty: presence_penalty,
                });

                response = groqResponse;
                break;
            }

            case ModelProviderName.LLAMALOCAL: {
                elizaLogger.debug(
                    "Using local Llama model for text completion."
                );
                const textGenerationService =
                    runtime.getService<ITextGenerationService>(
                        ServiceType.TEXT_GENERATION
                    );

                if (!textGenerationService) {
                    throw new Error("Text generation service not found");
                }

                response = await textGenerationService.queueTextCompletion(
                    context,
                    temperature,
                    _stop,
                    frequency_penalty,
                    presence_penalty,
                    max_response_length
                );
                elizaLogger.debug("Received response from local Llama model.");
                break;
            }

            case ModelProviderName.REDPILL: {
                elizaLogger.debug("Initializing RedPill model.");
                const serverUrl = models[provider].endpoint;
                const openai = createOpenAI({ apiKey, baseURL: serverUrl });

                const { text: redpillResponse } = await aiGenerateText({
                    model: openai.languageModel(model),
                    prompt: context,
                    temperature: temperature,
                    system:
                        runtime.character.system ??
                        settings.SYSTEM_PROMPT ??
                        undefined,
                    maxTokens: max_response_length,
                    frequencyPenalty: frequency_penalty,
                    presencePenalty: presence_penalty,
                });

                response = redpillResponse;
                elizaLogger.debug("Received response from redpill model.");
                break;
            }

            case ModelProviderName.OPENROUTER: {
                elizaLogger.debug("Initializing OpenRouter model.");
                const serverUrl = models[provider].endpoint;
                const openrouter = createOpenAI({ apiKey, baseURL: serverUrl });

                const { text: openrouterResponse, response: res } =
                    await aiGenerateText({
                        model: openrouter.languageModel(model),
                        prompt: context,
                        temperature: temperature,
                        system:
                            runtime.character.system ??
                            settings.SYSTEM_PROMPT ??
                            undefined,
                        maxTokens: max_response_length,
                        frequencyPenalty: frequency_penalty,
                        presencePenalty: presence_penalty,
                    });

                response = openrouterResponse;
                generationId = res.id;
                elizaLogger.debug("Received response from OpenRouter model.");

                break;
            }

            case ModelProviderName.OLLAMA:
                {
                    elizaLogger.debug("Initializing Ollama model.");

                    const ollamaProvider = createOllama({
                        baseURL: models[provider].endpoint + "/api",
                    });
                    const ollama = ollamaProvider(model);

                    elizaLogger.debug("****** MODEL\n", model);

                    const { text: ollamaResponse } = await aiGenerateText({
                        model: ollama,
                        prompt: context,
                        temperature: temperature,
                        maxTokens: max_response_length,
                        frequencyPenalty: frequency_penalty,
                        presencePenalty: presence_penalty,
                    });

                    response = ollamaResponse;
                }
                elizaLogger.debug("Received response from Ollama model.");
                break;

            case ModelProviderName.HEURIST: {
                elizaLogger.debug("Initializing Heurist model.");
                const heurist = createOpenAI({
                    apiKey: apiKey,
                    baseURL: endpoint,
                });

                const { text: heuristResponse } = await aiGenerateText({
                    model: heurist.languageModel(model),
                    prompt: context,
                    system:
                        runtime.character.system ??
                        settings.SYSTEM_PROMPT ??
                        undefined,
                    temperature: temperature,
                    maxTokens: max_response_length,
                    frequencyPenalty: frequency_penalty,
                    presencePenalty: presence_penalty,
                });

                response = heuristResponse;
                elizaLogger.debug("Received response from Heurist model.");
                break;
            }
            case ModelProviderName.GAIANET: {
                elizaLogger.debug("Initializing GAIANET model.");
                const openai = createOpenAI({ apiKey, baseURL: endpoint });

                const { text: openaiResponse } = await aiGenerateText({
                    model: openai.languageModel(model),
                    prompt: context,
                    system:
                        runtime.character.system ??
                        settings.SYSTEM_PROMPT ??
                        undefined,
                    temperature: temperature,
                    maxTokens: max_response_length,
                    frequencyPenalty: frequency_penalty,
                    presencePenalty: presence_penalty,
                });

                response = openaiResponse;
                elizaLogger.debug("Received response from GAIANET model.");
                break;
            }

            case ModelProviderName.GALADRIEL: {
                elizaLogger.debug("Initializing Galadriel model.");
                const galadriel = createOpenAI({
                    apiKey: apiKey,
                    baseURL: endpoint,
                });

                const { text: galadrielResponse } = await aiGenerateText({
                    model: galadriel.languageModel(model),
                    prompt: context,
                    system:
                        runtime.character.system ??
                        settings.SYSTEM_PROMPT ??
                        undefined,
                    temperature: temperature,
                    maxTokens: max_response_length,
                    frequencyPenalty: frequency_penalty,
                    presencePenalty: presence_penalty,
                });

                response = galadrielResponse;
                elizaLogger.debug("Received response from Galadriel model.");
                break;
            }

            default: {
                const errorMessage = `Unsupported provider: ${provider}`;
                elizaLogger.error(errorMessage);
                throw new Error(errorMessage);
            }
        }
        const timeEnd = performance.now();
        elizaLogger.log("Response: ", response);
        elizaLogger.log(`Time taken: ${timeEnd - startTime}ms`);

        if (agenticEnabled && provider === ModelProviderName.OPENROUTER) {
            deductCredits(runtime, generationId);
        }

        return response;
    } catch (error) {
        elizaLogger.error("Error in generateText:", error);
        throw error;
    }
}

/**
 * Truncate the context to the maximum length allowed by the model.
 * @param context The text to truncate
 * @param maxTokens Maximum number of tokens to keep
 * @param model The tokenizer model to use
 * @returns The truncated text
 */
export function trimTokens(
    context: string,
    maxTokens: number,
    model: TiktokenModel
): string {
    if (!context) return "";
    if (maxTokens <= 0) throw new Error("maxTokens must be positive");

    // Get the tokenizer for the model
    const encoding = encodingForModel(model);

    try {
        // Encode the text into tokens
        const tokens = encoding.encode(context);

        // If already within limits, return unchanged
        if (tokens.length <= maxTokens) {
            return context;
        }

        // Keep the most recent tokens by slicing from the end
        const truncatedTokens = tokens.slice(-maxTokens);

        // Decode back to text - js-tiktoken decode() returns a string directly
        return encoding.decode(truncatedTokens);
    } catch (error) {
        console.error("Error in trimTokens:", error);
        // Return truncated string if tokenization fails
        return context.slice(-maxTokens * 4); // Rough estimate of 4 chars per token
    }
}

/**
 * Sends a message to the model to determine if it should respond to the given context.
 * @param opts - The options for the generateText request
 * @param opts.context The context to evaluate for response
 * @param opts.stop A list of strings to stop the generateText at
 * @param opts.model The model to use for generateText
 * @param opts.frequency_penalty The frequency penalty to apply (0.0 to 2.0)
 * @param opts.presence_penalty The presence penalty to apply (0.0 to 2.0)
 * @param opts.temperature The temperature to control randomness (0.0 to 2.0)
 * @param opts.serverUrl The URL of the API server
 * @param opts.max_context_length Maximum allowed context length in tokens
 * @param opts.max_response_length Maximum allowed response length in tokens
 * @returns Promise resolving to "RESPOND", "IGNORE", "STOP" or null
 */
export async function generateShouldRespond({
    runtime,
    context,
    modelClass,
}: {
    runtime: IAgentRuntime;
    context: string;
    modelClass: string;
}): Promise<"RESPOND" | "IGNORE" | "STOP" | null> {
    let retryDelay = RETRY_DELAY;
    while (true) {
        try {
            elizaLogger.debug(
                "Attempting to generate text with context:",
                context
            );
            const response = await generateText({
                runtime,
                context,
                modelClass,
            });

            elizaLogger.debug("Received response from generateText:", response);
            const parsedResponse = parseShouldRespondFromText(response.trim());
            if (parsedResponse) {
                elizaLogger.debug("Parsed response:", parsedResponse);
                return parsedResponse;
            } else {
                elizaLogger.debug("generateShouldRespond no response");
            }
        } catch (error) {
            elizaLogger.error("Error in generateShouldRespond:", error);
            if (
                error instanceof TypeError &&
                error.message.includes("queueTextCompletion")
            ) {
                elizaLogger.error(
                    "TypeError: Cannot read properties of null (reading 'queueTextCompletion')"
                );
            }
        }

        elizaLogger.log(`Retrying in ${retryDelay}ms...`);
        await new Promise((resolve) => setTimeout(resolve, retryDelay));
        retryDelay *= 2;
    }
}

/**
 * Splits content into chunks of specified size with optional overlapping bleed sections
 * @param content - The text content to split into chunks
 * @param chunkSize - The maximum size of each chunk in tokens
 * @param bleed - Number of characters to overlap between chunks (default: 100)
 * @returns Promise resolving to array of text chunks with bleed sections
 */
export async function splitChunks(
    content: string,
    chunkSize: number = 512,
    bleed: number = 20
): Promise<string[]> {
    const textSplitter = new RecursiveCharacterTextSplitter({
        chunkSize: Number(chunkSize),
        chunkOverlap: Number(bleed),
    });

    return textSplitter.splitText(content);
}

/**
 * Sends a message to the model and parses the response as a boolean value
 * @param opts - The options for the generateText request
 * @param opts.context The context to evaluate for the boolean response
 * @param opts.stop A list of strings to stop the generateText at
 * @param opts.model The model to use for generateText
 * @param opts.frequency_penalty The frequency penalty to apply (0.0 to 2.0)
 * @param opts.presence_penalty The presence penalty to apply (0.0 to 2.0)
 * @param opts.temperature The temperature to control randomness (0.0 to 2.0)
 * @param opts.serverUrl The URL of the API server
 * @param opts.token The API token for authentication
 * @param opts.max_context_length Maximum allowed context length in tokens
 * @param opts.max_response_length Maximum allowed response length in tokens
 * @returns Promise resolving to a boolean value parsed from the model's response
 */
export async function generateTrueOrFalse({
    runtime,
    context = "",
    modelClass,
}: {
    runtime: IAgentRuntime;
    context: string;
    modelClass: string;
}): Promise<boolean> {
    let retryDelay = RETRY_DELAY;

    const stop = Array.from(
        new Set([
            ...(models[runtime.modelProvider].settings.stop || []),
            ["\n"],
        ])
    ) as string[];

    while (true) {
        try {
            const response = await generateText({
                stop,
                runtime,
                context,
                modelClass,
            });

            const parsedResponse = parseBooleanFromText(response.trim());
            if (parsedResponse !== null) {
                return parsedResponse;
            }
        } catch (error) {
            elizaLogger.error("Error in generateTrueOrFalse:", error);
        }

        await new Promise((resolve) => setTimeout(resolve, retryDelay));
        retryDelay *= 2;
    }
}

/**
 * Send a message to the model and parse the response as a string array
 * @param opts - The options for the generateText request
 * @param opts.context The context/prompt to send to the model
 * @param opts.stop Array of strings that will stop the model's generation if encountered
 * @param opts.model The language model to use
 * @param opts.frequency_penalty The frequency penalty to apply (0.0 to 2.0)
 * @param opts.presence_penalty The presence penalty to apply (0.0 to 2.0)
 * @param opts.temperature The temperature to control randomness (0.0 to 2.0)
 * @param opts.serverUrl The URL of the API server
 * @param opts.token The API token for authentication
 * @param opts.max_context_length Maximum allowed context length in tokens
 * @param opts.max_response_length Maximum allowed response length in tokens
 * @returns Promise resolving to an array of strings parsed from the model's response
 */
export async function generateTextArray({
    runtime,
    context,
    modelClass,
}: {
    runtime: IAgentRuntime;
    context: string;
    modelClass: string;
}): Promise<string[]> {
    if (!context) {
        elizaLogger.error("generateTextArray context is empty");
        return [];
    }
    let retryDelay = RETRY_DELAY;

    while (true) {
        try {
            const response = await generateText({
                runtime,
                context,
                modelClass,
            });

            const parsedResponse = parseJsonArrayFromText(response);
            if (parsedResponse) {
                return parsedResponse;
            }
        } catch (error) {
            elizaLogger.error("Error in generateTextArray:", error);
        }

        await new Promise((resolve) => setTimeout(resolve, retryDelay));
        retryDelay *= 2;
    }
}

export async function generateObject({
    runtime,
    context,
    modelClass,
}: {
    runtime: IAgentRuntime;
    context: string;
    modelClass: string;
}): Promise<any> {
    if (!context) {
        elizaLogger.error("generateObject context is empty");
        return null;
    }
    let retryDelay = RETRY_DELAY;

    while (true) {
        try {
            // this is slightly different than generateObjectArray, in that we parse object, not object array
            const response = await generateText({
                runtime,
                context,
                modelClass,
            });
            const parsedResponse = parseJSONObjectFromText(response);
            if (parsedResponse) {
                return parsedResponse;
            }
        } catch (error) {
            elizaLogger.error("Error in generateObject:", error);
        }

        await new Promise((resolve) => setTimeout(resolve, retryDelay));
        retryDelay *= 2;
    }
}

export async function generateObjectArray({
    runtime,
    context,
    modelClass,
}: {
    runtime: IAgentRuntime;
    context: string;
    modelClass: string;
}): Promise<any[]> {
    if (!context) {
        elizaLogger.error("generateObjectArray context is empty");
        return [];
    }
    let retryDelay = RETRY_DELAY;

    while (true) {
        try {
            const response = await generateText({
                runtime,
                context,
                modelClass,
            });

            const parsedResponse = parseJsonArrayFromText(response);
            if (parsedResponse) {
                return parsedResponse;
            }
        } catch (error) {
            elizaLogger.error("Error in generateTextArray:", error);
        }

        await new Promise((resolve) => setTimeout(resolve, retryDelay));
        retryDelay *= 2;
    }
}

/**
 * Send a message to the model for generateText.
 * @param opts - The options for the generateText request.
 * @param opts.context The context of the message to be completed.
 * @param opts.stop A list of strings to stop the generateText at.
 * @param opts.model The model to use for generateText.
 * @param opts.frequency_penalty The frequency penalty to apply to the generateText.
 * @param opts.presence_penalty The presence penalty to apply to the generateText.
 * @param opts.temperature The temperature to apply to the generateText.
 * @param opts.max_context_length The maximum length of the context to apply to the generateText.
 * @returns The completed message.
 */
export async function generateMessageResponse({
    runtime,
    context,
    modelClass,
}: {
    runtime: IAgentRuntime;
    context: string;
    modelClass: string;
}): Promise<Content> {
    const max_context_length =
        models[runtime.modelProvider].settings.maxInputTokens;
    context = trimTokens(context, max_context_length, "gpt-4o");

    const maxRetries = 5;
    let retryCount = 0;
    let retryDelay = RETRY_DELAY;

    const delay = (ms: number) =>
        new Promise((resolve) => setTimeout(resolve, ms));

    while (retryCount < maxRetries) {
        try {
            const response = await generateText({
                runtime,
                context,
                modelClass,
            });

            // try parsing the response as JSON, if null then try again
            const parsedContent = parseJSONObjectFromText(response) as Content;
            if (parsedContent) {
                elizaLogger.debug("Parsed response content:", parsedContent);
                return parsedContent;
            } else {
                elizaLogger.debug("parsedContent is null, retrying");
                elizaLogger.log("parsedContent is null, retrying");
            }
        } catch (error) {
            elizaLogger.error("Error in generateMessageResponse:", error);
        }

        retryCount++;
        elizaLogger.log(
            `Retrying in ${retryDelay}ms... (Attempt ${retryCount}/${maxRetries})`
        );
        await delay(retryDelay);
        retryDelay *= 2;
    }

    throw new Error(
        "Failed to generate message response after maximum retries"
    );
}

export const generateImage = async (
    data: {
        prompt: string;
        width: number;
        height: number;
        count?: number;
        negativePrompt?: string;
        numIterations?: number;
        guidanceScale?: number;
        seed?: number;
        modelId?: string;
        jobId?: string;
    },
    runtime: IAgentRuntime
): Promise<{
    success: boolean;
    data?: string[];
    error?: any;
}> => {
    const model = getModel(runtime.imageModelProvider, ModelClass.IMAGE);
    const modelSettings = models[runtime.imageModelProvider].imageSettings;

    elizaLogger.info("Generating image with options:", {
        imageModelProvider: model,
    });

    const apiKey =
        runtime.imageModelProvider === runtime.modelProvider
            ? runtime.token
            : (runtime.getSetting("HEURIST_API_KEY") ??
              runtime.getSetting("TOGETHER_API_KEY") ??
              runtime.getSetting("FAL_API_KEY") ??
              runtime.getSetting("OPENAI_API_KEY"));

    try {
        if (runtime.imageModelProvider === ModelProviderName.HEURIST) {
            const response = await fetch(
                "http://sequencer.heurist.xyz/submit_job",
                {
                    method: "POST",
                    headers: {
                        Authorization: `Bearer ${apiKey}`,
                        "Content-Type": "application/json",
                    },
                    body: JSON.stringify({
                        job_id: data.jobId || crypto.randomUUID(),
                        model_input: {
                            SD: {
                                prompt: data.prompt,
                                neg_prompt: data.negativePrompt,
                                num_iterations: data.numIterations || 20,
                                width: data.width || 512,
                                height: data.height || 512,
                                guidance_scale: data.guidanceScale || 3,
                                seed: data.seed || -1,
                            },
                        },
                        model_id: data.modelId || "FLUX.1-dev",
                        deadline: 60,
                        priority: 1,
                    }),
                }
            );

            if (!response.ok) {
                throw new Error(
                    `Heurist image generation failed: ${response.statusText}`
                );
            }

            const imageURL = await response.json();
            return { success: true, data: [imageURL] };
        } else if (
            runtime.imageModelProvider === ModelProviderName.TOGETHER ||
            // for backwards compat
            runtime.imageModelProvider === ModelProviderName.LLAMACLOUD
        ) {
            const together = new Together({ apiKey: apiKey as string });
            const response = await together.images.create({
                model: "black-forest-labs/FLUX.1-schnell",
                prompt: data.prompt,
                width: data.width,
                height: data.height,
                steps: modelSettings?.steps ?? 4,
                n: data.count,
            });

            // Add type assertion to handle the response properly
            const togetherResponse =
                response as unknown as TogetherAIImageResponse;

            if (
                !togetherResponse.data ||
                !Array.isArray(togetherResponse.data)
            ) {
                throw new Error("Invalid response format from Together AI");
            }

            // Rest of the code remains the same...
            const base64s = await Promise.all(
                togetherResponse.data.map(async (image) => {
                    if (!image.url) {
                        elizaLogger.error("Missing URL in image data:", image);
                        throw new Error("Missing URL in Together AI response");
                    }

                    // Fetch the image from the URL
                    const imageResponse = await fetch(image.url);
                    if (!imageResponse.ok) {
                        throw new Error(
                            `Failed to fetch image: ${imageResponse.statusText}`
                        );
                    }

                    // Convert to blob and then to base64
                    const blob = await imageResponse.blob();
                    const arrayBuffer = await blob.arrayBuffer();
                    const base64 = Buffer.from(arrayBuffer).toString("base64");

                    // Return with proper MIME type
                    return `data:image/jpeg;base64,${base64}`;
                })
            );

            if (base64s.length === 0) {
                throw new Error("No images generated by Together AI");
            }

            elizaLogger.debug(`Generated ${base64s.length} images`);
            return { success: true, data: base64s };
        } else if (runtime.imageModelProvider === ModelProviderName.FAL) {
            fal.config({
                credentials: apiKey as string,
            });

            // Prepare the input parameters according to their schema
            const input = {
                prompt: data.prompt,
                image_size: "square" as const,
                num_inference_steps: modelSettings?.steps ?? 50,
                guidance_scale: data.guidanceScale || 3.5,
                num_images: data.count,
                enable_safety_checker: true,
                output_format: "png" as const,
                seed: data.seed ?? 6252023,
                ...(runtime.getSetting("FAL_AI_LORA_PATH")
                    ? {
                          loras: [
                              {
                                  path: runtime.getSetting("FAL_AI_LORA_PATH"),
                                  scale: 1,
                              },
                          ],
                      }
                    : {}),
            };

            // Subscribe to the model
            const result = await fal.subscribe(model, {
                input,
                logs: true,
                onQueueUpdate: (update) => {
                    if (update.status === "IN_PROGRESS") {
                        elizaLogger.info(update.logs.map((log) => log.message));
                    }
                },
            });

            // Convert the returned image URLs to base64 to match existing functionality
            const base64Promises = result.data.images.map(async (image) => {
                const response = await fetch(image.url);
                const blob = await response.blob();
                const buffer = await blob.arrayBuffer();
                const base64 = Buffer.from(buffer).toString("base64");
                return `data:${image.content_type};base64,${base64}`;
            });

            const base64s = await Promise.all(base64Promises);
            return { success: true, data: base64s };
        } else {
            let targetSize = `${data.width}x${data.height}`;
            if (
                targetSize !== "1024x1024" &&
                targetSize !== "1792x1024" &&
                targetSize !== "1024x1792"
            ) {
                targetSize = "1024x1024";
            }
            const openaiApiKey = runtime.getSetting("OPENAI_API_KEY") as string;
            if (!openaiApiKey) {
                throw new Error("OPENAI_API_KEY is not set");
            }
            const openai = new OpenAI({
                apiKey: openaiApiKey as string,
            });
            const response = await openai.images.generate({
                model,
                prompt: data.prompt,
                size: targetSize as "1024x1024" | "1792x1024" | "1024x1792",
                n: data.count,
                response_format: "b64_json",
            });
            const base64s = response.data.map(
                (image) => `data:image/png;base64,${image.b64_json}`
            );
            return { success: true, data: base64s };
        }
    } catch (error) {
        console.error(error);
        return { success: false, error: error };
    }
};

export const generateCaption = async (
    data: { imageUrl: string },
    runtime: IAgentRuntime
): Promise<{
    title: string;
    description: string;
}> => {
    const { imageUrl } = data;
    const imageDescriptionService =
        runtime.getService<IImageDescriptionService>(
            ServiceType.IMAGE_DESCRIPTION
        );

    if (!imageDescriptionService) {
        throw new Error("Image description service not found");
    }

    const resp = await imageDescriptionService.describeImage(imageUrl);
    return {
        title: resp.title.trim(),
        description: resp.description.trim(),
    };
};

export const generateWebSearch = async (
    query: string,
    runtime: IAgentRuntime
): Promise<SearchResponse> => {
    const apiUrl = "https://api.tavily.com/search";
    const apiKey = runtime.getSetting("TAVILY_API_KEY");

    try {
        const response = await fetch(apiUrl, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                api_key: apiKey,
                query,
                include_answer: true,
            }),
        });

        if (!response.ok) {
            // throw new elizaLogger.error(
            throw elizaLogger.error(`HTTP error! status: ${response.status}`);
        }

        const data: SearchResponse = await response.json();
        return data;
    } catch (error) {
        elizaLogger.error("Error:", error);
    }
};
/**
 * Configuration options for generating objects with a model.
 */
export interface GenerationOptions {
    runtime: IAgentRuntime;
    context: string;
    modelClass: ModelClass;
    schema?: ZodSchema;
    schemaName?: string;
    schemaDescription?: string;
    stop?: string[];
    mode?: "auto" | "json" | "tool";
    experimental_providerMetadata?: Record<string, unknown>;
}

/**
 * Base settings for model generation.
 */
interface ModelSettings {
    prompt: string;
    temperature: number;
    maxTokens: number;
    frequencyPenalty: number;
    presencePenalty: number;
    stop?: string[];
}

/**
 * Generates structured objects from a prompt using specified AI models and configuration options.
 *
 * @param {GenerationOptions} options - Configuration options for generating objects.
 * @returns {Promise<any[]>} - A promise that resolves to an array of generated objects.
 * @throws {Error} - Throws an error if the provider is unsupported or if generation fails.
 */
export const generateObjectV2 = async ({
    runtime,
    context,
    modelClass,
    schema,
    schemaName,
    schemaDescription,
    stop,
    mode = "json",
}: GenerationOptions): Promise<GenerateObjectResult<unknown>> => {
    if (!context) {
        const errorMessage = "generateObject context is empty";
        console.error(errorMessage);
        throw new Error(errorMessage);
    }

    const provider = runtime.modelProvider;
    const model = models[provider].model[modelClass] as TiktokenModel;
    if (!model) {
        throw new Error(`Unsupported model class: ${modelClass}`);
    }
    const temperature = models[provider].settings.temperature;
    const frequency_penalty = models[provider].settings.frequency_penalty;
    const presence_penalty = models[provider].settings.presence_penalty;
    const max_context_length = models[provider].settings.maxInputTokens;
    const max_response_length = models[provider].settings.maxOutputTokens;
    const apiKey = runtime.token;

    try {
        context = trimTokens(context, max_context_length, model);

        const modelOptions: ModelSettings = {
            prompt: context,
            temperature,
            maxTokens: max_response_length,
            frequencyPenalty: frequency_penalty,
            presencePenalty: presence_penalty,
            stop: stop || models[provider].settings.stop,
        };

        const response = await handleProvider({
            provider,
            model,
            apiKey,
            schema,
            schemaName,
            schemaDescription,
            mode,
            modelOptions,
            runtime,
            context,
            modelClass,
        });

        return response;
    } catch (error) {
        console.error("Error in generateObject:", error);
        throw error;
    }
};

/**
 * Interface for provider-specific generation options.
 */
interface ProviderOptions {
    runtime: IAgentRuntime;
    provider: ModelProviderName;
    model: any;
    apiKey: string;
    schema?: ZodSchema;
    schemaName?: string;
    schemaDescription?: string;
    mode?: "auto" | "json" | "tool";
    experimental_providerMetadata?: Record<string, unknown>;
    modelOptions: ModelSettings;
    modelClass: string;
    context: string;
}

/**
 * Handles AI generation based on the specified provider.
 *
 * @param {ProviderOptions} options - Configuration options specific to the provider.
 * @returns {Promise<any[]>} - A promise that resolves to an array of generated objects.
 */
export async function handleProvider(
    options: ProviderOptions
): Promise<GenerateObjectResult<unknown>> {
    const { provider, runtime, context, modelClass } = options;
    switch (provider) {
        case ModelProviderName.OPENAI:
        case ModelProviderName.ETERNALAI:
        case ModelProviderName.ALI_BAILIAN:
        case ModelProviderName.VOLENGINE:
        case ModelProviderName.LLAMACLOUD:
        case ModelProviderName.TOGETHER:
            return await handleOpenAI(options);
        case ModelProviderName.ANTHROPIC:
            return await handleAnthropic(options);
        case ModelProviderName.GROK:
            return await handleGrok(options);
        case ModelProviderName.GROQ:
            return await handleGroq(options);
        case ModelProviderName.LLAMALOCAL:
            return await generateObject({
                runtime,
                context,
                modelClass,
            });
        case ModelProviderName.GOOGLE:
            return await handleGoogle(options);
        case ModelProviderName.REDPILL:
            return await handleRedPill(options);
        case ModelProviderName.OPENROUTER:
            return await handleOpenRouter(options);
        case ModelProviderName.OLLAMA:
            return await handleOllama(options);
        default: {
            const errorMessage = `Unsupported provider: ${provider}`;
            elizaLogger.error(errorMessage);
            throw new Error(errorMessage);
        }
    }
}
/**
 * Handles object generation for OpenAI.
 *
 * @param {ProviderOptions} options - Options specific to OpenAI.
 * @returns {Promise<GenerateObjectResult<unknown>>} - A promise that resolves to generated objects.
 */
async function handleOpenAI({
    model,
    apiKey,
    schema,
    schemaName,
    schemaDescription,
    mode,
    modelOptions,
}: ProviderOptions): Promise<GenerateObjectResult<unknown>> {
    const baseURL = models.openai.endpoint || undefined;
    const openai = createOpenAI({ apiKey, baseURL });
    return await aiGenerateObject({
        model: openai.languageModel(model),
        schema,
        schemaName,
        schemaDescription,
        mode,
        ...modelOptions,
    });
}

/**
 * Handles object generation for Anthropic models.
 *
 * @param {ProviderOptions} options - Options specific to Anthropic.
 * @returns {Promise<GenerateObjectResult<unknown>>} - A promise that resolves to generated objects.
 */
async function handleAnthropic({
    model,
    apiKey,
    schema,
    schemaName,
    schemaDescription,
    mode,
    modelOptions,
}: ProviderOptions): Promise<GenerateObjectResult<unknown>> {
    const anthropic = createAnthropic({ apiKey });
    return await aiGenerateObject({
        model: anthropic.languageModel(model),
        schema,
        schemaName,
        schemaDescription,
        mode,
        ...modelOptions,
    });
}

/**
 * Handles object generation for Grok models.
 *
 * @param {ProviderOptions} options - Options specific to Grok.
 * @returns {Promise<GenerateObjectResult<unknown>>} - A promise that resolves to generated objects.
 */
async function handleGrok({
    model,
    apiKey,
    schema,
    schemaName,
    schemaDescription,
    mode,
    modelOptions,
}: ProviderOptions): Promise<GenerateObjectResult<unknown>> {
    const grok = createOpenAI({ apiKey, baseURL: models.grok.endpoint });
    return await aiGenerateObject({
        model: grok.languageModel(model, { parallelToolCalls: false }),
        schema,
        schemaName,
        schemaDescription,
        mode,
        ...modelOptions,
    });
}

/**
 * Handles object generation for Groq models.
 *
 * @param {ProviderOptions} options - Options specific to Groq.
 * @returns {Promise<GenerateObjectResult<unknown>>} - A promise that resolves to generated objects.
 */
async function handleGroq({
    model,
    apiKey,
    schema,
    schemaName,
    schemaDescription,
    mode,
    modelOptions,
}: ProviderOptions): Promise<GenerateObjectResult<unknown>> {
    const groq = createGroq({ apiKey });
    return await aiGenerateObject({
        model: groq.languageModel(model),
        schema,
        schemaName,
        schemaDescription,
        mode,
        ...modelOptions,
    });
}

/**
 * Handles object generation for Google models.
 *
 * @param {ProviderOptions} options - Options specific to Google.
 * @returns {Promise<GenerateObjectResult<unknown>>} - A promise that resolves to generated objects.
 */
async function handleGoogle({
    model,
    apiKey: _apiKey,
    schema,
    schemaName,
    schemaDescription,
    mode,
    modelOptions,
}: ProviderOptions): Promise<GenerateObjectResult<unknown>> {
    const google = createGoogleGenerativeAI();
    return await aiGenerateObject({
        model: google(model),
        schema,
        schemaName,
        schemaDescription,
        mode,
        ...modelOptions,
    });
}

/**
 * Handles object generation for Redpill models.
 *
 * @param {ProviderOptions} options - Options specific to Redpill.
 * @returns {Promise<GenerateObjectResult<unknown>>} - A promise that resolves to generated objects.
 */
async function handleRedPill({
    model,
    apiKey,
    schema,
    schemaName,
    schemaDescription,
    mode,
    modelOptions,
}: ProviderOptions): Promise<GenerateObjectResult<unknown>> {
    const redPill = createOpenAI({ apiKey, baseURL: models.redpill.endpoint });
    return await aiGenerateObject({
        model: redPill.languageModel(model),
        schema,
        schemaName,
        schemaDescription,
        mode,
        ...modelOptions,
    });
}

/**
 * Handles object generation for OpenRouter models.
 *
 * @param {ProviderOptions} options - Options specific to OpenRouter.
 * @returns {Promise<GenerateObjectResult<unknown>>} - A promise that resolves to generated objects.
 */
async function handleOpenRouter({
    model,
    apiKey,
    schema,
    schemaName,
    schemaDescription,
    mode,
    modelOptions,
}: ProviderOptions): Promise<GenerateObjectResult<unknown>> {
    const openRouter = createOpenAI({
        apiKey,
        baseURL: models.openrouter.endpoint,
    });
    return await aiGenerateObject({
        model: openRouter.languageModel(model),
        schema,
        schemaName,
        schemaDescription,
        mode,
        ...modelOptions,
    });
}

/**
 * Handles object generation for Ollama models.
 *
 * @param {ProviderOptions} options - Options specific to Ollama.
 * @returns {Promise<GenerateObjectResult<unknown>>} - A promise that resolves to generated objects.
 */
async function handleOllama({
    model,
    schema,
    schemaName,
    schemaDescription,
    mode,
    modelOptions,
    provider,
}: ProviderOptions): Promise<GenerateObjectResult<unknown>> {
    const ollamaProvider = createOllama({
        baseURL: models[provider].endpoint + "/api",
    });
    const ollama = ollamaProvider(model);
    return await aiGenerateObject({
        model: ollama,
        schema,
        schemaName,
        schemaDescription,
        mode,
        ...modelOptions,
    });
}

async function getGenerationDetails(
    runtime: IAgentRuntime,
    generationId: string
): Promise<GenerationData> {
    try {
        const request = await fetch(
            `https://openrouter.ai/api/v1/generation?id=${generationId}`,
            {
                method: "GET",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${runtime.getSetting("OPENROUTER_API_KEY")}`,
                },
            }
        );

        const response = await request.json();
        elizaLogger.log("Response from getGenerationDetails:", response);
        return response.data;
    } catch (error) {
        elizaLogger.error("Error in getGenerationDetails:", error);
        return undefined;
    }
}

async function deductCredits(
    runtime: IAgentRuntime,
    generationId: string
): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 5000));
    elizaLogger.info("Deducting credits for generation", {
        agentId: runtime.agentId,
        generationId,
    });
    try {
        if (!generationId || generationId === "") {
            return;
        }
        const generationData = await getGenerationDetails(
            runtime,
            generationId
        );
        if (!generationData) {
            return;
        }

        const agenticHost = runtime.getSetting("AGENTIC_HOST") as string;
        const request = await fetch(`${agenticHost}/agent/credits/deduct`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                agentId: runtime.agentId,
                generationId,
                totalCost: generationData.total_cost,
                inputTokenAmount: generationData.native_tokens_prompt,
                outputTokenAmount: generationData.native_tokens_completion,
            }),
        });

        const response = await request.json();
        elizaLogger.info("Deduct credits response", response);
    } catch (error) {
        elizaLogger.error("Error in deductCredits:", error);
        return undefined;
    }
}

// Add type definition for Together AI response
interface TogetherAIImageResponse {
    data: Array<{
        url: string;
        content_type?: string;
        image_type?: string;
    }>;
}

interface GenerationData {
    id: string;
    upstream_id: string;
    total_cost: number;
    cache_discount: number | null;
    provider_name: string;
    created_at: string;
    model: string;
    app_id: string | null;
    streamed: boolean;
    cancelled: boolean;
    latency: number;
    moderation_latency: number | null;
    generation_time: number;
    tokens_prompt: number;
    tokens_completion: number;
    native_tokens_prompt: number;
    native_tokens_completion: number;
    native_tokens_reasoning: number;
    num_media_prompt: number | null;
    num_media_completion: number | null;
    num_search_results: number | null;
    origin: string;
    is_byok: boolean;
    finish_reason: string;
    native_finish_reason: string;
    usage: number;
}
