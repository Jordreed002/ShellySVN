import { useCallback, useEffect, useState } from 'react';
import type { AppUpdateState } from '@shared/types';

export function useAppUpdater() {
  const [state, setState] = useState<AppUpdateState | null>(null);

  useEffect(() => {
    let active = true;
    void window.api.updater.getState().then((next) => {
      if (active) setState(next);
    });
    const unsubscribe = window.api.updater.onStateChanged((next) => {
      if (active) setState(next);
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  const check = useCallback(async () => setState(await window.api.updater.check()), []);
  const download = useCallback(async () => setState(await window.api.updater.download()), []);
  const cancelDownload = useCallback(
    async () => setState(await window.api.updater.cancelDownload()),
    []
  );

  return { state, check, download, cancelDownload };
}
