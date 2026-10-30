/**
 * Copies the client "Fitness exercise App vids (Platinum Packages)" folder into
 * server/media/videos/platinum (one MP4 per Platinum exercise) and writes content/platinum-videos.json.
 *
 * Folders (client sheet): Day 1 Monday (Legs / Abs), Day 2 Tuesday (Back / Biceps / Abs),
 * Day 3 Wednesday (Abs & Cardio), Day 4 Thursday (Chest / Triceps / Abs), Day 5 Friday (Shoulders / Abs).
 *
 * Usage: npm run sync:platinum-videos [-- --source="C:/path/to/Fitness exercise App vids (Platinum Packages)"]
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const serverRoot = join(__dirname, '..');
const repoRoot = join(serverRoot, '..');

const D1 = 'Day 1 Monday';
const D2 = 'Day 2 Tuesday';
const D3 = 'Day 3 Wednesday';
const D4 = 'Day 4 Thursday';
const D5 = 'Day 5 Friday';

const PLATINUM_VIDEO_MAP: { subdir: string; slug: string; file: string }[] = [
  { subdir: D1, slug: 'leg-extension', file: 'Leg Extension Exercise.mp4' },
  { subdir: D1, slug: 'seated-leg-press', file: 'Seated Plate Loaded Leg Press (2).mp4' },
  { subdir: D1, slug: 'hamstring-curl', file: 'Lying Hamstring Curls.mp4' },
  { subdir: D1, slug: 'romanian-deadlift', file: 'Romanian Deadlifts With Dumbbells.mp4' },
  { subdir: D1, slug: 'hip-adductor', file: 'Seated Hip Adductor Machine (3).mp4' },
  { subdir: D1, slug: 'hip-abductor', file: 'Seated Hip Abductor Machine.mp4' },
  { subdir: D1, slug: 'seated-calf-raise', file: 'Seated Calf Raises.mp4' },
  { subdir: D1, slug: 'standing-calf-raise', file: 'Standing Calf Raises.mp4' },
  { subdir: D1, slug: 'ab-crunch-machine-d1', file: 'AB CRUNCH MACHINE (3).mp4' },
  { subdir: D1, slug: 'decline-leg-raise-d1', file: 'Leg Raises on a Decline Bench.mp4' },
  { subdir: D1, slug: 'cardio-d1', file: 'Bike or treadmill or Elliptical.mp4' },
  { subdir: D2, slug: 'seated-lat-pulldown', file: 'Seated Wide Grip Lat Pulldowns.mp4' },
  { subdir: D2, slug: 'close-grip-pulldown', file: 'Seated Close Grip Lat Pulldowns.mp4' },
  { subdir: D2, slug: 'bent-over-row', file: 'Standing bent over dumbbell rows (3).mp4' },
  { subdir: D2, slug: 'dumbbell-pullover', file: 'Dumbbell Pullovers on a Bench (2).mp4' },
  { subdir: D2, slug: 'lower-back-extension', file: 'Seated Low Back Extensions (1).mp4' },
  { subdir: D2, slug: 'standing-curl', file: 'Standing Alternating Dumbbell Curls.mp4' },
  { subdir: D2, slug: 'preacher-curl', file: 'Single Arm Preacher Curls.mp4' },
  { subdir: D2, slug: 'concentration-curl', file: 'Dumbbell Concentration Curls.mp4' },
  { subdir: D2, slug: 'lying-ab-crunch-d2', file: 'Lying Abdominal Crunches.mp4' },
  { subdir: D2, slug: 'standing-leg-raise-d2', file: 'Standing Apparatus Leg Raises.mp4' },
  { subdir: D2, slug: 'cardio-d2', file: 'Bike or treadmill or Elliptical.mp4' },
  { subdir: D3, slug: 'ab-crunch-machine-d3', file: 'AB CRUNCH MACHINE (3).mp4' },
  { subdir: D3, slug: 'decline-leg-raise-d3', file: 'Decline bench leg raises.mp4' },
  // Wednesday also repeats Monday's two calf exercises (same clips as Day 1).
  { subdir: D1, slug: 'seated-calf-raise-d3', file: 'Seated Calf Raises.mp4' },
  { subdir: D1, slug: 'standing-calf-raise-d3', file: 'Standing Calf Raises.mp4' },
  { subdir: D3, slug: 'cardio-d3', file: 'Bike or treadmill or Elliptical.mp4' },
  { subdir: D4, slug: 'incline-bench-press', file: 'Incline dumbbell bench press.mp4' },
  { subdir: D4, slug: 'bench-press', file: 'Flat dumbbell bench press.mp4' },
  { subdir: D4, slug: 'machine-bench-press', file: 'Machine Bench Press.mp4' },
  { subdir: D4, slug: 'cable-crossover', file: 'Cable crossovers.mp4' },
  { subdir: D4, slug: 'incline-dumbbell-fly', file: 'Incline dumbbell flyes.mp4' },
  { subdir: D4, slug: 'cable-pushdown', file: 'tricep press down.mp4' },
  { subdir: D4, slug: 'ez-bar-overhead-extension', file: 'Seated overhead EZ bar triceps extensions.mp4' },
  { subdir: D4, slug: 'single-arm-overhead-extension', file: 'Single arm dumbbell overhead extensions.mp4' },
  { subdir: D4, slug: 'ab-crunch-machine-d4', file: 'AB CRUNCH MACHINE (3).mp4' },
  { subdir: D4, slug: 'decline-leg-raise-d4', file: 'Leg Raises on a Decline Bench.mp4' },
  { subdir: D4, slug: 'cardio-d4', file: 'Bike or treadmill or Elliptical.mp4' },
  { subdir: D5, slug: 'seated-shoulder-press', file: 'Seated dumbbell shoulder press.mp4' },
  { subdir: D5, slug: 'lateral-raise', file: 'Standing dumbbell lateral raises.mp4' },
  { subdir: D5, slug: 'upright-row', file: 'Standing barbell upright rows.mp4' },
  { subdir: D5, slug: 'rear-delt-raise', file: 'rear lateral dumbbell raises.mp4' },
  { subdir: D5, slug: 'lying-ab-crunch-d5', file: 'Lying ab crunches.mp4' },
  { subdir: D5, slug: 'standing-leg-raise-d5', file: 'Standing apparatus machine leg raises.mp4' },
  { subdir: D5, slug: 'cardio-d5', file: 'Bike or treadmill or Elliptical.mp4' },
];

/** Clip length in seconds, read from the MP4 `mvhd` header (no ffmpeg needed). */
function mp4DurationSeconds(path: string): number | undefined {
  const buf = readFileSync(path);
  const i = buf.indexOf('mvhd');
  if (i < 0) return undefined;
  const version = buf[i + 4];
  const o = i + 4 + 4 + (version === 1 ? 16 : 8);
  const timescale = buf.readUInt32BE(o);
  const duration = version === 1 ? Number(buf.readBigUInt64BE(o + 4)) : buf.readUInt32BE(o + 4);
  return timescale ? Math.round((duration / timescale) * 100) / 100 : undefined;
}

