import * as React from 'react';
import { FlaskConical, Cpu, Server, Cloud, RefreshCw, Eye } from 'lucide-react';
import { AppSettings, type AiThinkingMode } from '../../../types';
import { useToast } from '../../../hooks/useToast';
import {
    AI_MODELS,
    getSupportedThinkingModes,
    normalizeAiThinkingMode
} from '../../../constants/aiModels';
import { ApiKeyInput } from '../../../components/ui/ApiKeyInput';
import { useSettingsStore } from '../../../stores/settingsStore';
import {
    areDeveloperFeaturesEnabled,
    getEffectiveAiModel,
    getEffectiveAiThinkingMode
} from '../../../utils/settingsUtils';
import { verifyLocalEndpoint, DEFAULT_LOCAL_AI_BASE_URL } from '../../../services/localAiService';

interface TabProps {
    settings: AppSettings;
    setSettings: React.Dispatch<React.SetStateAction<AppSettings>>;
}

const THINKING_MODE_LABELS: Record<AiThinkingMode, string> = {
    default: 'Model Default',
    minimal: 'Minimal',
    low: 'Low',
    medium: 'Medium',
    high: 'High',
    off: 'Off',
    dynamic: 'Dynamic',
};

const selectClassName = "w-full bg-gray-50 dark:bg-black/20 border border-gray-200 dark:border-white/10 rounded-xl p-3 text-sm focus:border-sage-500 outline-none text-gray-700 dark:text-gray-300 transition-colors";

