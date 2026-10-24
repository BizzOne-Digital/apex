/**
 * Copies client "Fitness Video" into server/media/videos (one MP4 per Starter exercise).
 *
 * Folders (client sheet):
 *   Monday - Thursday  → Day 1 lifts (Thu repeats in app)
 *   Tuesday - Friday   → Day 2 lifts (Fri repeats)
 *   Wednesday          → Cardio + abs
 */
import { copyFileSync, existsSync, mkdirSync, readdirSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const serverRoot = join(__dirname, '..');
const repoRoot = join(serverRoot, '..');

/** Preferred filename per exercise slug (must match files in the folder when present). */
const STARTER_VIDEO_MAP: { subdir: string; slug: string; file: string }[] = [
  { subdir: 'Monday - Thursday', slug: 'lat-pulldown', file: 'Lat Pulldowns.mp4' },
  { subdir: 'Monday - Thursday', slug: 'seated-cable-row', file: 'Seated Cable Rows.mp4' },
  { subdir: 'Monday - Thursday', slug: 'standing-bicep-cable-curl', file: 'Standing Bicep Cable Curls.mp4' },
  {
    subdir: 'Monday - Thursday',
    slug: 'standing-tricep-cable-pressdown',
    file: 'Standing Tricep Cable Pressdowns.mp4',
  },
  {
    subdir: 'Monday - Thursday',
    slug: 'seated-machine-shoulder-press',
    file: 'Seated Machine Shoulder Press.mp4',
  },
  { subdir: 'Monday - Thursday', slug: 'ab-crunch', file: 'Ab Crunches.mp4' },

  { subdir: 'Tuesday - Friday', slug: 'seated-leg-extension', file: 'Seated Leg Extensions.mp4' },
  { subdir: 'Tuesday - Friday', slug: 'leg-press-machine', file: 'Leg Press Machine.mp4' },
  { subdir: 'Tuesday - Friday', slug: 'lying-hamstring-curl', file: 'Lying Hamstring Curls.mp4' },
  { subdir: 'Tuesday - Friday', slug: 'standing-calf-raise', file: 'Standing Calf Raise.mp4' },
  { subdir: 'Tuesday - Friday', slug: 'seated-machine-bench-press', file: 'Seated Machine Bench Press.mp4' },
  { subdir: 'Tuesday - Friday', slug: 'seated-pec-deck-fly', file: 'Seated Machine Pec Deck Flyes.mp4' },

  { subdir: 'Wednesday', slug: 'cardio-20-min', file: 'Treadmil.mp4' },
  { subdir: 'Wednesday', slug: 'wednesday-abs', file: 'Ab Crunches.mp4' },
];

const DAY_1_FALLBACK_PREFIX = 'Monday Exercise Demo Videos_5';
const DAY_2_FALLBACK_PREFIX = 'Tuesday Exercise Demo Videos_5';
const DAY_3_FALLBACK_PREFIX = 'Wednesday Exercise Demo Videos_5';

function resolveFileInFolder(folder: string, preferred: string): string | null {
  if (!existsSync(folder)) return null;
  const entries = readdirSync(folder).filter((f) => f.toLowerCase().endsWith('.mp4'));
  const exact = entries.find((f) => f === preferred);
  if (exact) return exact;
  const lower = preferred.toLowerCase();
  const ci = entries.find((f) => f.toLowerCase() === lower);
  return ci ?? null;
}

function sortDemoVideoFiles(files: string[]): string[] {
  const orderKey = (name: string): number => {
    const m = name.match(/_5(?:_(\d+))?\.mp4$/i);
    if (!m) return 999;
    if (m[1] === undefined) return 0;
    return Number.parseInt(m[1], 10);
  };
  return [...files].sort((a, b) => orderKey(a) - orderKey(b) || a.localeCompare(b));
}

function fallbackFileForSlug(subdir: string, slug: string, folder: string): string | null {
  const slugsByFolder: Record<string, string[]> = {
    'Monday - Thursday': [
      'lat-pulldown',
      'seated-cable-row',
      'standing-bicep-cable-curl',
      'standing-tricep-cable-pressdown',
      'seated-machine-shoulder-press',
      'ab-crunch',
    ],
    'Tuesday - Friday': [
      'seated-leg-extension',
      'leg-press-machine',
      'lying-hamstring-curl',
      'standing-calf-raise',
      'seated-machine-bench-press',
      'seated-pec-deck-fly',
    ],
    Wednesday: ['cardio-20-min', 'wednesday-abs'],
  };
  const prefixByFolder: Record<string, string> = {
    'Monday - Thursday': DAY_1_FALLBACK_PREFIX,
    'Tuesday - Friday': DAY_2_FALLBACK_PREFIX,
    Wednesday: DAY_3_FALLBACK_PREFIX,
  };
  const slugs = slugsByFolder[subdir];
  const prefix = prefixByFolder[subdir];
  if (!slugs || !prefix) return null;
  const index = slugs.indexOf(slug);
  if (index < 0) return null;
  const numbered = sortDemoVideoFiles(
    readdirSync(folder).filter((f) => f.startsWith(prefix) && f.toLowerCase().endsWith('.mp4'))
  );
  return numbered[index] ?? null;
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

  for (const { subdir, slug, file } of STARTER_VIDEO_MAP) {
    const folder = join(sourceRoot, subdir);
    let chosen = resolveFileInFolder(folder, file);
    if (!chosen) {
      chosen = fallbackFileForSlug(subdir, slug, folder);
      if (chosen) {
        console.warn(`Using fallback for ${slug}: ${subdir}/${chosen} (missing ${file})`);
      }
    }
    if (!chosen) {
      console.warn('Skip — no file for', slug, 'in', subdir);
      continue;
    }

    const src = join(folder, chosen);
    const mediaKey = mediaKeyForSlug(slug);
    const dest = join(serverRoot, 'media', 'videos', mediaKey);
    mkdirSync(dirname(dest), { recursive: true });
    copyFileSync(src, dest);
    console.log(`${subdir}/${chosen} → ${slug}`);

    videos.push({
      programSlug: 'starter',
      exerciseSlug: slug,
      avatarPresentation: 'female',
      mediaKey,
      durationSeconds: 10,
      approvalStatus: 'approved',
      _sourceFile: join(subdir, chosen),
    });
  }

  const manifestPath = join(serverRoot, 'content', 'starter-videos-rev3.json');
  writeFileSync(manifestPath, JSON.stringify({ videos }, null, 2));
  console.log(`\nWrote ${videos.length} video rows →`, manifestPath);
  console.log('Next: npm run seed && npm run import:content -- --file=content/starter-videos-rev3.json');
}

main();
