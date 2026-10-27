import mongoose from 'mongoose';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { Program } from '../src/models/Program.js';
import { Exercise } from '../src/models/Exercise.js';
import { AppContent } from '../src/models/AppContent.js';

dotenv.config();

const __dirname = dirname(fileURLToPath(import.meta.url));
const contentDir = join(__dirname, '../content');

async function seed(): Promise<void> {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('MONGODB_URI required');
  await mongoose.connect(uri);

  const programs = JSON.parse(readFileSync(join(contentDir, 'programs.json'), 'utf-8'));
  for (const p of programs) {
    await Program.findOneAndUpdate({ slug: p.slug }, p, { upsert: true, new: true });
  }

  const starter = JSON.parse(readFileSync(join(contentDir, 'starter-exercises.json'), 'utf-8'));
  const starterSlugs = starter.exercises.map((ex: { slug: string }) => ex.slug);
  await Exercise.deleteMany({
    programSlug: starter.programSlug,
    slug: { $nin: starterSlugs },
  });
  for (const ex of starter.exercises) {
    await Exercise.findOneAndUpdate(
      { programSlug: starter.programSlug, slug: ex.slug },
      { ...ex, programSlug: starter.programSlug },
      { upsert: true, new: true }
    );
  }

  const elite = JSON.parse(readFileSync(join(contentDir, 'elite-exercises.json'), 'utf-8'));
  if (elite.exercises.length > 0) {
    const eliteSlugs = elite.exercises.map((ex: { slug: string }) => ex.slug);
    await Exercise.deleteMany({
      programSlug: elite.programSlug,
      slug: { $nin: eliteSlugs },
    });
    for (const ex of elite.exercises) {
      await Exercise.findOneAndUpdate(
        { programSlug: elite.programSlug, slug: ex.slug },
        { ...ex, programSlug: elite.programSlug },
        { upsert: true, new: true }
      );
    }
  }

  const platinum = JSON.parse(readFileSync(join(contentDir, 'platinum-exercises.json'), 'utf-8'));
  if (platinum.exercises.length > 0) {
    const platinumSlugs = platinum.exercises.map((ex: { slug: string }) => ex.slug);
    await Exercise.deleteMany({
      programSlug: platinum.programSlug,
      slug: { $nin: platinumSlugs },
    });
    for (const ex of platinum.exercises) {
      await Exercise.findOneAndUpdate(
        { programSlug: platinum.programSlug, slug: ex.slug },
        { ...ex, programSlug: platinum.programSlug },
        { upsert: true, new: true }
      );
    }
  }

  // Client-approved policies (content/legal.json).
  const legal = JSON.parse(readFileSync(join(contentDir, 'legal.json'), 'utf-8'));

  const appContent = [
    {
      key: 'safety.disclaimer',
      value: {
        title: 'Safety disclaimer',
        body:
          'This app provides general fitness information, not medical advice. Consult a qualified professional before starting. Stop exercising if you experience pain, dizziness, or shortness of breath.',
        approvalStatus: 'pending',
      },
    },
    ...(['terms', 'privacy', 'refund'] as const).map((type) => ({
      key: `legal.${type}`,
      value: { ...legal.docs[type], approvalStatus: 'approved' },
    })),
    {
      key: 'support.contact',
      value: {
        email: 'art@elitebodyfitnesspros.com',
        phone: '+1 (916) 223-3228',
        purchaseHelp: 'Purchases are tied to your Apple ID or Google account. Use Restore Purchases on a new install.',
        playbackHelp: 'Ensure a stable connection. Tap retry if a video fails to load.',
      },
    },
    {
      key: 'branding',
      value: {
        appName: 'ELITE BODY FITNESS PROS',
        tagline: 'Explore Programs',
        approvalStatus: 'pending',
      },
    },
  ];

  for (const item of appContent) {
    await AppContent.findOneAndUpdate({ key: item.key }, item, { upsert: true });
  }

  console.log('Seed complete (idempotent).');
  await mongoose.disconnect();
}

seed().catch((e) => {
  console.error(e);
  process.exit(1);
});
