// Nodo Blender falso para las pruebas E2E (CI no tiene GPU ni Blender).
// Cumple el mismo contrato que services/blender: latido en Redis, consume `render-jobs`,
// informa avance, sube PNG, JPEG y .blend con las claves del trabajo y devuelve un BlenderResult.
// Corre con la imagen de la API (trae bullmq, ioredis, sharp y el cliente S3): ver el servicio
// `blender-fake` de docker-compose.yml.
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { Worker } from 'bullmq';
import { Redis } from 'ioredis';
import sharp from 'sharp';

const QUEUE = 'render-jobs';
const HEARTBEAT_KEY = 'render-node:heartbeat';
const env = process.env;

const redis = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
const s3 = new S3Client({
  region: env.S3_REGION ?? 'us-east-1',
  endpoint: env.S3_ENDPOINT,
  forcePathStyle: env.S3_FORCE_PATH_STYLE !== 'false',
  credentials: { accessKeyId: env.S3_ACCESS_KEY_ID, secretAccessKey: env.S3_SECRET_ACCESS_KEY },
});
const put = (Key, Body, ContentType) => s3.send(new PutObjectCommand({ Bucket: env.S3_BUCKET, Key, Body, ContentType }));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const beat = () => redis.set(HEARTBEAT_KEY, JSON.stringify({ device: 'FAKE', at: new Date().toISOString() }), 'EX', 30);
await beat();
const timer = setInterval(() => void beat(), 10_000);

const worker = new Worker(
  QUEUE,
  async (job) => {
    const { outputPrefix, plan } = job.data;
    for (const pct of [10, 50, 90]) {
      await job.updateProgress(pct);
      await sleep(400);
    }
    // Una imagen de verdad (pequeña) para que la galería la pueda mostrar.
    const image = sharp({ create: { width: Math.round(plan.width / 8), height: Math.round(plan.height / 8), channels: 3, background: '#d9c7a7' } });
    await put(`${outputPrefix}.png`, await image.clone().png().toBuffer(), 'image/png');
    await put(`${outputPrefix}.jpg`, await image.clone().jpeg().toBuffer(), 'image/jpeg');
    await put(`${outputPrefix}.blend`, Buffer.from('BLENDER-v405 escena falsa'), 'application/x-blender');
    return { imageKey: `${outputPrefix}.png`, previewKey: `${outputPrefix}.jpg`, blendKey: `${outputPrefix}.blend`, seconds: 1.2, device: 'FAKE' };
  },
  { connection: redis.duplicate(), concurrency: 1 },
);
console.log('Nodo Blender falso escuchando', QUEUE);

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, async () => {
    clearInterval(timer);
    await redis.del(HEARTBEAT_KEY);
    await worker.close();
    process.exit(0);
  });
}
