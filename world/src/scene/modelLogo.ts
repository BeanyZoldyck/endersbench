// Identify the model, including models routed through OpenRouter/local servers.
// Unknown and fake models get a neutral mark rather than a guessed brand.
export function modelLogo(modelId: string, kind = 'llm'): string {
  const id = modelId.toLowerCase();
  const file = kind === 'human' ? 'human'
    : /^ender(?:$|:)/.test(id) ? 'ender'
    : /claude|^anthropic:/.test(id) ? 'claude'
    : /gemini/.test(id) ? 'gemini-color'
    : /qwen|qwq/.test(id) ? 'qwen-color'
    : /deepseek/.test(id) ? 'deepseek-color'
    : /llama/.test(id) ? 'meta-color'
    : /mistral|mixtral|codestral/.test(id) ? 'mistral-color'
    : /grok/.test(id) ? 'grok'
    : /gpt|chatgpt|(?:^|[:/])o[134](?:$|[-:])|^codex:/.test(id) ? 'openai'
    : 'generic';
  return `/model-logos/${file}.svg`;
}
