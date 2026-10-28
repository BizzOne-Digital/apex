import mongoose, { Schema } from 'mongoose';

/** Uploaded files live in MongoDB so they survive redeploys on read-only / serverless hosts. */
const storedUploadSchema = new Schema(
  {
    folder: { type: String, required: true, enum: ['avatars', 'misc'] },
    filename: { type: String, required: true },
    mimeType: { type: String, required: true },
    size: { type: Number, required: true },
    data: { type: Buffer, required: true },
    ownerId: { type: String, index: true },
  },
  { timestamps: true }
);

storedUploadSchema.index({ folder: 1, filename: 1 }, { unique: true });

export const StoredUpload = mongoose.model('StoredUpload', storedUploadSchema);
