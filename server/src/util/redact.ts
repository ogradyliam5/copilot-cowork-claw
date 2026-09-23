/**
 * Redaction for logs. We must never log API keys, passwords, tokens, or
 * full secret environment values.
 */

const SECRET_KEY_PATTERN = /(pass(word)?|secret|token|api[-_]?key|client[-_]?secret|connectionstring|sas|bearer)/i;
const SECRET_VALUE_PATTERNS: RegExp[] = [
  /\bghp_[A-Za-z0-9]{20,}\b/g, // GitHub PAT
  /\bgho_[A-Za-z0-9]{20,}\b/g,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, // JWT
  /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g, // Slack
];

const MASK = '***REDACTED***';

/** Redact an environment-variable-like record by key name. */
export function redactEnv(env: Record<string, string | undefined>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) continue;
    out[k] = SECRET_KEY_PATTERN.test(k) ? MASK : v;
  }
  return out;
}

/** Redact known secret-shaped substrings from free text (e.g. logged stdout). */
export function redactText(text: string): string {
  let out = text;
  for (const re of SECRET_VALUE_PATTERNS) out = out.replace(re, MASK);
  return out;
}
