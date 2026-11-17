import { describe, expect, it, vi } from 'vitest';

vi.mock('@/text', () => ({
    getCurrentLanguage: () => 'zh-Hans',
}));

import { formatCodexUsageChips, formatResetEta, remainingPercent, usageTone } from './codexUsageBar';

describe('codexUsageBar helpers', () => {
    it('flips used percent to remaining', () => {
        expect(remainingPercent(16)).toBe(84);
        expect(remainingPercent(100)).toBe(0);
        expect(remainingPercent(-4)).toBe(100);
    });

    it('maps remaining percent to tone', () => {
        expect(usageTone(84)).toBe('ok');
        expect(usageTone(30)).toBe('warn');
        expect(usageTone(10)).toBe('critical');
    });

    it('formats compact reset ETAs', () => {
        const now = 1_700_000_000_000;
        expect(formatResetEta(Math.floor(now / 1000) + 90, now)).toBe('2m');
        expect(formatResetEta(Math.floor(now / 1000) + 3700, now)).toBe('1h');
        expect(formatResetEta(Math.floor(now / 1000) + 3 * 86400, now)).toBe('3d');
    });

    it('renders Chinese chips with remaining percent, ETA, and reset credits', () => {
        const now = 1_700_000_000_000;
        const view = formatCodexUsageChips({
            capturedAt: now,
            source: 'codex',
            windows: [
                { id: 'five_hour', label: '5h', usedPercent: 100, resetsAt: Math.floor(now / 1000) + 3600 },
                { id: 'seven_day', label: '7d', usedPercent: 16, resetsAt: Math.floor(now / 1000) + 6 * 86400 },
            ],
            resetCreditsAvailable: 1,
            rateLimitReached: true,
        }, now);

        expect(view.chips.map((chip) => chip.text)).toEqual([
            '5h 0% · 1h后',
            '周 84% · 6d后',
        ]);
        expect(view.chips[0]?.tone).toBe('critical');
        expect(view.resetCreditsText).toBe('可重置×1');
    });
});
