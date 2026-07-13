import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Link } from 'react-router-dom';
import { listPhotos } from '../repos/photoRepo';
import type { Photo } from '../lib/types';

/**
 * 体型时间轴。
 *
 * 这里曾是全站最后一块 `rounded-2xl bg-card` 实心卡片——用户说整个 app「一块一块的」，
 * 说的就是它这种。改版的规则是：**区块靠蚀刻线划界，只有实物才配浮起。**
 * 「体型时间轴」是一个区块；浮起来的是里面那一张张照片（bg-raised 表面 + 溢出裁切）。
 */
export function PhotoTimeline() {
  const photos = useLiveQuery(() => listPhotos(), []);
  if (!photos || photos.length === 0) return null;
  return (
    <section>
      <div className="etch" />
      <div className="mb-3 flex items-baseline justify-between">
        <h2 className="text-[11px] tracking-[2px] text-mute uppercase">体型时间轴</h2>
        <span className="text-[11px] text-mute">仅存本机</span>
      </div>
      <div className="-mx-5 flex gap-2 overflow-x-auto px-5 pb-1 [scrollbar-width:none]">
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
    // 时间轴的全部意义是**对比**——看到三个月前那张，第一反应是点开看大图。
    // 大图和重拍/删除本来就都在日详情页（PhotoCard），直接把它当归宿，别再造一个查看器。
    <Link to={`/day/${photo.date}`} className="shrink-0 active:scale-[.97]">
      <figure>
        <div className="overflow-hidden rounded-lg bg-raised">
          <img src={url} alt={photo.date} className="h-24 w-24 object-cover" />
        </div>
        <figcaption className="mt-1 text-center text-[10px] text-mute">
          {photo.date.slice(5)}
        </figcaption>
      </figure>
    </Link>
  );
}
