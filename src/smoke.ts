/**
 * Stage 0 smoke test: prove we can reach the Foundry model and get a reply.
 *
 * Run:  npm run smoke   (or: npx tsx src/smoke.ts)
 *
 * If .env still has placeholder values, this prints setup instructions and
 * exits 0 (so the scaffold is verifiable without real credentials yet).
 */

import "dotenv/config";
import {
  getModelClient,
  isPlaceholderConfig,
  loadProviderConfig,
  ProviderConfigError,
} from "./core/provider.js";

async function main(): Promise<void> {
  let cfg;
  try {
    cfg = loadProviderConfig();
  } catch (err) {
    if (err instanceof ProviderConfigError) {
      console.error(`\n[config] ${err.message}\n`);
      console.error("Copy .env.example to .env and fill in real Foundry values.");
      process.exitCode = 1;
      return;
    }
    throw err;
  }

  if (isPlaceholderConfig(cfg)) {
    console.log("\n[smoke] .env still contains placeholder values — skipping live call.");
    console.log("[smoke] Fill AZURE_FOUNDRY_ENDPOINT / AZURE_FOUNDRY_API_KEY / MODEL in .env, then rerun.");
    console.log(`[smoke] endpoint=${cfg.endpoint}  model=${cfg.model}`);
    console.log("[smoke] Scaffold OK ✅ (provider factory + config loading verified).\n");
    return;
  }

  console.log(`[smoke] Calling model "${cfg.model}" at ${cfg.endpoint} ...`);
  const { client, model } = getModelClient(cfg);

  const response = await client.chat.completions.create({
    model,
    messages: [
      { role: "system", content: "You are a terse assistant." },
      { role: "user", content: "Reply with exactly: code-agent smoke OK" },
    ],
  });

  const text = response.choices[0]?.message?.content ?? "(no content)";
  console.log(`[smoke] Model replied: ${text}`);
  console.log("[smoke] Live inference OK ✅\n");
}

main().catch((err) => {
  console.error("[smoke] FAILED ❌");
  console.error(err);
  process.exitCode = 1;
});
