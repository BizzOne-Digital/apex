import { randomUUID } from 'crypto';

const BASE = 'http://127.0.0.1:4000/api/v1';
const ORIGIN = 'http://127.0.0.1:4000';

async function main() {
  const installationId = randomUUID();
  const reg = await fetch(`${BASE}/installation/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ installationId }),
  });
  const { token } = (await reg.json()) as { token: string };

  const lib = await fetch(`${BASE}/exercises/program/starter`, {
    headers: { 'x-installation-id': installationId, 'x-installation-token': token },
  });
  const exercises = (await lib.json()) as { exercises: { id: string; slug: string }[] };
  const ex = exercises.exercises.find((e) => e.slug === 'standing-tricep-cable-pressdown');
  if (!ex) throw new Error('exercise not found');

  const det = await fetch(`${BASE}/exercises/${ex.id}`, {
    headers: { 'x-installation-id': installationId, 'x-installation-token': token },
  });
  const videoId = (await det.json()) as { exercise: { videos: { id: string }[] } };
  const vid = videoId.exercise.videos[0]?.id;

  const pb = await fetch(`${BASE}/exercises/${ex.id}/playback`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-installation-id': installationId,
      'x-installation-token': token,
    },
    body: JSON.stringify({ videoId: vid }),
  });
  console.log('POST playback status:', pb.status, await pb.text());
}

main();
