import mongoose, { Schema, type InferSchemaType } from 'mongoose';

const exerciseSchema = new Schema(
  {
    programSlug: { type: String, required: true, index: true },
    slug: { type: String, required: true },
    name: { type: String, required: true },
    sequence: { type: Number, required: true, index: true },
    workoutDay: { type: Number, index: true },
    workoutDayLabel: { type: String },
    category: { type: String, default: 'General' },
    equipment: [{ type: String }],
    sets: { type: Number },
    reps: { type: String },
    durationSeconds: { type: Number },
    restSeconds: { type: Number },
    instructions: [{ type: String }],
    formTips: [{ type: String }],
    warnings: [{ type: String }],
    alternatives: [{ type: String }],
    isPreview: { type: Boolean, default: false },
    published: { type: Boolean, default: false },
    contentApprovalStatus: {
      type: String,
      enum: ['pending', 'approved'],
      default: 'pending',
    },
  },
  { timestamps: true }
);

exerciseSchema.index({ programSlug: 1, slug: 1 }, { unique: true });
exerciseSchema.index({ programSlug: 1, sequence: 1 });

export type ExerciseDocument = InferSchemaType<typeof exerciseSchema> & {
  _id: mongoose.Types.ObjectId;
};

export const Exercise = mongoose.model('Exercise', exerciseSchema);
