/**
 * OpenAPI seed catalog validation - MMO-31
 *
 * Every seed catalog document must validate against the OpenAPI entity schemas.
 * Undeclared seed keys fail so spec/seed drift is caught in CI.
 */

import * as fs from 'fs';
import * as path from 'path';
import Ajv, { ErrorObject, ValidateFunction } from 'ajv';
import addFormats from 'ajv-formats';
import * as yaml from 'js-yaml';
import {
  CLASSES_V1,
  COMBAT_CONSTANTS_V1,
  COMBAT_CONSTANTS_V2,
  ELEMENTS_V1,
  RESONANCES_V1,
  SKILLS_V1,
  STATUSES_V1,
} from '../lib/game-metadata';

type JsonSchema = Record<string, unknown>;

interface OpenApiSpec {
  components: {
    schemas: Record<string, JsonSchema>;
  };
}

const SPEC_PATH = path.join(__dirname, '../contracts/openapi.yaml');
const RESOURCE_IDS = [
  'resolve',
  'focus',
  'mana',
  'charge',
  'radiance',
  'judgement',
  'momentum',
] as const;

function loadSpec(): OpenApiSpec {
  return yaml.load(fs.readFileSync(SPEC_PATH, 'utf8')) as OpenApiSpec;
}

function convertOpenApiSchema(schema: unknown): unknown {
  if (Array.isArray(schema)) {
    return schema.map(convertOpenApiSchema);
  }
  if (!schema || typeof schema !== 'object') {
    return schema;
  }

  const obj = { ...(schema as JsonSchema) };
  const nullable = obj.nullable === true;
  delete obj.nullable;

  for (const [key, value] of Object.entries(obj)) {
    if (key !== '$ref') {
      obj[key] = convertOpenApiSchema(value);
    }
  }

  if (!nullable) {
    return obj;
  }
  if (typeof obj.type === 'string') {
    obj.type = [obj.type, 'null'];
    return obj;
  }
  if (Array.isArray(obj.type) && !obj.type.includes('null')) {
    obj.type = [...obj.type, 'null'];
    return obj;
  }
  return { anyOf: [obj, { type: 'null' }] };
}

function createAjv(spec: OpenApiSpec): Ajv {
  const ajv = new Ajv({
    allErrors: true,
    strict: false,
    validateFormats: true,
  });
  addFormats(ajv);

  for (const [name, schema] of Object.entries(spec.components.schemas)) {
    ajv.addSchema(convertOpenApiSchema(schema) as object, `#/components/schemas/${name}`);
  }
  return ajv;
}

function formatErrors(errors: ErrorObject[] | null | undefined): string {
  if (!errors?.length) {
    return 'unknown validation error';
  }
  return errors
    .map((err) => `${err.instancePath || '/'} ${err.message}${err.params ? ` ${JSON.stringify(err.params)}` : ''}`)
    .join('\n');
}

function resolveRef(schema: JsonSchema, schemas: Record<string, JsonSchema>): JsonSchema {
  const ref = schema.$ref;
  if (typeof ref !== 'string') {
    return schema;
  }
  const prefix = '#/components/schemas/';
  if (!ref.startsWith(prefix)) {
    throw new Error(`Unsupported $ref: ${ref}`);
  }
  const name = ref.slice(prefix.length);
  const target = schemas[name];
  if (!target) {
    throw new Error(`Missing schema ${name}`);
  }
  return resolveRef(target, schemas);
}

function mergedProperties(
  schema: JsonSchema,
  schemas: Record<string, JsonSchema>
): Record<string, JsonSchema> {
  const resolved = resolveRef(schema, schemas);
  const props: Record<string, JsonSchema> = {};

  const allOf = resolved.allOf;
  if (Array.isArray(allOf)) {
    for (const part of allOf) {
      Object.assign(props, mergedProperties(part as JsonSchema, schemas));
    }
  }

  const own = resolved.properties;
  if (own && typeof own === 'object') {
    Object.assign(props, own as Record<string, JsonSchema>);
  }
  return props;
}

