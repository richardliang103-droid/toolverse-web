"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CountUp } from "@/components/count-up";
import { DEFAULT_PASSWORD_OPTIONS, PASSWORD_MAX, PASSWORD_MIN, characterClasses, generatePassword, passwordEntropyBits, passwordStrength } from "@/lib/password";
import type { PasswordOptions } from "@/lib/password";

const STORAGE_KEY = "toolverse:password-generator:v1";

const CLASS_TOGGLES: Array<{ key: keyof Pick<PasswordOptions, "lowercase" | "uppercase" | "digits" | "symbols">; label: string; sample: string }> = [
  { key: "lowercase", label: "小寫字母", sample: "a-z" },
  { key: "uppercase", label: "大寫字母", sample: "A-Z" },
  { key: "digits", label: "數字", sample: "0-9" },
  { key: "symbols", label: "符號", sample: "!@#$" },
];

function sanitizeOptions(value: unknown): PasswordOptions {
  const data = (typeof value === "object" && value !== null ? value : {}) as Record<string, unknown>;
  const length = Number.isFinite(Number(data.length)) ? Math.min(Math.max(Math.round(Number(data.length)), PASSWORD_MIN), PASSWORD_MAX) : DEFAULT_PASSWORD_OPTIONS.length;
  const bool = (input: unknown, fallback: boolean) => (typeof input === "boolean" ? input : fallback);
  const options: PasswordOptions = {
    length,
    lowercase: bool(data.lowercase, true),
    uppercase: bool(data.uppercase, true),
    digits: bool(data.digits, true),
    symbols: bool(data.symbols, true),
    excludeSimilar: bool(data.excludeSimilar, false),
  };
  // 至少要有一種類別，否則回退到預設。
  if (characterClasses(options).length === 0) return { ...DEFAULT_PASSWORD_OPTIONS, length };
  return options;
}

export function PasswordGeneratorTool() {
  const [options, setOptions] = useState<PasswordOptions>(DEFAULT_PASSWORD_OPTIONS);
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const regenerate = useCallback((next: PasswordOptions) => {
    try {
      setPassword(generatePassword(next));
      setError("");
      setCopied(false);
    } catch (caught) {
      setPassword("");
      setError(caught instanceof Error ? caught.message : "產生失敗");
    }
  }, []);

  useEffect(() => {
    let restored = DEFAULT_PASSWORD_OPTIONS;
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) restored = sanitizeOptions(JSON.parse(saved));
    } catch { localStorage.removeItem(STORAGE_KEY); }
    // 還原偏好並立刻產生一組；密碼本身絕不寫入 localStorage。
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setOptions(restored);
    regenerate(restored);
     
    setHydrated(true);
  }, [regenerate]);

  useEffect(() => {
    if (hydrated) localStorage.setItem(STORAGE_KEY, JSON.stringify(options));
  }, [hydrated, options]);

  useEffect(() => () => { if (copyTimerRef.current) clearTimeout(copyTimerRef.current); }, []);

  function update(patch: Partial<PasswordOptions>) {
    const next = { ...options, ...patch };
    if (characterClasses(next).length === 0) { setError("請至少保留一種字元類別"); return; }
    setOptions(next);
    regenerate(next);
  }

  async function copyPassword() {
    if (!password) return;
    try {
      await navigator.clipboard.writeText(password);
      setCopied(true);
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
      copyTimerRef.current = setTimeout(() => setCopied(false), 2400);
    } catch {
      setError("無法複製到剪貼簿，請手動選取密碼複製");
    }
  }

  const bits = passwordEntropyBits(options);
  const strength = passwordStrength(bits);
  const strengthPercent = Math.min(100, Math.round((bits / 128) * 100));

  return <section className="workspace password-workspace page-shell" aria-label="密碼產生器">
    <div className="panel">
      <div className="panel-header"><h2>密碼設定</h2><span className="panel-meta">Web Crypto 安全隨機</span></div>
      <div className="password-length-row">
        <label className="field-label" htmlFor="pw-length">長度：{options.length}</label>
        <input id="pw-length" className="gantt-range" type="range" min={PASSWORD_MIN} max={PASSWORD_MAX} value={options.length} onChange={(event) => update({ length: Number(event.target.value) })} />
      </div>
      <div className="password-toggles">
        {CLASS_TOGGLES.map((item) => (
          <label key={item.key} className="check-row password-toggle">
            <input type="checkbox" checked={options[item.key]} onChange={(event) => update({ [item.key]: event.target.checked })} />
            {item.label} <code>{item.sample}</code>
          </label>
        ))}
        <label className="check-row password-toggle">
          <input type="checkbox" checked={options.excludeSimilar} onChange={(event) => update({ excludeSimilar: event.target.checked })} />
          排除易混字元 <code>0O1lI…</code>
        </label>
      </div>
      <p className="key-note">全部在瀏覽器本機以 Web Crypto 產生，密碼不會上傳、也不會寫入任何儲存。輸入敏感帳號密碼請自行保管。</p>
    </div>
    <div className="panel panel-tinted password-result-panel">
      <div className="panel-header"><h2>產生結果</h2><span className="panel-meta">約 <CountUp value={bits} /> bits 熵</span></div>
      <output className="password-output" aria-live="polite">{password || "—"}</output>
      <div className={`password-strength password-strength-${strength.level}`}>
        <div className="password-strength-bar"><span style={{ width: `${strengthPercent}%` }} /></div>
        <span className="password-strength-label">強度：{strength.label}</span>
      </div>
      {error && <p className="error-message" role="alert">{error}</p>}
      <div className="result-actions">
        <button className="button button-small button-blue" type="button" onClick={() => regenerate(options)} disabled={!password}>重新產生</button>
        <button className="button button-small button-secondary" type="button" onClick={copyPassword} disabled={!password}>{copied ? "已複製 ✓" : "複製密碼"}</button>
      </div>
    </div>
  </section>;
}
