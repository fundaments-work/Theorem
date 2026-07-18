import { useEffect, useRef } from "react";
import { isTauri } from "../../../core/lib/env";
import type { DailyReadingActivity, ReadingStats } from "../../../core/types";

interface UseReadingTimeOptions {
    currentBookId: string | undefined;
    addReadingTime: (bookId: string, minutes: number) => void;
    stats: ReadingStats;
    updateStats: (updates: Partial<ReadingStats>) => void;
}

export function useReadingTime({
    currentBookId,
    addReadingTime,
    stats,
    updateStats,
}: UseReadingTimeOptions) {
    const readingStartTimeRef = useRef<number | null>(null);
    const readingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const statsRef = useRef(stats);
    statsRef.current = stats;

    useEffect(() => {
        if (!currentBookId) return;

        readingStartTimeRef.current = Date.now();

        const flushReadingTime = () => {
            if (currentBookId && readingStartTimeRef.current) {
                const elapsedMinutes = Math.floor((Date.now() - readingStartTimeRef.current) / 60000);
                if (elapsedMinutes > 0) {
                    addReadingTime(currentBookId, elapsedMinutes);

                    const currentStats = statsRef.current;
                    const today = new Date().toISOString().split('T')[0];
                    const existingActivity = currentStats.dailyActivity.find(a => a.date === today);

                    let newDailyActivity: DailyReadingActivity[];
                    if (existingActivity) {
                        newDailyActivity = currentStats.dailyActivity.map(a =>
                            a.date === today
                                ? { ...a, minutes: a.minutes + elapsedMinutes, booksRead: [...new Set([...a.booksRead, currentBookId])] }
                                : a
                        );
                    } else {
                        newDailyActivity = [...currentStats.dailyActivity, {
                            date: today,
                            minutes: elapsedMinutes,
                            booksRead: [currentBookId],
                        }];
                    }

                    if (newDailyActivity.length > 84) {
                        newDailyActivity = newDailyActivity.slice(-84);
                    }

                    const sortedActivity = [...newDailyActivity].sort((a, b) =>
                        new Date(b.date).getTime() - new Date(a.date).getTime()
                    );

                    let currentStreak = 0;
                    const todayStr = new Date().toISOString().split('T')[0];
                    const yesterdayStr = new Date(Date.now() - 86400000).toISOString().split('T')[0];

                    const lastReadDate = sortedActivity[0]?.date;
                    if (lastReadDate === todayStr || lastReadDate === yesterdayStr) {
                        currentStreak = 1;
                        for (let i = 1; i < sortedActivity.length; i++) {
                            const prevDate = new Date(sortedActivity[i - 1].date);
                            const currDate = new Date(sortedActivity[i].date);
                            const diffDays = (prevDate.getTime() - currDate.getTime()) / 86400000;
                            if (diffDays === 1) {
                                currentStreak++;
                            } else {
                                break;
                            }
                        }
                    }

                    updateStats({
                        totalReadingTime: currentStats.totalReadingTime + elapsedMinutes,
                        dailyActivity: newDailyActivity,
                        currentStreak,
                        longestStreak: Math.max(currentStats.longestStreak, currentStreak),
                        lastReadDate: today,
                    });

                    readingStartTimeRef.current = Date.now();
                }
            }
        };

        readingIntervalRef.current = setInterval(flushReadingTime, 60000);

        const handleVisibilityChange = () => {
            if (document.hidden) {
                flushReadingTime();
                if (readingIntervalRef.current) {
                    clearInterval(readingIntervalRef.current);
                    readingIntervalRef.current = null;
                }
            } else {
                readingStartTimeRef.current = Date.now();
                if (!readingIntervalRef.current) {
                    readingIntervalRef.current = setInterval(flushReadingTime, 60000);
                }
            }
        };

        document.addEventListener('visibilitychange', handleVisibilityChange);

        let tauriUnlisten: Array<() => void> = [];
        if (isTauri()) {
            (async () => {
                const { listen } = await import('@tauri-apps/api/event');
                const unlistenPause = await listen('tauri://on-pause', () => {
                    flushReadingTime();
                    if (readingIntervalRef.current) {
                        clearInterval(readingIntervalRef.current);
                        readingIntervalRef.current = null;
                    }
                });
                const unlistenResume = await listen('tauri://on-resume', () => {
                    readingStartTimeRef.current = Date.now();
                    if (!readingIntervalRef.current) {
                        readingIntervalRef.current = setInterval(flushReadingTime, 60000);
                    }
                });
                tauriUnlisten = [unlistenPause, unlistenResume];
            })();
        }

        return () => {
            if (readingIntervalRef.current) {
                clearInterval(readingIntervalRef.current);
            }
            document.removeEventListener('visibilitychange', handleVisibilityChange);
            tauriUnlisten.forEach((fn) => fn());

            if (currentBookId && readingStartTimeRef.current) {
                const elapsedMinutes = Math.floor((Date.now() - readingStartTimeRef.current) / 60000);
                if (elapsedMinutes > 0) {
                    addReadingTime(currentBookId, elapsedMinutes);
                }
            }
        };
    }, [currentBookId, addReadingTime, updateStats]);
}
