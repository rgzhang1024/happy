import * as React from 'react';
import { Text, View } from 'react-native';
import { useUnistyles } from 'react-native-unistyles';
import { Typography } from '@/constants/Typography';
import { layout } from '@/components/layout';
import type { UsageLimits } from '@/sync/storageTypes';
import { CODEX_USAGE_BAR_HEIGHT, formatCodexUsageChips, type CodexUsageTone } from '@/utils/codexUsageBar';

const TONE_COLOR: Record<CodexUsageTone, string> = {
    ok: '#8E8E93',
    warn: '#D97706',
    critical: '#DC2626',
};

export function CodexUsageBar({ usageLimits }: { usageLimits: UsageLimits }) {
    const { theme } = useUnistyles();
    const [now, setNow] = React.useState(() => Date.now());

    React.useEffect(() => {
        const timer = setInterval(() => setNow(Date.now()), 30_000);
        return () => clearInterval(timer);
    }, []);

    const { chips, resetCreditsText } = React.useMemo(
        () => formatCodexUsageChips(usageLimits, now),
        [usageLimits, now],
    );

    if (chips.length === 0) {
        return null;
    }

    return (
        <View
            style={{
                height: CODEX_USAGE_BAR_HEIGHT,
                width: '100%',
                justifyContent: 'center',
                backgroundColor: theme.colors.header.background,
            }}
        >
            <View
                style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 10,
                    paddingHorizontal: 12,
                    width: '100%',
                    maxWidth: layout.headerMaxWidth,
                    alignSelf: 'center',
                }}
            >
                {chips.map((chip) => (
                    <Text
                        key={chip.id}
                        numberOfLines={1}
                        style={{
                            fontSize: 11,
                            lineHeight: 14,
                            color: TONE_COLOR[chip.tone],
                            ...Typography.default('semiBold'),
                        }}
                    >
                        {chip.text}
                    </Text>
                ))}
                {resetCreditsText ? (
                    <Text
                        numberOfLines={1}
                        style={{
                            fontSize: 11,
                            lineHeight: 14,
                            color: theme.colors.textSecondary,
                            ...Typography.default(),
                        }}
                    >
                        {resetCreditsText}
                    </Text>
                ) : null}
            </View>
        </View>
    );
}
