/**
 * Provider factory — the single place that knows how to build a model client.
 *
 * This mirrors Claude Code's `getAnthropicClient()` pattern: every consumer
 * (the query loop, sub-agents, the classifier) asks this factory for a client
 * and treats it generically. Swapping Foundry direct inference for Agent Service,
 * Entra ID auth, or a local model is a change *here only* — never in the loop.
 *
 * MVP: Azure AI Foundry direct model inference via the `openai` SDK + API key.
 * Auth: Supports API key or Entra ID (DefaultAzureCredential).
 */

import "dotenv/config";
import OpenAI from "openai";
import { DefaultAzureCredential } from "@azure/identity";

export type AuthType = "api-key" | "entra-id";

export interface ProviderConfig {
  endpoint: string;
  apiKey: string;
  model: string;
  authType: AuthType;
  azure?: {
    deploymentName: string;
    apiVersion?: string;
  };
}

const PLACEHOLDER_MARKERS = ["<your-", "<resource>", "your-resource"];

/** Determine auth type based on environment variables. */
function getAuthType(env: NodeJS.ProcessEnv = process.env): AuthType {
  const useEntraId = env.AZURE_USE_ENTRA_ID?.trim()?.toLowerCase() === "true";
  const hasApiKey = !!env.AZURE_FOUNDRY_API_KEY?.trim();

  if (useEntraId) {
    return "entra-id";
  }

  // Default to api-key if API key is provided, otherwise require Entra ID
  return hasApiKey ? "api-key" : "entra-id";
}

/** Read + validate provider configuration from the environment. */
export function loadProviderConfig(env: NodeJS.ProcessEnv = process.env): ProviderConfig {
  const endpoint = env.AZURE_FOUNDRY_ENDPOINT?.trim() ?? "";
  const apiKey = env.AZURE_FOUNDRY_API_KEY?.trim() ?? "";
  const model = env.MODEL?.trim() ?? "";
  const authType = getAuthType(env);
  const isAzure = endpoint.includes("cognitiveservices.azure.com") || endpoint.includes(".openai.azure.com");

  // Validate based on auth type
  if (authType === "api-key") {
    if (!endpoint) {
      throw new ProviderConfigError("Missing required env var: AZURE_FOUNDRY_ENDPOINT. See .env.example.");
    }
    if (!apiKey) {
      throw new ProviderConfigError("Missing required env var: AZURE_FOUNDRY_API_KEY. See .env.example.");
    }
    if (!model) {
      throw new ProviderConfigError("Missing required env var: MODEL. See .env.example.");
    }
  } else {
    // Entra ID auth
    if (!endpoint) {
      throw new ProviderConfigError("Missing required env var: AZURE_FOUNDRY_ENDPOINT. See .env.example.");
    }
    if (!model) {
      throw new ProviderConfigError("Missing required env var: MODEL. See .env.example.");
    }
  }

  // For Azure OpenAI, configure azure-specific options
  if (isAzure) {
    return {
      endpoint,
      apiKey,
      model,
      authType,
      azure: {
        deploymentName: model,
        apiVersion: "2024-08-01-preview",
      },
    };
  }

  return { endpoint, apiKey, model, authType };
}

/** True when the config still contains .env.example placeholder values. */
export function isPlaceholderConfig(cfg: ProviderConfig): boolean {
  const haystack = `${cfg.endpoint} ${cfg.apiKey}`.toLowerCase();
  return PLACEHOLDER_MARKERS.some((m) => haystack.includes(m));
}

/** Check if Entra ID auth is being used. */
export function isEntraIdAuth(cfg: ProviderConfig = loadProviderConfig()): boolean {
  return cfg.authType === "entra-id";
}

export class ProviderConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProviderConfigError";
  }
}

/** Build an OpenAI-compatible client pointed at the Foundry endpoint. */
export async function getModelClient(cfg: ProviderConfig = loadProviderConfig()): Promise<{
  client: OpenAI;
  model: string;
}> {
  let apiKey: string;

  if (cfg.authType === "entra-id") {
    // Use Entra ID (DefaultAzureCredential) for authentication
    const credential = new DefaultAzureCredential();
    const token = await credential.getToken("https://cognitiveservices.azure.com/.default");
    apiKey = token.token;
  } else {
    // Use API key from config
    apiKey = cfg.apiKey;
  }

  const clientOptions: ConstructorParameters<typeof OpenAI>[0] = {
    apiKey,
    baseURL: cfg.endpoint,
  };

  // Configure Azure OpenAI if endpoint is Azure-based
  if (cfg.azure) {
    clientOptions.azure = cfg.azure;
  }

  const client = new OpenAI(clientOptions);
  return { client, model: cfg.model };
}
