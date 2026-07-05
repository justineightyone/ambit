/**
 * Local AI service — talks to any OpenAI-compatible chat completions server
 * (Ollama, LM Studio, llama.cpp server, vLLM) running on localhost.
 *
 * Mirrors the geminiService function surface so aiService can route between them.
 */
import { FilterState, RecoveryStyle, ImageMetadata } from "../types";
import { AI_PROMPTS, AIPromptKey, RECOVERY_STYLES } from "../constants/aiPrompts";
import {
    GeminiFilterResponseSchema,
    GeminiMetadataResponseSchema,
    PromptVariationsSchema,
    safeParse
} from "../utils/validation";
import { formatDateInputValue } from "../utils/dateFilters";

export interface LocalAiConfig {
    baseUrl: string;      // e.g. http://localhost:11434/v1
    model: string;        // text model, e.g. "gemma-3-12b-it-abliterated.q4_k_m:latest"
    visionModel?: string; // model used for image-based recovery; falls back to `model`
}

export const DEFAULT_LOCAL_AI_BASE_URL = 'http://localhost:11434/v1';

// Local vision models can be slow on first load (weights paged into VRAM).
const REQUEST_TIMEOUT_MS = 300_000;

const normalizeBaseUrl = (url: string): string => {
    const trimmed = (url || DEFAULT_LOCAL_AI_BASE_URL).trim().replace(/\/+$/, '');
    // Accept both "http://localhost:11434" and "http://localhost:11434/v1"
    return /\/v1$/.test(trimmed) ? trimmed : `${trimmed}/v1`;
};

const resolvePrompt = (key: AIPromptKey, overrides?: Record<string, string>): string => {
    return overrides?.[key] || AI_PROMPTS[key];
};

const requireModel = (config: LocalAiConfig, vision = false): string => {
    const model = vision ? (config.visionModel || config.model) : config.model;
    if (!model) {
        throw new Error("No local model selected. Pick one in Settings > Intelligence.");
    }
    return model;
};

type MessageContent =
    | string
    | Array<
        | { type: 'text'; text: string }
        | { type: 'image_url'; image_url: { url: string } }
    >;

interface ChatMessage {
    role: 'system' | 'user' | 'assistant';
    content: MessageContent;
}

interface ChatOptions {
    schema?: Record<string, unknown>;
    schemaName?: string;
}

/**
 * Strips reasoning tags (<think>…</think>) and markdown fences, then isolates
 * the first JSON value in the text. Local models are far less disciplined
 * about raw-JSON output than hosted APIs, so parsing must be defensive.
 */
export const extractJsonText = (raw: string): string => {
    let text = raw.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
    const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
    if (fence) text = fence[1].trim();

    const objStart = text.indexOf('{');
    const arrStart = text.indexOf('[');
    let start = -1;
    let open = '';
    let close = '';
    if (objStart !== -1 && (arrStart === -1 || objStart < arrStart)) {
        start = objStart; open = '{'; close = '}';
    } else if (arrStart !== -1) {
        start = arrStart; open = '['; close = ']';
    }
    if (start === -1) return text;

    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let i = start; i < text.length; i++) {
        const ch = text[i];
        if (inString) {
            if (escaped) escaped = false;
            else if (ch === '\\') escaped = true;
            else if (ch === '"') inString = false;
            continue;
        }
        if (ch === '"') inString = true;
        else if (ch === open) depth++;
        else if (ch === close) {
            depth--;
            if (depth === 0) return text.slice(start, i + 1);
        }
    }
    return text.slice(start);
};

const stripReasoning = (raw: string): string =>
    raw.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();

const postChat = async (
    baseUrl: string,
    body: Record<string, unknown>
): Promise<Response> => {
    return fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    });
};

/**
 * Runs a chat completion. When a schema is supplied, attempts OpenAI-style
 * structured output (supported by Ollama and LM Studio); if the server
 * rejects the request, retries once without response_format and relies on
 * prompt instructions + defensive JSON extraction.
 */
const chatCompletion = async (
    config: LocalAiConfig,
    messages: ChatMessage[],
    options: ChatOptions = {},
    vision = false
): Promise<string> => {
    const baseUrl = normalizeBaseUrl(config.baseUrl);
    const model = requireModel(config, vision);

    const baseBody: Record<string, unknown> = { model, messages, stream: false };

    let response: Response;
    try {
        if (options.schema) {
            response = await postChat(baseUrl, {
                ...baseBody,
                response_format: {
                    type: 'json_schema',
                    json_schema: {
                        name: options.schemaName || 'response',
                        schema: options.schema
                    }
                }
            });
            if (!response.ok && response.status >= 400 && response.status < 500) {
                // Server likely doesn't support json_schema — retry unconstrained.
                response = await postChat(baseUrl, baseBody);
            }
        } else {
            response = await postChat(baseUrl, baseBody);
        }
    } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        if (/abort|timeout/i.test(msg)) {
            throw new Error(`Local AI request timed out after ${REQUEST_TIMEOUT_MS / 1000}s. The model may still be loading.`);
        }
        throw new Error(`Cannot reach local AI server at ${baseUrl}. Is it running?`);
    }

    if (!response.ok) {
        const detail = await response.text().catch(() => '');
        throw new Error(`Local AI server error (${response.status}): ${detail.slice(0, 300)}`);
    }

    const data = await response.json();
    const content: unknown = data?.choices?.[0]?.message?.content;
    if (typeof content !== 'string' || !content.trim()) {
        throw new Error("Local AI server returned an empty response.");
    }
    return content;
};

/**
 * Verifies the endpoint is reachable and returns its model list.
 */
