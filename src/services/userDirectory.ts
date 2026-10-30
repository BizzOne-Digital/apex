import mongoose from 'mongoose';
import type { Env } from '../config/env.js';
import { User, type UserDocument } from '../models/User.js';
import { UserEmail } from '../models/UserEmail.js';
import { ApiError } from '../utils/errors.js';

const isDuplicate = (e: unknown) => (e as { code?: number } | null)?.code === 11000;
const emailTaken = () => new ApiError(409, 'EMAIL_TAKEN', 'An account with this email already exists. Please log in.');

type NewUser = Omit<Partial<UserDocument>, '_id'> & { email: string; passwordHash: string; name: string };

/**
 * Signup as a small saga:
 *   1. reserve the email in the directory   (unique index = the cluster-wide "one account per email" rule)
 *   2. create the user with the reserved id (undo on failure: release the reservation)
 * A reservation left behind by a crash between the two steps (no user behind it) is taken over, so an
 * email can never be locked out forever.
 */
export async function createUserWithEmail(data: NewUser): Promise<UserDocument> {
  const _id = new mongoose.Types.ObjectId();
  const userId = _id.toString();

  try {
    await UserEmail.create({ email: data.email, userId });
  } catch (e) {
    if (!isDuplicate(e)) throw e;
    const existing = await UserEmail.findOne({ email: data.email });
    const alive = existing ? await User.exists({ _id: existing.userId }) : true;
    if (alive) throw emailTaken();
    // Orphaned reservation: claim it (conditional on it still pointing at the dead user).
    const claimed = await UserEmail.updateOne({ email: data.email, userId: existing!.userId }, { $set: { userId } });
    if (claimed.modifiedCount !== 1) throw emailTaken();
  }

  try {
    return (await User.create({ ...data, _id })) as UserDocument;
  } catch (e) {
    await UserEmail.deleteOne({ email: data.email, userId }).catch(() => undefined); // compensation
    if (isDuplicate(e)) throw emailTaken();
    throw e;
  }
}

/** Targeted lookup: directory by email, then the user by id. Falls back to a legacy scan until the backfill has run. */
export async function findUserByEmail(env: Env, email: string): Promise<UserDocument | null> {
  const ref = await UserEmail.findOne({ email }).lean();
  if (ref) {
    const user = await User.findById(ref.userId);
    if (user) return user as UserDocument;
  }
  if (!env.USER_LEGACY_EMAIL_LOOKUP) return null;
  const legacy = await User.findOne({ email });
  if (legacy) {
    // Self-heal: accounts created before the directory existed get their entry on first login.
    await UserEmail.updateOne({ email }, { $setOnInsert: { userId: legacy._id.toString() } }, { upsert: true }).catch(() => undefined);
  }
  return legacy as UserDocument | null;
}

export async function releaseEmail(email: string, userId: string): Promise<void> {
  await UserEmail.deleteOne({ email, userId });
}
