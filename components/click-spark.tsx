"use client";

import { useEffect, useRef } from "react";

type Spark = { x: number; y: number; angle: number; start: number };

const SPARK_COUNT = 8;
const SPARK_RADIUS = 17;
const SPARK_LENGTH = 9;
const DURATION_MS = 420;

// 改寫自 react-bits 的 ClickSpark（MIT + Commons Clause）：全站點擊時在游標處
// 迸出短促的線狀火花。純 canvas，不動 DOM、不攔截事件（pointer-events: none）。
export function ClickSpark() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const context = canvas.getContext("2d");
    if (!context) return;

    let sparks: Spark[] = [];
    let frame = 0;

    const resize = () => {
      const ratio = window.devicePixelRatio || 1;
      canvas.width = Math.round(window.innerWidth * ratio);
      canvas.height = Math.round(window.innerHeight * ratio);
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
    };

    const draw = (now: number) => {
      context.clearRect(0, 0, window.innerWidth, window.innerHeight);
      sparks = sparks.filter((spark) => now - spark.start < DURATION_MS);
      for (const spark of sparks) {
        const progress = (now - spark.start) / DURATION_MS;
        const eased = 1 - Math.pow(1 - progress, 3);
        const distance = eased * SPARK_RADIUS;
        const length = SPARK_LENGTH * (1 - eased);
        context.strokeStyle = "#3557ff";
        context.lineWidth = 2;
        context.lineCap = "round";
        context.beginPath();
        context.moveTo(spark.x + distance * Math.cos(spark.angle), spark.y + distance * Math.sin(spark.angle));
        context.lineTo(spark.x + (distance + length) * Math.cos(spark.angle), spark.y + (distance + length) * Math.sin(spark.angle));
        context.stroke();
      }
      frame = sparks.length > 0 ? requestAnimationFrame(draw) : 0;
    };

    const handleClick = (event: MouseEvent) => {
      const now = performance.now();
      for (let i = 0; i < SPARK_COUNT; i += 1) {
        sparks.push({ x: event.clientX, y: event.clientY, angle: (Math.PI * 2 * i) / SPARK_COUNT, start: now });
      }
      if (!frame) frame = requestAnimationFrame(draw);
    };

    resize();
    window.addEventListener("resize", resize);
    document.addEventListener("click", handleClick, { passive: true });
    return () => {
      window.removeEventListener("resize", resize);
      document.removeEventListener("click", handleClick);
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);

  return <canvas ref={canvasRef} className="click-spark-layer" aria-hidden="true" />;
}
