/**
 * Copies the client "Fitness exercise App vids (Elite Packages)" folder into
 * server/media/videos/elite (one MP4 per Elite exercise) and writes content/elite-videos.json.
 *
 * Folders (client sheet):
 *   Day 1 Monday                        → Back / Biceps / Abs
 *   Day 2 Tuesday                       → Chest / Triceps / Abs
 *   Day 3 & 5 Wednesday - Friday        → Shoulders / Abs (Friday repeats the shoulders)
 *   Day 4 Thursday                      → Legs / Calves / Abs
 *
 * Usage: npm run sync:elite-videos
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const serverRoot = join(__dirname, '..');
const repoRoot = join(serverRoot, '..');

const D1 = 'Day 1 Monday';
const D2 = 'Day 2 Tuesday';
const D3 = 'Day 3 & 5 Wednesday - Friday';
const D4 = 'Day 4 Thursday';
const CARDIO = 'Bike or treadmill or Elliptical.mp4';

const ELITE_VIDEO_MAP: { subdir: string; slug: string; file: string }[] = [
  // Monday
  { subdir: D1, slug: 'seated-lat-pulldown', file: 'Seated lat pulldowns.mp4' },
  { subdir: D1, slug: 'seated-single-arm-cable-pulldown', file: 'Seated single-arm cable pulldowns.mp4' },
  { subdir: D1, slug: 'seated-machine-row', file: 'Seated machine rows.mp4' },
  { subdir: D1, slug: 'lower-back-extension', file: 'Seated Low Back Extensions (2).mp4' },
  { subdir: D1, slug: 'seated-bicep-preacher-curl', file: 'Seated bicep preacher curls.mp4' },
  { subdir: D1, slug: 'standing-cable-curl', file: 'standing cable curl.mp4' },
  { subdir: D1, slug: 'lying-ab-crunch-floor', file: 'Lying ab crunches on floor.mp4' },
  { subdir: D1, slug: 'standing-leg-raise-d1', file: 'Standing apparatus leg raises.mp4' },
  { subdir: D1, slug: 'cardio-d1', file: CARDIO },
  // Tuesday
  { subdir: D2, slug: 'seated-machine-press', file: 'Seated machine press.mp4' },
  { subdir: D2, slug: 'seated-incline-machine-press', file: 'Seated incline machine (2).mp4' },
  { subdir: D2, slug: 'seated-pec-deck-fly', file: 'Seated peck deck machine flyes.mp4' },
  { subdir: D2, slug: 'standing-cable-pressdown', file: 'Standing cable pressdowns (2).mp4' },
  { subdir: D2, slug: 'seated-overhead-dumbbell-extension', file: 'Seated overhead dumbbell extensions.mp4' },
  { subdir: D2, slug: 'seated-machine-tricep-pushdown', file: 'Seated machine tricep pushdowns.mp4' },
  { subdir: D2, slug: 'ab-crunch-machine-d2', file: 'AB CRUNCH MACHINE (3).mp4' },
  { subdir: D2, slug: 'seated-decline-crunch-d2', file: 'Seated decline crunch.mp4' },
  // Tuesday has no cardio clip of its own: reuse the same bike/treadmill/elliptical clip.
  { subdir: D3, slug: 'cardio-d2', file: CARDIO },
  // Wednesday
  { subdir: D3, slug: 'seated-shoulder-press', file: 'Seated machine or dumbbell presses (2).mp4' },
  { subdir: D3, slug: 'seated-lateral-raise', file: 'Seated lateral shoulder raises.mp4' },
  { subdir: D3, slug: 'seated-rear-delt-machine', file: 'Seated rear delt machine.mp4' },
  { subdir: D3, slug: 'lying-ab-crunch-d3', file: 'Lying ab crunches.mp4' },
  { subdir: D3, slug: 'standing-leg-raise-d3', file: 'Standing apparatus machine leg raises.mp4' },
  { subdir: D3, slug: 'cardio-d3', file: CARDIO },
  // Thursday
  { subdir: D4, slug: 'seated-leg-extension', file: 'Leg Extension Exercise.mp4' },
  { subdir: D4, slug: 'seated-leg-press', file: 'Seated machine presses or plate-loaded leg presses (2).mp4' },
  { subdir: D4, slug: 'seated-hamstring-curl', file: 'Seated or lying hamstring curls (2).mp4' },
  { subdir: D4, slug: 'seated-adductor-abductor', file: 'Seated adductor and abductor machine.mp4' },
  { subdir: D4, slug: 'standing-calf-raise', file: 'Standing calf raises.mp4' },
  { subdir: D4, slug: 'seated-calf-raise', file: 'Seated calf raises.mp4' },
  { subdir: D4, slug: 'ab-crunch-machine-d4', file: 'AB CRUNCH MACHINE (3).mp4' },
  { subdir: D4, slug: 'seated-decline-crunch-d4', file: 'Seated decline crunch.mp4' },
  { subdir: D4, slug: 'cardio-d4', file: CARDIO },
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
    : join(repoRoot, 'Fitness exercise App vids (Elite Packages)');

  if (!existsSync(sourceRoot)) {
    console.error('Source folder not found:', sourceRoot);
    process.exit(1);
  }

  const videos: object[] = [];
  let missing = 0;

  for (const { subdir, slug, file } of ELITE_VIDEO_MAP) {
    const src = join(sourceRoot, subdir, file);
    if (!existsSync(src)) {
      console.warn('MISSING —', join(subdir, file), 'for', slug);
      missing++;
      continue;
    }
    const mediaKey = `elite/exercises/${slug}-female.mp4`;
    const dest = join(serverRoot, 'media', 'videos', mediaKey);
    mkdirSync(dirname(dest), { recursive: true });
    copyFileSync(src, dest);
    console.log(`${subdir}/${file} → ${slug}`);

    videos.push({
      programSlug: 'elite',
      exerciseSlug: slug,
      avatarPresentation: 'female',
      mediaKey,
      durationSeconds: mp4DurationSeconds(src),
      approvalStatus: 'approved',
      _sourceFile: join(subdir, file),
    });
  }

  const manifestPath = join(serverRoot, 'content', 'elite-videos.json');
  writeFileSync(manifestPath, JSON.stringify({ videos }, null, 2));
  console.log(`\nWrote ${videos.length} video rows (${missing} missing) →`, manifestPath);
  console.log('Next: npm run import:content -- --file=content/elite-exercises.json');
  console.log('      npm run import:content -- --file=content/elite-videos.json');
}

main();
