# Keep all classes in the sync worker package — called reflectively by:
#  - Tauri plugin bridge (@Command methods)
#  - WorkManager (SyncWorker.doWork())
#  - Android system (SyncForegroundService lifecycle)

-keep class work.fundamentals.theorem.syncworker.** { *; }
