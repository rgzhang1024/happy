/**
 * Codex account rate-limit adapter.
 *
 * Reads `account/rateLimits/read` and stores a compact snapshot on encrypted
 * session metadata. `usedPercent` stays "percent used"; the web bar flips it
 * to remaining at render time. `resetsAt` is unix seconds, matching Codex.
 */

export type CodexUsageWindow = {
    id: string;
    label?: string;
    usedPercent: number;
    resetsAt?: number | null;
    windowDurationMins?: number | null;
};

export type CodexUsageLimits = {
    capturedAt: number;
    source?: string;
    windows: CodexUsageWindow[];
    resetCreditsAvailable?: number;
    planType?: string | null;
    rateLimitReached?: boolean;
};

type CodexRateLimitWindow = {
    usedPercent?: unknown;
    windowDurationMins?: unknown;
    resetsAt?: unknown;
};

type CodexRateLimitSnapshot = {
    primary?: CodexRateLimitWindow | null;
    secondary?: CodexRateLimitWindow | null;
    rateLimitReachedType?: unknown;
    planType?: unknown;
};

type CodexAccountRateLimits = {
    rateLimits?: CodexRateLimitSnapshot | null;
    rateLimitsByLimitId?: Record<string, CodexRateLimitSnapshot> | null;
    rateLimitResetCredits?: {
        availableCount?: unknown;
    } | null;
};

const FIVE_HOUR_MINS = 300;
const WEEKLY_MINS = 7 * 24 * 60;

function asRecord(value: unknown): Record<string, unknown> | null {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, unknown>
        : null;
}

function clampPercent(value: unknown): number | null {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
        return null;
    }
    return Math.max(0, Math.min(100, Math.round(value)));
}

function toUnixSeconds(value: unknown): number | null {
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
        return null;
    }
    return value > 1e12 ? Math.round(value / 1000) : Math.round(value);
}

function windowId(window: CodexRateLimitWindow | null | undefined, fallback: 'five_hour' | 'seven_day'): string {
    const mins = window?.windowDurationMins;
    if (typeof mins === 'number' && Number.isFinite(mins)) {
        if (Math.abs(mins - FIVE_HOUR_MINS) <= 15) {
            return 'five_hour';
        }
        if (Math.abs(mins - WEEKLY_MINS) <= 60) {
            return 'seven_day';
        }
    }
    return fallback;
}

function readSnapshot(raw: unknown): CodexRateLimitSnapshot | null {
    const response = asRecord(raw) as CodexAccountRateLimits | null;
    if (!response) {
        return null;
    }
    const byId = response.rateLimitsByLimitId;
    if (byId && typeof byId === 'object' && byId.codex) {
        return byId.codex;
    }
    return response.rateLimits ?? null;
}

function toWindow(
    window: CodexRateLimitWindow | null | undefined,
    fallbackId: 'five_hour' | 'seven_day',
    label: string,
): CodexUsageWindow | null {
    if (!window) {
        return null;
    }
    const usedPercent = clampPercent(window.usedPercent);
    if (usedPercent === null) {
        return null;
    }
    const mins = typeof window.windowDurationMins === 'number' && Number.isFinite(window.windowDurationMins)
        ? Math.round(window.windowDurationMins)
        : null;
    return {
        id: windowId(window, fallbackId),
        label,
        usedPercent,
        resetsAt: toUnixSeconds(window.resetsAt),
        windowDurationMins: mins,
    };
}

export function normalizeCodexRateLimits(raw: unknown, capturedAt: number = Date.now()): CodexUsageLimits | null {
    const snapshot = readSnapshot(raw);
    if (!snapshot) {
        return null;
    }

    const windows = [
        toWindow(snapshot.primary, 'five_hour', '5h'),
        toWindow(snapshot.secondary, 'seven_day', '7d'),
    ].filter((window): window is CodexUsageWindow => window !== null);

    if (windows.length === 0) {
        return null;
    }

    const response = asRecord(raw) as CodexAccountRateLimits | null;
    const available = response?.rateLimitResetCredits?.availableCount;
    return {
        capturedAt,
        source: 'codex',
        windows,
        resetCreditsAvailable: typeof available === 'number' && available > 0
            ? Math.round(available)
            : undefined,
        planType: typeof snapshot.planType === 'string' ? snapshot.planType : null,
        rateLimitReached: snapshot.rateLimitReachedType === 'rate_limit_reached',
    };
}

export function usageLimitsFingerprint(limits?: CodexUsageLimits | null): string {
    if (!limits) {
        return '';
    }
    return JSON.stringify({
        windows: limits.windows.map((window) => ({
            id: window.id,
            usedPercent: window.usedPercent,
            resetsAt: window.resetsAt ?? null,
        })),
        resetCreditsAvailable: limits.resetCreditsAvailable ?? 0,
        rateLimitReached: Boolean(limits.rateLimitReached),
    });
}
