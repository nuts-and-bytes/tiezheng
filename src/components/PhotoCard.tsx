import { useEffect, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { compressImage } from '../lib/image';
import { log } from '../lib/logger';
import { getPhoto, removePhoto, savePhoto } from '../repos/photoRepo';

export function PhotoCard({ date }: { date: string }) {
  const photo = useLiveQuery(() => getPhoto(date), [date]);
  const [url, setUrl] = useState('');
  const [error, setError] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!photo) {
      setUrl('');
      return;
    }
    const u = URL.createObjectURL(photo.blob);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [photo]);

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      setError(false);
      await savePhoto(date, await compressImage(file));
    } catch (err) {
      log(`photo compress: ${String(err)}`);
      setError(true);
    }
  }

  return (
    <section>
      <div className="mb-3 flex items-baseline justify-between">
        <h2 className="text-[11px] tracking-[2px] text-mute uppercase">体型铁证</h2>
        <span className="text-[11px] text-mute">仅存本机</span>
      </div>
      {/* 刻意不写 capture：那会强制拉起后置摄像头，把「从相册选」这个选项整个拿掉。
          体型对比要拿三个月前的旧照片当基线，而且对镜自拍用的是前置。该由用户选。 */}
      <input ref={inputRef} type="file" accept="image/*" className="hidden" onChange={onPick} />
      {!url && (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="flex w-full items-center justify-center gap-2 rounded-2xl border border-dashed border-line py-8 text-sm text-mute active:scale-[.98]"
        >
          {/* 这里原是相机 emoji：部分设备上直接渲染成豆腐块方块，换回全站的线描图标语言 */}
          <svg
            width={18}
            height={18}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.8}
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
          >
            <path d="M3.5 8.8A1.8 1.8 0 0 1 5.3 7h2l1.2-2h7l1.2 2h2a1.8 1.8 0 0 1 1.8 1.8v8.4a1.8 1.8 0 0 1-1.8 1.8H5.3a1.8 1.8 0 0 1-1.8-1.8V8.8Z" />
            <circle cx="12" cy="12.8" r="3.4" />
          </svg>
          拍一张，留下今天的证据
        </button>
      )}
      {/* 照片是实体，允许浮起：bg-raised 表面 + 溢出裁切 */}
      {url && (
        <div className="overflow-hidden rounded-2xl bg-raised">
          <img src={url} alt={`${date} 体型照片`} className="max-h-80 w-full object-cover" />
          <div className="flex border-t border-line">
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              className="flex-1 py-3 text-sm text-ink active:scale-95"
            >
              重拍
            </button>
            <span className="w-px bg-line" aria-hidden />
            <button
              type="button"
              onClick={async () => {
                if (window.confirm('删除这张照片？')) await removePhoto(date);
              }}
              className="flex-1 py-3 text-sm text-iron active:scale-95"
            >
              删除
            </button>
          </div>
        </div>
      )}
      {error && <p className="mt-2 text-sm text-iron">照片处理失败，请重试或换一张</p>}
    </section>
  );
}
