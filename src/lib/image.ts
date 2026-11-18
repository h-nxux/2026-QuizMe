const MAX_EDGE = 2000;
const QUALITY = 0.82;
// Vercel caps request bodies at 4.5MB; base64 adds a third.
const MAX_UPLOAD_BYTES = 3 * 1024 * 1024;

export function fileToBase64(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? '').split(',')[1] ?? '');
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

async function decode(file: File): Promise<ImageBitmap | HTMLImageElement> {
  if ('createImageBitmap' in window) {
    try {
      return await createImageBitmap(file, { imageOrientation: 'from-image' });
    } catch {
      // fall through to <img>, which handles more formats on Safari
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}

// Downscales camera photos (often 4000px+, 3–8MB) to something OCR-friendly and upload-sized.
export async function compressImage(file: File): Promise<{ fileBase64: string; mimeType: string }> {
  try {
    const source = await decode(file);
    const w = 'naturalWidth' in source ? source.naturalWidth : source.width;
    const h = 'naturalHeight' in source ? source.naturalHeight : source.height;
    const scale = Math.min(1, MAX_EDGE / Math.max(w, h));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(w * scale);
    canvas.height = Math.round(h * scale);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('no canvas');
    ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/jpeg', QUALITY));
    if (!blob) throw new Error('encode failed');
    return { fileBase64: await fileToBase64(blob), mimeType: 'image/jpeg' };
  } catch {
    if (file.size > MAX_UPLOAD_BYTES) throw new Error('사진을 처리하지 못했어요. 다른 사진으로 시도해주세요.');
    return { fileBase64: await fileToBase64(file), mimeType: file.type || 'image/jpeg' };
  }
}