function additionalPropertiesSchema(
  schema: JsonSchema,
  schemas: Record<string, JsonSchema>
): JsonSchema | boolean | undefined {
  const resolved = resolveRef(schema, schemas);
  if (resolved.additionalProperties !== undefined) {
    return resolved.additionalProperties as JsonSchema | boolean;
  }
  const allOf = resolved.allOf;
  if (Array.isArray(allOf)) {
    for (const part of allOf) {
      const extra = additionalPropertiesSchema(part as JsonSchema, schemas);
      if (extra !== undefined) {
        return extra;
      }
    }
  }
  return undefined;
}

function itemsSchema(
  schema: JsonSchema,
  schemas: Record<string, JsonSchema>
): JsonSchema | undefined {
  const resolved = resolveRef(schema, schemas);
  if (resolved.items && typeof resolved.items === 'object') {
    return resolved.items as JsonSchema;
  }
  return undefined;
}

/**
 * Fail if seed JSON has a key the OpenAPI schema does not declare.
 * Maps that set additionalProperties to a schema (effectOverrides, targetVariants,
 * additionalConstants, strongAgainst, etc.) may use dynamic keys.
 */
function assertDeclaredKeys(
  data: unknown,
  schema: JsonSchema,
  schemas: Record<string, JsonSchema>,
  pointer: string
): void {
  if (data === null || typeof data !== 'object') {
    return;
  }

  if (Array.isArray(data)) {
    const items = itemsSchema(schema, schemas);
    if (!items) {
      return;
    }
    data.forEach((item, index) => {
      assertDeclaredKeys(item, items, schemas, `${pointer}/${index}`);
    });
    return;
  }

  const props = mergedProperties(schema, schemas);
  const extra = additionalPropertiesSchema(schema, schemas);

  for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
    const child = props[key];
    if (child) {
      assertDeclaredKeys(value, child, schemas, `${pointer}/${key}`);
      continue;
    }
    if (extra && typeof extra === 'object') {
      assertDeclaredKeys(value, extra, schemas, `${pointer}/${key}`);
      continue;
    }
    throw new Error(`Seed key ${pointer}/${key} is not declared in the OpenAPI schema`);
  }
}

function expectValid(validate: ValidateFunction, document: unknown, label: string): void {
  const ok = validate(document);
  if (!ok) {
    throw new Error(`${label} failed OpenAPI validation:\n${formatErrors(validate.errors)}`);
  }
}

