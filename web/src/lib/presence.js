import { useState, useEffect } from 'react';
import { getConfig } from '../api/client.js';

// Fallback nếu fetch /api/v1/config lỗi (server là nguồn sự thật cho ngưỡng tươi — TASK 8).
export const DEFAULT_FRESH_MS = 60_000;

export function isOnline(lastSeenAt, freshMs) {
  return lastSeenAt != null && Date.now() - lastSeenAt < freshMs;
}

export function relativeTime(lastSeenAt) {
  if (lastSeenAt == null) return 'chưa kết nối';
  const diffSec = Math.floor((Date.now() - lastSeenAt) / 1000);
  if (diffSec < 60) return `${diffSec} giây trước`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin} phút trước`;
  return `${Math.floor(diffMin / 60)} giờ trước`;
}

export function effectivePrinterStatus(printer, freshMs) {
  if (printer.last_seen_at == null) return 'unknown';
  if (!isOnline(printer.last_seen_at, freshMs)) return 'offline';
  return printer.status;
}

/** Lấy ngưỡng tươi từ server (1 nguồn sự thật); giữ default nếu lỗi. */
export function useFreshMs() {
  const [freshMs, setFreshMs] = useState(DEFAULT_FRESH_MS);

  useEffect(() => {
    getConfig()
      .then((cfg) => setFreshMs(cfg?.presence?.freshMs ?? DEFAULT_FRESH_MS))
      .catch(() => {});
  }, []);

  return freshMs;
}
