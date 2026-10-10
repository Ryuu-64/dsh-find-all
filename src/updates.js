import SemVer from 'semver/classes/semver.js';

const PACKAGE = '@ryuu-64/dsh-find-all';
const ENDPOINT = 'https://registry.npmjs.org/@ryuu-64%2fdsh-find-all/latest';

function version(value) {
    if (typeof value !== 'string') throw new Error('Invalid version');
    const parsed = new SemVer(value);
    const canonical = parsed.version + (parsed.build.length ? '+' + parsed.build.join('.') : '');
    // Registry versions must be canonical, not coerced. node-semver bounds core
    // numbers; also reject unsafe numeric prerelease identifiers rather than
    // letting its numeric comparison silently round them.
    if (canonical !== value || parsed.prerelease.some(id => /^\d+$/.test(String(id)) && !Number.isSafeInteger(Number(id)))) {
        throw new Error('Unsupported version');
    }
    return parsed;
}

/** One explicit public-npm lookup. Never uses Host credentials or registry settings. */
export async function checkLatestVersion(currentVersion, signal) {
    const current = version(currentVersion);
    const controller = new AbortController();
    const cancel = () => controller.abort();
    signal.addEventListener('abort', cancel, { once: true });
    if (signal.aborted) cancel();
    const timeout = setTimeout(cancel, 8000);
    try {
        const response = await fetch(ENDPOINT, {
            signal: controller.signal, mode: 'cors', credentials: 'omit',
            cache: 'no-store', redirect: 'error', referrerPolicy: 'no-referrer',
        });
        if (!response.ok) throw new Error('Registry unavailable');
        const data = await response.json();
        if (controller.signal.aborted || data?.name !== PACKAGE) throw new Error('Invalid registry response');
        const latest = version(data.version);
        const comparison = latest.compare(current);
        return { status: comparison > 0 ? 'available' : comparison < 0 ? 'ahead' : 'current', version: data.version };
    } finally {
        clearTimeout(timeout);
        signal.removeEventListener('abort', cancel);
    }
}
