// JSON Schema para cada proveedor. El mismo esquema (zod → JSON Schema) sirve de salida estructurada y de argumentos de
// herramientas, pero cada API acepta un subconjunto distinto:
// - Anthropic (salida estructurada): objetos cerrados y sin límites numéricos ni de largo; esos límites pasan a la
//   descripción para que el modelo los respete igual.
// - Gemini: el subconjunto de OpenAPI (nullable en vez de tipos con null, sin additionalProperties).
// - OpenAI y xAI: el esquema tal cual; modo estricto solo si ya cumple sus reglas.
// La validación final siempre la hace zod en quien pidió la respuesta.
import type { JsonSchema } from "./ai.types";

type Schema = Record<string, unknown>;

const isSchema = (value: unknown): value is Schema => typeof value === "object" && value !== null && !Array.isArray(value);
const SAFE_INTEGER_LIMIT = Number.MAX_SAFE_INTEGER;

/** Recorre los subesquemas de un esquema (propiedades, ítems, uniones) y los transforma. */
function mapChildren(schema: Schema, fn: (child: Schema) => Schema): Schema {
  const out: Schema = { ...schema };
  if (isSchema(schema.properties)) {
    out.properties = Object.fromEntries(Object.entries(schema.properties).map(([key, value]) => [key, isSchema(value) ? fn(value) : value]));
  }
  if (isSchema(schema.items)) out.items = fn(schema.items);
  if (Array.isArray(schema.prefixItems)) out.prefixItems = schema.prefixItems.map((item) => (isSchema(item) ? fn(item) : item));
  for (const key of ["anyOf", "oneOf", "allOf"] as const) {
    const list = schema[key];
    if (Array.isArray(list)) out[key] = list.map((item) => (isSchema(item) ? fn(item) : item));
  }
  if (isSchema(schema.additionalProperties)) out.additionalProperties = fn(schema.additionalProperties);
  return out;
}

/** Copia sin `$schema` y con las referencias locales (`#/$defs/...`) ya resueltas. */
export function cleanSchema(schema: JsonSchema): JsonSchema {
  const defs: Schema = {
    ...(isSchema(schema.definitions) ? schema.definitions : {}),
    ...(isSchema(schema.$defs) ? schema.$defs : {}),
  };
  const resolve = (node: Schema, depth: number): Schema => {
    if (depth > 24) return { type: "object" };
    const ref = node.$ref;
    if (typeof ref === "string") {
      const name = /^#\/(?:\$defs|definitions)\/(.+)$/.exec(ref)?.[1];
      const target = name ? defs[decodeURIComponent(name)] : undefined;
      const { $ref: _ref, ...rest } = node;
      return isSchema(target) ? resolve({ ...target, ...rest }, depth + 1) : resolve(rest, depth + 1);
    }
    const { $schema: _s, $id: _i, $defs: _d, definitions: _f, $comment: _c, ...rest } = node;
    return mapChildren(rest, (child) => resolve(child, depth + 1));
  };
  return resolve(schema, 0);
}

/** Los límites que se quitan del esquema, dichos en palabras para la descripción. */
function constraintHints(schema: Schema): string[] {
  const hints: string[] = [];
  const num = (key: string) => (typeof schema[key] === "number" ? (schema[key] as number) : null);
  const minLength = num("minLength");
  const maxLength = num("maxLength");
  if (minLength && maxLength !== null) hints.push(`de ${minLength} a ${maxLength} caracteres`);
  else if (maxLength !== null) hints.push(`máximo ${maxLength} caracteres`);
  else if (minLength) hints.push(`mínimo ${minLength} caracteres`);

  const minimum = num("minimum");
  const maximum = num("maximum");
  const realMin = minimum !== null && Math.abs(minimum) < SAFE_INTEGER_LIMIT ? minimum : null;
  const realMax = maximum !== null && Math.abs(maximum) < SAFE_INTEGER_LIMIT ? maximum : null;
  if (realMin !== null && realMax !== null) hints.push(`entre ${realMin} y ${realMax}`);
  else if (realMin !== null) hints.push(`mínimo ${realMin}`);
  else if (realMax !== null) hints.push(`máximo ${realMax}`);
  const exclusiveMinimum = num("exclusiveMinimum");
  const exclusiveMaximum = num("exclusiveMaximum");
  if (exclusiveMinimum !== null) hints.push(`mayor que ${exclusiveMinimum}`);
  if (exclusiveMaximum !== null) hints.push(`menor que ${exclusiveMaximum}`);
  const multipleOf = num("multipleOf");
  if (multipleOf !== null) hints.push(`múltiplo de ${multipleOf}`);

  const minItems = num("minItems");
  const maxItems = num("maxItems");
  if (minItems && minItems > 1 && maxItems !== null) hints.push(`de ${minItems} a ${maxItems} elementos`);
  else if (maxItems !== null) hints.push(`máximo ${maxItems} elementos`);
  else if (minItems && minItems > 1) hints.push(`mínimo ${minItems} elementos`);
  return hints;
}

