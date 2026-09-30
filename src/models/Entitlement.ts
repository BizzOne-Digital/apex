import mongoose, { Schema, type InferSchemaType } from 'mongoose';

const entitlementSchema = new Schema(
  {
    installationId: { type: String, required: true, index: true },
    programSlug: { type: String, required: true, index: true },
    purchaseSource: {
      type: String,
      enum: ['apple', 'google', 'web', 'dev_simulator'],
      required: true,
    },
    storeTransactionId: { type: String, required: true, index: true },
    verificationStatus: {
      type: String,
      enum: ['pending', 'verified', 'failed', 'revoked'],
      default: 'pending',
    },
    entitlementStatus: {
      type: String,
      enum: ['active', 'revoked', 'refunded'],
      default: 'active',
    },
    recoveryTokenHash: { type: String },
    rawReceiptRef: { type: String },
    metadata: { type: Schema.Types.Mixed },
  },
  { timestamps: true }
);

entitlementSchema.index(
  { storeTransactionId: 1, programSlug: 1 },
  { unique: true }
);
entitlementSchema.index({ installationId: 1, programSlug: 1 });

export type EntitlementDocument = InferSchemaType<typeof entitlementSchema> & {
  _id: mongoose.Types.ObjectId;
};

export const Entitlement = mongoose.model('Entitlement', entitlementSchema);
