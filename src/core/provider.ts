/**
 * Provider factory — the single place that knows how to build a model client.
 *
 * This mirrors Claude Code's `getAnthropicClient()` pattern: every consumer
 * (the query loop, sub-agents, the classifier) asks this factory for a client
 * and treats it generically. Swapping Foundry direct inference for Agent Service,
 * Entra ID auth, or a local model is a change *here only* — never in the loop.
 *
 * MVP: Azure AI Foundry direct model inference via the `openai` SDK + API key.
 */

import OpenAI from "openai";

export interface ProviderConfig {
  endpoint: string;
  apiKey: string;
  model: string;
}

const PLACEHOLDER_MARKERS = ["<your-", "<resource>", "your-resource"];

/** Read + validate provider configuration from the environment. */
export function loadProviderConfig(env: NodeJS.ProcessEnv = process.env): ProviderConfig {
  const endpoint = env.AZURE_FOUNDRY_ENDPOINT?.trim() ?? "";
  const apiKey = env.AZURE_FOUNDRY_API_KEY?.trim() ?? "";
  const model = env.MODEL?.trim() ?? "";

  const missing: string[] = [];
  if (!endpoint) missing.push("AZURE_FOUNDRY_ENDPOINT");
  if (!apiKey) missing.push("AZURE_FOUNDRY_API_KEY");
  if (!model) missing.push("MODEL");
  if (missing.length > 0) {
    throw new ProviderConfigError(
      `Missing required env var(s): ${missing.join(", ")}. See .env.example.`,
    );
  }

  return { endpoint, apiKey, model };
}

/** True when the config still contains .env.example placeholder values. */
export function isPlaceholderConfig(cfg: ProviderConfig): boolean {
  const haystack = `${cfg.endpoint} ${cfg.apiKey}`.toLowerCase();
  return PLACEHOLDER_MARKERS.some((m) => haystack.includes(m));
}

export class ProviderConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProviderConfigError";
  }
}

/** Build an OpenAI-compatible client pointed at the Foundry endpoint. */
export function getModelClient(cfg: ProviderConfig = loadProviderConfig()): {
  client: OpenAI;
  model: string;
} {
  const client = new OpenAI({
    apiKey: cfg.apiKey,
    baseURL: cfg.endpoint,
  });
  return { client, model: cfg.model };
}
