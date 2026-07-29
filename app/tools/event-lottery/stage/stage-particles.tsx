"use client";

import { useEffect, useRef } from "react";

type Particle = { x: number; y: number; radius: number; speed: number; drift: number; opacity: number };

/** 舞台背景的漂浮光點；純 Canvas 繪製，不引入任何外部粒子庫或 CDN。 */
export function StageParticles() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;

    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let width = 0;
    let height = 0;
    let particles: Particle[] = [];

    function layout() {
      if (!canvas || !context) return;
      width = canvas.clientWidth;
      height = canvas.clientHeight;
      const ratio = window.devicePixelRatio || 1;
      canvas.width = width * ratio;
      canvas.height = height * ratio;
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      const count = reduceMotion ? 22 : 50;
      particles = Array.from({ length: count }, () => ({
        x: Math.random() * width,
        y: Math.random() * height,
        radius: 1 + Math.random() * 2.4,
        speed: 6 + Math.random() * 14,
        drift: (Math.random() - 0.5) * 10,
        opacity: 0.12 + Math.random() * 0.32,
      }));
    }

    function paint() {
      if (!context) return;
      context.clearRect(0, 0, width, height);
      for (const particle of particles) {
        context.beginPath();
        context.arc(particle.x, particle.y, particle.radius, 0, Math.PI * 2);
        context.fillStyle = `rgba(255,255,255,${particle.opacity})`;
        context.fill();
      }
    }

    layout();
    paint();
    window.addEventListener("resize", layout);

    if (reduceMotion) {
      return () => window.removeEventListener("resize", layout);
    }

    let raf = 0;
    let last = performance.now();
    function frame(now: number) {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      for (const particle of particles) {
        particle.y -= particle.speed * dt;
        particle.x += particle.drift * dt;
        if (particle.y < -10) { particle.y = height + 10; particle.x = Math.random() * width; }
        if (particle.x < -10) particle.x = width + 10;
        if (particle.x > width + 10) particle.x = -10;
      }
      paint();
      raf = requestAnimationFrame(frame);
    }
    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", layout);
    };
  }, []);

  return <canvas ref={canvasRef} className="event-lottery-stage-particles" aria-hidden="true" />;
}
