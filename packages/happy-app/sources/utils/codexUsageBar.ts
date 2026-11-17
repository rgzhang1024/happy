import { getCurrentLanguage } from '@/text';
import type { UsageLimits } from '@/sync/storageTypes';

export const CODEX_USAGE_BAR_HEIGHT = 18;

export type CodexUsageTone = 'ok' | 'warn' | 'critical';

export type CodexUsageChip = {
    id: string;
    text: string;
    tone: CodexUsageTone;
};

function isChinese(): boolean {
    const language = getCurrentLanguage();
    return language === 'zh-Hans' || language === 'zh-Hant';
}

export function remainingPercent(usedPercent: number): number {
    if (!Number.isFinite(usedPercent)) return 0;
    return Math.max(0, Math.min(100, 100 - Math.round(usedPercent)));
}

export function usageTone(remaining: number): CodexUsageTone {
    if (remaining <= 10) return 'critical';
    if (remaining <= 30) return 'warn';
    return 'ok';
}

export function formatResetEta(resetsAtSec: number | null | undefined, nowMs: number = Date.now()): string | null {
    if (resetsAtSec == null || !Number.isFinite(resetsAtSec)) return null;
    const deltaSec = Math.max(0, resetsAtSec - Math.floor(nowMs / 1000));
    if (deltaSec < 60) return '<1m';
    if (deltaSec < 3600) return `${Math.round(deltaSec / 60)}m`;
    if (deltaSec < 86400) return `${Math.round(deltaSec / 3600)}h`;
    return `${Math.round(deltaSec / 86400)}d`;
}

function windowLabel(id: string, fallback?: string): string {
    if (id === 'five_hour') return '5h';
    if (id === 'seven_day') return isChinese() ? '周' : '7d';
    return fallback || id;
}

export function formatCodexUsageChips(usageLimits: UsageLimits, nowMs: number = Date.now()): {
    chips: CodexUsageChip[];
    resetCreditsText: string | null;
} {
    const zh = isChinese();
    const chips = usageLimits.windows.map((window) => {
        const remaining = remainingPercent(window.usedPercent);
        const eta = formatResetEta(window.resetsAt, nowMs);
        const etaText = eta ? (zh ? `${eta}后` : eta) : null;
        const text = etaText
            ? `${windowLabel(window.id, window.label)} ${remaining}% · ${etaText}`
            : `${windowLabel(window.id, window.label)} ${remaining}%`;
        return {
            id: window.id,
            text,
            tone: usageLimits.rateLimitReached && window.id === 'five_hour'
                ? 'critical'
                : usageTone(remaining),
        };
    });

    const credits = usageLimits.resetCreditsAvailable ?? 0;
    return {
        chips,
        resetCreditsText: credits > 0
            ? (zh ? `可重置×${credits}` : `reset×${credits}`)
            : null,
    };
}
