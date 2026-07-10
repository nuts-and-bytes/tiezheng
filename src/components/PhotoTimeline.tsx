import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { listPhotos } from '../repos/photoRepo';
import type { Photo } from '../lib/types';

export function PhotoTimeline() {
  const photos = useLiveQuery(() => listPhotos(), []);
  if (!photos || photos.length === 0) return null;
  return (
    <section className="rounded-2xl bg-card p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-mute">体型时间轴</h2>
        <span className="text-[11px] text-mute">仅存本机</span>
      </div>
      <div className="flex gap-2 overflow-x-auto pb-1">
        {photos.map((p) => (
          <Thumb key={p.id} photo={p} />
        ))}
      </div>
    </section>
  );
}

function Thumb({ photo }: { photo: Photo }) {
  const [url, setUrl] = useState('');
  useEffect(() => {
    const u = URL.createObjectURL(photo.blob);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [photo]);
  return (
    <figure className="shrink-0">
      <img src={url} alt={photo.date} className="h-24 w-24 rounded-lg object-cover" />
      <figcaption className="mt-1 text-center text-[10px] text-mute">{photo.date.slice(5)}</figcaption>
    </figure>
  );
}
