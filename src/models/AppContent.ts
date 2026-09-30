import mongoose, { Schema, type InferSchemaType } from 'mongoose';

const appContentSchema = new Schema(
  {
    key: { type: String, required: true, unique: true },
    value: { type: Schema.Types.Mixed, required: true },
  },
  { timestamps: true }
);

export type AppContentDocument = InferSchemaType<typeof appContentSchema> & {
  _id: mongoose.Types.ObjectId;
};

export const AppContent = mongoose.model('AppContent', appContentSchema);
