/** 长边限制在 max 内的等比缩放，小图不放大 */
export function fitWithin(
  width: number,
  height: number,
  max: number,
): { width: number; height: number } {
  const long = Math.max(width, height);
  if (long <= max) return { width, height };
  const scale = max / long;
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
}

/** 规格 §9：长边 1280、JPEG q0.8，产出约 100–200KB */
export async function compressImage(file: Blob, max = 1280, quality = 0.8): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const { width, height } = fitWithin(bitmap.width, bitmap.height, max);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('toBlob failed'))),
      'image/jpeg',
      quality,
    );
  });
}
