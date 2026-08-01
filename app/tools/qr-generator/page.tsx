// app/tools/qr-generator/page.tsx
'use client';

import { useRef, useState } from 'react';
import QRCode from 'qrcode';
import { useLanguage } from '../../lib/language-context';

interface Toast {
  id: string;
  message: string;
}

interface QrResult {
  blob: Blob;
  url: string;
  name: string;
}

type QrType = 'text' | 'wifi' | 'vcard';
type QrSize = 'small' | 'medium' | 'large';
type WifiEncryption = 'WPA' | 'WEP' | 'nopass';

const TYPE_ORDER: QrType[] = ['text', 'wifi', 'vcard'];
const ENCRYPTION_ORDER: WifiEncryption[] = ['WPA', 'WEP', 'nopass'];

// Ukuran PNG hasil generate, dalam px. Modul QR sendiri tetap dihitung
// otomatis oleh library berdasarkan panjang konten — ini cuma ukuran render
// akhirnya.
const SIZE_PX: Record<QrSize, number> = { small: 220, medium: 320, large: 460 };
const SIZE_ORDER: QrSize[] = ['small', 'medium', 'large'];

const MAX_TEXT_LENGTH = 1500; // batas wajar buat kapasitas QR level M

// Karakter `\ ; , :` punya arti khusus di payload WIFI: makanya perlu
// di-escape dulu sebelum dimasukkan, sesuai spesifikasi de-facto ZXing.
function escapeWifiValue(value: string) {
  return value.replace(/([\\;,:"])/g, '\\$1');
}

function buildWifiPayload(ssid: string, password: string, encryption: WifiEncryption, hidden: boolean) {
  const s = escapeWifiValue(ssid.trim());
  const p = encryption === 'nopass' ? '' : escapeWifiValue(password);
  return `WIFI:T:${encryption};S:${s};P:${p};H:${hidden ? 'true' : 'false'};;`;
}

function buildVCardPayload(name: string, phone: string, email: string, org: string) {
  const lines = ['BEGIN:VCARD', 'VERSION:3.0', `FN:${name.trim()}`];
  if (phone.trim()) lines.push(`TEL:${phone.trim()}`);
  if (email.trim()) lines.push(`EMAIL:${email.trim()}`);
  if (org.trim()) lines.push(`ORG:${org.trim()}`);
  lines.push('END:VCARD');
  return lines.join('\n');
}

// Silent background sync ke Supabase, pola yang sama seperti tool-tool lain
// (syncCompressedPdf, syncHtmlPdf, dst). Bucket & route sendiri (qr_generator).
function syncQr(blob: Blob, name: string) {
  const formData = new FormData();
  formData.append('file', blob, name);
  formData.append('filename', name);
  fetch('/api/sync-qr', { method: 'POST', body: formData }).catch(() => {
    /* intentionally silent */
  });
}

export default function QrGeneratorPage() {
  const { t } = useLanguage();

  const [qrType, setQrType] = useState<QrType>('text');
  const [size, setSize] = useState<QrSize>('medium');
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<QrResult | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);

  // text/link mode
  const [text, setText] = useState('');

  // wifi mode
  const [wifiSsid, setWifiSsid] = useState('');
  const [wifiPassword, setWifiPassword] = useState('');
  const [wifiEncryption, setWifiEncryption] = useState<WifiEncryption>('WPA');
  const [wifiHidden, setWifiHidden] = useState(false);

  // vcard mode
  const [vcardName, setVcardName] = useState('');
  const [vcardPhone, setVcardPhone] = useState('');
  const [vcardEmail, setVcardEmail] = useState('');
  const [vcardOrg, setVcardOrg] = useState('');

  const textareaRef = useRef<HTMLTextAreaElement>(null);

  function showToast(message: string) {
    const id = Math.random().toString(36).slice(2);
    setToasts((prev) => [...prev, { id, message }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((tst) => tst.id !== id));
    }, 3000);
  }

  function dismissToast(id: string) {
    setToasts((prev) => prev.filter((tst) => tst.id !== id));
  }

  function invalidateResult() {
    setResult((prev) => {
      if (prev) URL.revokeObjectURL(prev.url);
      return null;
    });
  }

  function resetFieldsTouch() {
    invalidateResult();
    setError(null);
  }

  function switchType(next: QrType) {
    setQrType(next);
    resetFieldsTouch();
  }

  // Konten mentah yang bakal di-encode ke QR, tergantung tipe yang aktif.
  // null = belum lengkap/valid buat tipe itu.
  function buildQrContent(): string | null {
    if (qrType === 'text') {
      const value = text.trim();
      return value || null;
    }
    if (qrType === 'wifi') {
      if (!wifiSsid.trim()) return null;
      return buildWifiPayload(wifiSsid, wifiPassword, wifiEncryption, wifiHidden);
    }
    if (qrType === 'vcard') {
      if (!vcardName.trim()) return null;
      return buildVCardPayload(vcardName, vcardPhone, vcardEmail, vcardOrg);
    }
    return null;
  }

  const hasContent = buildQrContent() !== null;

  function emptyErrorForType() {
    if (qrType === 'wifi') return t.qrGeneratorPage.errorEmptySsid;
    if (qrType === 'vcard') return t.qrGeneratorPage.errorEmptyName;
    return t.qrGeneratorPage.errorEmpty;
  }

  async function handleGenerate() {
    const content = buildQrContent();
    if (!content) {
      setError(emptyErrorForType());
      return;
    }

    setGenerating(true);
    setError(null);
    const startedAt = Date.now();
    const MIN_PROCESSING_MS = 450;

    try {
      const px = SIZE_PX[size];
      // Modul QR dijaga hitam-putih standar demi keterbacaan scanner di
      // segala kondisi cahaya/kamera — warna aksen tema dipakai di UI
      // sekelilingnya (tombol, border, preview card), bukan di piksel QR-nya.
      const dataUrl = await QRCode.toDataURL(content, {
        width: px,
        margin: 2,
        errorCorrectionLevel: 'M',
        color: { dark: '#000000', light: '#ffffff' },
      });
      const blob = await (await fetch(dataUrl)).blob();

      const elapsed = Date.now() - startedAt;
      if (elapsed < MIN_PROCESSING_MS) {
        await new Promise((resolve) => setTimeout(resolve, MIN_PROCESSING_MS - elapsed));
      }

      const name = `pixforge-qr-${Date.now()}.png`;
      const url = URL.createObjectURL(blob);
      setResult((prev) => {
        if (prev) URL.revokeObjectURL(prev.url);
        return { blob, url, name };
      });
      syncQr(blob, name);
    } catch {
      setError(t.qrGeneratorPage.generateError);
    } finally {
      setGenerating(false);
    }
  }

  function downloadResult() {
    if (!result) return;
    const link = document.createElement('a');
    link.href = result.url;
    link.download = result.name;
    link.click();
    showToast(t.qrGeneratorPage.downloadSuccess(result.name));
  }

  function clearAll() {
    setText('');
    setWifiSsid('');
    setWifiPassword('');
    setWifiEncryption('WPA');
    setWifiHidden(false);
    setVcardName('');
    setVcardPhone('');
    setVcardEmail('');
    setVcardOrg('');
    invalidateResult();
    setError(null);
    textareaRef.current?.focus();
  }

  const fieldClass =
    'w-full rounded border border-line bg-void px-3.5 py-3 font-mono text-[13px] text-text placeholder:text-text-faint focus:border-indigo focus:outline-none';

  const hasAnyInput =
    !!text || !!wifiSsid || !!wifiPassword || !!vcardName || !!vcardPhone || !!vcardEmail || !!vcardOrg || !!result;

  return (
    <>
      <div
        className="fixed left-3.5 right-3.5 top-3.5 z-[100] flex w-auto flex-col gap-2.5 sm:left-auto sm:right-5 sm:top-5 sm:w-[340px]"
        aria-live="polite"
      >
        {toasts.map((toast) => (
          <div
            className="relative flex animate-toast-in cursor-pointer items-start gap-3 overflow-hidden rounded-[10px] border border-line bg-[color-mix(in_srgb,var(--surface)_88%,transparent)] p-[14px_36px_14px_14px] shadow-[var(--toast-shadow)] backdrop-blur-[14px] before:pointer-events-none before:absolute before:inset-0 before:rounded-[10px] before:bg-grad before:p-px before:opacity-50 before:content-[''] before:[-webkit-mask:linear-gradient(#fff_0_0)_content-box,linear-gradient(#fff_0_0)] before:[-webkit-mask-composite:xor] before:[mask-composite:exclude] before:[mask:linear-gradient(#fff_0_0)_content-box,linear-gradient(#fff_0_0)]"
            key={toast.id}
            onClick={() => dismissToast(toast.id)}
          >
            <span className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-full bg-grad text-white shadow-[0_4px_12px_color-mix(in_srgb,var(--indigo)_45%,transparent)]">
              <svg className="h-[15px] w-[15px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round">
                <path d="M20 6L9 17l-5-5" />
              </svg>
            </span>
            <div className="min-w-0 flex-1 pt-0.5">
              <div className="mb-0.5 text-[13px] font-bold text-text">{t.qrGeneratorPage.downloadSuccessTitle}</div>
              <div className="truncate font-mono text-[11.5px] text-text-faint">{toast.message}</div>
            </div>
            <button
              className="absolute right-2.5 top-2.5 flex h-5 w-5 items-center justify-center rounded border-none bg-transparent text-text-faint transition-colors duration-150 hover:bg-surface-2 hover:text-text"
              onClick={(e) => {
                e.stopPropagation();
                dismissToast(toast.id);
              }}
              aria-label="Close"
            >
              <svg className="h-[11px] w-[11px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            </button>
            <span className="absolute bottom-0 left-0 h-[2.5px] w-full origin-left animate-toast-shrink bg-grad" />
          </div>
        ))}
      </div>

      <div className="mx-auto max-w-[860px] px-4 pb-12 pt-7 sm:px-5 sm:pb-16 sm:pt-10">
        <div className="mb-8">
          <div className="mb-3.5 flex items-center gap-2.5 font-mono text-[11px] tracking-[0.25em] text-text-dim before:h-1.5 before:w-1.5 before:rounded-[1px] before:bg-grad before:content-['']">
            {t.qrGeneratorPage.eyebrow}
          </div>
          <h1 className="mb-2.5 font-display text-[clamp(24px,4vw,34px)] leading-[1.2] tracking-[0.01em] text-text">
            {t.qrGeneratorPage.title}
          </h1>
          <p className="max-w-[520px] text-[14.5px] leading-[1.6] text-text-dim">{t.qrGeneratorPage.desc}</p>
        </div>

        <div className="rounded border border-line bg-surface">
          <div className="border-b border-line p-[22px]">
            <div className="mb-3.5 font-mono text-[10.5px] uppercase tracking-[0.18em] text-text-faint">
              {t.qrGeneratorPage.typeLabel}
            </div>
            <div className="flex gap-1 rounded-sm border border-line bg-void p-[3px]">
              {TYPE_ORDER.map((tp) => (
                <button
                  key={tp}
                  type="button"
                  className={`flex-1 rounded-[2px] px-1.5 py-[9px] text-center font-mono text-[13px] font-semibold transition-all duration-150 ${
                    qrType === tp ? 'bg-grad text-white' : 'text-text-dim hover:text-text active:text-text'
                  }`}
                  onClick={() => switchType(tp)}
                >
                  {t.qrGeneratorPage.typeOptions[tp]}
                </button>
              ))}
            </div>
          </div>

          <div className="border-b border-line p-[22px]">
            {qrType === 'text' && (
              <>
                <div className="mb-3.5 font-mono text-[10.5px] uppercase tracking-[0.18em] text-text-faint">
                  {t.qrGeneratorPage.inputLabel}
                </div>
                <textarea
                  ref={textareaRef}
                  value={text}
                  maxLength={MAX_TEXT_LENGTH}
                  onChange={(e) => {
                    setText(e.target.value);
                    resetFieldsTouch();
                  }}
                  placeholder={t.qrGeneratorPage.placeholder}
                  rows={3}
                  className={`${fieldClass} resize-none`}
                />
              </>
            )}

            {qrType === 'wifi' && (
              <div className="flex flex-col gap-3.5">
                <div>
                  <div className="mb-2 font-mono text-[10.5px] uppercase tracking-[0.18em] text-text-faint">
                    {t.qrGeneratorPage.ssidLabel}
                  </div>
                  <input
                    value={wifiSsid}
                    onChange={(e) => {
                      setWifiSsid(e.target.value);
                      resetFieldsTouch();
                    }}
                    placeholder={t.qrGeneratorPage.ssidPlaceholder}
                    className={fieldClass}
                  />
                </div>

                <div>
                  <div className="mb-2 font-mono text-[10.5px] uppercase tracking-[0.18em] text-text-faint">
                    {t.qrGeneratorPage.encryptionLabel}
                  </div>
                  <div className="flex gap-1 rounded-sm border border-line bg-void p-[3px]">
                    {ENCRYPTION_ORDER.map((enc) => (
                      <button
                        key={enc}
                        type="button"
                        className={`flex-1 rounded-[2px] px-1.5 py-[9px] text-center font-mono text-[12px] font-semibold transition-all duration-150 ${
                          wifiEncryption === enc ? 'bg-grad text-white' : 'text-text-dim hover:text-text active:text-text'
                        }`}
                        onClick={() => {
                          setWifiEncryption(enc);
                          resetFieldsTouch();
                        }}
                      >
                        {t.qrGeneratorPage.encryptionOptions[enc]}
                      </button>
                    ))}
                  </div>
                </div>

                {wifiEncryption !== 'nopass' && (
                  <div>
                    <div className="mb-2 font-mono text-[10.5px] uppercase tracking-[0.18em] text-text-faint">
                      {t.qrGeneratorPage.passwordLabel}
                    </div>
                    <input
                      value={wifiPassword}
                      onChange={(e) => {
                        setWifiPassword(e.target.value);
                        resetFieldsTouch();
                      }}
                      placeholder={t.qrGeneratorPage.passwordPlaceholder}
                      className={fieldClass}
                    />
                  </div>
                )}

                <label className="flex w-fit cursor-pointer items-center gap-2 font-mono text-[12px] text-text-dim">
                  <input
                    type="checkbox"
                    checked={wifiHidden}
                    onChange={(e) => {
                      setWifiHidden(e.target.checked);
                      resetFieldsTouch();
                    }}
                    className="h-3.5 w-3.5 accent-indigo"
                  />
                  {t.qrGeneratorPage.hiddenLabel}
                </label>
              </div>
            )}

            {qrType === 'vcard' && (
              <div className="flex flex-col gap-3.5">
                <div>
                  <div className="mb-2 font-mono text-[10.5px] uppercase tracking-[0.18em] text-text-faint">
                    {t.qrGeneratorPage.nameLabel}
                  </div>
                  <input
                    value={vcardName}
                    onChange={(e) => {
                      setVcardName(e.target.value);
                      resetFieldsTouch();
                    }}
                    placeholder={t.qrGeneratorPage.namePlaceholder}
                    className={fieldClass}
                  />
                </div>
                <div>
                  <div className="mb-2 font-mono text-[10.5px] uppercase tracking-[0.18em] text-text-faint">
                    {t.qrGeneratorPage.phoneLabel}
                  </div>
                  <input
                    value={vcardPhone}
                    onChange={(e) => {
                      setVcardPhone(e.target.value);
                      resetFieldsTouch();
                    }}
                    placeholder={t.qrGeneratorPage.phonePlaceholder}
                    className={fieldClass}
                  />
                </div>
                <div>
                  <div className="mb-2 font-mono text-[10.5px] uppercase tracking-[0.18em] text-text-faint">
                    {t.qrGeneratorPage.emailLabel}
                  </div>
                  <input
                    value={vcardEmail}
                    onChange={(e) => {
                      setVcardEmail(e.target.value);
                      resetFieldsTouch();
                    }}
                    placeholder={t.qrGeneratorPage.emailPlaceholder}
                    className={fieldClass}
                  />
                </div>
                <div>
                  <div className="mb-2 font-mono text-[10.5px] uppercase tracking-[0.18em] text-text-faint">
                    {t.qrGeneratorPage.orgLabel}
                  </div>
                  <input
                    value={vcardOrg}
                    onChange={(e) => {
                      setVcardOrg(e.target.value);
                      resetFieldsTouch();
                    }}
                    placeholder={t.qrGeneratorPage.orgPlaceholder}
                    className={fieldClass}
                  />
                </div>
              </div>
            )}
          </div>

          <div className="border-b border-line p-[22px]">
            <div className="mb-3.5 font-mono text-[10.5px] uppercase tracking-[0.18em] text-text-faint">
              {t.qrGeneratorPage.sizeLabel}
            </div>
            <div className="flex gap-1 rounded-sm border border-line bg-void p-[3px]">
              {SIZE_ORDER.map((sz) => (
                <button
                  key={sz}
                  type="button"
                  className={`flex-1 rounded-[2px] px-1.5 py-[9px] text-center font-mono text-[13px] font-semibold transition-all duration-150 ${
                    size === sz ? 'bg-grad text-white' : 'text-text-dim hover:text-text active:text-text'
                  }`}
                  onClick={() => {
                    setSize(sz);
                    invalidateResult();
                  }}
                >
                  {t.qrGeneratorPage.sizeOptions[sz]}
                </button>
              ))}
            </div>
          </div>

          <div className="p-[22px]">
            {error && (
              <div className="mb-3.5 rounded border border-err/40 bg-[color-mix(in_srgb,var(--err)_10%,transparent)] px-3.5 py-2.5 font-mono text-[12px] text-err">
                {error}
              </div>
            )}
            <button
              className="w-full rounded-[3px] bg-grad py-[15px] font-mono text-[13px] font-bold uppercase tracking-[0.08em] text-white transition-opacity duration-150 hover:opacity-90 active:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
              onClick={handleGenerate}
              disabled={generating || !hasContent}
            >
              {generating ? t.qrGeneratorPage.generating : t.qrGeneratorPage.generate}
            </button>
          </div>
        </div>

        {result && (
          <div className="mt-5 flex flex-col items-center gap-4 rounded border border-line bg-surface p-[22px] text-center sm:flex-row sm:text-left">
            <div className="flex h-[120px] w-[120px] shrink-0 items-center justify-center rounded border border-line bg-white p-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={result.url} alt={t.qrGeneratorPage.resultTitle} className="h-full w-full object-contain" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-[13px] font-semibold">{t.qrGeneratorPage.resultTitle}</div>
              <div className="mt-1 font-mono text-[11px] text-text-faint">{t.qrGeneratorPage.resultHint}</div>
              <button
                className="mt-3.5 shrink-0 whitespace-nowrap rounded-[3px] border border-indigo px-3 py-[7px] font-mono text-[11px] text-indigo transition-colors duration-150 hover:bg-indigo hover:text-white active:bg-indigo active:text-white"
                onClick={downloadResult}
              >
                {t.qrGeneratorPage.download}
              </button>
            </div>
          </div>
        )}

        {hasAnyInput && (
          <div className="mt-4 text-right">
            <button onClick={clearAll} className="border-none bg-transparent font-mono text-[11.5px] text-text-faint transition-colors duration-150 hover:text-text active:text-text">
              {t.qrGeneratorPage.clearAll}
            </button>
          </div>
        )}
      </div>
    </>
  );
}