import mongoose, { Schema, type InferSchemaType } from 'mongoose';

/**
 * One purchase attempt, driven through the payment saga:
 *   created -> checkout_open -> paid -> fulfilled
 * Failure / compensation branches: expired, failed, refund_pending -> refunded, revoked.
 */
export const ORDER_STATUSES = [
  'created',
  'checkout_open',
  'paid',
  'fulfilled',
  'expired',
  'failed',
  'refund_pending',
  'refunded',
  'revoked',
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

const sagaStepSchema = new Schema(
  {
    step: { type: String, required: true },
    outcome: { type: String, enum: ['ok', 'failed', 'compensated'], required: true },
    at: { type: Date, default: Date.now },
    detail: { type: String },
  },
  { _id: false }
);

const orderSchema = new Schema(
  {
    orderId: { type: String, required: true, unique: true },
    userId: { type: String, required: true, index: true },
    installationId: { type: String, required: true },
    programSlug: { type: String, required: true },
    currency: { type: String, default: 'usd' },
    subtotalCents: { type: Number, required: true },
    taxCents: { type: Number, required: true },
    totalCents: { type: Number, required: true },
    taxRatePercent: { type: Number, required: true },
    status: { type: String, enum: ORDER_STATUSES, default: 'created', index: true },
    stripeSessionId: { type: String, index: { unique: true, sparse: true } },
    stripePaymentIntentId: { type: String, index: true },
    checkoutUrl: { type: String },
    expiresAt: { type: Date },
    paidAt: { type: Date },
    fulfilledAt: { type: Date },
    /** Set once the confirmation emails went out (claimed before sending, released on failure). */
    emailsSentAt: { type: Date },
    failureReason: { type: String },
    sagaLog: { type: [sagaStepSchema], default: [] },
  },
  { timestamps: true }
);

orderSchema.index({ userId: 1, programSlug: 1, status: 1 });
// At most one order per account + program may be in the short `created` state at a time (double-tap guard).
orderSchema.index({ userId: 1, programSlug: 1 }, { unique: true, partialFilterExpression: { status: 'created' } });
orderSchema.index({ status: 1, updatedAt: 1 });

export type OrderDocument = InferSchemaType<typeof orderSchema> & { _id: mongoose.Types.ObjectId };
export const Order = mongoose.model('Order', orderSchema);
