// Exporta el contrato worker <-> IA como JSON Schema para el test de contrato de Python.
import { writeFileSync, mkdirSync } from 'node:fs';
import { z } from 'zod';
import { AI_CONTRACT_SCHEMAS } from '../dist/index.js';

const defs = Object.fromEntries(
  Object.entries(AI_CONTRACT_SCHEMAS).map(([name, schema]) => [name, z.toJSONSchema(schema, { io: 'input' })]),
);
mkdirSync(new URL('../generated/', import.meta.url), { recursive: true });
writeFileSync(
  new URL('../generated/ai-contract.schema.json', import.meta.url),
  JSON.stringify({ $comment: 'Generado por scripts/export-json-schema.mjs — no editar a mano', schemas: defs }, null, 2) + '\n',
);
console.log('ai-contract.schema.json actualizado');
