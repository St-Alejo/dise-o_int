// Exporta los contratos con los servicios de Python como JSON Schema para sus tests de contrato:
// worker <-> IA y API <-> nodo Blender.
import { writeFileSync, mkdirSync } from 'node:fs';
import { z } from 'zod';
import { AI_CONTRACT_SCHEMAS, BLENDER_CONTRACT_SCHEMAS } from '../dist/index.js';

mkdirSync(new URL('../generated/', import.meta.url), { recursive: true });

function write(file, schemas) {
  const defs = Object.fromEntries(Object.entries(schemas).map(([name, schema]) => [name, z.toJSONSchema(schema, { io: 'input' })]));
  writeFileSync(
    new URL(`../generated/${file}`, import.meta.url),
    JSON.stringify({ $comment: 'Generado por scripts/export-json-schema.mjs — no editar a mano', schemas: defs }, null, 2) + '\n',
  );
  console.log(`${file} actualizado`);
}

write('ai-contract.schema.json', AI_CONTRACT_SCHEMAS);
write('blender-contract.schema.json', BLENDER_CONTRACT_SCHEMAS);
