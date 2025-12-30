/**
 * LiteLLM Price Table to TOML Converter
 *
 * Fetches model pricing data from LiteLLM's official repository,
 * filters for claude/gpt/gemini models, and converts to TOML format.
 *
 * Features:
 * - Preserves custom models (source = "custom") during updates
 * - Generates checksum for integrity verification
 * - Supports incremental updates
 *
 * Usage: bun run update:prices
 */

import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const LITELLM_PRICES_URL =
  "https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json";

const OUTPUT_PATH = join(
  import.meta.dir,
  "../public/config/prices-base.toml"
);

interface ModelInfo {
  [key: string]: unknown;
  source?: string;
}

interface PricesData {
  [modelName: string]: ModelInfo;
}

function escapeTomlString(str: string): string {
  return str.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function toTomlValue(value: unknown, indent = 0): string {
  if (value === null || value === undefined) {
    return '""';
  }

  if (typeof value === "string") {
    return `"${escapeTomlString(value)}"`;
  }

  if (typeof value === "number") {
    return String(value);
  }

  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }

  if (Array.isArray(value)) {
    if (value.length === 0) return "[]";
    const items = value.map((v) => toTomlValue(v));
    return `[${items.join(", ")}]`;
  }

  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) return "{}";
    const items = entries.map(([k, v]) => `${k} = ${toTomlValue(v)}`);
    return `{ ${items.join(", ")} }`;
  }

  return String(value);
}

function modelToToml(modelName: string, info: ModelInfo): string {
  const lines: string[] = [];
  const nestedSections: { key: string; value: Record<string, unknown> }[] = [];

  lines.push(`[models."${escapeTomlString(modelName)}"]`);

  const sortedKeys = Object.keys(info).sort();

  for (const key of sortedKeys) {
    const value = info[key];

    if (
      typeof value === "object" &&
      value !== null &&
      !Array.isArray(value)
    ) {
      nestedSections.push({ key, value: value as Record<string, unknown> });
    } else {
      lines.push(`${key} = ${toTomlValue(value)}`);
    }
  }

  for (const { key, value } of nestedSections) {
    lines.push("");
    lines.push(`[models."${escapeTomlString(modelName)}".${key}]`);
    const nestedKeys = Object.keys(value).sort();
    for (const nestedKey of nestedKeys) {
      lines.push(`${nestedKey} = ${toTomlValue(value[nestedKey])}`);
    }
  }

  return lines.join("\n");
}

function loadExistingCustomModels(): Map<string, ModelInfo> {
  const customModels = new Map<string, ModelInfo>();

  if (!existsSync(OUTPUT_PATH)) {
    return customModels;
  }

  const content = readFileSync(OUTPUT_PATH, "utf-8");
  const modelRegex = /\[models\."([^"]+)"\]/g;
  let match: RegExpExecArray | null;

  while ((match = modelRegex.exec(content)) !== null) {
    const modelName = match[1];
    const startIndex = match.index;

    let endIndex = content.length;
    const nextMatch = modelRegex.exec(content);
    if (nextMatch) {
      endIndex = nextMatch.index;
      modelRegex.lastIndex = match.index + 1;
    }

    const modelSection = content.slice(startIndex, endIndex);

    if (modelSection.includes('source = "custom"')) {
      const info: ModelInfo = { source: "custom" };

      const keyValueRegex = /^([a-z_]+)\s*=\s*(.+)$/gm;
      let kvMatch: RegExpExecArray | null;

      while ((kvMatch = keyValueRegex.exec(modelSection)) !== null) {
        const [, key, rawValue] = kvMatch;
        if (key === "source") continue;

        let value: unknown;
        const trimmedValue = rawValue.trim();

        if (trimmedValue === "true") {
          value = true;
        } else if (trimmedValue === "false") {
          value = false;
        } else if (trimmedValue.startsWith('"')) {
          value = trimmedValue.slice(1, -1);
        } else if (trimmedValue.startsWith("[")) {
          try {
            value = JSON.parse(trimmedValue.replace(/'/g, '"'));
          } catch {
            value = trimmedValue;
          }
        } else if (!Number.isNaN(Number(trimmedValue))) {
          value = Number(trimmedValue);
        } else {
          value = trimmedValue;
        }

        info[key] = value;
      }

      customModels.set(modelName, info);
    }
  }

  return customModels;
}

function generateChecksum(data: string): string {
  return createHash("sha256").update(data).digest("hex");
}

async function fetchLiteLLMPrices(): Promise<PricesData> {
  console.log(`Fetching prices from: ${LITELLM_PRICES_URL}`);

  const response = await fetch(LITELLM_PRICES_URL);

  if (!response.ok) {
    throw new Error(`Failed to fetch: ${response.status} ${response.statusText}`);
  }

  return response.json() as Promise<PricesData>;
}

async function main() {
  try {
    console.log("Loading existing custom models...");
    const customModels = loadExistingCustomModels();
    console.log(`Found ${customModels.size} custom models to preserve`);

    console.log("Fetching LiteLLM price data...");
    const allModels = await fetchLiteLLMPrices();

    const filteredModels: PricesData = { ...allModels };
    const totalCount = Object.keys(allModels).length;

    console.log(`Loaded ${totalCount} models from LiteLLM`);

    for (const [modelName, info] of customModels) {
      if (!filteredModels[modelName]) {
        filteredModels[modelName] = info;
        console.log(`Preserved custom model: ${modelName}`);
      } else {
        filteredModels[modelName] = { ...filteredModels[modelName], ...info };
        console.log(`Merged custom model: ${modelName}`);
      }
    }

    const sortedModelNames = Object.keys(filteredModels).sort();

    const tomlSections: string[] = [];

    tomlSections.push("# Generated by scripts/convert-litellm-to-toml.ts");
    tomlSections.push("");

    const modelsToml = sortedModelNames
      .map((name) => modelToToml(name, filteredModels[name]))
      .join("\n\n");

    const checksum = generateChecksum(modelsToml);
    const today = new Date();
    const version = `${today.getFullYear()}.${String(today.getMonth() + 1).padStart(2, "0")}.${String(today.getDate()).padStart(2, "0")}`;

    tomlSections.push("[metadata]");
    tomlSections.push(`version = "${version}"`);
    tomlSections.push(`checksum = "${checksum}"`);
    tomlSections.push("");
    tomlSections.push(modelsToml);
    tomlSections.push("");

    const finalToml = tomlSections.join("\n");

    writeFileSync(OUTPUT_PATH, finalToml, "utf-8");

    console.log(`\nSuccess! Written to: ${OUTPUT_PATH}`);
    console.log(`  Version: ${version}`);
    console.log(`  Models: ${sortedModelNames.length}`);
    console.log(`  Checksum: ${checksum.slice(0, 16)}...`);
  } catch (error) {
    console.error("Error:", error);
    process.exit(1);
  }
}

main();
