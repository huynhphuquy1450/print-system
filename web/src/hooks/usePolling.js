import { useEffect, useRef } from 'react';

/**
 * Gọi callback ngay khi mount/enabled, sau đó lặp lại mỗi intervalMs.
 * Tạm dừng khi tab bị ẩn (document.hidden); khi tab hiện lại thì gọi ngay
 * và tiếp tục interval. Callback luôn dùng bản mới nhất qua ref, nên đổi
 * identity của callback không làm restart interval.
 */
export function usePolling(callback, intervalMs, { enabled = true } = {}) {
  const callbackRef = useRef(callback);

  useEffect(() => {
    callbackRef.current = callback;
  }, [callback]);

  useEffect(() => {
    if (!enabled) return undefined;

    let intervalId = null;

    function start() {
      if (intervalId != null) return;
      intervalId = setInterval(() => callbackRef.current(), intervalMs);
    }

    function stop() {
      if (intervalId != null) {
        clearInterval(intervalId);
        intervalId = null;
      }
    }

    function handleVisibilityChange() {
      if (document.hidden) {
        stop();
      } else {
        callbackRef.current();
        start();
      }
    }

    if (!document.hidden) {
      callbackRef.current();
      start();
    }

    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      stop();
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [intervalMs, enabled]);
}
