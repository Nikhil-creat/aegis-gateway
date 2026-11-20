import { useEffect, useRef, useState } from 'react';

const VIDEO_URL = 'https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260715_090628_7052d8a6-a094-4341-a4a2-ad58493a67a9.mp4';
const FPS = 30;
type VFC = (cb: () => void) => number;

/**
 * Capture-then-boomerang background (the template's core motion).
 * 1) Play the clip once while copying each frame to an offscreen canvas (deduplicated by currentTime,
 *    capture width capped at 960px; 640px on phones and low-memory devices; frame count capped).
 * 2) On `ended`, hide the <video> and ping-pong the stored frames on a <canvas> at 30fps, forever.
 * Fallbacks: if the clip's host sends no CORS headers the capture cannot work, so the video is reloaded
 * without `crossOrigin` and simply loops natively. If it cannot load at all, the soft gradient shows.
 * Reduced-motion users get the first frame only.
 */
export default function BoomerangVideoBg() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const framesRef = useRef<HTMLCanvasElement[]>([]);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const lowMem = ((navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 8) < 4;
    const maxWidth = window.innerWidth < 768 || lowMem ? 640 : 960;
    const maxFrames = lowMem ? 150 : 300;
    const frames: HTMLCanvasElement[] = [];
    const seen = new Set<number>();
    let capturing = false;
    let cancelled = false;
    let raf = 0;
    let vfc = 0;
    let retriedWithoutCors = false;

    const capture = () => {
      if (!video.videoWidth || frames.length >= maxFrames) return;
      const t = Math.round(video.currentTime * 1000);
      if (seen.has(t)) return;
      seen.add(t);
      const w = Math.min(maxWidth, video.videoWidth);
      const c = document.createElement('canvas');
      c.width = w;
      c.height = Math.round((video.videoHeight * w) / video.videoWidth);
      c.getContext('2d')?.drawImage(video, 0, 0, c.width, c.height);
      frames.push(c);
    };
    const loop = () => {
      if (!capturing || cancelled) return;
      capture();
      if ('requestVideoFrameCallback' in video) vfc = (video as HTMLVideoElement & { requestVideoFrameCallback: VFC }).requestVideoFrameCallback(loop);
      else raf = requestAnimationFrame(loop);
    };
    const onPlaying = () => {
      if (!capturing && !retriedWithoutCors) {
        capturing = true;
        loop();
      }
    };
    const onEnded = () => {
      capturing = false;
      if (frames.length > 1) {
        framesRef.current = frames;
        setReady(true);
      } else {
        video.loop = true;
        void video.play().catch(() => undefined);
      }
    };
    const onError = () => {
      capturing = false;
      if (!retriedWithoutCors) {
        retriedWithoutCors = true;
        video.removeAttribute('crossorigin');
        video.loop = true;
        video.src = VIDEO_URL;
        video.load();
        void video.play().catch(() => undefined);
      } else setFailed(true);
    };

    video.addEventListener('playing', onPlaying);
    video.addEventListener('ended', onEnded);
    video.addEventListener('error', onError);
    if (reduced) video.pause();
    else void video.play().catch(() => undefined);

    return () => {
      cancelled = true;
      capturing = false;
      cancelAnimationFrame(raf);
      if (vfc && 'cancelVideoFrameCallback' in video) (video as HTMLVideoElement & { cancelVideoFrameCallback: (id: number) => void }).cancelVideoFrameCallback(vfc);
      video.removeEventListener('playing', onPlaying);
      video.removeEventListener('ended', onEnded);
      video.removeEventListener('error', onError);
    };
  }, []);

  useEffect(() => {
    if (!ready) return;
    const canvas = canvasRef.current;
    const frames = framesRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx || frames.length < 2) return;
    canvas.width = frames[0].width;
    canvas.height = frames[0].height;
    const interval = 1000 / FPS;
    let idx = 0;
    let dir = 1;
    let last = 0;
    let raf = 0;
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      if (document.hidden || now - last < interval) return;
      last = now - ((now - last) % interval);
      ctx.drawImage(frames[idx], 0, 0);
      if (idx >= frames.length - 1) dir = -1;
      else if (idx <= 0) dir = 1;
      idx += dir;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [ready]);

  return (
    <div className="absolute inset-0 z-0 bg-gradient-to-b from-white via-mist to-white" aria-hidden="true">
      <div className="absolute inset-0 scale-[1.15] origin-top overflow-hidden">
        <video
          ref={videoRef}
          src={VIDEO_URL}
          muted
          playsInline
          preload="auto"
          crossOrigin="anonymous"
          tabIndex={-1}
          className="w-full h-full object-cover object-top"
          style={{ display: ready || failed ? 'none' : 'block' }}
        />
        <canvas ref={canvasRef} className="w-full h-full object-cover object-top" style={{ display: ready ? 'block' : 'none' }} />
      </div>
    </div>
  );
}
