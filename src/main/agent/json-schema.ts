// Canonical JSON-schema validation for structured model output.
//
// One validator for the whole app: provider structured-output re-validation
// (providers/base.ts), the agent loop's schema-constrained replies (loop.ts),
// and the subagent runtime's per-tool output checks (runtime.ts) all used to
// carry their own copies — three sources of truth for "does this reply satisfy
// the schema" was a correctness problem waiting to diverge.

export function parseJson(content: string): { ok: true; value: unknown } | { ok: false } {
  try { return { ok: true, value: JSON.parse(content) }; }
  catch { return { ok: false }; }
}

export function validateJsonSchema(value: unknown, schema: Record<string, unknown>, path = '$'): { valid: boolean; error?: string } {
  const type = schema.type;
  if (typeof type === 'string') {
    const validType = type === 'object' ? typeof value === 'object' && value !== null && !Array.isArray(value)
      : type === 'array' ? Array.isArray(value)
        : type === 'null' ? value === null
          : typeof value === type;
    if (!validType) return { valid: false, error: `${path} must be ${type}.` };
  }
  if (Array.isArray(schema.enum) && !schema.enum.some((item) => JSON.stringify(item) === JSON.stringify(value))) {
    return { valid: false, error: `${path} must match one of the allowed values.` };
  }
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    const object = value as Record<string, unknown>;
    for (const required of Array.isArray(schema.required) ? schema.required : []) {
      if (typeof required === 'string' && !(required in object)) return { valid: false, error: `${path}.${required} is required.` };
    }
    const properties = schema.properties as Record<string, Record<string, unknown>> | undefined;
    if (properties) {
      for (const [key, childSchema] of Object.entries(properties)) {
        if (key in object) {
          const result = validateJsonSchema(object[key], childSchema, `${path}.${key}`);
          if (!result.valid) return result;
        }
      }
    }
  }
  if (Array.isArray(value) && schema.items && typeof schema.items === 'object') {
    for (let index = 0; index < value.length; index++) {
      const result = validateJsonSchema(value[index], schema.items as Record<string, unknown>, `${path}[${index}]`);
      if (!result.valid) return result;
    }
  }
  return { valid: true };
}