function withHints(schema: Schema, hints: string[]): Schema {
  if (hints.length === 0) return schema;
  const note = `(${hints.join("; ")})`;
  const description = typeof schema.description === "string" && schema.description.trim() ? `${schema.description.trim()} ${note}` : note;
  return { ...schema, description };
}

const isObjectSchema = (schema: Schema) => schema.type === "object" || isSchema(schema.properties);

const ANTHROPIC_FORMATS = new Set(["date-time", "time", "date", "duration", "email", "hostname", "uri", "ipv4", "ipv6", "uuid"]);
const ANTHROPIC_DROP = [
  "minimum",
  "maximum",
  "exclusiveMinimum",
  "exclusiveMaximum",
  "multipleOf",
  "minLength",
  "maxLength",
  "pattern",
  "maxItems",
  "default",
  "examples",
  "title",
  "not",
  "if",
  "then",
  "else",
  "patternProperties",
  "propertyNames",
  "dependentRequired",
  "dependentSchemas",
  "unevaluatedProperties",
  "contains",
  "uniqueItems",
] as const;

/** Salida estructurada de Anthropic: objetos cerrados, sin límites de número ni de largo (van a la descripción). */
export function toAnthropicOutputSchema(schema: JsonSchema): JsonSchema {
  const convert = (node: Schema): Schema => {
    const hints = constraintHints(node);
    const out: Schema = { ...node };
    for (const key of ANTHROPIC_DROP) delete out[key];
    if (typeof out.minItems === "number" && out.minItems > 1) delete out.minItems;
    if (typeof out.format === "string" && !ANTHROPIC_FORMATS.has(out.format)) delete out.format;
    if ("const" in out) {
      out.enum = [out.const];
      delete out.const;
    }
    if (Array.isArray(out.oneOf)) {
      out.anyOf = out.oneOf;
      delete out.oneOf;
    }
    if (isObjectSchema(out)) out.additionalProperties = false;
    return withHints(mapChildren(out, convert), hints);
  };
  return convert(cleanSchema(schema));
}

const GEMINI_KEYS = new Set([
  "type",
  "format",
  "description",
  "nullable",
  "enum",
  "items",
  "properties",
  "required",
  "minItems",
  "maxItems",
  "minimum",
  "maximum",
  "anyOf",
  "propertyOrdering",
]);
const isNullSchema = (value: unknown) => isSchema(value) && value.type === "null";

/**
 * Esquema de Gemini (subconjunto de OpenAPI): un solo `type` con `nullable`, `anyOf` sin la rama null, `enum` solo de
 * textos y sin `additionalProperties`. Con `ordered`, agrega `propertyOrdering` para que responda en el orden declarado.
 */
