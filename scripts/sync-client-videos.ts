/**
 * Copies client folder "Fitness Video - 3rd Rev" into server/media/videos.
 * One MP4 per weekday → all exercises on that workout day share the session clip
 * until per-exercise AI avatar clips are delivered.
 */
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const serverRoot = join(__dirname, '..');
const repoRoot = join(serverRoot, '..');

const DAY_1_SLUGS = [
  'lat-pulldown',
  'seated-cable-row',
  'standing-bicep-cable-curl',
  'standing-tricep-cable-pressdown',
  'seated-machine-shoulder-press',
  'ab-crunch',
];

const DAY_2_SLUGS = [
  'seated-leg-extension',
  'leg-press-machine',
  'lying-hamstring-curl',
  'standing-calf-raise',
  'seated-machine-bench-press',
  'seated-pec-deck-fly',
];

const DAY_3_SLUGS = ['cardio-20-min', 'wednesday-abs'];

const DAY_FILES: {
  file: string;
  mediaKey: string;
  exerciseSlugs: string[];
}[] = [
  { file: 'Monday 1.mp4', mediaKey: 'starter/day-1-rev3.mp4', exerciseSlugs: DAY_1_SLUGS },
  { file: 'Tuesday a.mp4', mediaKey: 'starter/day-2-rev3.mp4', exerciseSlugs: DAY_2_SLUGS },
  { file: 'Wednesday 1.mp4', mediaKey: 'starter/day-3-rev3.mp4', exerciseSlugs: DAY_3_SLUGS },
  { file: 'Thursday 1.mp4', mediaKey: 'starter/day-4-rev3.mp4', exerciseSlugs: DAY_1_SLUGS },
  { file: 'Friday a.mp4', mediaKey: 'starter/day-5-rev3.mp4', exerciseSlugs: DAY_2_SLUGS },
];

function main(): void {
  const sourceArg = process.argv.find((a) => a.startsWith('--source='));
  const sourceDir = sourceArg
    ? sourceArg.split('=').slice(1).join('=')
    : join(repoRoot, 'Fitness Video - 3rd Rev');

  if (!existsSync(sourceDir)) {
    console.error('Source folder not found:', sourceDir);
    process.exit(1);
  }

  const videos: object[] = [];

  for (const day of DAY_FILES) {
    const src = join(sourceDir, day.file);
    if (!existsSync(src)) {
      console.warn('Missing file, skip:', src);
      continue;
    }
    const dest = join(serverRoot, 'media', 'videos', day.mediaKey);
    mkdirSync(dirname(dest), { recursive: true });
    copyFileSync(src, dest);
    console.log('Copied →', day.mediaKey);

    for (const exerciseSlug of day.exerciseSlugs) {
      videos.push({
        programSlug: 'starter',
        exerciseSlug,
        avatarPresentation: 'female',
        mediaKey: day.mediaKey,
        durationSeconds: 8,
        approvalStatus: 'approved',
        _sourceFile: day.file,
      });
    }
  }

  const manifestPath = join(serverRoot, 'content', 'starter-videos-rev3.json');
  writeFileSync(manifestPath, JSON.stringify({ videos }, null, 2));
  console.log(`\nWrote ${videos.length} video rows →`, manifestPath);
  console.log('Next: npm run seed && npm run import:content -- --file=content/starter-videos-rev3.json');
}

main();
