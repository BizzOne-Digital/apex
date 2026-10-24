import { randomUUID } from 'crypto';

const BASE = process.env.API_BASE ?? 'http://127.0.0.1:4000/api/v1';
const ORIGIN = BASE.replace(/\/api\/v1\/?$/, '');

async function main() {
  const installationId = randomUUID();
  const reg = await fetch(`${BASE}/installation/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ installationId }),
  });
  const { token } = (await reg.json()) as { token: string };

  await fetch(`${BASE}/purchases/dev-simulate`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-installation-id': installationId,
      'x-installation-token': token,
    },
    body: JSON.stringify({ programSlug: 'starter' }),
  });

  const lib = await fetch(`${BASE}/exercises/program/starter`, {
    headers: { 'x-installation-id': installationId, 'x-installation-token': token },
  });
  const exercises = (await lib.json()) as { exercises: { id: string }[] };
  const exId = exercises.exercises[0].id;

  const det = await fetch(`${BASE}/exercises/${exId}`, {
    headers: { 'x-installation-id': installationId, 'x-installation-token': token },
  });
  const videos = (await det.json()) as { exercise: { videos: { id: string }[] } };
  const videoId = videos.exercise.videos[0]?.id;
  if (!videoId) {
    console.error('No video on exercise');
    process.exit(1);
  }

  const pb = await fetch(`${BASE}/exercises/${exId}/playback`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-installation-id': installationId,
      'x-installation-token': token,
    },
    body: JSON.stringify({ videoId }),
  });
  const pbBody = (await pb.json()) as { playbackPath: string };
  console.log('playbackPath:', pbBody.playbackPath);
  const hasInstall = pbBody.playbackPath.includes('installationId=');
  console.log('has installationId in URL:', hasInstall);

  const url = `${ORIGIN}${pbBody.playbackPath}`;
  const r1 = await fetch(url);
  console.log('GET (no headers):', r1.status, r1.headers.get('content-type'));

  const r2 = await fetch(url, {
    headers: { 'x-installation-id': installationId, 'x-installation-token': token },
  });
  console.log('GET (with headers):', r2.status, r2.headers.get('content-type'));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