export const verifyLocalEndpoint = async (
    baseUrl: string
): Promise<{ valid: boolean; error?: string; models: string[] }> => {
    const normalized = normalizeBaseUrl(baseUrl);
    try {
        const response = await fetch(`${normalized}/models`, {
            signal: AbortSignal.timeout(10_000)
        });
        if (!response.ok) {
            return { valid: false, error: `Server responded with HTTP ${response.status}`, models: [] };
        }
        const data = await response.json();
        const models: string[] = Array.isArray(data?.data)
            ? data.data.map((m: { id?: string }) => m?.id).filter((id: unknown): id is string => typeof id === 'string')
            : [];
        return { valid: true, models };
    } catch {
        return { valid: false, error: `Cannot reach ${normalized}. Is your local AI server running?`, models: [] };
    }
};

export const analyzePromptAndSuggest = async (
    currentPrompt: string,
    config: LocalAiConfig,
    prompts?: Record<string, string>
): Promise<string> => {
    const template = resolvePrompt('ANALYSIS', prompts);
    const prompt = template.replace('{{prompt}}', currentPrompt);
    const text = await chatCompletion(config, [{ role: 'user', content: prompt }]);
    return stripReasoning(text) || "No suggestions available.";
};

export const generatePromptVariations = async (
    currentPrompt: string,
    config: LocalAiConfig,
    prompts?: Record<string, string>
): Promise<string[]> => {
    const template = resolvePrompt('VARIATIONS', prompts);
    const prompt = template.replace('{{prompt}}', currentPrompt);

    const text = await chatCompletion(config, [{ role: 'user', content: prompt }], {
        schemaName: 'prompt_variations',
        schema: { type: 'array', items: { type: 'string' } }
    });

    const parsedJson: unknown = JSON.parse(extractJsonText(text));
    // Some servers force an object root; accept {"variations": [...]} too.
    const candidate = Array.isArray(parsedJson)
        ? parsedJson
        : (parsedJson as Record<string, unknown>)?.variations;
    return safeParse(PromptVariationsSchema, candidate) || [];
};

export const generateTitleFromPrompt = async (
    promptText: string,
    config: LocalAiConfig,
    prompts?: Record<string, string>
): Promise<string> => {
    try {
        const template = resolvePrompt('TITLE', prompts);
        const prompt = template.replace('{{prompt}}', promptText);
        const text = await chatCompletion(config, [{ role: 'user', content: prompt }]);
        return stripReasoning(text).replace(/^["']|["']$/g, '') || "Untitled Creation";
    } catch {
        return "Untitled";
    }
};

export const generateFiltersFromQuery = async (
    query: string,
    config: LocalAiConfig,
    prompts?: Record<string, string>
): Promise<Partial<FilterState>> => {
    try {
        const template = resolvePrompt('FILTERS', prompts);
        const prompt = template
            .replace('{{query}}', query)
            .replace('{{today}}', formatDateInputValue(new Date()));

        const text = await chatCompletion(config, [{ role: 'user', content: prompt }], {
            schemaName: 'library_filters',
            schema: {
                type: 'object',
                properties: {
                    searchQuery: { type: 'string' },
                    models: { type: 'array', items: { type: 'string' } },
                    tools: { type: 'array', items: { type: 'string' } },
                    dateRange: { type: 'string', enum: ['today', 'week', 'month', 'custom', 'all'] },
                    dateFrom: { type: 'string' },
                    dateTo: { type: 'string' },
                    favoritesOnly: { type: 'boolean' },
                    minSteps: { type: 'number' },
                    minCfg: { type: 'number' }
                }
            }
        });

        const parsed = safeParse(GeminiFilterResponseSchema, JSON.parse(extractJsonText(text)));
        if (parsed) {
            return parsed as Partial<FilterState>;
        }
        return { searchQuery: query };
    } catch (error) {
        console.error("Local NL Search Error:", error);
        return { searchQuery: query }; // Fallback to raw text search
    }
};

export const recoverImageMetadata = async (
    base64Image: string,
    style: RecoveryStyle,
    config: LocalAiConfig,
    prompts?: Record<string, string>
): Promise<Partial<ImageMetadata>> => {
    const stylePrompt = RECOVERY_STYLES[style] || RECOVERY_STYLES.generic;
    const template = resolvePrompt('RECOVERY_GENERIC', prompts);
    const prompt = template.replace('{{stylePrompt}}', stylePrompt);

    const dataUrl = base64Image.startsWith('data:')
        ? base64Image
        : `data:image/png;base64,${base64Image}`;

    const text = await chatCompletion(
        config,
        [{
            role: 'user',
            content: [
                { type: 'image_url', image_url: { url: dataUrl } },
                { type: 'text', text: prompt }
            ]
        }],
        {
            schemaName: 'recovered_metadata',
            schema: {
                type: 'object',
                properties: {
                    positivePrompt: { type: 'string' },
                    negativePrompt: { type: 'string' },
                    cfg: { type: 'number' },
                    steps: { type: 'number' },
                    seed: { type: 'number' },
                    model: { type: 'string' },
                    tool: { type: 'string' }
                },
                required: ["positivePrompt"]
            }
        },
        true // vision model
    );

    const rawData: unknown = JSON.parse(extractJsonText(text));
    const validated = safeParse(GeminiMetadataResponseSchema, rawData);
    if (!validated) {
        throw new Error("Failed to validate local AI response");
    }

    // SCOPE REDUCTION: Only return positivePrompt (matches geminiService behavior).
    return {
        positivePrompt: validated.positivePrompt
    };
};
