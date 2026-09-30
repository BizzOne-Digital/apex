import mongoose from 'mongoose';

let connectPromise: Promise<typeof mongoose> | null = null;

/** Cached connection for serverless (Vercel) and local server. */
export async function connectMongo(uri: string): Promise<typeof mongoose> {
  if (mongoose.connection.readyState === 1) {
    return mongoose;
  }
  if (!connectPromise) {
    connectPromise = mongoose.connect(uri);
  }
  return connectPromise;
}
