/**
 * @author Kuitos
 * @since 2019-02-26
 */

import { Entry, importEntry, ImportEntryOpts } from 'import-html-entry';
import { isFunction } from 'lodash';
import { getAppStatus, getMountedApps, NOT_LOADED } from 'single-spa';
import { AppMetadata, PrefetchStrategy } from './interfaces';

type RequestIdleCallbackHandle = any;
type RequestIdleCallbackOptions = {
  timeout: number;
};
type RequestIdleCallbackDeadline = {
  readonly didTimeout: boolean;
  timeRemaining: () => number;
};

declare global {
  interface Window {
    requestIdleCallback: (
      callback: (deadline: RequestIdleCallbackDeadline) => void,
      opts?: RequestIdleCallbackOptions,
    ) => RequestIdleCallbackHandle;
    cancelIdleCallback: (handle: RequestIdleCallbackHandle) => void;
  }

  interface Navigator {
    connection: {
      saveData: boolean;
      effectiveType: string;
      type: 'bluetooth' | 'cellular' | 'ethernet' | 'none' | 'wifi' | 'wimax' | 'other' | 'unknown';
    };
  }
}

// RIC and shim for browsers setTimeout() without it
const requestIdleCallback =
  window.requestIdleCallback ||
  function requestIdleCallback(cb: CallableFunction) {
    const start = Date.now();
    return setTimeout(() => {
      cb({
        didTimeout: false,
        timeRemaining() {
          return Math.max(0, 50 - (Date.now() - start));
        },
      });
    }, 1);
  };
// navigator.connection 属性还处于实验阶段，当前 chrome86支持，firefox83和IE Edge还不支持
const isSlowNetwork = navigator.connection
  ? navigator.connection.saveData ||
    (navigator.connection.type !== 'wifi' &&
      navigator.connection.type !== 'ethernet' &&
      /(2|3)g/.test(navigator.connection.effectiveType))
  : false;

/**
 * prefetch assets, do nothing while in mobile network
 * @param entry
 * @param opts
 */
function prefetch(entry: Entry, opts?: ImportEntryOpts): void {
  if (!navigator.onLine || isSlowNetwork) {
    // Don't prefetch if in a slow network or offline
    return;
  }

  requestIdleCallback(async () => {
    const { getExternalScripts, getExternalStyleSheets } = await importEntry(entry, opts);
    requestIdleCallback(getExternalStyleSheets);
    requestIdleCallback(getExternalScripts);
  });
}

function prefetchAfterFirstMounted(apps: AppMetadata[], opts?: ImportEntryOpts): void {
  window.addEventListener('single-spa:first-mount', function listener() {
    const notLoadedApps = apps.filter((app) => getAppStatus(app.name) === NOT_LOADED); // NOT_LOADED 微应用已经被注册但还没加载

    if (process.env.NODE_ENV === 'development') {
      const mountedApps = getMountedApps(); // 返回处于active状态并且已经挂载到DOM上的所有微应用 name
      console.log(`[qiankun] prefetch starting after ${mountedApps} mounted...`, notLoadedApps);
    }

    notLoadedApps.forEach(({ entry }) => prefetch(entry, opts));

    window.removeEventListener('single-spa:first-mount', listener);
  });
}

export function prefetchImmediately(apps: AppMetadata[], opts?: ImportEntryOpts): void {
  if (process.env.NODE_ENV === 'development') {
    console.log('[qiankun] prefetch starting for apps...', apps);
  }

  apps.forEach(({ entry }) => prefetch(entry, opts));
}
/**
 * 
 * @param apps 所有已经通过 registerMicroApps() 注册了的微应用
 * @param prefetchStrategy 为字符串数组时，其中是需要预加载的微应用 name
 * @param importEntryOpts 
 */
export function doPrefetchStrategy(
  apps: AppMetadata[],
  prefetchStrategy: PrefetchStrategy,
  importEntryOpts?: ImportEntryOpts,
) {
  const appsName2Apps = (names: string[]): AppMetadata[] => apps.filter((app) => names.includes(app.name));

  if (Array.isArray(prefetchStrategy)) {
    prefetchAfterFirstMounted(appsName2Apps(prefetchStrategy as string[]), importEntryOpts);
  } else if (isFunction(prefetchStrategy)) {
    (async () => {
      // critical rendering apps would be prefetch as earlier as possible
      const { criticalAppNames = [], minorAppsName = [] } = await prefetchStrategy(apps);
      prefetchImmediately(appsName2Apps(criticalAppNames), importEntryOpts);
      prefetchAfterFirstMounted(appsName2Apps(minorAppsName), importEntryOpts);
    })();
  } else {
    switch (prefetchStrategy) {
      case true:
        prefetchAfterFirstMounted(apps, importEntryOpts);
        break;

      case 'all':
        prefetchImmediately(apps, importEntryOpts);
        break;

      default:
        break;
    }
  }
}