export function toGeminiSchema(schema: JsonSchema, opts: { ordered?: boolean } = {}): JsonSchema {
  const convert = (input: Schema): Schema => {
    let node: Schema = { ...input };
    // [X, "null"] → X + nullable.
    if (Array.isArray(node.type)) {
      const types = node.type.filter((type): type is string => typeof type === "string");
      const nonNull = types.filter((type) => type !== "null");
      node.type = nonNull[0] ?? "string";
      if (types.includes("null")) node.nullable = true;
    }
    // anyOf/oneOf con una rama null → la otra rama + nullable.
    const union = Array.isArray(node.anyOf) ? node.anyOf : Array.isArray(node.oneOf) ? node.oneOf : null;
    if (union) {
      const branches = union.filter(isSchema);
      const nonNull = branches.filter((branch) => !isNullSchema(branch));
      const nullable = nonNull.length < branches.length || node.nullable === true;
      const { anyOf: _a, oneOf: _o, ...rest } = node;
      if (nonNull.length === 1) {
        // Una sola rama: se funde con el esquema (la descripción de afuera manda) y se convierte de nuevo.
        const merged = convert({ ...rest, ...nonNull[0], ...(rest.description ? { description: rest.description } : {}) });
        return nullable ? { ...merged, nullable: true } : merged;
      }
      node = { ...rest, anyOf: nonNull };
      if (nullable) node.nullable = true;
    }
    if ("const" in node) {
      node.enum = [node.const];
      delete node.const;
    }
    const hints = constraintHints({ minLength: node.minLength, maxLength: node.maxLength });
    if (Array.isArray(node.enum)) {
      if (node.enum.every((value) => typeof value === "string")) {
        node.type = "string";
      } else {
        delete node.enum;
      }
    }
    if (typeof node.exclusiveMinimum === "number" && node.minimum === undefined) node.minimum = node.exclusiveMinimum;
    if (typeof node.exclusiveMaximum === "number" && node.maximum === undefined) node.maximum = node.exclusiveMaximum;
    for (const key of ["minimum", "maximum"] as const) {
      if (typeof node[key] === "number" && Math.abs(node[key] as number) >= SAFE_INTEGER_LIMIT) delete node[key];
    }
    if (node.format !== undefined && node.format !== "date-time" && node.format !== "enum") delete node.format;
    if (isObjectSchema(node)) {
      node.type = "object";
      if (opts.ordered && isSchema(node.properties)) node.propertyOrdering = Object.keys(node.properties);
    }
    const kept = Object.fromEntries(Object.entries(node).filter(([key]) => GEMINI_KEYS.has(key)));
    return withHints(mapChildren(kept, convert), hints);
  };
  return convert(cleanSchema(schema));
}

const STRICT_FORBIDDEN = ["default", "oneOf", "allOf", "not", "if", "patternProperties", "dependentRequired"];

/** ¿Cumple el modo estricto de OpenAI/xAI tal cual? (todo objeto cerrado y con todas sus propiedades obligatorias) */
export function isStrictCompatible(schema: JsonSchema): boolean {
  const check = (node: Schema): boolean => {
    if (STRICT_FORBIDDEN.some((key) => key in node)) return false;
    if (isObjectSchema(node)) {
      if (node.additionalProperties !== false) return false;
      const properties = isSchema(node.properties) ? Object.keys(node.properties) : [];
      const required = Array.isArray(node.required) ? new Set(node.required) : new Set();
      if (properties.some((key) => !required.has(key))) return false;
    }
    const children: Schema[] = [];
    mapChildren(node, (child) => {
      children.push(child);
      return child;
    });
    return children.every(check);
  };
  return check(cleanSchema(schema));
}

/** Las APIs piden un objeto en la raíz: si el esquema es otra cosa (una lista), va dentro de `value`. */
export function objectRoot(schema: JsonSchema): { schema: JsonSchema; wrapped: boolean } {
  if (isObjectSchema(schema)) return { schema, wrapped: false };
  return { schema: { type: "object", properties: { value: schema }, required: ["value"], additionalProperties: false }, wrapped: true };
}

/** Lo que va dentro de `value` en una respuesta envuelta por objectRoot (undefined si no se pudo leer). */
export function unwrapJson(text: string): unknown {
  const parsed = parseJsonText(text);
  return parsed.ok && isSchema(parsed.value) && "value" in parsed.value ? parsed.value.value : undefined;
}

/** JSON de la respuesta de un modelo: tolera bloques ```json y texto alrededor del objeto. */
export function parseJsonText(text: string): { ok: true; value: unknown } | { ok: false } {
  const trimmed = text.trim();
  if (!trimmed) return { ok: false };
  const unfenced = trimmed.replace(/^```[a-zA-Z]*\s*/, "").replace(/\s*```$/, "");
  const candidates = [unfenced];
  const start = unfenced.search(/[[{]/);
  if (start > 0 || (start === 0 && !/[}\]]$/.test(unfenced))) {
    const close = unfenced[start] === "{" ? "}" : "]";
    const end = unfenced.lastIndexOf(close);
    if (end > start) candidates.push(unfenced.slice(start, end + 1));
  }
  for (const candidate of candidates) {
    try {
      return { ok: true, value: JSON.parse(candidate) as unknown };
    } catch {
      // Siguiente candidato.
    }
  }
  return { ok: false };
}
