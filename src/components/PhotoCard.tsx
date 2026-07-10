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
    <div className="rounded-2xl bg-card p-5">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-mute">体型铁证</h2>
        <span className="text-[11px] text-mute">仅存本机</span>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={onPick}
      />
      {!url && (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="w-full rounded-xl border border-dashed border-line py-6 text-mute active:scale-[.98]"
        >
          📷 拍一张，留下今天的证据
        </button>
      )}
      {url && (
        <div className="flex flex-col gap-2">
          <img src={url} alt={`${date} 体型照片`} className="max-h-80 w-full rounded-xl object-cover" />
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              className="flex-1 rounded-lg bg-card2 py-2 text-sm text-ink active:scale-95"
            >
              重拍
            </button>
            <button
              type="button"
              onClick={async () => {
                if (window.confirm('删除这张照片？')) await removePhoto(date);
              }}
              className="flex-1 rounded-lg bg-card2 py-2 text-sm text-iron active:scale-95"
            >
              删除
            </button>
          </div>
        </div>
      )}
      {error && <p className="mt-2 text-sm text-iron">照片处理失败，请重试或换一张</p>}
    </div>
  );
}
