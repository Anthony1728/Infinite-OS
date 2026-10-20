import type { Tool, ToolResult } from './base.js';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { infiniteHome } from '../profiles/home.js';
import { findOperation, importSpec, invokeOperation, listSpecs, loadSpec } from './openapi.js';

interface APIProvider {
  id: string;
  name: string;
  keyPatterns: RegExp[];
  keyPrefix: string[];
  baseUrl: string;
  authHeader: string;
  authFormat: (key: string) => string;
  testEndpoint: string;
  testHeaders?: Record<string, string>;
  capabilities: string[];
  models?: string[];
  category: 'ai' | 'cloud' | 'social' | 'payment' | 'email' | 'storage' | 'messaging' | 'analytics' | 'devtools' | 'other';
}

interface SavedConnection {
  id: string;
  providerId: string;
  providerName: string;
  apiKey: string;
  baseUrl: string;
  customHeaders?: Record<string, string>;
  connectedAt: number;
  lastTested?: number;
  status: 'active' | 'inactive' | 'error';
  capabilities: string[];
}

const PROVIDERS: APIProvider[] = [
  // AI Providers
  {
    id: 'openai',
    name: 'OpenAI',
    keyPatterns: [/^sk-[a-zA-Z0-9]{48,}$/],
    keyPrefix: ['sk-'],
    baseUrl: 'https://api.openai.com/v1',
    authHeader: 'Authorization',
    authFormat: (key) => `Bearer ${key}`,
    testEndpoint: '/models',
    capabilities: ['chat', 'completions', 'embeddings', 'images', 'audio', 'moderation', 'fine-tuning'],
    models: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'gpt-4', 'gpt-3.5-turbo', 'dall-e-3', 'whisper-1', 'tts-1'],
    category: 'ai',
  },
  {
    id: 'anthropic',
    name: 'Anthropic (Claude)',
    keyPatterns: [/^sk-ant-[a-zA-Z0-9-]{93,}$/],
    keyPrefix: ['sk-ant-'],
    baseUrl: 'https://api.anthropic.com/v1',
    authHeader: 'x-api-key',
    authFormat: (key) => key,
    testEndpoint: '/messages',
    testHeaders: { 'anthropic-version': '2023-06-01' },
    capabilities: ['chat', 'completions', 'vision', 'tool-use'],
    models: ['claude-opus-4-20250514', 'claude-sonnet-4-20250514', 'claude-3-5-haiku-20241022'],
    category: 'ai',
  },
  {
    id: 'google-ai',
    name: 'Google AI (Gemini)',
    keyPatterns: [/^AIza[a-zA-Z0-9\-_]{35}$/],
    keyPrefix: ['AIza'],
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    authHeader: 'x-goog-api-key',
    authFormat: (key) => key,
    testEndpoint: '/models?key=',
    capabilities: ['chat', 'completions', 'embeddings', 'vision', 'audio'],
    models: ['gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-1.5-pro'],
    category: 'ai',
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    keyPatterns: [/^sk-or-v1-[a-f0-9]{64}$/],
    keyPrefix: ['sk-or-v1-'],
    baseUrl: 'https://openrouter.ai/api/v1',
    authHeader: 'Authorization',
    authFormat: (key) => `Bearer ${key}`,
    testEndpoint: '/models',
    capabilities: ['chat', 'completions', 'routing'],
    models: ['anthropic/claude-opus-4', 'openai/gpt-4o', 'google/gemini-2.5-pro'],
    category: 'ai',
  },
  {
    id: 'groq',
    name: 'Groq',
    keyPatterns: [/^gsk_[a-zA-Z0-9]{52}$/],
    keyPrefix: ['gsk_'],
    baseUrl: 'https://api.groq.com/openai/v1',
    authHeader: 'Authorization',
    authFormat: (key) => `Bearer ${key}`,
    testEndpoint: '/models',
    capabilities: ['chat', 'completions', 'embeddings'],
    models: ['llama-3.3-70b-versatile', 'mixtral-8x7b-32768', 'gemma2-9b-it'],
    category: 'ai',
  },
  {
    id: 'nvidia',
    name: 'NVIDIA NIM',
    keyPatterns: [/^nvapi-[a-zA-Z0-9_-]{20,}/],
    keyPrefix: ['nvapi-'],
    baseUrl: 'https://integrate.api.nvidia.com/v1',
    authHeader: 'Authorization',
    authFormat: (key) => `Bearer ${key}`,
    testEndpoint: '/models',
    capabilities: ['chat', 'completions', 'vision', 'embeddings'],
    models: ['mistralai/mistral-large', 'nvidia/nemotron-3-super-120b-a12b', 'google/gemma-3-12b-it'],
    category: 'ai',
  },
  {
    id: 'mistral',
    name: 'Mistral AI',
    keyPatterns: [/^[a-zA-Z0-9]{32}$/],
    keyPrefix: [],
    baseUrl: 'https://api.mistral.ai/v1',
    authHeader: 'Authorization',
    authFormat: (key) => `Bearer ${key}`,
    testEndpoint: '/models',
    capabilities: ['chat', 'completions', 'embeddings', 'fine-tuning'],
    models: ['mistral-large-latest', 'mistral-small-latest', 'codestral-latest'],
    category: 'ai',
  },
  {
    id: 'cohere',
    name: 'Cohere',
    keyPatterns: [/^[a-zA-Z0-9]{40}$/],
    keyPrefix: [],
    baseUrl: 'https://api.cohere.com/v1',
    authHeader: 'Authorization',
    authFormat: (key) => `Bearer ${key}`,
    testEndpoint: '/models',
    capabilities: ['chat', 'completions', 'embeddings', 'search'],
    models: ['command-r-plus', 'command-r', 'embed-english-v3.0'],
    category: 'ai',
  },
  {
    id: 'huggingface',
    name: 'Hugging Face',
    keyPatterns: [/^hf_[a-zA-Z0-9]{34}$/],
    keyPrefix: ['hf_'],
    baseUrl: 'https://api-inference.huggingface.co',
    authHeader: 'Authorization',
    authFormat: (key) => `Bearer ${key}`,
    testEndpoint: '/models',
    capabilities: ['inference', 'embeddings', 'fine-tuning'],
    category: 'ai',
  },
  {
    id: 'replicate',
    name: 'Replicate',
    keyPatterns: [/^r8_[a-zA-Z0-9]{40}$/],
    keyPrefix: ['r8_'],
    baseUrl: 'https://api.replicate.com/v1',
    authHeader: 'Authorization',
    authFormat: (key) => `Bearer ${key}`,
    testEndpoint: '/models',
    capabilities: ['inference', 'images', 'audio', 'video'],
    category: 'ai',
  },
  {
    id: 'elevenlabs',
    name: 'ElevenLabs',
    keyPatterns: [/^[a-f0-9]{32}$/],
    keyPrefix: [],
    baseUrl: 'https://api.elevenlabs.io/v1',
    authHeader: 'xi-api-key',
    authFormat: (key) => key,
    testEndpoint: '/voices',
    capabilities: ['tts', 'speech-to-speech', 'voice-cloning'],
    category: 'ai',
  },
  // Cloud Providers
  {
    id: 'aws',
    name: 'AWS',
    keyPatterns: [/^AKIA[0-9A-Z]{16}$/],
    keyPrefix: ['AKIA'],
    baseUrl: 'https://iam.amazonaws.com',
    authHeader: 'Authorization',
    authFormat: (key) => `AWS4-HMAC-SHA256 Credential=${key}`,
    testEndpoint: '/',
    capabilities: ['s3', 'ec2', 'lambda', 'dynamodb', 'sqs', 'sns'],
    category: 'cloud',
  },
  {
    id: 'gcp',
    name: 'Google Cloud Platform',
    keyPatterns: [/^AIza[a-zA-Z0-9\-_]{35}$/],
    keyPrefix: ['AIza'],
    baseUrl: 'https://cloud.googleapis.com',
    authHeader: 'Authorization',
    authFormat: (key) => `Bearer ${key}`,
    testEndpoint: '/',
    capabilities: ['compute', 'storage', 'bigquery', 'pubsub', 'functions'],
    category: 'cloud',
  },
  {
    id: 'azure',
    name: 'Microsoft Azure',
    keyPatterns: [/^[a-f0-9]{32}$/],
    keyPrefix: [],
    baseUrl: 'https://management.azure.com',
    authHeader: 'Authorization',
    authFormat: (key) => `Bearer ${key}`,
    testEndpoint: '/subscriptions?api-version=2020-01-01',
    capabilities: ['compute', 'storage', 'sql', 'functions', 'cognitive-services'],
    category: 'cloud',
  },
  {
    id: 'digitalocean',
    name: 'DigitalOcean',
    keyPatterns: [/^dop_v1_[a-f0-9]{64}$/],
    keyPrefix: ['dop_v1_'],
    baseUrl: 'https://api.digitalocean.com/v2',
    authHeader: 'Authorization',
    authFormat: (key) => `Bearer ${key}`,
    testEndpoint: '/account',
    capabilities: ['droplets', 'kubernetes', 'spaces', 'databases'],
    category: 'cloud',
  },
  // Social Media
  {
    id: 'twitter',
    name: 'Twitter/X API',
    keyPatterns: [/^[a-zA-Z0-9]{25}$/],
    keyPrefix: [],
    baseUrl: 'https://api.twitter.com/2',
    authHeader: 'Authorization',
    authFormat: (key) => `Bearer ${key}`,
    testEndpoint: '/tweets/search/recent?query=test&max_results=10',
    capabilities: ['tweets', 'users', 'followers', 'media'],
    category: 'social',
  },
  {
    id: 'discord',
    name: 'Discord Bot',
    keyPatterns: [/^[a-zA-Z0-9\-_]{24,}$/],
    keyPrefix: [],
    baseUrl: 'https://discord.com/api/v10',
    authHeader: 'Authorization',
    authFormat: (key) => `Bot ${key}`,
    testEndpoint: '/users/@me',
    capabilities: ['messages', 'channels', 'guilds', 'webhooks'],
    category: 'social',
  },
  {
    id: 'telegram',
    name: 'Telegram Bot',
    keyPatterns: [/^[0-9]{10}:[a-zA-Z0-9_-]{35}$/],
    keyPrefix: [],
    baseUrl: 'https://api.telegram.org',
    authHeader: 'Authorization',
    authFormat: (key) => `Bearer ${key}`,
    testEndpoint: '/getMe',
    capabilities: ['messages', 'inline-queries', 'webhooks'],
    category: 'social',
  },
  {
    id: 'slack',
    name: 'Slack',
    keyPatterns: [/^xoxb-[0-9]{12,}-[a-zA-Z0-9]{24,}$/],
    keyPrefix: ['xoxb-'],
    baseUrl: 'https://slack.com/api',
    authHeader: 'Authorization',
    authFormat: (key) => `Bearer ${key}`,
    testEndpoint: '/auth.test',
    capabilities: ['messages', 'channels', 'users', 'files'],
    category: 'social',
  },
  {
    id: 'reddit',
    name: 'Reddit API',
    keyPatterns: [/^[a-zA-Z0-9]{14}$/],
    keyPrefix: [],
    baseUrl: 'https://oauth.reddit.com',
    authHeader: 'Authorization',
    authFormat: (key) => `Bearer ${key}`,
    testEndpoint: '/api/v1/me',
    capabilities: ['posts', 'comments', 'subreddits', 'users'],
    category: 'social',
  },
  {
    id: 'linkedin',
    name: 'LinkedIn',
    keyPatterns: [/^[a-zA-Z0-9]{10,}$/],
    keyPrefix: [],
    baseUrl: 'https://api.linkedin.com/v2',
    authHeader: 'Authorization',
    authFormat: (key) => `Bearer ${key}`,
    testEndpoint: '/me',
    capabilities: ['profile', 'posts', 'companies'],
    category: 'social',
  },
  {
    id: 'instagram',
    name: 'Instagram Graph API',
    keyPatterns: [/^[a-f0-9]{64}$/],
    keyPrefix: [],
    baseUrl: 'https://graph.facebook.com/v19.0',
    authHeader: 'Authorization',
    authFormat: (key) => `Bearer ${key}`,
    testEndpoint: '/me',
    capabilities: ['media', 'comments', 'insights'],
    category: 'social',
  },
  {
    id: 'facebook',
    name: 'Facebook Graph API',
    keyPatterns: [/^EAAG[0-9A-Za-z]+$/],
    keyPrefix: ['EAAG'],
    baseUrl: 'https://graph.facebook.com/v19.0',
    authHeader: 'Authorization',
    authFormat: (key) => `Bearer ${key}`,
    testEndpoint: '/me',
    capabilities: ['pages', 'posts', 'ads', 'messenger'],
    category: 'social',
  },
  {
    id: 'youtube',
    name: 'YouTube Data API',
    keyPatterns: [/^AIza[a-zA-Z0-9\-_]{35}$/],
    keyPrefix: ['AIza'],
    baseUrl: 'https://www.googleapis.com/youtube/v3',
    authHeader: 'Authorization',
    authFormat: (key) => `Bearer ${key}`,
    testEndpoint: '/channels?part=snippet&mine=true',
    capabilities: ['videos', 'channels', 'playlists', 'comments'],
    category: 'social',
  },
  {
    id: 'tiktok',
    name: 'TikTok API',
    keyPatterns: [/^[a-z0-9]{32}$/],
    keyPrefix: [],
    baseUrl: 'https://open.tiktokapis.com/v2',
    authHeader: 'Authorization',
    authFormat: (key) => `Bearer ${key}`,
    testEndpoint: '/user/info/',
    capabilities: ['videos', 'users', 'analytics'],
    category: 'social',
  },
  {
    id: 'pinterest',
    name: 'Pinterest API',
    keyPatterns: [/^pin_[a-zA-Z0-9]{64}$/],
    keyPrefix: ['pin_'],
    baseUrl: 'https://api.pinterest.com/v5',
    authHeader: 'Authorization',
    authFormat: (key) => `Bearer ${key}`,
    testEndpoint: '/user_account',
    capabilities: ['pins', 'boards', 'analytics'],
    category: 'social',
  },
  // Payment
  {
    id: 'stripe',
    name: 'Stripe',
    keyPatterns: [/^sk_live_[a-zA-Z0-9]{24,}$/, /^sk_test_[a-zA-Z0-9]{24,}$/],
    keyPrefix: ['sk_live_', 'sk_test_'],
    baseUrl: 'https://api.stripe.com/v1',
    authHeader: 'Authorization',
    authFormat: (key) => `Bearer ${key}`,
    testEndpoint: '/balance',
    capabilities: ['charges', 'customers', 'invoices', 'subscriptions', 'payment-intents'],
    category: 'payment',
  },
  {
    id: 'paypal',
    name: 'PayPal',
    keyPatterns: [/^AX[0-9A-Za-z\-_]{50,}$/],
    keyPrefix: ['AX'],
    baseUrl: 'https://api-m.sandbox.paypal.com',
    authHeader: 'Authorization',
    authFormat: (key) => `Bearer ${key}`,
    testEndpoint: '/v1/identity/oauth2/token',
    capabilities: ['payments', 'subscriptions', 'invoices'],
    category: 'payment',
  },
  {
    id: 'square',
    name: 'Square',
    keyPatterns: [/^sq0atp-[a-zA-Z0-9\-_]{22}$/],
    keyPrefix: ['sq0atp-'],
    baseUrl: 'https://connect.squareup.com/v2',
    authHeader: 'Authorization',
    authFormat: (key) => `Bearer ${key}`,
    testEndpoint: '/locations',
    capabilities: ['payments', 'catalog', 'customers', 'invoices'],
    category: 'payment',
  },
  {
    id: 'braintree',
    name: 'Braintree',
    keyPatterns: [/^[a-f0-9]{16}$/],
    keyPrefix: [],
    baseUrl: 'https://api.braintreegateway.com/merchants/',
    authHeader: 'Authorization',
    authFormat: (key) => `Bearer ${key}`,
    testEndpoint: '/v1/configuration',
    capabilities: ['payments', 'subscriptions', 'customers'],
    category: 'payment',
  },
  {
    id: 'mercadopago',
    name: 'MercadoPago',
    keyPatterns: [/^TEST-[0-9]{10,}-[0-9]{10,}$/, /^APP_USR-[0-9]{10,}-[0-9]{10,}$/],
    keyPrefix: ['TEST-', 'APP_USR-'],
    baseUrl: 'https://api.mercadopago.com/v1',
    authHeader: 'Authorization',
    authFormat: (key) => `Bearer ${key}`,
    testEndpoint: '/payment_methods',
    capabilities: ['payments', 'refunds', 'preferences'],
    category: 'payment',
  },
  // Email
  {
    id: 'sendgrid',
    name: 'SendGrid',
    keyPatterns: [/^SG\.[a-zA-Z0-9\-_]{22}\.[a-zA-Z0-9\-_]{43}$/],
    keyPrefix: ['SG.'],
    baseUrl: 'https://api.sendgrid.com/v3',
    authHeader: 'Authorization',
    authFormat: (key) => `Bearer ${key}`,
    testEndpoint: '/user/profile',
    capabilities: ['email', 'templates', 'analytics'],
    category: 'email',
  },
  {
    id: 'mailgun',
    name: 'Mailgun',
    keyPatterns: [/^key-[a-z0-9]{32}$/],
    keyPrefix: ['key-'],
    baseUrl: 'https://api.mailgun.net/v3',
    authHeader: 'Authorization',
    authFormat: (key) => `Basic ${Buffer.from(`api:${key}`).toString('base64')}`,
    testEndpoint: '/domains',
    capabilities: ['email', 'templates', 'analytics'],
    category: 'email',
  },
  {
    id: 'postmark',
    name: 'Postmark',
    keyPatterns: [/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/],
    keyPrefix: [],
    baseUrl: 'https://api.postmarkapp.com',
    authHeader: 'X-Postmark-Server-Token',
    authFormat: (key) => key,
    testEndpoint: '/account',
    capabilities: ['email', 'templates', 'analytics'],
    category: 'email',
  },
  {
    id: 'resend',
    name: 'Resend',
    keyPatterns: [/^re_[a-zA-Z0-9]{32}$/],
    keyPrefix: ['re_'],
    baseUrl: 'https://api.resend.com',
    authHeader: 'Authorization',
    authFormat: (key) => `Bearer ${key}`,
    testEndpoint: '/domains',
    capabilities: ['email', 'domains', 'analytics'],
    category: 'email',
  },
  // Storage
  {
    id: 'cloudflare-r2',
    name: 'Cloudflare R2',
    keyPatterns: [/^[a-zA-Z0-9]{40}$/],
    keyPrefix: [],
    baseUrl: 'https://api.cloudflare.com/client/v4',
    authHeader: 'Authorization',
    authFormat: (key) => `Bearer ${key}`,
    testEndpoint: '/accounts',
    capabilities: ['storage', 'cdn', 'workers'],
    category: 'storage',
  },
  {
    id: 'backblaze',
    name: 'Backblaze B2',
    keyPatterns: [/^[a-f0-9]{32}$/],
    keyPrefix: [],
    baseUrl: 'https://api.backblazeb2.com/b2api/v2',
    authHeader: 'Authorization',
    authFormat: (key) => `Bearer ${key}`,
    testEndpoint: '/b2api/v2/b2_authorize_account',
    capabilities: ['storage', 'buckets'],
    category: 'storage',
  },
  {
    id: 'supabase',
    name: 'Supabase',
    keyPatterns: [/^eyJ[a-zA-Z0-9\-_]+\.[a-zA-Z0-9\-_]+\.[a-zA-Z0-9\-_]*$/],
    keyPrefix: ['eyJ'],
    baseUrl: '',
    authHeader: 'Authorization',
    authFormat: (key) => `Bearer ${key}`,
    testEndpoint: '/rest/v1/',
    capabilities: ['database', 'auth', 'storage', 'realtime', 'edge-functions'],
    category: 'storage',
  },
  {
    id: 'firebase',
    name: 'Firebase',
    keyPatterns: [/^AIza[a-zA-Z0-9\-_]{35}$/],
    keyPrefix: ['AIza'],
    baseUrl: 'https://firestore.googleapis.com/v1',
    authHeader: 'Authorization',
    authFormat: (key) => `Bearer ${key}`,
    testEndpoint: '/',
    capabilities: ['database', 'auth', 'storage', 'messaging', 'analytics'],
    category: 'storage',
  },
  // Messaging
  {
    id: 'twilio',
    name: 'Twilio',
    keyPatterns: [/^AC[a-f0-9]{32}$/],
    keyPrefix: ['AC'],
    baseUrl: 'https://api.twilio.com/2010-04-01',
    authHeader: 'Authorization',
    authFormat: (key) => `Basic ${Buffer.from(`${key}:`).toString('base64')}`,
    testEndpoint: '/Accounts.json',
    capabilities: ['sms', 'voice', 'whatsapp', 'video'],
    category: 'messaging',
  },
  {
    id: 'vonage',
    name: 'Vonage (Nexmo)',
    keyPatterns: [/^[a-f0-9]{16}$/],
    keyPrefix: [],
    baseUrl: 'https://rest.nexmo.com',
    authHeader: 'Authorization',
    authFormat: (key) => `Bearer ${key}`,
    testEndpoint: '/account/ balance',
    capabilities: ['sms', 'voice', 'video'],
    category: 'messaging',
  },
  {
    id: 'plivo',
    name: 'Plivo',
    keyPatterns: [/^MA[a-zA-Z0-9]{32}$/],
    keyPrefix: ['MA'],
    baseUrl: 'https://api.plivo.com/v1',
    authHeader: 'Authorization',
    authFormat: (key) => `Basic ${Buffer.from(`${key}:`).toString('base64')}`,
    testEndpoint: '/Account/',
    capabilities: ['sms', 'voice'],
    category: 'messaging',
  },
  // Analytics
  {
    id: 'segment',
    name: 'Segment',
    keyPatterns: [/^[a-zA-Z0-9]{32}$/],
    keyPrefix: [],
    baseUrl: 'https://api.segment.io/v1',
    authHeader: 'Authorization',
    authFormat: (key) => `Bearer ${key}`,
    testEndpoint: '/spaces',
    capabilities: ['events', 'identify', 'track', 'analytics'],
    category: 'analytics',
  },
  {
    id: 'mixpanel',
    name: 'Mixpanel',
    keyPatterns: [/^[a-f0-9]{32}$/],
    keyPrefix: [],
    baseUrl: 'https://mixpanel.com/api/2.0',
    authHeader: 'Authorization',
    authFormat: (key) => `Basic ${Buffer.from(`${key}:`).toString('base64')}`,
    testEndpoint: '/events',
    capabilities: ['events', 'funnels', 'retention', 'analytics'],
    category: 'analytics',
  },
  {
    id: 'amplitude',
    name: 'Amplitude',
    keyPatterns: [/^[a-f0-9]{32}$/],
    keyPrefix: [],
    baseUrl: 'https://api.amplitude.com/2',
    authHeader: 'Authorization',
    authFormat: (key) => `Bearer ${key}`,
    testEndpoint: '/events',
    capabilities: ['events', 'users', 'analytics'],
    category: 'analytics',
  },
  {
    id: 'hotjar',
    name: 'Hotjar',
    keyPatterns: [/^[a-z0-9]{24}$/],
    keyPrefix: [],
    baseUrl: 'https://api.hotjar.com/v3',
    authHeader: 'Authorization',
    authFormat: (key) => `Bearer ${key}`,
    testEndpoint: '/sites',
    capabilities: ['recordings', 'heatmaps', 'feedback'],
    category: 'analytics',
  },
  // DevTools
  {
    id: 'github',
    name: 'GitHub',
    keyPatterns: [/^ghp_[a-zA-Z0-9]{36}$/, /^github_pat_[a-zA-Z0-9_]{82}$/],
    keyPrefix: ['ghp_', 'github_pat_'],
    baseUrl: 'https://api.github.com',
    authHeader: 'Authorization',
    authFormat: (key) => `Bearer ${key}`,
    testEndpoint: '/user',
    capabilities: ['repos', 'issues', 'pulls', 'actions', 'packages'],
    category: 'devtools',
  },
  {
    id: 'gitlab',
    name: 'GitLab',
    keyPatterns: [/^glpat-[a-zA-Z0-9\-_]{20}$/],
    keyPrefix: ['glpat-'],
    baseUrl: 'https://gitlab.com/api/v4',
    authHeader: 'Authorization',
    authFormat: (key) => `Bearer ${key}`,
    testEndpoint: '/user',
    capabilities: ['projects', 'issues', 'merge-requests', 'pipelines'],
    category: 'devtools',
  },
  {
    id: 'bitbucket',
    name: 'Bitbucket',
    keyPatterns: [/^[a-zA-Z0-9]{20}$/],
    keyPrefix: [],
    baseUrl: 'https://api.bitbucket.org/2.0',
    authHeader: 'Authorization',
    authFormat: (key) => `Bearer ${key}`,
    testEndpoint: '/user',
    capabilities: ['repos', 'issues', 'pipelines'],
    category: 'devtools',
  },
  {
    id: 'vercel',
    name: 'Vercel',
    keyPatterns: [/^vercel_[a-zA-Z0-9]{24}$/],
    keyPrefix: ['vercel_'],
    baseUrl: 'https://api.vercel.com/v13',
    authHeader: 'Authorization',
    authFormat: (key) => `Bearer ${key}`,
    testEndpoint: '/user',
    capabilities: ['deployments', 'projects', 'domains', 'edge-config'],
    category: 'devtools',
  },
  {
    id: 'netlify',
    name: 'Netlify',
    keyPatterns: [/^nfp_[a-zA-Z0-9]{40}$/],
    keyPrefix: ['nfp_'],
    baseUrl: 'https://api.netlify.com/api/v1',
    authHeader: 'Authorization',
    authFormat: (key) => `Bearer ${key}`,
    testEndpoint: '/accounts',
    capabilities: ['sites', 'deployments', 'forms', 'functions'],
    category: 'devtools',
  },
  {
    id: 'heroku',
    name: 'Heroku',
    keyPatterns: [/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/],
    keyPrefix: [],
    baseUrl: 'https://api.heroku.com',
    authHeader: 'Authorization',
    authFormat: (key) => `Bearer ${key}`,
    testEndpoint: '/account',
    capabilities: ['apps', 'dynos', 'addons', 'config-vars'],
    category: 'devtools',
  },
  {
    id: 'sentry',
    name: 'Sentry',
    keyPatterns: [/^sntrys_[a-zA-Z0-9_]{72,}$/],
    keyPrefix: ['sntrys_'],
    baseUrl: 'https://sentry.io/api/0',
    authHeader: 'Authorization',
    authFormat: (key) => `Bearer ${key}`,
    testEndpoint: '/organizations/',
    capabilities: ['errors', 'releases', 'performance', 'sessions'],
    category: 'devtools',
  },
  {
    id: 'datadog',
    name: 'Datadog',
    keyPatterns: [/^[a-f0-9]{40}$/],
    keyPrefix: [],
    baseUrl: 'https://api.datadoghq.com/api/v1',
    authHeader: 'Authorization',
    authFormat: (key) => `Bearer ${key}`,
    testEndpoint: '/validate',
    capabilities: ['metrics', 'logs', 'traces', 'monitors'],
    category: 'devtools',
  },
  {
    id: 'newrelic',
    name: 'New Relic',
    keyPatterns: [/^NRAK-[A-Z0-9]{27}$/],
    keyPrefix: ['NRAK-'],
    baseUrl: 'https://api.newrelic.com/v2',
    authHeader: 'Api-Key',
    authFormat: (key) => key,
    testEndpoint: '/accounts.json',
    capabilities: ['apm', 'infrastructure', 'browser', 'synthetics'],
    category: 'devtools',
  },
  {
    id: 'ngrok',
    name: 'ngrok',
    keyPatterns: [/^ngrok_[a-zA-Z0-9]{40}$/],
    keyPrefix: ['ngrok_'],
    baseUrl: 'https://api.ngrok.com',
    authHeader: 'Authorization',
    authFormat: (key) => `Bearer ${key}`,
    testEndpoint: '/tunnels',
    capabilities: ['tunnels', 'domains', 'edges'],
    category: 'devtools',
  },
  {
    id: 'cloudflare',
    name: 'Cloudflare',
    keyPatterns: [/^[a-zA-Z0-9_-]{40}$/],
    keyPrefix: [],
    baseUrl: 'https://api.cloudflare.com/client/v4',
    authHeader: 'Authorization',
    authFormat: (key) => `Bearer ${key}`,
    testEndpoint: '/user/tokens/verify',
    capabilities: ['dns', 'cdn', 'workers', 'r2', 'd1'],
    category: 'devtools',
  },
];

