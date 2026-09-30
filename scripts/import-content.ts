/**
 * Idempotent import of approved exercise lists and video metadata.
 * Usage: npm run import:content -- --file=content/starter-exercises.json
 */
import mongoose from 'mongoose';
import { readFileSync } from 'fs';
import dotenv from 'dotenv';
import { Exercise } from '../src/models/Exercise.js';
import { ExerciseVideo } from '../src/models/ExerciseVideo.js';

dotenv.config();

type ExerciseFile = {
  programSlug: string;
  exercises: Array<Record<string, unknown> & { slug: string }>;
};

type VideoManifest = {
  videos: Array<{
    programSlug: string;
    exerciseSlug: string;
    avatarPresentation: 'male' | 'female';
    mediaKey: string;
    thumbnailKey?: string;
    durationSeconds?: number;
    approvalStatus?: 'pending' | 'approved';
  }>;
};

async function main(): Promise<void> {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('MONGODB_URI required');
  await mongoose.connect(uri);

  const fileArg = process.argv.find((a) => a.startsWith('--file='));
  const path = fileArg?.split('=')[1];
  if (!path) {
    console.log('No --file= provided. Nothing to import.');
    await mongoose.disconnect();
    return;
  }

  const raw = readFileSync(path, 'utf-8');
  const parsed = JSON.parse(raw) as ExerciseFile | VideoManifest;

  if ('exercises' in parsed) {
    for (const ex of parsed.exercises) {
      await Exercise.findOneAndUpdate(
        { programSlug: parsed.programSlug, slug: ex.slug },
        { ...ex, programSlug: parsed.programSlug },
        { upsert: true, new: true }
      );
    }
    console.log(`Imported ${parsed.exercises.length} exercises for ${parsed.programSlug}`);
  } else if ('videos' in parsed) {
    for (const v of parsed.videos) {
      const exercise = await Exercise.findOne({
        programSlug: v.programSlug,
        slug: v.exerciseSlug,
      });
      if (!exercise) {
        console.warn(`Skip video: exercise ${v.exerciseSlug} not found`);
        continue;
      }
      await ExerciseVideo.findOneAndUpdate(
        { exerciseId: exercise._id, avatarPresentation: v.avatarPresentation },
        {
          mediaKey: v.mediaKey,
          thumbnailKey: v.thumbnailKey ?? '',
          durationSeconds: v.durationSeconds,
          approvalStatus: v.approvalStatus ?? 'pending',
        },
        { upsert: true, new: true }
      );
    }
    console.log(`Imported ${parsed.videos.length} video records`);
  }

  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
