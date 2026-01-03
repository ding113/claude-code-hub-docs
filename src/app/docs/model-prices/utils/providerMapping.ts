export const KNOWN_PROVIDERS = new Set([
  'openai',
  'azure',
  'anthropic',
  'google',
  'gemini',
  'vertex_ai',
  'bedrock',
  'bedrock_converse',
  'cohere',
  'mistral',
  'groq',
  'together',
  'anyscale',
  'aiml',
  'deepinfra',
  'replicate',
  'huggingface',
  'fireworks_ai',
  'ollama',
  'perplexity',
  'amazon-nova',
  'amazon_nova',
  'nvidia_nim',
  'databricks',
  'friendliai',
  'voyage',
  'xinference',
  'cloudflare',
  'aleph_alpha',
  'nlp_cloud',
  'petals',
  'openrouter',
  'palm',
  'ai21',
  'sagemaker',
  'amazon',
  'aws_polly',
  'assemblyai',
  'cerebras',
  'github_copilot',
])

export const KNOWN_REGIONS = new Set([
  'eu',
  'us',
  'global',
  'global-standard',
  'apac',
  'us-east-1',
  'us-west-2',
  'eu-west-1',
])

export type ProviderMeta = {
  id: string
  label: string
  iconKey?: string
}

export const PROVIDER_META: Record<string, ProviderMeta> = {
  openai: { id: 'openai', label: 'OpenAI', iconKey: 'OpenAI' },
  azure: { id: 'azure', label: 'Azure', iconKey: 'Azure' },
  anthropic: { id: 'anthropic', label: 'Anthropic', iconKey: 'Anthropic' },
  bedrock: { id: 'bedrock', label: 'Bedrock', iconKey: 'Bedrock' },
  bedrock_converse: { id: 'bedrock_converse', label: 'Bedrock', iconKey: 'Bedrock' },
  google: { id: 'google', label: 'Google', iconKey: 'Google' },
  gemini: { id: 'gemini', label: 'Gemini', iconKey: 'Gemini' },
  vertex_ai: { id: 'vertex_ai', label: 'Vertex AI', iconKey: 'GoogleCloud' },
  cohere: { id: 'cohere', label: 'Cohere', iconKey: 'Cohere' },
  mistral: { id: 'mistral', label: 'Mistral', iconKey: 'Mistral' },
  groq: { id: 'groq', label: 'Groq', iconKey: 'Groq' },
  together: { id: 'together', label: 'Together', iconKey: 'Together' },
  deepinfra: { id: 'deepinfra', label: 'DeepInfra', iconKey: 'DeepInfra' },
  replicate: { id: 'replicate', label: 'Replicate', iconKey: 'Replicate' },
  huggingface: { id: 'huggingface', label: 'Hugging Face', iconKey: 'HuggingFace' },
  fireworks_ai: { id: 'fireworks_ai', label: 'Fireworks', iconKey: 'Fireworks' },
  ollama: { id: 'ollama', label: 'Ollama', iconKey: 'Ollama' },
  perplexity: { id: 'perplexity', label: 'Perplexity', iconKey: 'Perplexity' },
  openrouter: { id: 'openrouter', label: 'OpenRouter', iconKey: 'OpenRouter' },
  cloudflare: { id: 'cloudflare', label: 'Cloudflare', iconKey: 'Cloudflare' },
  voyage: { id: 'voyage', label: 'Voyage', iconKey: 'Voyage' },
  anyscale: { id: 'anyscale', label: 'Anyscale', iconKey: 'Anyscale' },
  deepseek: { id: 'deepseek', label: 'DeepSeek', iconKey: 'DeepSeek' },
  github_copilot: { id: 'github_copilot', label: 'GitHub Copilot', iconKey: 'GithubCopilot' },
}

export function getProviderMeta(providerId: string | undefined): ProviderMeta {
  if (!providerId) return { id: 'unknown', label: '未知' }
  return PROVIDER_META[providerId] ?? { id: providerId, label: providerId }
}