const DATA_DIR = join(infiniteHome(), 'api-connections');
const CONNECTIONS_FILE = join(DATA_DIR, 'connections.json');

function ensureDir(): void {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
}

function loadConnections(): SavedConnection[] {
  ensureDir();
  if (!existsSync(CONNECTIONS_FILE)) return [];
  try {
    return JSON.parse(readFileSync(CONNECTIONS_FILE, 'utf-8'));
  } catch {
    return [];
  }
}

function saveConnections(connections: SavedConnection[]): void {
  ensureDir();
  writeFileSync(CONNECTIONS_FILE, JSON.stringify(connections, null, 2));
}

function detectProvider(apiKey: string): APIProvider | null {
  const trimmed = apiKey.trim();
  for (const provider of PROVIDERS) {
    for (const pattern of provider.keyPatterns) {
      if (pattern.test(trimmed)) return provider;
    }
    for (const prefix of provider.keyPrefix) {
      if (trimmed.startsWith(prefix) && trimmed.length > prefix.length + 10) return provider;
    }
  }
  return null;
}

async function testConnection(provider: APIProvider, apiKey: string, baseUrl?: string): Promise<{ ok: boolean; message: string; details?: Record<string, unknown> }> {
  try {
    const url = (baseUrl || provider.baseUrl) + provider.testEndpoint;
    const headers: Record<string, string> = {
      [provider.authHeader]: provider.authFormat(apiKey),
      'Content-Type': 'application/json',
      ...provider.testHeaders,
    };

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    let testUrl = url;
    if (provider.id === 'google-ai' || provider.id === 'firebase') {
      testUrl = url + apiKey;
    }

    const res = await fetch(testUrl, { headers, signal: controller.signal });
    clearTimeout(timeout);

    if (res.ok) {
      let body: Record<string, unknown> = {};
      try { body = await res.json() as Record<string, unknown>; } catch { /* empty */ }
      return {
        ok: true,
        message: `Connected to ${provider.name} (${res.status})`,
        details: { status: res.status, dataKeys: Object.keys(body).slice(0, 10) },
      };
    }
    return { ok: false, message: `Auth failed: ${res.status} ${res.statusText}` };
  } catch (err) {
    return { ok: false, message: `Connection error: ${(err as Error).message}` };
  }
}

