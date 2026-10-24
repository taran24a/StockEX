import * as Minio from "minio";
import type { Environment } from "./config/index.js";

export function createObjectStorage(environment: Environment): Minio.Client {
  // SYLLABUS: MinIO
  return new Minio.Client({
    endPoint: environment.MINIO_ENDPOINT,
    port: environment.MINIO_PORT,
    useSSL: environment.MINIO_USE_SSL,
    accessKey: environment.MINIO_ACCESS_KEY,
    secretKey: environment.MINIO_SECRET_KEY
  });
}

export async function ensureUploadBucket(client: Minio.Client, bucket: string): Promise<void> {
  if (!(await client.bucketExists(bucket))) {
    await client.makeBucket(bucket);
  }
}
