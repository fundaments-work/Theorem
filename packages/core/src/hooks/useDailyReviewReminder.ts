import { useCallback, useEffect } from "react";
import { useLearningStore, useSettingsStore } from "../store/index";

function toIsoDateString(date: Date): string {
    return date.toISOString().slice(0, 10);
}

function parseTimeToMinutes(timeValue: string): number {
    const [hours, minutes] = timeValue.split(":").map((value) => Number.parseInt(value, 10));
    if (!Number.isFinite(hours) || !Number.isFinite(minutes)) {
        return 9 * 60;
    }
    return Math.max(0, Math.min(23 * 60 + 59, (hours * 60) + minutes));
}

/**
 * Shows an in-app reminder when daily review is due and review items are waiting.
 */
export function useDailyReviewReminder() {
    const learningSettings = useSettingsStore((state) => state.settings.learning);
    const getDueReviewItems = useLearningStore((state) => state.getDueReviewItems);
    const dailyReminderState = useLearningStore((state) => state.dailyReminderState);
    const setReminderPromptVisible = useLearningStore((state) => state.setReminderPromptVisible);

    const evaluateReminder = useCallback(() => {
        if (!learningSettings.inAppReminder) {
            setReminderPromptVisible(false);
            return;
        }

        const now = new Date();
        const dueReviewItems = getDueReviewItems(now, learningSettings.defaultReminderReviewScope);

        if (dueReviewItems.length === 0) {
            setReminderPromptVisible(false);
            return;
        }

        const today = toIsoDateString(now);
        if (dailyReminderState.completedDate === today || dailyReminderState.dismissedDate === today) {
            setReminderPromptVisible(false);
            return;
        }

        const nowMinutes = (now.getHours() * 60) + now.getMinutes();
        const reviewMinutes = parseTimeToMinutes(learningSettings.dailyReviewTime);

        if (nowMinutes >= reviewMinutes) {
            setReminderPromptVisible(true);
            return;
        }

        setReminderPromptVisible(false);
    }, [
        dailyReminderState.completedDate,
        dailyReminderState.dismissedDate,
        getDueReviewItems,
        learningSettings.defaultReminderReviewScope,
        learningSettings.dailyReviewTime,
        learningSettings.inAppReminder,
        setReminderPromptVisible,
    ]);

    useEffect(() => {
        evaluateReminder();

        const interval = window.setInterval(evaluateReminder, 60_000);
        const onFocus = () => evaluateReminder();
        const onVisibilityChange = () => {
            if (document.visibilityState === "visible") {
                evaluateReminder();
            }
        };

        window.addEventListener("focus", onFocus);
        document.addEventListener("visibilitychange", onVisibilityChange);

        return () => {
            window.clearInterval(interval);
            window.removeEventListener("focus", onFocus);
            document.removeEventListener("visibilitychange", onVisibilityChange);
        };
    }, [evaluateReminder]);
}
