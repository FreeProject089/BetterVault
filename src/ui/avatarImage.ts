/**
 * Prépare une photo de profil : recadrage carré au centre, 256 px, réencodée en WebP (PNG en secours).
 * Le réencodage retire aussi les métadonnées de la photo d'origine (position GPS, appareil…).
 */

const ACCEPTED = /^image\/(png|jpeg|webp|gif|avif|bmp)$/;

export async function resizeAvatar(file: File, size = 256): Promise<{ bytes: Uint8Array; dataUrl: string }> {
  if (!ACCEPTED.test(file.type)) throw new Error('Image PNG, JPEG, WebP, GIF ou AVIF attendue');
  if (file.size > 20 * 1024 * 1024) throw new Error('Image trop volumineuse (20 Mo maximum avant réduction)');

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error('Image illisible');
  }
  const side = Math.min(bitmap.width, bitmap.height);
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Image illisible');
  context.imageSmoothingQuality = 'high';
  context.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, size, size);
  bitmap.close();

  const encode = (type: string, quality?: number) => new Promise<Blob | null>(resolve => canvas.toBlob(resolve, type, quality));
  let blob = await encode('image/webp', 0.86);
  // Certains navigateurs renvoient du PNG quand WebP n'est pas pris en charge : on vérifie le type obtenu
  if (!blob || blob.type !== 'image/webp') blob = await encode('image/png');
  if (!blob) throw new Error('Image illisible');

  const bytes = new Uint8Array(await blob.arrayBuffer());
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('Image illisible'));
    reader.readAsDataURL(blob!);
  });
  return { bytes, dataUrl };
}
