/**
 * Copies client "Fitness Video" folders into server/media/videos (one MP4 per exercise).
 *
 * Folder layout (under repo root or --source=):
 *   Fitness Video/Monday - Thursday   → Day 1 exercises (Mon & Thu in app)
 *   Fitness Video/Tuesday - Friday    → Day 2 exercises (Tue & Fri)
 *   Fitness Video/Wednesday           → Day 3 (cardio + abs)
 */
import { copyFileSync, existsSync, mkdirSync, readdirSync, writeFileSync } from 'fs';
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

const FOLDER_MAP: { subdir: string; exerciseSlugs: string[] }[] = [
  { subdir: 'Monday - Thursday', exerciseSlugs: DAY_1_SLUGS },
  { subdir: 'Tuesday - Friday', exerciseSlugs: DAY_2_SLUGS },
  { subdir: 'Wednesday', exerciseSlugs: DAY_3_SLUGS },
];

/** Sort "…_5.mp4", "…_5_1.mp4", "…_5_2.mp4" in demo order. */
function sortDemoVideoFiles(files: string[]): string[] {
  const orderKey = (name: string): number => {
    const m = name.match(/_5(?:_(\d+))?\.mp4$/i);
    if (!m) return 999;
    if (m[1] === undefined) return 0;
    return Number.parseInt(m[1], 10);
  };
  return [...files].sort((a, b) => orderKey(a) - orderKey(b) || a.localeCompare(b));
}

function listMp4(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return sortDemoVideoFiles(
    readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.mp4'))
  );
}

function mediaKeyForSlug(slug: string): string {
  return `starter/exercises/${slug}-female.mp4`;
}

function main(): void {
  const sourceArg = process.argv.find((a) => a.startsWith('--source='));
  const sourceRoot = sourceArg
    ? sourceArg.split('=').slice(1).join('=')
    : join(repoRoot, 'Fitness Video');

  if (!existsSync(sourceRoot)) {
    console.error('Source folder not found:', sourceRoot);
    process.exit(1);
  }

  const videos: object[] = [];

  for (const { subdir, exerciseSlugs } of FOLDER_MAP) {
    const folder = join(sourceRoot, subdir);
    const files = listMp4(folder);
    if (files.length === 0) {
      console.warn('No MP4 files in', folder);
      continue;
    }

    const pairs = Math.min(files.length, exerciseSlugs.length);
    if (files.length !== exerciseSlugs.length) {
      console.warn(
        `${subdir}: ${files.length} file(s), ${exerciseSlugs.length} exercise(s) — mapping first ${pairs}`
      );
    }

    for (let i = 0; i < pairs; i++) {
      const file = files[i];
      const exerciseSlug = exerciseSlugs[i];
      const mediaKey = mediaKeyForSlug(exerciseSlug);
      const src = join(folder, file);
      const dest = join(serverRoot, 'media', 'videos', mediaKey);
      mkdirSync(dirname(dest), { recursive: true });
      copyFileSync(src, dest);
      console.log(`${subdir}/${file} → ${exerciseSlug} (${mediaKey})`);

      videos.push({
        programSlug: 'starter',
        exerciseSlug,
        avatarPresentation: 'female',
        mediaKey,
        durationSeconds: 10,
        approvalStatus: 'approved',
        _sourceFile: join(subdir, file),
      });
    }
  }

  const manifestPath = join(serverRoot, 'content', 'starter-videos-rev3.json');
  writeFileSync(manifestPath, JSON.stringify({ videos }, null, 2));
  console.log(`\nWrote ${videos.length} video rows →`, manifestPath);
  console.log('Next: npm run seed && npm run import:content -- --file=content/starter-videos-rev3.json');
}

main();
