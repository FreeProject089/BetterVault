import jsQR from 'jsqr';

/**
 * Lecture de QR codes 2FA (otpauth://) depuis la caméra ou une image.
 * Le décodage est entièrement local : aucune image ne quitte l'appareil.
 */

export function decodeQrFromImageData(image: ImageData): string | null {
  const result = jsQR(image.data, image.width, image.height, { inversionAttempts: 'attemptBoth' });
  return result?.data ?? null;
}

export async function decodeQrFromFile(file: File): Promise<string | null> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return decodeQrFromImageData(ctx.getImageData(0, 0, canvas.width, canvas.height));
}

export class CameraQrScanner {
  private readonly video: HTMLVideoElement;
  private stream: MediaStream | null = null;
  private frameId = 0;
  private stopped = false;

  constructor(video: HTMLVideoElement) {
    this.video = video;
  }

  async start(onResult: (text: string) => void): Promise<void> {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('Caméra indisponible sur cet appareil');
    this.stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
    this.video.srcObject = this.stream;
    await this.video.play();

    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('Canvas indisponible');

    const tick = () => {
      // La modale a été fermée : on libère la caméra
      if (this.stopped || !this.video.isConnected) {
        this.stop();
        return;
      }
      if (this.video.readyState >= 2 && this.video.videoWidth > 0) {
        canvas.width = this.video.videoWidth;
        canvas.height = this.video.videoHeight;
        ctx.drawImage(this.video, 0, 0);
        const text = decodeQrFromImageData(ctx.getImageData(0, 0, canvas.width, canvas.height));
        if (text) {
          this.stop();
          onResult(text);
          return;
        }
      }
      this.frameId = requestAnimationFrame(tick);
    };
    tick();
  }

  stop(): void {
    this.stopped = true;
    cancelAnimationFrame(this.frameId);
    this.stream?.getTracks().forEach(track => track.stop());
    this.stream = null;
    this.video.srcObject = null;
  }
}