describe('OpenAPI spec vs seed catalogs (MMO-31)', () => {
  const spec = loadSpec();
  const schemas = spec.components.schemas;
  const ajv = createAjv(spec);

  const validateClass = ajv.getSchema('#/components/schemas/ClassDefinition');
  const validateSkill = ajv.getSchema('#/components/schemas/SkillDefinition');
  const validateStatus = ajv.getSchema('#/components/schemas/StatusDefinition');
  const validateElement = ajv.getSchema('#/components/schemas/ElementDefinition');
  const validateResonance = ajv.getSchema('#/components/schemas/ResonanceDefinition');
  const validateCombat = ajv.getSchema('#/components/schemas/CombatConstantsData');

  it('loads the entity schemas used by catalog publish', () => {
    expect(validateClass).toBeDefined();
    expect(validateSkill).toBeDefined();
    expect(validateStatus).toBeDefined();
    expect(validateElement).toBeDefined();
    expect(validateResonance).toBeDefined();
    expect(validateCombat).toBeDefined();
  });

  describe('every seed document validates', () => {
    it.each(CLASSES_V1.map((doc) => [doc.classId, doc] as const))(
      'class %s',
      (_id, doc) => {
        expectValid(validateClass!, doc, `class ${doc.classId}`);
        assertDeclaredKeys(doc, schemas.ClassDefinition, schemas, `/class/${doc.classId}`);
      }
    );

    it.each(SKILLS_V1.map((doc) => [doc.skillId, doc] as const))(
      'skill %s',
      (_id, doc) => {
        expectValid(validateSkill!, doc, `skill ${doc.skillId}`);
        assertDeclaredKeys(doc, schemas.SkillDefinition, schemas, `/skill/${doc.skillId}`);
      }
    );

    it.each(STATUSES_V1.map((doc) => [doc.statusId, doc] as const))(
      'status %s',
      (_id, doc) => {
        expectValid(validateStatus!, doc, `status ${doc.statusId}`);
        assertDeclaredKeys(doc, schemas.StatusDefinition, schemas, `/status/${doc.statusId}`);
      }
    );

    it.each(ELEMENTS_V1.map((doc) => [doc.elementId, doc] as const))(
      'element %s',
      (_id, doc) => {
        expectValid(validateElement!, doc, `element ${doc.elementId}`);
        assertDeclaredKeys(doc, schemas.ElementDefinition, schemas, `/element/${doc.elementId}`);
      }
    );

    it.each(RESONANCES_V1.map((doc) => [doc.resonanceId, doc] as const))(
      'resonance %s',
      (_id, doc) => {
        expectValid(validateResonance!, doc, `resonance ${doc.resonanceId}`);
        assertDeclaredKeys(doc, schemas.ResonanceDefinition, schemas, `/resonance/${doc.resonanceId}`);
      }
    );

    it('combat-constants v1', () => {
      expectValid(validateCombat!, COMBAT_CONSTANTS_V1, 'combat-constants v1');
      assertDeclaredKeys(COMBAT_CONSTANTS_V1, schemas.CombatConstantsData, schemas, '/combat-constants/v1');
    });

    it('combat-constants v2', () => {
      expectValid(validateCombat!, COMBAT_CONSTANTS_V2, 'combat-constants v2');
      assertDeclaredKeys(COMBAT_CONSTANTS_V2, schemas.CombatConstantsData, schemas, '/combat-constants/v2');
    });
  });

  describe('MMO-31 schema gaps are declared', () => {
    const perStack = schemas.PerStackCoefficients.properties as JsonSchema;
    const conditional = schemas.ConditionalCoefficient.properties as JsonSchema;
    const skillCoefficients = schemas.SkillCoefficients.properties as JsonSchema;
    const stagger = schemas.StaggerCoefficients.properties as JsonSchema;
    const pvp = schemas.PvPMultipliers.properties as JsonSchema;
    const classProps = schemas.ClassDefinition.properties as JsonSchema;

    it('declares perStack.scalingPerStack', () => {
      expect(perStack.scalingPerStack).toBeDefined();
    });

    it('declares conditionals[].scaling', () => {
      expect(conditional.scaling).toBeDefined();
    });

    it('declares coefficients.targetVariants', () => {
      expect(skillCoefficients.targetVariants).toBeDefined();
    });

    it('declares stagger.targetVariants', () => {
      expect(stagger.targetVariants).toBeDefined();
    });

    it('declares extra PvP keys used by seed', () => {
      expect(pvp.statusOverrides).toBeDefined();
      expect(pvp.missingHealthCap).toBeDefined();
      expect(pvp.exhaustedDurationSeconds).toBeDefined();
    });

    it('secondaryResource uses ResourceId, not judgement-only', () => {
      expect(classProps.secondaryResource).toEqual({
        $ref: '#/components/schemas/ResourceId',
        description: expect.any(String),
      });
      expect(schemas.ResourceId.enum).toEqual([...RESOURCE_IDS]);
    });
  });

  describe('identity ids and ResourceId', () => {
    const baseClass = { ...CLASSES_V1[0] };

    it('accepts new class / resonance / element ids the admin can add', () => {
      expectValid(
        validateClass!,
        { ...baseClass, classId: 'new_class', resonance: 'new_resonance' },
        'new class id'
      );
      expectValid(
        validateElement!,
        { ...ELEMENTS_V1[0], elementId: 'void' },
        'new element id'
      );
      expectValid(
        validateResonance!,
        { ...RESONANCES_V1[0], resonanceId: 'harmony' },
        'new resonance id'
      );
      expectValid(
        validateSkill!,
        { ...SKILLS_V1[0], skillId: 'new_class_new_skill', classId: 'new_class' },
        'new skill id'
      );
    });

    it('rejects identity ids that do not match the catalog id pattern', () => {
      expect(validateClass!({ ...baseClass, classId: 'NewClass' })).toBe(false);
      expect(validateClass!({ ...baseClass, classId: 'new-class' })).toBe(false);
      expect(validateClass!({ ...baseClass, classId: '' })).toBe(false);
    });

    it.each(RESOURCE_IDS)('accepts secondaryResource %s', (resourceId) => {
      expectValid(
        validateClass!,
        { ...baseClass, secondaryResource: resourceId },
        `secondaryResource ${resourceId}`
      );
    });

    it('rejects secondaryResource values outside ResourceId', () => {
      expect(validateClass!({ ...baseClass, secondaryResource: 'energy' })).toBe(false);
    });
  });
});
