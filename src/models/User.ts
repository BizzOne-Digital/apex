import mongoose, { Schema, type InferSchemaType } from 'mongoose';

/**
 * Set USERS_SHARDED=true once `users` is sharded (see scripts/enable-sharding.ts): a sharded collection
 * cannot carry a unique index on email (uniqueness then lives in the sharded `useremails` directory).
 */
const usersSharded = process.env.USERS_SHARDED === 'true';

const userSchema = new Schema(
  {
    email: { type: String, required: true, lowercase: true, trim: true, ...(usersSharded ? { index: true } : { unique: true }) },
    passwordHash: { type: String, required: true },
    name: { type: String, required: true, trim: true },
    age: { type: Number },
    gender: { type: String, enum: ['male', 'female', 'other'] },
    /** Weight / height exactly as the user entered them, plus the unit. */
    weight: { value: { type: Number }, unit: { type: String, enum: ['kg', 'lbs'] } },
    height: { value: { type: Number }, unit: { type: String, enum: ['cm', 'in'] } },
    /** Public path served by GET /api/v1/uploads/avatars/:filename (binary lives in StoredUpload). */
    avatarUrl: { type: String, default: '' },
  },
  { timestamps: true }
);

export type UserDocument = InferSchemaType<typeof userSchema> & { _id: mongoose.Types.ObjectId };

export const User = mongoose.model('User', userSchema);
