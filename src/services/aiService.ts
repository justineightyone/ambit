/**
 * AI service router — dispatches AI features to either the Gemini API
 * (geminiService) or a local OpenAI-compatible server (localAiService)
 * based on the user's provider setting.
 *
 * Function signatures match geminiService so call sites only change
 * their import path. The Gemini SDK is loaded lazily so local-only
 * users never pull @google/genai into memory.
 */
import { useSettingsStore } from '../stores/settingsStore';
import type { FilterState, RecoveryStyle, ImageMetadata, AiThinkingMode } from '../types';
import * as local from './localAiService';
import { DEFAULT_LOCAL_AI_BASE_URL, type LocalAiConfig } from './localAiService';

export type AiProvider = 'local' | 'gemini';

/**
 * Undefined resolves to 'gemini' so settings saved by upstream Ambit
 * builds keep their existing behavior; fresh installs get 'local'
 * from DEFAULT_APP_SETTINGS.
 */
export const getAiProvider = (): AiProvider => {
    return useSettingsStore.getState().settings?.aiProvider === 'local' ? 'local' : 'gemini';
};

export const isLocalProvider = (): boolean => getAiProvider() === 'local';

const getLocalConfig = (): LocalAiConfig => {
    const settings = useSettingsStore.getState().settings;
    return {
        baseUrl: settings?.localAiBaseUrl?.trim() || DEFAULT_LOCAL_AI_BASE_URL,
        model: settings?.localAiModel || '',
        visionModel: settings?.localAiVisionModel || settings?.localAiModel || ''
    };
};

export const analyzePromptAndSuggest = async (
    currentPrompt: string,
    apiKey: string,
    modelId?: string,
    prompts?: Record<string, string>,
    thinkingMode?: AiThinkingMode
): Promise<string> => {
    if (isLocalProvider()) {
        return local.analyzePromptAndSuggest(currentPrompt, getLocalConfig(), prompts);
    }
    const gemini = await import('./geminiService');
    return gemini.analyzePromptAndSuggest(currentPrompt, apiKey, modelId, prompts, thinkingMode);
};

export const generatePromptVariations = async (
    currentPrompt: string,
    apiKey: string,
    modelId?: string,
    prompts?: Record<string, string>,
    thinkingMode?: AiThinkingMode
): Promise<string[]> => {
    if (isLocalProvider()) {
        return local.generatePromptVariations(currentPrompt, getLocalConfig(), prompts);
    }
    const gemini = await import('./geminiService');
    return gemini.generatePromptVariations(currentPrompt, apiKey, modelId, prompts, thinkingMode);
};

export const generateTitleFromPrompt = async (
    promptText: string,
    apiKey: string,
    modelId?: string,
    prompts?: Record<string, string>,
    thinkingMode?: AiThinkingMode
): Promise<string> => {
    if (isLocalProvider()) {
        return local.generateTitleFromPrompt(promptText, getLocalConfig(), prompts);
    }
    const gemini = await import('./geminiService');
    return gemini.generateTitleFromPrompt(promptText, apiKey, modelId, prompts, thinkingMode);
};

export const generateFiltersFromQuery = async (
    query: string,
    apiKey: string,
    modelId?: string,
    prompts?: Record<string, string>,
    thinkingMode?: AiThinkingMode
): Promise<Partial<FilterState>> => {
    if (isLocalProvider()) {
        return local.generateFiltersFromQuery(query, getLocalConfig(), prompts);
    }
    const gemini = await import('./geminiService');
    return gemini.generateFiltersFromQuery(query, apiKey, modelId, prompts, thinkingMode);
};

export const recoverImageMetadata = async (
    base64Image: string,
    style: RecoveryStyle,
    apiKey: string,
    modelId?: string,
    prompts?: Record<string, string>,
    thinkingMode?: AiThinkingMode
): Promise<Partial<ImageMetadata>> => {
    if (isLocalProvider()) {
        return local.recoverImageMetadata(base64Image, style, getLocalConfig(), prompts);
    }
    const gemini = await import('./geminiService');
    return gemini.recoverImageMetadata(base64Image, style, apiKey, modelId, prompts, thinkingMode);
};
