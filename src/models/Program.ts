import mongoose, { Schema, type InferSchemaType } from 'mongoose';

const programSchema = new Schema(
  {
    slug: { type: String, required: true, unique: true, index: true },
    name: { type: String, required: true },
    level: { type: String, required: true },
    description: { type: String, required: true },
    displayPriceUsd: { type: Number, required: true },
    storeProductIds: {
      ios: { type: String, default: '' },
      android: { type: String, default: '' },
    },
    artworkUrl: { type: String, default: '' },
    previewExerciseSlugs: [{ type: String }],
    published: { type: Boolean, default: false, index: true },
    displayOrder: { type: Number, default: 0 },
    featureFlags: {
      guidedTimersEnabled: { type: Boolean, default: false },
      categoryFilterEnabled: { type: Boolean, default: true },
    },
  },
  { timestamps: true }
);

export type ProgramDocument = InferSchemaType<typeof programSchema> & {
  _id: mongoose.Types.ObjectId;
};

export const Program = mongoose.model('Program', programSchema);
