import mongoose, { Schema, type InferSchemaType } from 'mongoose';

const exerciseVideoSchema = new Schema(
  {
    exerciseId: { type: Schema.Types.ObjectId, ref: 'Exercise', required: true, index: true },
    avatarPresentation: { type: String, enum: ['male', 'female'], required: true },
    cameraAngle: { type: String, default: 'front' },
    durationSeconds: { type: Number },
    mediaKey: { type: String, required: true },
    thumbnailKey: { type: String, default: '' },
    approvalStatus: {
      type: String,
      enum: ['pending', 'approved'],
      default: 'pending',
    },
    version: { type: Number, default: 1 },
  },
  { timestamps: true }
);

exerciseVideoSchema.index({ exerciseId: 1, avatarPresentation: 1 }, { unique: true });

export type ExerciseVideoDocument = InferSchemaType<typeof exerciseVideoSchema> & {
  _id: mongoose.Types.ObjectId;
};

export const ExerciseVideo = mongoose.model('ExerciseVideo', exerciseVideoSchema);
