import { useEffect, useRef } from "react";
import { isTauri } from "../../../core/lib/env";
import { useSettingsStore } from "../../../core/store";

async function sendReminder(shortfall: number) {
    const { notifyIfGranted } = await import("../../../core/lib/notifications");
    await notifyIfGranted(
        "Reading Goal Reminder",
        `You're ${shortfall} min short of your daily reading goal — keep going!`,
    );
    const { toast } = await import("sonner");
    toast(`${shortfall} min to go to reach your daily goal`);
}

function isReminderTime(reminderSetting: string): boolean {
    const now = new Date();
    const currentMinutes = now.getHours() * 60 + now.getMinutes();
    const [h, m] = reminderSetting.split(":").map(Number);
    const targetMinutes = h * 60 + m;
    const diff = Math.abs(currentMinutes - targetMinutes);
    return diff <= 5;
}

export function useDailyGoalReminder() {
    const remindedDateRef = useRef<string>("");

    useEffect(() => {
        if (!isTauri()) return;

        const intervalId = setInterval(async () => {
            try {
                const settings = useSettingsStore.getState().settings;
                if (!settings.goalNotifications) return;

                const today = new Date().toISOString().split("T")[0];
                if (remindedDateRef.current === today) return;

                if (!isReminderTime(settings.dailyReminderTime)) return;

                const { invoke } = await import("@tauri-apps/api/core");
                const result = await invoke<{
                    today_minutes: number;
                    daily_goal: number;
                } | null>("sqlite_check_goal_reminder");

                if (!result) return;

                if (
                    result.today_minutes > 0 &&
                    result.today_minutes < result.daily_goal
                ) {
                    remindedDateRef.current = today;
                    const shortfall = result.daily_goal - result.today_minutes;
                    sendReminder(shortfall);
                }
            } catch {
                // Silently ignore (plugin not available, etc.)
            }
        }, 5 * 60 * 1000);

        return () => clearInterval(intervalId);
    }, []);
}
