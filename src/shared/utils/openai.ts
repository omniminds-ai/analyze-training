import { encoding_for_model, TiktokenModel } from 'tiktoken';
import { Message } from '../types';

export interface OpenAIMessage {
    role: string;
    content: string | OpenAIContent[];
}

export interface OpenAIContent {
    type: "text" | "image_url";
    text?: string;
    image_url?: {
        url: string;
    };
}

interface ImageDimensions {
    width: number;
    height: number;
}

export class OpenAIUtils {
    static readonly MAX_TOKENS = 65536;
    private static readonly BASE_IMAGE_COST = 85; // Base cost for each image
    private static readonly TILE_COST = 170; // Cost per 512x512 tile
    private static readonly MAX_SIZE = 2048; // Max size OpenAI accepts
    private static readonly TARGET_SIZE = 768; // Size OpenAI scales down to
    private static readonly SYSTEM_PROMPT = "You are an expert drawing assistant that helps users create drawings by providing precise coordinate instructions. You break down complex drawings into a series of strokes, explaining each step clearly and providing exact coordinates using Python drag commands. Each drag command contains 32 coordinate pairs in absolute values.";

    /**
     * Count tokens in a text string using tiktoken
     */
    static countTextTokens(text: string, model: TiktokenModel = 'gpt-4'): number {
        const enc = encoding_for_model(model);
        const tokens = enc.encode(text);
        enc.free();
        return tokens.length;
    }

    /**
     * Calculate tokens for an image based on OpenAI's rules
     * @param dimensions Original image dimensions
     * @param detail Whether to use high detail mode (default: true)
     */
    static countImageTokens(dimensions: ImageDimensions, detail = true): number {
        if (!detail) return this.BASE_IMAGE_COST;

        // First resize step: scale down to fit within MAX_SIZE
        let width = dimensions.width;
        let height = dimensions.height;
        
        if (width > this.MAX_SIZE || height > this.MAX_SIZE) {
            const scale = this.MAX_SIZE / Math.max(width, height);
            width = Math.floor(width * scale);
            height = Math.floor(height * scale);
        }

        // Second resize step: scale down shortest side to TARGET_SIZE
        const shortestSide = Math.min(width, height);
        if (shortestSide > this.TARGET_SIZE) {
            const scale = this.TARGET_SIZE / shortestSide;
            width = Math.floor(width * scale);
            height = Math.floor(height * scale);
        }

        // Calculate number of 512x512 tiles needed
        const tilesX = Math.ceil(width / 512);
        const tilesY = Math.ceil(height / 512);
        const totalTiles = tilesX * tilesY;

        return this.TILE_COST * totalTiles + this.BASE_IMAGE_COST;
    }

    /**
     * Calculate dimensions after OpenAI's resizing rules
     * Note: This function will be used later for actual image resizing
     */
    static calculateResizedDimensions(dimensions: ImageDimensions): ImageDimensions {
        let width = dimensions.width;
        let height = dimensions.height;
        
        // First resize step: scale down to fit within MAX_SIZE
        if (width > this.MAX_SIZE || height > this.MAX_SIZE) {
            const scale = this.MAX_SIZE / Math.max(width, height);
            width = Math.floor(width * scale);
            height = Math.floor(height * scale);
        }

        // Second resize step: scale down shortest side to TARGET_SIZE
        const shortestSide = Math.min(width, height);
        if (shortestSide > this.TARGET_SIZE) {
            const scale = this.TARGET_SIZE / shortestSide;
            width = Math.floor(width * scale);
            height = Math.floor(height * scale);
        }

        return { width, height };
    }

    /**
     * Convert messages to OpenAI fine-tuning format
     */
    static convertToOpenAIFormat(messages: Message[]): OpenAIMessage[] {
        // Start with system message
        const openaiMessages: OpenAIMessage[] = [{
            role: "system",
            content: this.SYSTEM_PROMPT
        }];

        // First pass: Convert each message to intermediate format
        const convertedMessages: OpenAIMessage[] = [];
        for (const msg of messages) {
            if (typeof msg.content === 'string') {
                // Text message
                convertedMessages.push({
                    role: msg.role,
                    content: msg.content
                });
            } else if (msg.content?.type === 'image') {
                // Image message - convert base64 to content array format
                convertedMessages.push({
                    role: msg.role,
                    content: [
                        {
                            type: "image_url",
                            image_url: {
                                url: `data:image/jpeg;base64,${msg.content.data}`
                            }
                        }
                    ]
                });
            }
        }

        // Second pass: Combine consecutive text messages from same role
        const consolidatedMessages: OpenAIMessage[] = [];
        let currentMessage: OpenAIMessage | null = null;

        for (const msg of convertedMessages) {
            if (!currentMessage) {
                currentMessage = { ...msg };
                continue;
            }

            if (msg.role === currentMessage.role) {
                // Both are text messages
                if (typeof msg.content === 'string' && typeof currentMessage.content === 'string') {
                    currentMessage.content += '\n' + msg.content;
                }
                // Current is text, new is image array
                else if (typeof currentMessage.content === 'string' && Array.isArray(msg.content)) {
                    consolidatedMessages.push(currentMessage);
                    currentMessage = { ...msg };
                }
                // Current is image array, new is text
                else if (Array.isArray(currentMessage.content) && typeof msg.content === 'string') {
                    consolidatedMessages.push(currentMessage);
                    currentMessage = { ...msg };
                }
                // Both are image arrays
                else if (Array.isArray(currentMessage.content) && Array.isArray(msg.content)) {
                    consolidatedMessages.push(currentMessage);
                    currentMessage = { ...msg };
                }
            } else {
                consolidatedMessages.push(currentMessage);
                currentMessage = { ...msg };
            }
        }

        if (currentMessage) {
            consolidatedMessages.push(currentMessage);
        }

        // Remove trailing user messages to ensure last message is from assistant
        while (consolidatedMessages.length > 0 && consolidatedMessages[consolidatedMessages.length - 1].role === 'user') {
            consolidatedMessages.pop();
        }

        // Only add consolidated messages if we have a valid conversation (ends with assistant)
        if (consolidatedMessages.length > 0) {
            openaiMessages.push(...consolidatedMessages);
        }

        return openaiMessages;
    }

    /**
     * Count total tokens in a conversation
     */
    static countConversationTokens(messages: OpenAIMessage[]): number {
        let totalTokens = 0;

        for (const msg of messages) {
            // Count role and any metadata tokens
            totalTokens += this.countTextTokens(msg.role);

            if (typeof msg.content === 'string') {
                // Text message
                totalTokens += this.countTextTokens(msg.content);
            } else if (Array.isArray(msg.content)) {
                // Mixed content array (text + images)
                for (const content of msg.content) {
                    if (content.type === 'text') {
                        totalTokens += this.countTextTokens(content.text || '');
                    } else if (content.type === 'image_url') {
                        // For now assume high detail mode and 1024x1024 images
                        // Later we can extract actual dimensions from base64
                        totalTokens += this.countImageTokens({ width: 1024, height: 1024 });
                    }
                }
            }
        }

        return totalTokens;
    }

    /**
     * Check if a conversation exceeds the token limit
     */
    static exceedsTokenLimit(messages: OpenAIMessage[]): boolean {
        return this.countConversationTokens(messages) > this.MAX_TOKENS;
    }
}