export const IntelligenceTab: React.FC<TabProps> = React.memo(({ settings, setSettings }) => {
    const { addToast } = useToast();
    const { geminiApiKey, setGeminiApiKey } = useSettingsStore();
    const [localApiKey, setLocalApiKey] = React.useState(geminiApiKey || '');
    const [isVerifying, setIsVerifying] = React.useState(false);
    const [verificationStatus, setVerificationStatus] = React.useState<'idle' | 'success' | 'error'>('idle');
    const [verificationError, setVerificationError] = React.useState<string | null>(null);
    const developerFeaturesEnabled = areDeveloperFeaturesEnabled(settings);
    const effectiveAiModel = getEffectiveAiModel(settings);
    const effectiveAiThinkingMode = getEffectiveAiThinkingMode(settings);
    const supportedThinkingModes = getSupportedThinkingModes(effectiveAiModel);

    // Local provider state
    const provider = settings.aiProvider === 'local' ? 'local' : 'gemini';
    const [localModels, setLocalModels] = React.useState<string[]>([]);
    const [isConnecting, setIsConnecting] = React.useState(false);
    const [localStatus, setLocalStatus] = React.useState<'idle' | 'success' | 'error'>('idle');
    const [localError, setLocalError] = React.useState<string | null>(null);
    const localBaseUrl = settings.localAiBaseUrl || DEFAULT_LOCAL_AI_BASE_URL;

    // Update local state if global key changes (e.g. from init)
    React.useEffect(() => {
        setLocalApiKey(geminiApiKey || '');
    }, [geminiApiKey]);

    const isEnvKey = !!process.env.API_KEY;

    const connectLocalServer = React.useCallback(async (baseUrl: string, silent = false) => {
        setIsConnecting(true);
        setLocalError(null);
        const result = await verifyLocalEndpoint(baseUrl);
        setIsConnecting(false);
        if (result.valid) {
            setLocalStatus('success');
            setLocalModels(result.models);
            if (!silent) {
                addToast(`Connected — ${result.models.length} model${result.models.length === 1 ? '' : 's'} available`, 'success');
            }
        } else {
            setLocalStatus('error');
            setLocalModels([]);
            setLocalError(result.error || 'Connection failed');
            if (!silent) {
                addToast(result.error || 'Connection failed', 'error');
            }
        }
    }, [addToast]);

    // Auto-connect when the tab opens with local provider active
    React.useEffect(() => {
        if (settings.enableAI && provider === 'local' && localStatus === 'idle') {
            void connectLocalServer(localBaseUrl, true);
        }
    }, [settings.enableAI, provider, localStatus, localBaseUrl, connectLocalServer]);

    const handleAIToggle = () => {
        const newValue = !settings.enableAI;
        setSettings(prev => ({ ...prev, enableAI: newValue }));
        addToast(newValue ? 'AI features enabled' : 'AI features disabled', 'success');
    };

    const handleProviderChange = (newProvider: 'local' | 'gemini') => {
        if (newProvider === provider) return;
        setSettings(prev => ({ ...prev, aiProvider: newProvider }));
        addToast(newProvider === 'local' ? 'Using local AI server' : 'Using Gemini API', 'success');
    };

    const handleApiKeyChange = (val: string) => {
        setLocalApiKey(val);
        setVerificationStatus('idle');
        setVerificationError(null);
    };

    const handleModelChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
        const modelId = e.target.value;
        const model = AI_MODELS.find(m => m.id === modelId);
        setSettings(prev => ({
            ...prev,
            aiModel: modelId,
            aiThinkingMode: normalizeAiThinkingMode(modelId, prev.aiThinkingMode)
        }));
        setVerificationStatus('idle');
        setVerificationError(null);
        if (model) {
            addToast(`Switched to ${model.name}`, 'success');
        }
    };

    const handleThinkingModeChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
        const thinkingMode = e.target.value as AiThinkingMode;
        if (!supportedThinkingModes.includes(thinkingMode)) return;

        setSettings(prev => ({ ...prev, aiThinkingMode: thinkingMode }));
        addToast(`Thinking effort set to ${THINKING_MODE_LABELS[thinkingMode]}`, 'success');
    };

    const handleVerifyKey = async () => {
        if (!localApiKey) {
            addToast('Please enter an API key first', 'error');
            return;
        }

        setIsVerifying(true);
        setVerificationStatus('idle');
        setVerificationError(null);

        try {
            const { verifyApiKey } = await import('../../../services/geminiService');
            const result = await verifyApiKey(localApiKey, effectiveAiModel);
            if (result.valid) {
                setVerificationStatus('success');
                // Save to secure keyring on successful verification
                await setGeminiApiKey(localApiKey);
                addToast('API Key verified and saved securely', 'success');
            } else {
                setVerificationStatus('error');
                setVerificationError(result.error || 'Verification failed');
                addToast(result.error || 'Verification failed', 'error');
            }
        } catch (error) {
            setVerificationStatus('error');
            const msg = error instanceof Error ? error.message : 'Unknown error';
            setVerificationError(msg);
            addToast(msg, 'error');
        } finally {
            setIsVerifying(false);
        }
    };

    const renderModelOptions = (current: string | undefined, includeInherit: boolean) => {
        const options = [...localModels];
        if (current && !options.includes(current)) options.unshift(current);
        return (
            <>
                {includeInherit && <option value="" className="dark:bg-sage-900">Same as text model</option>}
                {!includeInherit && !current && <option value="" className="dark:bg-sage-900">Select a model…</option>}
                {options.map(id => (
                    <option key={id} value={id} className="dark:bg-sage-900">{id}</option>
                ))}
            </>
        );
    };

    return (
        <div className="space-y-6 max-w-2xl animate-in fade-in slide-in-from-bottom-2 duration-300">
            <section className="bg-white dark:bg-white/5 border border-gray-200 dark:border-white/5 rounded-xl p-6 shadow-sm">
                <h4 className="text-xs font-bold text-sage-500 uppercase tracking-wider mb-6 flex items-center gap-2">
                    <FlaskConical className="w-4 h-4" /> Ambit Intelligence
                </h4>

                <div className="space-y-6">
                    <div
                        onClick={handleAIToggle}
                        className="flex items-center justify-between cursor-pointer group"
                    >
                        <div>
                            <div className="text-base font-medium text-gray-900 dark:text-gray-200 group-hover:text-sage-500 transition-colors">Enable AI Features</div>
                            <div className="text-sm text-gray-500">Unlocks natural language search, prompt analysis, and metadata recovery via a local AI server or the Gemini API.</div>
                        </div>
                        <button
                            type="button"
                            className={`w-12 h-7 rounded-full relative transition-colors ${settings.enableAI ? 'bg-sage-600' : 'bg-gray-200 dark:bg-white/10'}`}
                        >
                            <div className={`absolute top-1 w-5 h-5 bg-white rounded-full shadow-sm transition-all ${settings.enableAI ? 'left-6' : 'left-1'}`} />
                        </button>
                    </div>

                    {settings.enableAI && (
                        <div className="animate-in fade-in slide-in-from-top-2 space-y-4">
                            <div>
                                <label className="text-sm font-bold text-gray-900 dark:text-white block mb-2">AI Provider</label>
                                <div className="grid grid-cols-2 gap-2">
                                    <button
                                        type="button"
                                        onClick={() => handleProviderChange('local')}
                                        className={`flex items-center justify-center gap-2 p-3 rounded-xl border text-sm font-medium transition-all ${provider === 'local'
                                            ? 'border-sage-500 bg-sage-500/10 text-sage-600 dark:text-sage-400'
                                            : 'border-gray-200 dark:border-white/10 text-gray-500 hover:border-sage-500/50'}`}
                                    >
                                        <Server className="w-4 h-4" /> Local Server
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => handleProviderChange('gemini')}
                                        className={`flex items-center justify-center gap-2 p-3 rounded-xl border text-sm font-medium transition-all ${provider === 'gemini'
                                            ? 'border-sage-500 bg-sage-500/10 text-sage-600 dark:text-sage-400'
                                            : 'border-gray-200 dark:border-white/10 text-gray-500 hover:border-sage-500/50'}`}
                                    >
                                        <Cloud className="w-4 h-4" /> Gemini API
                                    </button>
                                </div>
                            </div>

                            {provider === 'local' && (
                                <div className="space-y-4 animate-in fade-in slide-in-from-top-2">
                                    <div>
                                        <label className="text-sm font-bold text-gray-900 dark:text-white block mb-2">Server URL</label>
                                        <div className="flex gap-2">
                                            <input
                                                type="text"
                                                value={localBaseUrl}
                                                onChange={e => setSettings(prev => ({ ...prev, localAiBaseUrl: e.target.value }))}
                                                placeholder={DEFAULT_LOCAL_AI_BASE_URL}
                                                spellCheck={false}
                                                className="flex-1 bg-gray-50 dark:bg-black/20 border border-gray-200 dark:border-white/10 rounded-xl p-3 text-sm focus:border-sage-500 outline-none text-gray-700 dark:text-gray-300 transition-colors font-mono"
                                            />
                                            <button
                                                type="button"
                                                onClick={() => connectLocalServer(localBaseUrl)}
                                                disabled={isConnecting}
                                                className="px-4 rounded-xl bg-sage-600 hover:bg-sage-500 text-white text-sm font-medium transition-colors disabled:opacity-50 flex items-center gap-2"
                                            >
                                                <RefreshCw className={`w-4 h-4 ${isConnecting ? 'animate-spin' : ''}`} />
                                                {isConnecting ? 'Connecting…' : 'Connect'}
                                            </button>
                                        </div>
                                        <p className="text-[10px] text-gray-500 mt-2 ml-1">
                                            Any OpenAI-compatible server: Ollama (http://localhost:11434/v1), LM Studio (http://localhost:1234/v1), llama.cpp, vLLM.
                                        </p>
                                        {localStatus === 'error' && localError && (
                                            <p className="text-xs text-red-500 mt-2 ml-1">{localError}</p>
                                        )}
                                        {localStatus === 'success' && (
                                            <p className="text-xs text-sage-500 mt-2 ml-1">Connected — {localModels.length} model{localModels.length === 1 ? '' : 's'} available.</p>
                                        )}
                                    </div>

                                    <div>
                                        <label className="text-sm font-bold text-gray-900 dark:text-white block mb-2 flex items-center gap-2">
                                            <Cpu className="w-4 h-4 text-gray-400" /> Text Model
                                        </label>
                                        <select
                                            value={settings.localAiModel || ''}
                                            onChange={e => {
                                                setSettings(prev => ({ ...prev, localAiModel: e.target.value }));
                                                if (e.target.value) addToast(`Text model set to ${e.target.value}`, 'success');
                                            }}
                                            className={selectClassName}
                                        >
                                            {renderModelOptions(settings.localAiModel, false)}
                                        </select>
                                        <p className="text-[10px] text-gray-500 mt-2 ml-1">
                                            Used for prompt analysis, variations, titles, and natural language search.
                                        </p>
                                    </div>

                                    <div>
                                        <label className="text-sm font-bold text-gray-900 dark:text-white block mb-2 flex items-center gap-2">
                                            <Eye className="w-4 h-4 text-gray-400" /> Vision Model
                                        </label>
                                        <select
                                            value={settings.localAiVisionModel || ''}
                                            onChange={e => {
                                                setSettings(prev => ({ ...prev, localAiVisionModel: e.target.value || undefined }));
                                                if (e.target.value) addToast(`Vision model set to ${e.target.value}`, 'success');
                                            }}
                                            className={selectClassName}
                                        >
                                            {renderModelOptions(settings.localAiVisionModel, true)}
                                        </select>
                                        <p className="text-[10px] text-gray-500 mt-2 ml-1">
                                            Used for image-based prompt recovery. Pick a vision-capable model (e.g. a LLaVA/JoyCaption, Gemma 3 or GLM-V variant).
                                        </p>
                                    </div>

                                    <p className="text-xs text-gray-500 mt-2">
                                        Everything runs on your own machine. No data ever leaves your computer.
                                    </p>
                                </div>
                            )}

                            {provider === 'gemini' && (
                                <div className="space-y-4 animate-in fade-in slide-in-from-top-2">
                                    <ApiKeyInput
                                        value={localApiKey}
                                        onChange={handleApiKeyChange}
                                        onVerify={handleVerifyKey}
                                        isVerifying={isVerifying}
                                        status={verificationStatus}
                                        error={verificationError}
                                        isEnvKey={isEnvKey}
                                        onTestEnvKey={() => {
                                            const keyToTest = process.env.API_KEY || '';
                                            if (keyToTest) {
                                                (async () => {
                                                    setIsVerifying(true);
                                                    setVerificationStatus('idle');
                                                    try {
                                                        const { verifyApiKey } = await import('../../../services/geminiService');
                                                        const result = await verifyApiKey(keyToTest, effectiveAiModel);
                                                        if (result.valid) {
                                                            setVerificationStatus('success');
                                                            addToast('Environment API Key verified', 'success');
                                                        } else {
                                                            setVerificationStatus('error');
                                                            setVerificationError(result.error || 'Verification failed');
                                                        }
                                                    } catch (e) {
                                                        setVerificationStatus('error');
                                                        setVerificationError(e instanceof Error ? e.message : 'Unknown error');
                                                    } finally {
                                                        setIsVerifying(false);
                                                    }
                                                })();
                                            }
                                        }}
                                    />

                                    {developerFeaturesEnabled && (
                                        <div className="pt-2 space-y-4 animate-in fade-in slide-in-from-top-2">
                                            <div>
                                                <label className="text-sm font-bold text-gray-900 dark:text-white block mb-2 flex items-center gap-2">
                                                    <Cpu className="w-4 h-4 text-gray-400" /> AI Model (Dev Mode)
                                                </label>
                                                <select
                                                    value={effectiveAiModel}
                                                    onChange={handleModelChange}
                                                    className={selectClassName}
                                                >
                                                    {AI_MODELS.map(model => (
                                                        <option key={model.id} value={model.id} className="dark:bg-sage-900">
                                                            {model.name}
                                                            {model.isExperimental ? ' (Preview)' : ''}
                                                            {model.isLegacy ? ' (Legacy)' : ''}
                                                        </option>
                                                    ))}
                                                </select>
                                                <p className="text-[10px] text-gray-500 mt-2 ml-1">
                                                    {AI_MODELS.find(m => m.id === effectiveAiModel)?.description}
                                                </p>
                                            </div>

                                            <div>
                                                <label className="text-sm font-bold text-gray-900 dark:text-white block mb-2">
                                                    Thinking Effort (Dev Mode)
                                                </label>
                                                <select
                                                    value={effectiveAiThinkingMode}
                                                    onChange={handleThinkingModeChange}
                                                    className={selectClassName}
                                                >
                                                    {supportedThinkingModes.map(mode => (
                                                        <option key={mode} value={mode} className="dark:bg-sage-900">
                                                            {THINKING_MODE_LABELS[mode]}
                                                        </option>
                                                    ))}
                                                </select>
                                                <p className="text-[10px] text-gray-500 mt-2 ml-1">
                                                    Changes the reasoning effort used by Ambit AI requests so response quality and speed can be compared.
                                                </p>
                                            </div>
                                        </div>
                                    )}

                                    <p className="text-xs text-gray-500 mt-2">
                                        Use your own Gemini API key. Your key is stored locally in the OS keyring, and requests are sent only when you verify the key or run an AI feature.
                                    </p>
                                </div>
                            )}
                        </div>
                    )}
                </div>
            </section>
        </div>
    );
});
