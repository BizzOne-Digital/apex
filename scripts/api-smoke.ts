/**
 * Manual smoke test against a running server (default http://localhost:4000).
 * Usage: npm run dev (separate terminal) then: npx tsx scripts/api-smoke.ts
 */
import { randomUUID } from 'crypto';

const BASE = process.env.API_BASE ?? 'http://localhost:4000/api/v1';

type Result = { name: string; ok: boolean; detail?: string };

const results: Result[] = [];

function pass(name: string, detail?: string) {
  results.push({ name, ok: true, detail });
}

function fail(name: string, detail: string) {
  results.push({ name, ok: false, detail });
}

async function json(
  path: string,
  opts: RequestInit & { installationId?: string; token?: string } = {}
) {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(opts.headers as Record<string, string>),
  };
  if (opts.installationId) headers['x-installation-id'] = opts.installationId;
  if (opts.token) headers['x-installation-token'] = opts.token;
  const res = await fetch(`${BASE}${path}`, { ...opts, headers });
  const body = await res.json().catch(() => ({}));
  return { res, body };
}

async function main() {
  const installationId = randomUUID();

  try {
    const reg = await json('/installation/register', {
      method: 'POST',
      body: JSON.stringify({ installationId }),
    });
    if (reg.res.status !== 200 || !reg.body.token) {
      fail('register installation', `status ${reg.res.status}`);
    } else {
      pass('register installation');
    }
    const token = reg.body.token as string;

    const programs = await json('/programs', { installationId, token });
    if (programs.res.status === 200 && Array.isArray(programs.body.programs)) {
      pass('GET /programs', `${programs.body.programs.length} programs`);
    } else {
      fail('GET /programs', `status ${programs.res.status}`);
    }

    const starter = await json('/programs/starter', { installationId, token });
    if (starter.res.status === 200 && starter.body.program?.slug === 'starter') {
      pass('GET /programs/starter');
    } else {
      fail('GET /programs/starter', `status ${starter.res.status}`);
    }

    const libLocked = await json('/exercises/program/starter', { installationId, token });
    if (libLocked.res.status === 403) {
      pass('library locked without purchase');
    } else {
      fail('library locked without purchase', `expected 403 got ${libLocked.res.status}`);
    }

    const sim = await json('/purchases/dev-simulate', {
      method: 'POST',
      installationId,
      token,
      body: JSON.stringify({ programSlug: 'starter' }),
    });
    if (sim.res.status === 200) pass('dev-simulate starter');
    else fail('dev-simulate starter', `status ${sim.res.status}`);

    const lib = await json('/exercises/program/starter', { installationId, token });
    const exercises = lib.body.exercises as unknown[];
    if (lib.res.status === 200 && exercises?.length) {
      pass('library after purchase', `${exercises.length} exercises`);
    } else {
      fail('library after purchase', `status ${lib.res.status}`);
    }

    const first = exercises[0] as { id: string };
    const detail = await json(`/exercises/${first.id}`, { installationId, token });
    if (detail.res.status === 200 && detail.body.exercise?.id === first.id) {
      pass('GET exercise detail');
    } else {
      fail('GET exercise detail', `status ${detail.res.status}`);
    }

    const videos = detail.body.exercise?.videos as { id: string }[] | undefined;
    if (videos?.length) {
      const pb = await json(`/exercises/${first.id}/playback`, {
        method: 'POST',
        installationId,
        token,
        body: JSON.stringify({ videoId: videos[0].id }),
      });
      if (pb.res.status === 200 && pb.body.playbackPath) pass('playback token');
      else fail('playback token', `status ${pb.res.status}`);
    } else {
      pass('playback token', 'skipped — no videos on exercise');
    }

    const safety = await json('/content/safety');
    if (safety.res.status === 200 && safety.body.body) pass('GET /content/safety');
    else fail('GET /content/safety', `status ${safety.res.status}`);

    const legal = await json('/content/legal/terms');
    if (legal.res.status === 200) pass('GET /content/legal/terms');
    else fail('GET /content/legal/terms', `status ${legal.res.status}`);

    const ent = await json('/installation/entitlements', { installationId, token });
    if (ent.res.status === 200 && (ent.body.programs as string[])?.includes('starter')) {
      pass('entitlements include starter');
    } else {
      fail('entitlements', JSON.stringify(ent.body));
    }

    const restore = await json('/purchases/restore', {
      method: 'POST',
      installationId,
      token,
      body: JSON.stringify({ platform: 'ios', purchases: [] }),
    });
    if (restore.res.status === 200) pass('POST /purchases/restore');
    else fail('POST /purchases/restore', `status ${restore.res.status}`);
  } catch (e) {
    fail('smoke runner', e instanceof Error ? e.message : String(e));
  }

  const failed = results.filter((r) => !r.ok);
  for (const r of results) {
    const mark = r.ok ? 'OK' : 'FAIL';
    console.log(`${mark}  ${r.name}${r.detail ? ` — ${r.detail}` : ''}`);
  }
  if (failed.length) {
    console.error(`\n${failed.length} check(s) failed. Is the server running at ${BASE}?`);
    process.exit(1);
  }
  console.log(`\nAll ${results.length} checks passed.`);
}

main();
