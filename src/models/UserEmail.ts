import mongoose, { Schema } from 'mongoose';

/**
 * Email directory: email -> userId.
 *
 * Why it exists: `users` is sharded by hashed _id (even spread, every authenticated request is a targeted
 * lookup), but MongoDB cannot enforce a unique email on a collection that is not sharded by email. This
 * small collection is sharded by email instead, so "one account per email" is enforced cluster-wide by its
 * unique index and login finds the account with a targeted two-step lookup.
 */
const userEmailSchema = new Schema(
  {
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    userId: { type: String, required: true },
  },
  { timestamps: true }
);

export const UserEmail = mongoose.model('UserEmail', userEmailSchema);
