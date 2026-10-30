/**
 * One-off: creates the email directory entry for every account that existed before it was introduced.
 * Safe to re-run (idempotent). Run it before sharding and before setting USER_LEGACY_EMAIL_LOOKUP=false.
 *
 *   npm run backfill:user-emails
 */
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { User } from '../src/models/User.js';
import { UserEmail } from '../src/models/UserEmail.js';

dotenv.config();

async function main(): Promise<void> {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('MONGODB_URI required');
  await mongoose.connect(uri);
  let created = 0;
  let total = 0;
  for await (const u of User.find({}, { email: 1 }).cursor()) {
    total++;
    const r = await UserEmail.updateOne({ email: u.email }, { $setOnInsert: { userId: u._id.toString() } }, { upsert: true });
    if (r.upsertedCount) created++;
  }
  console.log(`${total} accounts checked, ${created} directory entries created.`);
  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
