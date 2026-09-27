// scripts/swarm/validate-schemas.ts — prove each swarm schema accepts its valid fixture and
// rejects its invalid one. Minimal JSON-Schema draft-07 subset validator (no new deps):
// supports type, required, properties (recursive), items, additionalProperties:false, enum,
// const, pattern, minLength, minItems. Contracts only — no swarm runtime.
import { readdirSync, readFileSync } from 'node:fs';
import { join, basename } from 'node:path';

const SCHEMAS_DIR = join(process.cwd(), 'core', 'swarm', 'schemas');
const FIXTURES_DIR = join(SCHEMAS_DIR, 'fixtures');

type V = (schema: any, value: unknown, path: string, errors: string[]) => void;

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const typeOk = (t: string, v: unknown): boolean =>
  t === 'object' ? isObject(v)
  : t === 'array' ? Array.isArray(v)
  : t === 'string' ? typeof v === 'string'
  : t === 'integer' ? Number.isInteger(v)
  : t === 'number' ? typeof v === 'number'
  : t === 'boolean' ? typeof v === 'boolean'
  : t === 'null' ? v === null
  : false;

const validate: V = (schema, value, path, errors) => {
  if (schema.type) {
    const types: string[] = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!types.some((t) => typeOk(t, value))) {
      errors.push(`${path}: expected type ${types.join('|')}, got ${Array.isArray(value) ? 'array' : typeof value}`);
      return; // type wrong — no point recursing
    }
  }
  if (schema.enum && !schema.enum.includes(value)) {
    errors.push(`${path}: not in enum [${schema.enum.join(', ')}]`);
  }
  if ('const' in schema && value !== schema.const) {
    errors.push(`${path}: must equal ${JSON.stringify(schema.const)}`);
  }
  if (schema.pattern && typeof value === 'string' && !new RegExp(schema.pattern).test(value)) {
    errors.push(`${path}: does not match /${schema.pattern}/`);
  }
  if (schema.minLength != null && typeof value === 'string' && value.length < schema.minLength) {
    errors.push(`${path}: shorter than minLength ${schema.minLength}`);
  }
  if (schema.minItems != null && Array.isArray(value) && value.length < schema.minItems) {
    errors.push(`${path}: fewer than minItems ${schema.minItems}`);
  }
  if (isObject(value)) {
    for (const req of schema.required || []) {
      if (!(req in value)) errors.push(`${path}: missing required "${req}"`);
    }
    if (schema.additionalProperties === false && schema.properties) {
      for (const key of Object.keys(value)) {
        if (!(key in schema.properties)) errors.push(`${path}: additional property "${key}" not allowed`);
      }
    }
    for (const [key, sub] of Object.entries(schema.properties || {})) {
      if (key in value) validate(sub, (value as any)[key], `${path}.${key}`, errors);
    }
  }
  if (Array.isArray(value) && schema.items) {
    value.forEach((el, i) => validate(schema.items, el, `${path}[${i}]`, errors));
  }
};

let failures = 0;
const pass = (m: string) => console.log(`  ok    ${m}`);
const fail = (m: string) => { console.error(`  FAIL  ${m}`); failures++; };

const schemaFiles = readdirSync(SCHEMAS_DIR).filter((f) => f.endsWith('.json')).sort();
if (schemaFiles.length === 0) { fail('no schemas found'); process.exit(1); }

for (const file of schemaFiles) {
  const name = basename(file, '.json');
  const schema = JSON.parse(readFileSync(join(SCHEMAS_DIR, file), 'utf8'));
  const load = (kind: 'valid' | 'invalid') => {
    try { return JSON.parse(readFileSync(join(FIXTURES_DIR, `${name}.${kind}.json`), 'utf8')); }
    catch { return undefined; }
  };
  const valid = load('valid');
  const invalid = load('invalid');
  if (valid === undefined) { fail(`${name}: missing valid fixture`); continue; }
  if (invalid === undefined) { fail(`${name}: missing invalid fixture`); continue; }

  const ve: string[] = []; validate(schema, valid, name, ve);
  if (ve.length === 0) pass(`${name}: valid fixture passes`);
  else fail(`${name}: valid fixture REJECTED — ${ve[0]}`);

  const ie: string[] = []; validate(schema, invalid, name, ie);
  if (ie.length > 0) pass(`${name}: invalid fixture refused (${ie.length} violation(s))`);
  else fail(`${name}: invalid fixture ACCEPTED — the schema has a hole`);
}

console.log(failures === 0 ? 'swarm schemas: all valid/invalid fixtures behave' : `swarm schemas: ${failures} failure(s)`);
process.exit(failures === 0 ? 0 : 1);
