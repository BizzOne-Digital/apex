/**
 * Shards the account collections on a sharded MongoDB cluster (Atlas M30+ sharded cluster or self-managed).
 *
 *   users       shard key { _id: 'hashed' }   even spread; every authenticated request is a targeted lookup
 *   useremails  shard key { email: 1 }        unique: one account per email, enforced cluster-wide
 *
 * Usage:   npm run shard:users            (prints the plan, changes nothing)
 *          npm run shard:users -- --confirm
 *
 * Do this once, when you actually need it (sharding cannot be undone without resharding). After it succeeds
 * set USERS_SHARDED=true in the server environment so the app stops declaring a unique index on users.email.
 * It does not work on Atlas M0/M2/M5 or a standalone/replica-set-only deployment.
 */
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { User } from '../src/models/User.js';
import { UserEmail } from '../src/models/UserEmail.js';

dotenv.config();

async function main(): Promise<void> {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('MONGODB_URI required');
  const confirm = process.argv.includes('--confirm');
  await mongoose.connect(uri);
  const db = mongoose.connection.db!;
  const dbName = db.databaseName;
  const admin = db.admin();
  const usersNs = `${dbName}.${User.collection.name}`;
  const emailsNs = `${dbName}.${UserEmail.collection.name}`;

  console.log('Plan:');
  console.log(`  1. enableSharding on database "${dbName}"`);
  console.log(`  2. ${User.collection.name}: drop the unique email index, add a plain one, shard on { _id: "hashed" }`);
  console.log(`  3. ${UserEmail.collection.name}: ensure the unique email index, shard on { email: 1 } (unique)`);
  if (!confirm) {
    console.log('\nDry run only. Re-run with --confirm to apply.');
    await mongoose.disconnect();
    return;
  }

  try {
    await admin.command({ listShards: 1 });
  } catch {
    throw new Error('This deployment is not a sharded cluster (listShards failed). Sharding needs Atlas M30+ (sharded) or a self-managed sharded cluster.');
  }

  await admin.command({ enableSharding: dbName }).catch((e: Error) => {
    if (!/already enabled/i.test(e.message)) throw e;
  });

  const users = db.collection(User.collection.name);
  await users.dropIndex('email_1').catch(() => undefined); // the unique one; uniqueness now lives in useremails
  await users.createIndex({ email: 1 });
  await admin.command({ shardCollection: usersNs, key: { _id: 'hashed' } });
  console.log(`sharded ${usersNs} on { _id: "hashed" }`);

  const emails = db.collection(UserEmail.collection.name);
  await emails.createIndex({ email: 1 }, { unique: true });
  await admin.command({ shardCollection: emailsNs, key: { email: 1 }, unique: true });
  console.log(`sharded ${emailsNs} on { email: 1 } (unique)`);

  console.log('\nDone. Now set USERS_SHARDED=true (and USER_LEGACY_EMAIL_LOOKUP=false once the backfill has run) and redeploy.');
  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e.message ?? e);
  process.exit(1);
});
