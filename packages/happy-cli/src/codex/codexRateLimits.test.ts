import { describe, expect, it } from 'vitest';
import { normalizeCodexRateLimits, usageLimitsFingerprint } from './codexRateLimits';

const livePayload = {
    rateLimits: {
        primary: { usedPercent: 100, windowDurationMins: 300, resetsAt: 1787724782 },
        secondary: { usedPercent: 16, windowDurationMins: 10080, resetsAt: 1788311582 },
        rateLimitReachedType: 'rate_limit_reached',
        planType: 'plus',
    },
    rateLimitsByLimitId: {
        codex: {
            primary: { usedPercent: 100, windowDurationMins: 300, resetsAt: 1787724782 },
            secondary: { usedPercent: 16, windowDurationMins: 10080, resetsAt: 1788311582 },
            rateLimitReachedType: 'rate_limit_reached',
            planType: 'plus',
        },
    },
    rateLimitResetCredits: {
        availableCount: 1,
    },
};

describe('normalizeCodexRateLimits', () => {
    it('normalizes the live Plus 5h/weekly payload', () => {
        expect(normalizeCodexRateLimits(livePayload, 1_700_000_000_000)).toEqual({
            capturedAt: 1_700_000_000_000,
            source: 'codex',
            resetCreditsAvailable: 1,
            planType: 'plus',
            rateLimitReached: true,
            windows: [
                {
                    id: 'five_hour',
                    label: '5h',
                    usedPercent: 100,
                    resetsAt: 1787724782,
                    windowDurationMins: 300,
                },
                {
                    id: 'seven_day',
                    label: '7d',
                    usedPercent: 16,
                    resetsAt: 1788311582,
                    windowDurationMins: 10080,
                },
            ],
        });
    });

    it('prefers the codex bucket and returns null without windows', () => {
        expect(normalizeCodexRateLimits({
            rateLimits: { primary: { usedPercent: 1, windowDurationMins: 300, resetsAt: 10 } },
            rateLimitsByLimitId: {
                codex: { primary: { usedPercent: 42, windowDurationMins: 300, resetsAt: 20 } },
            },
        })?.windows[0]?.usedPercent).toBe(42);

        expect(normalizeCodexRateLimits({ rateLimits: {} })).toBeNull();
        expect(normalizeCodexRateLimits(null)).toBeNull();
    });

    it('omits a zero reset-credit count', () => {
        const limits = normalizeCodexRateLimits({
            rateLimits: { primary: { usedPercent: 10, windowDurationMins: 300, resetsAt: 100 } },
            rateLimitResetCredits: { availableCount: 0 },
        });
        expect(limits?.resetCreditsAvailable).toBeUndefined();
        expect(limits?.rateLimitReached).toBe(false);
    });
});

describe('usageLimitsFingerprint', () => {
    it('ignores capturedAt so unchanged snapshots skip metadata writes', () => {
        const first = normalizeCodexRateLimits(livePayload, 1);
        const second = normalizeCodexRateLimits(livePayload, 2);
        expect(usageLimitsFingerprint(first)).toBe(usageLimitsFingerprint(second));
        expect(usageLimitsFingerprint(null)).toBe('');
    });
});