function maskKey(key: string): string {
  if (key.length <= 8) return '****';
  return key.slice(0, 4) + '****' + key.slice(-4);
}

export const apiConnectorTool: Tool = {
  name: 'APIConnector',
  description:
    'Universal API connector: detect/connect provider keys, test connections, and import OpenAPI JSON to list and invoke operations. Supports 50+ providers including OpenAI, Anthropic, Google, AWS, Stripe, GitHub, Twitter, Discord, Slack, Twilio, and SendGrid.',
  permission: 'ask',
  inputSchema: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['detect', 'connect', 'list', 'test', 'delete', 'providers', 'import_openapi', 'operations', 'invoke'],
        description: 'detect/connect/list/test/delete/providers, or import_openapi → operations → invoke',
      },
      apiKey: { type: 'string', description: 'API key to detect or connect' },
      providerId: { type: 'string', description: 'Provider ID (for manual selection)' },
      baseUrl: { type: 'string', description: 'Custom base URL override' },
      connectionId: { type: 'string', description: 'Saved connection or auth source' },
      category: { type: 'string', description: 'Filter providers by category' },
      spec: { type: 'string', description: 'OpenAPI JSON text' },
      specUrl: { type: 'string', description: 'OpenAPI JSON URL' },
      specId: { type: 'string', description: 'Imported spec ID' },
      operationId: { type: 'string' },
      method: { type: 'string' },
      path: { type: 'string' },
      params: { type: 'object', description: 'Path/query parameters' },
      body: { description: 'JSON request body' },
      headers: { type: 'object' },
      query: { type: 'string', description: 'Filter operation list' },
    },
    required: ['action'],
  },

  async execute(args, ctx): Promise<ToolResult> {
    const input = args as {
      action: string;
      apiKey?: string;
      providerId?: string;
      baseUrl?: string;
      connectionId?: string;
      category?: string;
      spec?: string;
      specUrl?: string;
      specId?: string;
      operationId?: string;
      method?: string;
      path?: string;
      params?: Record<string, unknown>;
      body?: unknown;
      headers?: Record<string, string>;
      query?: string;
    };

    try {
      switch (input.action) {
        case 'detect': {
          if (!input.apiKey) return { content: 'apiKey is required for detection', is_error: true };
          const provider = detectProvider(input.apiKey);
          if (!provider) {
            return {
              content: [
                'Could not auto-detect provider from key format.',
                'Key prefix: ' + input.apiKey.slice(0, 8) + '...',
                'Key length: ' + input.apiKey.length,
                '',
                'Use "providers" action to see supported providers,',
                'or "connect" with a providerId to manually specify.',
              ].join('\n'),
            };
          }
          return {
            content: [
              `Detected: ${provider.name}`,
              `Category: ${provider.category}`,
              `Capabilities: ${provider.capabilities.join(', ')}`,
              provider.models ? `Models: ${provider.models.slice(0, 5).join(', ')}` : '',
              '',
              'Use "connect" action to test and save this connection.',
            ].filter(Boolean).join('\n'),
          };
        }

        case 'connect': {
          const apiKey = input.apiKey;
          if (!apiKey) return { content: 'apiKey is required', is_error: true };

          let provider = detectProvider(apiKey);
          if (!provider && input.providerId) {
            provider = PROVIDERS.find((p) => p.id === input.providerId) || null;
          }
          if (!provider) {
            return {
              content: [
                'Could not detect provider. Specify providerId manually.',
                'Use "providers" to see available providers.',
              ].join('\n'),
              is_error: true,
            };
          }

          const testResult = await testConnection(provider, apiKey, input.baseUrl);
          const connections = loadConnections();
          const connId = `conn_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
          const connection: SavedConnection = {
            id: connId,
            providerId: provider.id,
            providerName: provider.name,
            apiKey,
            baseUrl: input.baseUrl || provider.baseUrl,
            connectedAt: Date.now(),
            lastTested: Date.now(),
            status: testResult.ok ? 'active' : 'error',
            capabilities: provider.capabilities,
          };
          connections.push(connection);
          saveConnections(connections);

          return {
            content: [
              `=== ${provider.name} Connection ===`,
              '',
              `Status: ${testResult.ok ? 'CONNECTED' : 'FAILED'}`,
              `Message: ${testResult.message}`,
              `Connection ID: ${connId}`,
              `Key: ${maskKey(apiKey)}`,
              `Base URL: ${connection.baseUrl}`,
              `Capabilities: ${provider.capabilities.join(', ')}`,
              testResult.details ? `\nDetails: ${JSON.stringify(testResult.details, null, 2)}` : '',
              '',
              testResult.ok ? 'Connection saved! AI agents can now use this API.' : 'Connection failed. Check your API key.',
            ].join('\n'),
          };
        }

        case 'list': {
          const connections = loadConnections();
          if (connections.length === 0) {
            return {
              content: [
                'No saved connections.',
                '',
                'Paste any API key and use "connect" to auto-detect and save.',
                'Use "providers" to see 50+ supported providers.',
              ].join('\n'),
            };
          }

          const lines = ['=== API Connections ===', ''];
          for (const conn of connections) {
            lines.push(`[${conn.status.toUpperCase()}] ${conn.providerName}`);
            lines.push(`  ID: ${conn.id}`);
            lines.push(`  Key: ${maskKey(conn.apiKey)}`);
            lines.push(`  Capabilities: ${conn.capabilities.join(', ')}`);
            lines.push(`  Connected: ${new Date(conn.connectedAt).toLocaleString()}`);
            lines.push('');
          }
          lines.push(`${connections.length} total connection(s). Use "test" to verify any connection.`);
          return { content: lines.join('\n') };
        }

        case 'test': {
          if (!input.connectionId) return { content: 'connectionId is required', is_error: true };
          const connections = loadConnections();
          const conn = connections.find((c) => c.id === input.connectionId);
          if (!conn) return { content: `Connection not found: ${input.connectionId}`, is_error: true };

          const provider = PROVIDERS.find((p) => p.id === conn.providerId);
          if (!provider) return { content: `Unknown provider: ${conn.providerId}`, is_error: true };

          const testResult = await testConnection(provider, conn.apiKey);
          conn.status = testResult.ok ? 'active' : 'error';
          conn.lastTested = Date.now();
          saveConnections(connections);

          return {
            content: [
              `=== Test: ${conn.providerName} ===`,
              `Status: ${testResult.ok ? 'OK' : 'FAILED'}`,
              `Message: ${testResult.message}`,
              `Last tested: ${new Date().toLocaleString()}`,
            ].join('\n'),
          };
        }

        case 'delete': {
          if (!input.connectionId) return { content: 'connectionId is required', is_error: true };
          const connections = loadConnections();
          const idx = connections.findIndex((c) => c.id === input.connectionId);
          if (idx === -1) return { content: `Connection not found: ${input.connectionId}`, is_error: true };
          const removed = connections.splice(idx, 1)[0]!;
          saveConnections(connections);
          return { content: `Removed connection: ${removed.providerName} (${removed.id})` };
        }

        case 'providers': {
          const filtered = input.category
            ? PROVIDERS.filter((p) => p.category === input.category)
            : PROVIDERS;

          const lines = [`=== Supported API Providers (${filtered.length}) ===`, ''];
          const byCategory: Record<string, APIProvider[]> = {};
          for (const p of filtered) {
            if (!byCategory[p.category]) byCategory[p.category] = [];
            byCategory[p.category].push(p);
          }
          for (const [cat, providers] of Object.entries(byCategory)) {
            lines.push(`--- ${cat.toUpperCase()} ---`);
            for (const p of providers) {
              const prefix = p.keyPrefix.length > 0 ? ` (starts with: ${p.keyPrefix[0]}...)` : '';
              lines.push(`  ${p.id}: ${p.name}${prefix}`);
              lines.push(`    Capabilities: ${p.capabilities.join(', ')}`);
            }
            lines.push('');
          }
          lines.push('Paste any API key and use "detect" or "connect" to auto-detect.');
          return { content: lines.join('\n') };
        }

        case 'import_openapi': {
          if (!input.spec && !input.specUrl) return { content: 'spec or specUrl is required', is_error: true };
          const spec = await importSpec({ spec: input.spec, specUrl: input.specUrl, signal: ctx?.abortSignal });
          return {
            content: JSON.stringify({
              specId: spec.id,
              title: spec.title,
              version: spec.version,
              server: spec.server,
              operations: spec.operations.length,
              next: 'Use operations to inspect, then invoke with operationId or method + path.',
            }, null, 2),
          };
        }

        case 'operations': {
          if (!input.specId) return { content: JSON.stringify(listSpecs(), null, 2) };
          const spec = loadSpec(input.specId);
          const query = input.query?.trim().toLowerCase() ?? '';
          const operations = spec.operations
            .filter((operation) => !query || [operation.method, operation.path, operation.operationId ?? '', operation.summary ?? ''].join(' ').toLowerCase().includes(query))
            .slice(0, 200);
          return { content: JSON.stringify({ specId: spec.id, title: spec.title, server: spec.server, operations }, null, 2) };
        }

        case 'invoke': {
          if (!input.specId) return { content: 'specId is required', is_error: true };
          const spec = loadSpec(input.specId);
          let auth: { header: string; value: string } | undefined;
          let baseUrl = input.baseUrl;
          if (input.connectionId) {
            const conn = loadConnections().find((c) => c.id === input.connectionId);
            if (!conn) return { content: `Connection not found: ${input.connectionId}`, is_error: true };
            const provider = PROVIDERS.find((p) => p.id === conn.providerId);
            if (!provider) return { content: `Unknown provider: ${conn.providerId}`, is_error: true };
            auth = { header: provider.authHeader, value: provider.authFormat(conn.apiKey) };
            if (!baseUrl && !spec.server) baseUrl = conn.baseUrl;
          }
          const operation = findOperation(spec, input);
          const result = await invokeOperation(spec, {
            specId: spec.id,
            operationId: input.operationId,
            method: input.method,
            path: input.path,
            params: input.params,
            body: input.body,
            headers: input.headers,
            baseUrl,
            auth,
            signal: ctx?.abortSignal,
          });
          return {
            content: JSON.stringify({ specId: spec.id, operation: { method: operation.method, path: operation.path, operationId: operation.operationId }, ...result }, null, 2),
            ...(result.ok ? {} : { is_error: true }),
          };
        }

        default:
          return { content: `Unknown action: ${input.action}`, is_error: true };
      }
    } catch (error) {
      return { content: `API Connector error: ${(error as Error).message}`, is_error: true };
    }
  },
};
