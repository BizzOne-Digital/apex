import mongoose, { Schema } from 'mongoose';

/** Webhook events already handled, so Stripe retries and replays never run a step twice. */
const stripeEventSchema = new Schema(
  {
    eventId: { type: String, required: true, unique: true },
    type: { type: String, required: true },
    status: { type: String, enum: ['processing', 'done', 'failed'], default: 'processing' },
    error: { type: String },
    receivedAt: { type: Date, default: Date.now },
  },
  { timestamps: false }
);

// Keep two months of history for debugging, then let MongoDB clean up.
stripeEventSchema.index({ receivedAt: 1 }, { expireAfterSeconds: 60 * 24 * 60 * 60 });

export const StripeEvent = mongoose.model('StripeEvent', stripeEventSchema);
