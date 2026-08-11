import type { JSONSchema } from "@/types/llm";

/**
 * Minimal, dependency-free JSON Schema validator.
 *
 * Trade-off: Ajv is more complete, but it pulls in a code-generating runtime
 * and we only need the subset that LLM structured output actually uses
 * (object/array/string/number/boolean/null, required, enum, nested
 * properties/items, min/max, additionalProperties: false). Keeping it in-repo
 * means the error messages are written for the repair loop — they are fed back
 * to the model verbatim, so they must read like instructions.
 */
export interface ValidationIssue {
  path: string;
  message: string;
}

export interface ValidationResult {
  valid: boolean;
  issues: ValidationIssue[];
}

function typeOf(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

function validateNode(value: unknown, schema: JSONSchema, path: string, issues: ValidationIssue[]): void {
  if (!schema || typeof schema !== "object") return;

  // enum
  const enumValues = schema.enum as unknown[] | undefined;
  if (Array.isArray(enumValues) && !enumValues.some((e) => JSON.stringify(e) === JSON.stringify(value))) {
    issues.push({ path, message: `must be one of ${JSON.stringify(enumValues)}, received ${JSON.stringify(value)}` });
    return;
  }

  const expected = schema.type as string | string[] | undefined;
  if (expected) {
    const expectedList = Array.isArray(expected) ? expected : [expected];
    const actual = typeOf(value);
    const ok = expectedList.some((t) => (t === "integer" ? Number.isInteger(value) : t === actual));
    if (!ok) {
      issues.push({ path, message: `expected type ${expectedList.join(" | ")}, received ${actual}` });
      return;
    }
  }

  if (typeOf(value) === "object") {
    const obj = value as Record<string, unknown>;
    const properties = (schema.properties ?? {}) as Record<string, JSONSchema>;

    for (const key of (schema.required as string[] | undefined) ?? []) {
      if (!(key in obj)) issues.push({ path: `${path}.${key}`, message: "is required but missing" });
    }

    if (schema.additionalProperties === false) {
      for (const key of Object.keys(obj)) {
        if (!(key in properties)) {
          issues.push({ path: `${path}.${key}`, message: "is not an allowed property" });
        }
      }
    }

    for (const [key, sub] of Object.entries(properties)) {
      if (key in obj) validateNode(obj[key], sub, `${path}.${key}`, issues);
    }
  }

  if (Array.isArray(value)) {
    const items = schema.items as JSONSchema | undefined;
    const minItems = schema.minItems as number | undefined;
    const maxItems = schema.maxItems as number | undefined;
    if (minItems != null && value.length < minItems) {
      issues.push({ path, message: `must contain at least ${minItems} item(s)` });
    }
    if (maxItems != null && value.length > maxItems) {
      issues.push({ path, message: `must contain at most ${maxItems} item(s)` });
    }
    if (items) value.forEach((item, i) => validateNode(item, items, `${path}[${i}]`, issues));
  }

  if (typeof value === "string") {
    const minLength = schema.minLength as number | undefined;
    const maxLength = schema.maxLength as number | undefined;
    if (minLength != null && value.length < minLength) {
      issues.push({ path, message: `must be at least ${minLength} characters` });
    }
    if (maxLength != null && value.length > maxLength) {
      issues.push({ path, message: `must be at most ${maxLength} characters` });
    }
  }

  if (typeof value === "number") {
    const minimum = schema.minimum as number | undefined;
    const maximum = schema.maximum as number | undefined;
    if (minimum != null && value < minimum) issues.push({ path, message: `must be >= ${minimum}` });
    if (maximum != null && value > maximum) issues.push({ path, message: `must be <= ${maximum}` });
  }
}

export function validateAgainstSchema(value: unknown, schema: JSONSchema): ValidationResult {
  const issues: ValidationIssue[] = [];
  validateNode(value, schema, "$", issues);
  return { valid: issues.length === 0, issues };
}

/** Human-readable issue list handed straight back to the model for repair. */
export function formatIssues(issues: ValidationIssue[]): string {
  return issues.map((i) => `- ${i.path} ${i.message}`).join("\n");
}

/**
 * LLMs frequently wrap JSON in prose or code fences even when told not to.
 * This extracts the first balanced JSON object/array from a response before we
 * declare the output invalid — cheaper than a repair round-trip.
 */
export function extractJson(text: string): unknown {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1].trim() : trimmed;

  try {
    return JSON.parse(candidate);
  } catch {
    // fall through to balance scanning
  }

  const start = candidate.search(/[[{]/);
  if (start === -1) throw new SyntaxError("No JSON object or array found in model output.");

  const open = candidate[start];
  const close = open === "{" ? "}" : "]";
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < candidate.length; i++) {
    const ch = candidate[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === "\\") {
      escaped = true;
      continue;
    }
    if (ch === '"') inString = !inString;
    if (inString) continue;
    if (ch === open) depth++;
    if (ch === close) {
      depth--;
      if (depth === 0) return JSON.parse(candidate.slice(start, i + 1));
    }
  }

  throw new SyntaxError("Unbalanced JSON in model output.");
}