function main(): void {
  const sourceArg = process.argv.find((a) => a.startsWith('--source='));
  const sourceRoot = sourceArg
    ? sourceArg.split('=').slice(1).join('=')
    : join(repoRoot, 'Fitness exercise App vids (Platinum Packages)');

  if (!existsSync(sourceRoot)) {
    console.error('Source folder not found:', sourceRoot);
    process.exit(1);
  }

  const videos: object[] = [];
  let missing = 0;

  for (const { subdir, slug, file } of PLATINUM_VIDEO_MAP) {
    const src = join(sourceRoot, subdir, file);
    if (!existsSync(src)) {
      console.warn('MISSING —', join(subdir, file), 'for', slug);
      missing++;
      continue;
    }
    const mediaKey = `platinum/exercises/${slug}-female.mp4`;
    const dest = join(serverRoot, 'media', 'videos', mediaKey);
    mkdirSync(dirname(dest), { recursive: true });
    copyFileSync(src, dest);
    console.log(`${subdir}/${file} → ${slug}`);

    videos.push({
      programSlug: 'platinum',
      exerciseSlug: slug,
      avatarPresentation: 'female',
      mediaKey,
      durationSeconds: mp4DurationSeconds(src),
      approvalStatus: 'approved',
      _sourceFile: join(subdir, file),
    });
  }

  const manifestPath = join(serverRoot, 'content', 'platinum-videos.json');
  writeFileSync(manifestPath, JSON.stringify({ videos }, null, 2));
  console.log(`\nWrote ${videos.length} video rows (${missing} missing) →`, manifestPath);
  console.log('Next: npm run import:content -- --file=content/platinum-exercises.json');
  console.log('      npm run import:content -- --file=content/platinum-videos.json');
}

main();
