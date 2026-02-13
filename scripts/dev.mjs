import { spawn } from "node:child_process";

const rawArgs = process.argv.slice(2);
const hasTauriFlag = rawArgs.includes("--tauri") || process.env.npm_config_tauri === "true";
const forwardedArgs = rawArgs.filter((arg) => arg !== "--tauri" && arg !== "--");

const pnpmArgs = hasTauriFlag
    ? ["--filter", "@lionreader/web", "tauri", "dev", ...forwardedArgs]
    : ["--filter", "@lionreader/web", "dev", ...forwardedArgs];

const child = spawn("pnpm", pnpmArgs, {
    stdio: "inherit",
    shell: process.platform === "win32",
});

child.on("exit", (code, signal) => {
    if (signal) {
        process.kill(process.pid, signal);
        return;
    }
    process.exit(code ?? 0);
});
