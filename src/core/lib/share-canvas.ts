import type { Annotation, Book, HighlightColor } from "../types";
import { getResolvedColor } from "../../features/library/components/share-card-colors";

function resolveAccentColor(color: HighlightColor | undefined): string {
    if (!color) return getResolvedColor("--color-text-muted");
    const colorMap: Record<HighlightColor, string> = {
        yellow: getResolvedColor("--highlight-yellow"),
        green: getResolvedColor("--highlight-green"),
        blue: getResolvedColor("--highlight-blue"),
        red: getResolvedColor("--highlight-red"),
        orange: getResolvedColor("--highlight-orange"),
        purple: getResolvedColor("--highlight-purple"),
    };
    return colorMap[color] || getResolvedColor("--color-text-muted");
}

function truncateText(text: string, maxChars: number): string {
    if (text.length <= maxChars) return text;
    return text.slice(0, maxChars - 1) + "…";
}

function getContrastColor(hexColor: string): string {
    const color = hexColor.startsWith("#") ? hexColor.slice(1) : hexColor;
    let r = 0, g = 0, b = 0;
    if (color.length === 3) {
        r = parseInt(color[0] + color[0], 16);
        g = parseInt(color[1] + color[1], 16);
        b = parseInt(color[2] + color[2], 16);
    } else if (color.length === 6) {
        r = parseInt(color.slice(0, 2), 16);
        g = parseInt(color.slice(2, 4), 16);
        b = parseInt(color.slice(4, 6), 16);
    } else if (color.startsWith("rgb")) {
        const matches = color.match(/\d+/g);
        if (matches && matches.length >= 3) {
            r = parseInt(matches[0]);
            g = parseInt(matches[1]);
            b = parseInt(matches[2]);
        }
    }
    const a = [r, g, b].map((v) => {
        v /= 255;
        return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    });
    const luminance = 0.2126 * a[0] + 0.7152 * a[1] + 0.0722 * a[2];
    return luminance > 0.45 ? "#1C1C1C" : "#FFFFFF";
}



interface WrappedTextParams {
    lines: string[];
    lineHeight: number;
    totalHeight: number;
    fontSize: number;
}

function calculateWrappedText(
    context: CanvasRenderingContext2D,
    text: string,
    maxWidth: number,
    fontFamily: string,
    fontStyle: string = "",
    minFontSize: number = 24,
    maxFontSize: number = 48,
    maxAllowedHeight: number
): WrappedTextParams {
    let currentFontSize = maxFontSize;
    let lines: string[] = [];
    let lineHeight = 0;
    
    while (currentFontSize >= minFontSize) {
        context.font = `${fontStyle} ${currentFontSize}px ${fontFamily}`;
        lineHeight = currentFontSize * 1.5;
        lines = [];
        
        const paragraphs = text.split('\n');
        for (const paragraph of paragraphs) {
            if (!paragraph.trim()) {
                lines.push("");
                continue;
            }
            const words = paragraph.split(' ');
            let line = '';
            
            for (let n = 0; n < words.length; n++) {
                const testLine = line + words[n] + ' ';
                const metrics = context.measureText(testLine);
                if (metrics.width > maxWidth && n > 0) {
                    lines.push(line.trim());
                    line = words[n] + ' ';
                } else {
                    line = testLine;
                }
            }
            lines.push(line.trim());
        }
        
        const totalHeight = lines.length * lineHeight;
        if (totalHeight <= maxAllowedHeight || currentFontSize === minFontSize) {
            return { lines, lineHeight, totalHeight, fontSize: currentFontSize };
        }
        
        currentFontSize -= 2;
    }
    
    return { lines, lineHeight, totalHeight: lines.length * lineHeight, fontSize: minFontSize };
}

function createSvgImage(svgString: string, color: string, opacity: number = 1): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
        const coloredSvg = svgString.replace(/currentColor/g, color);
        const finalSvg = coloredSvg.replace('<svg', `<svg style="opacity: ${opacity};"`);
        const blob = new Blob([finalSvg], { type: 'image/svg+xml;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const img = new Image();
        img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
        img.onerror = (e) => { URL.revokeObjectURL(url); reject(e); };
        img.src = url;
    });
}

const QUOTE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 21c3 0 7-1 7-8V5c0-1.25-.756-2.017-2-2H4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2 1 0 1 0 1 1v1c0 1-1 2-2 2s-1 .008-1 1.031V21z"/><path d="M15 21c3 0 7-1 7-8V5c0-1.25-.757-2.017-2-2h-4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2h.75c0 2.25.25 4-2.75 4v3c0 1 0 1 1 1z"/></svg>`;
const THEOREM_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M1 1h22v22H1V1zm4 4v14h14V5H5zm3 3h8v8H8V8z" fill="currentColor" fill-rule="evenodd" clip-rule="evenodd" /></svg>`;
const CLOCK_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`;
const FLAME_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"/></svg>`;
const BOOK_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>`;
const HIGHLIGHT_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="m9 11-6 6v3h3l6-6"/><path d="m22 2-9 9 4 4 9-9z"/><path d="m14 4 6 6"/></svg>`;
const TRENDING_UP_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/><polyline points="16 7 22 7 22 13"/></svg>`;


export interface ShareImageOptions {
    format: "square" | "story";
    theme: "match" | "dark" | "tinted" | "sepia";
    showNote: boolean;
}

export async function generateShareCardImage(
    annotation: Annotation,
    book: Pick<Book, "title" | "author"> | undefined,
    options: ShareImageOptions = { format: "square", theme: "match", showNote: true }
): Promise<Blob> {
    const canvas = document.createElement("canvas");
    canvas.width = 1080;
    canvas.height = options.format === "story" ? 1920 : 1080;
    
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Could not get 2d context");

    const accentColor = resolveAccentColor(annotation.color);
    let surfaceColor = getResolvedColor("--color-surface");
    let textPrimary = getResolvedColor("--color-text-primary");
    let borderColor = getResolvedColor("--color-border");

    if (options.theme === "dark") {
        surfaceColor = "#000000";
        textPrimary = "#ffffff";
        borderColor = "#333333";
    } else if (options.theme === "tinted") {
        surfaceColor = accentColor;
        textPrimary = getContrastColor(accentColor);
        borderColor = textPrimary === "#FFFFFF" ? "rgba(255, 255, 255, 0.25)" : "rgba(0, 0, 0, 0.15)";
    } else if (options.theme === "sepia") {
        surfaceColor = "#F4EAE0"; // Warm paper
        textPrimary = "#433422"; // Deep brown ink
        borderColor = "#D1C4A9";
    }

    // Fonts from design-tokens
    const fontSerif = "'EB Garamond', Lora, Georgia, serif";
    const fontSans = "'Helvetica Neue', Helvetica, Arial, sans-serif";

    // 1. Draw Background
    ctx.fillStyle = surfaceColor;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    if (options.theme === "tinted") {
        ctx.fillStyle = accentColor;
        ctx.globalAlpha = 0.1; // 10% tint
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.globalAlpha = 1.0;
    }

    // 2. Draw Elegant Left Accent Bar (or alternate styling based on theme)
    if (options.theme === "sepia") {
        // Sepia gets an elegant inner frame instead of a thick bar
        ctx.strokeStyle = accentColor;
        ctx.lineWidth = 4;
        ctx.strokeRect(24, 24, canvas.width - 48, canvas.height - 48);
        ctx.strokeStyle = borderColor;
        ctx.lineWidth = 1;
        ctx.strokeRect(32, 32, canvas.width - 64, canvas.height - 64);
    } else {
        ctx.fillStyle = accentColor;
        ctx.fillRect(0, 0, 16, canvas.height);
    }

    // Layout margins
    const paddingX = 96; 
    const paddingY = options.format === "story" ? 240 : 96; // More vertical padding for stories
    const maxWidth = canvas.width - (paddingX * 2) - 16;
    const drawX = 16 + paddingX; // account for left bar

    const quoteIconColor = options.theme === "tinted" ? textPrimary : accentColor;
    const ghostIconColor = options.theme === "tinted" ? textPrimary : accentColor;

    // Load SVGs
    const [quoteImg, ghostImg, theoremImg] = await Promise.all([
        createSvgImage(QUOTE_SVG, quoteIconColor, 0.30),
        createSvgImage(QUOTE_SVG, ghostIconColor, 1.0),
        createSvgImage(THEOREM_SVG, textPrimary)
    ]);

    // 2.5 Draw Ghost Icon (Option 3)
    // Draw a massive, subtle watermark of the quote icon in the bottom right background area
    const ghostSize = options.format === "story" ? 1000 : 700;
    ctx.globalAlpha = options.theme === "tinted" ? 0.08 : 0.05;
    ctx.drawImage(
        ghostImg, 
        canvas.width - ghostSize * 0.6, // let it bleed off the right edge
        canvas.height - ghostSize * 0.8, // position in lower half
        ghostSize, 
        ghostSize
    );
    ctx.globalAlpha = 1.0;

    // We will draw the quote icon later when we know the final currentY

    // 4. Calculate Available Space for Text
    const bottomReservedSpace = options.format === "story" ? 300 : 160; 
    const maxTextSpace = canvas.height - paddingY - 64 - 40 - bottomReservedSpace;

    const displayText = truncateText(annotation.selectedText || "", 1200);
    const displayNote = options.showNote && annotation.noteContent ? truncateText(annotation.noteContent, 500) : null;

    // Allocate space roughly: 70% quote, 30% note (if exists)
    const quoteMaxSpace = displayNote ? maxTextSpace * 0.7 : maxTextSpace;
    const noteMaxSpace = displayNote ? maxTextSpace * 0.3 - 40 : 0; // -40 for border

    // Calculate Quote Text Layout (can be larger in Story mode)
    const maxFontSize = options.format === "story" ? 64 : 52;
    const quoteLayout = calculateWrappedText(ctx, displayText, maxWidth, fontSerif, "", 28, maxFontSize, quoteMaxSpace);
    
    // Calculate Note Text Layout
    let noteLayout: WrappedTextParams | null = null;
    if (displayNote) {
        noteLayout = calculateWrappedText(ctx, displayNote, maxWidth, fontSerif, "italic", 22, maxFontSize - 16, noteMaxSpace);
    }

    // 5. Draw Quote Text
    // In story mode, if text is short, we might want to vertically center it. 
    // Let's compute total height used.
    // We add 30px for the timestamp that we will draw below
    const totalContentHeight = 64 + 40 + quoteLayout.totalHeight + (displayNote && noteLayout ? 50 + noteLayout.totalHeight : 0) + 40;
    let currentY = paddingY;

    if (options.format === "story") {
        // Vertically center content in the available space
        const emptySpace = maxTextSpace - totalContentHeight;
        currentY += Math.max(0, emptySpace / 2);
    }

    // 3. Draw Quote Icon at the resolved currentY
    ctx.drawImage(quoteImg, drawX, currentY, 64, 64);

    currentY += 64 + 40; // Below quote icon
    
    ctx.textBaseline = "top";
    ctx.fillStyle = textPrimary;
    ctx.font = `${quoteLayout.fontSize}px ${fontSerif}`;

    for (const line of quoteLayout.lines) {
        ctx.fillText(line, drawX, currentY);
        currentY += quoteLayout.lineHeight;
    }

    // 6. Draw Note Text
    if (displayNote && noteLayout) {
        currentY += 20; // Margin before border

        // Separator Line
        ctx.beginPath();
        ctx.moveTo(drawX, currentY);
        ctx.lineTo(drawX + Math.min(maxWidth, 200), currentY); // A short elegant separator
        ctx.strokeStyle = borderColor;
        ctx.lineWidth = 1.5;
        ctx.stroke();

        currentY += 30; // Margin after border

        ctx.fillStyle = textPrimary;
        ctx.globalAlpha = 0.85;
        ctx.font = `italic ${noteLayout.fontSize}px ${fontSerif}`;
        for (const line of noteLayout.lines) {
            ctx.fillText(line, drawX, currentY);
            currentY += noteLayout.lineHeight;
        }
        ctx.globalAlpha = 1.0;
    }

    // 6.5 Draw Timestamp (Option 1)
    currentY += 24; // Margin before timestamp
    const dateStr = new Date(annotation.createdAt).toLocaleDateString("en-US", {
        month: "long",
        day: "numeric",
        year: "numeric"
    });
    ctx.fillStyle = textPrimary;
    ctx.globalAlpha = 0.5;
    ctx.font = `italic 400 18px ${fontSans}`;
    ctx.fillText(`Highlighted on ${dateStr}`, drawX, currentY);
    ctx.globalAlpha = 1.0;

    // 7. Draw Footer (Source and Branding)
    const bottomY = canvas.height - (options.format === "story" ? 160 : 96);

    // Title
    ctx.textBaseline = "bottom";
    const title = (book?.title || "Unknown Source").toUpperCase();
    const author = book?.author;

    // Modern Canvas API supports letterSpacing natively
    if ('letterSpacing' in ctx) {
        (ctx as any).letterSpacing = "2px";
    }

    ctx.fillStyle = textPrimary;
    ctx.font = `600 24px ${fontSans}`;

    let titleY = bottomY;
    if (author) {
        titleY -= 32; // Make room for author
    }

    // Draw Title with truncation if too wide
    let displayTitle = title;
    while (ctx.measureText(displayTitle).width > maxWidth && displayTitle.length > 4) {
        displayTitle = displayTitle.slice(0, -1);
    }
    if (displayTitle !== title) displayTitle += "\u2026";
    ctx.fillText(displayTitle, drawX, titleY);

    if ('letterSpacing' in ctx) {
        (ctx as any).letterSpacing = "0px";
    }

    // Draw Author with truncation
    if (author) {
        ctx.fillStyle = textPrimary;
        ctx.globalAlpha = options.theme === "tinted" ? 0.90 : 0.75;
        ctx.font = `400 20px ${fontSans}`;
        let displayAuthor = author;
        while (ctx.measureText(displayAuthor).width > maxWidth && displayAuthor.length > 4) {
            displayAuthor = displayAuthor.slice(0, -1);
        }
        if (displayAuthor !== author) displayAuthor += "\u2026";
        ctx.fillText(displayAuthor, drawX, bottomY);
        ctx.globalAlpha = 1.0;
    }

    // Draw "Shared via Theorem"
    const footerFontPx = 22;
    ctx.fillStyle = textPrimary;
    ctx.globalAlpha = options.theme === "tinted" ? 0.75 : 0.45;
    ctx.font = `500 ${footerFontPx}px ${fontSans}`;
    const sharedText = "Shared via Theorem";
    const textWidth = ctx.measureText(sharedText).width;
    const rightX = canvas.width - paddingX;

    // textBaseline is "bottom" here — text bottom edge is at bottomY
    // logo top = bottomY - fontSize aligns logo bottom with text bottom
    const logoSz = footerFontPx;
    const logoTopY = bottomY - logoSz;
    const logoLeftX = rightX - textWidth - logoSz - 10;

    ctx.fillText(sharedText, rightX - textWidth, bottomY);
    ctx.globalAlpha = options.theme === "tinted" ? 0.95 : 0.85;
    ctx.drawImage(theoremImg, logoLeftX, logoTopY, logoSz, logoSz);
    ctx.globalAlpha = 1.0;

    return new Promise((resolve, reject) => {
        canvas.toBlob((blob) => {
            if (blob) resolve(blob);
            else reject(new Error("Canvas toBlob failed"));
        }, "image/png", 0.95);
    });
}

export interface ShareStatsData {
    totalBooks: number;
    completedBooks: number;
    totalReadingTime: number; // in minutes
    currentStreak: number;
    longestStreak: number;
    booksReadThisYear: number;
    yearlyBookGoal: number;
    totalHighlights: number;
    recentlyReading?: {
        title: string;
        author: string;
        progress: number; // 0–1
    };
}

function drawStatBox(
    ctx: CanvasRenderingContext2D,
    x: number, y: number,
    w: number, h: number,
    value: string,
    label: string,
    iconImg: HTMLImageElement,
    theme: string,
    borderColor: string,
    textPrimary: string,
    fontSerif: string,
    fontSans: string
) {
    // Background
    ctx.fillStyle = theme === "dark" ? "#111111" : theme === "sepia" ? "#EAE0CF" : "rgba(0, 0, 0, 0.03)";
    if (theme === "tinted") {
        ctx.fillStyle = textPrimary === "#FFFFFF" ? "rgba(255, 255, 255, 0.12)" : "rgba(0, 0, 0, 0.08)";
    }

    ctx.strokeStyle = borderColor;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    if (typeof (ctx as any).roundRect === 'function') {
        (ctx as any).roundRect(x, y, w, h, 12);
    } else {
        ctx.rect(x, y, w, h);
    }
    ctx.fill();
    ctx.stroke();

    const pad = 24;
    const iconSize = 28;

    // Icon (top-left)
    ctx.globalAlpha = 0.75;
    ctx.drawImage(iconImg, x + pad, y + pad, iconSize, iconSize);
    ctx.globalAlpha = 1.0;

    // Value (serif, large) — below icon with gap
    ctx.fillStyle = textPrimary;
    ctx.font = `bold 36px ${fontSerif}`;
    ctx.fillText(value, x + pad, y + pad + iconSize + 16);

    // Label (sans, small, muted) — below value with generous gap
    ctx.fillStyle = textPrimary;
    ctx.globalAlpha = 0.55;
    ctx.font = `500 14px ${fontSans}`;
    // Truncate label to fit within box width
    const maxLabelWidth = w - pad * 2;
    let displayLabel = label;
    while (ctx.measureText(displayLabel).width > maxLabelWidth && displayLabel.length > 4) {
        displayLabel = displayLabel.slice(0, -1);
    }
    if (displayLabel !== label) displayLabel = displayLabel.slice(0, -1) + "\u2026";
    ctx.fillText(displayLabel, x + pad, y + pad + iconSize + 16 + 58);
    ctx.globalAlpha = 1.0;
}

function drawHorizontalStatCard(
    ctx: CanvasRenderingContext2D,
    x: number, y: number,
    w: number, h: number,
    value: string,
    label: string,
    iconImg: HTMLImageElement,
    theme: string,
    borderColor: string,
    textPrimary: string,
    fontSerif: string,
    fontSans: string
) {
    // Background
    ctx.fillStyle = theme === "dark" ? "#111111" : theme === "sepia" ? "#EAE0CF" : "rgba(0, 0, 0, 0.03)";
    if (theme === "tinted") {
        ctx.fillStyle = textPrimary === "#FFFFFF" ? "rgba(255, 255, 255, 0.12)" : "rgba(0, 0, 0, 0.08)";
    }

    ctx.strokeStyle = borderColor;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    if (typeof (ctx as any).roundRect === 'function') {
        (ctx as any).roundRect(x, y, w, h, 12);
    } else {
        ctx.rect(x, y, w, h);
    }
    ctx.fill();
    ctx.stroke();

    const iconSize = 44;
    const iconX = x + 32;
    const iconY = y + (h - iconSize) / 2;

    // Left: Icon (vertically centered)
    ctx.globalAlpha = 0.75;
    ctx.drawImage(iconImg, iconX, iconY, iconSize, iconSize);
    ctx.globalAlpha = 1.0;

    // Right side: value + label stacked vertically, centered in remaining height
    const textX = iconX + iconSize + 28;
    const valueFontSize = 40;
    const labelFontSize = 17;
    const gap = 20; // generous gap between value and label text
    const totalTextH = valueFontSize + gap + labelFontSize;
    const textStartY = y + (h - totalTextH) / 2;

    // Value
    ctx.fillStyle = textPrimary;
    ctx.font = `bold ${valueFontSize}px ${fontSerif}`;
    ctx.fillText(value, textX, textStartY);

    // Label (muted, smaller)
    ctx.fillStyle = textPrimary;
    ctx.globalAlpha = 0.55;
    ctx.font = `500 ${labelFontSize}px ${fontSans}`;
    // Truncate label to fit
    const maxLabelWidth = w - (textX - x) - 24;
    let displayLabel = label;
    while (ctx.measureText(displayLabel).width > maxLabelWidth && displayLabel.length > 4) {
        displayLabel = displayLabel.slice(0, -1);
    }
    if (displayLabel !== label) displayLabel = displayLabel.slice(0, -1) + "…";
    ctx.fillText(displayLabel, textX, textStartY + valueFontSize + gap);
    ctx.globalAlpha = 1.0;
}

function drawCanvasProgressBar(
    ctx: CanvasRenderingContext2D,
    x: number, y: number,
    w: number, h: number,
    current: number,
    target: number,
    label: string,
    accentColor: string,
    borderColor: string,
    textPrimary: string,
    fontSans: string
) {
    const labelFontSize = 15;
    const countFontSize = 15;

    // Label (left)
    ctx.fillStyle = textPrimary;
    ctx.globalAlpha = 0.7;
    ctx.font = `600 ${labelFontSize}px ${fontSans}`;
    ctx.fillText(label, x, y);

    // Progress count (right)
    const progressText = `${current} / ${target} books`;
    ctx.font = `500 ${countFontSize}px ${fontSans}`;
    const countW = ctx.measureText(progressText).width;
    ctx.fillText(progressText, x + w - countW, y);
    ctx.globalAlpha = 1.0;

    const trackY = y + labelFontSize + 10;

    // Track background
    ctx.fillStyle = "rgba(128, 128, 128, 0.15)";
    ctx.strokeStyle = borderColor;
    ctx.lineWidth = 1;
    ctx.beginPath();
    if (typeof (ctx as any).roundRect === 'function') {
        (ctx as any).roundRect(x, trackY, w, h, h / 2);
    } else {
        ctx.rect(x, trackY, w, h);
    }
    ctx.fill();
    ctx.stroke();

    // Fill
    const percentage = Math.min(100, (current / Math.max(target, 1)) * 100);
    if (percentage > 0) {
        ctx.fillStyle = accentColor;
        ctx.globalAlpha = 0.85;
        ctx.beginPath();
        if (typeof (ctx as any).roundRect === 'function') {
            (ctx as any).roundRect(x, trackY, (w * percentage) / 100, h, h / 2);
        } else {
            ctx.rect(x, trackY, (w * percentage) / 100, h);
        }
        ctx.fill();
        ctx.globalAlpha = 1.0;
    }

    // Percentage label below bar
    ctx.fillStyle = textPrimary;
    ctx.globalAlpha = 0.5;
    ctx.font = `400 13px ${fontSans}`;
    ctx.fillText(`${Math.round(percentage)}% of yearly goal`, x, trackY + h + 14);
    ctx.globalAlpha = 1.0;
}

export async function generateShareStatsImage(
    statsData: ShareStatsData,
    options: ShareImageOptions = { format: "square", theme: "match", showNote: true }
): Promise<Blob> {
    const canvas = document.createElement("canvas");
    canvas.width = 1080;
    canvas.height = options.format === "story" ? 1920 : 1080;
    
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Could not get 2d context");

    const accentColor = getResolvedColor("--color-accent") || "#3b82f6";
    let surfaceColor = getResolvedColor("--color-surface");
    let textPrimary = getResolvedColor("--color-text-primary");
    let borderColor = getResolvedColor("--color-border");

    if (options.theme === "dark") {
        surfaceColor = "#000000";
        textPrimary = "#ffffff";
        borderColor = "#333333";
    } else if (options.theme === "tinted") {
        surfaceColor = accentColor;
        textPrimary = getContrastColor(accentColor);
        borderColor = textPrimary === "#FFFFFF" ? "rgba(255, 255, 255, 0.25)" : "rgba(0, 0, 0, 0.15)";
    } else if (options.theme === "sepia") {
        surfaceColor = "#F4EAE0";
        textPrimary = "#433422";
        borderColor = "#D1C4A9";
    }

    const fontSerif = "'EB Garamond', Lora, Georgia, serif";
    const fontSans = "'Helvetica Neue', Helvetica, Arial, sans-serif";

    // 1. Draw Background
    ctx.fillStyle = surfaceColor;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    if (options.theme === "tinted") {
        ctx.fillStyle = accentColor;
        ctx.globalAlpha = 0.1;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.globalAlpha = 1.0;
    }

    // 2. Draw Left Accent Bar
    if (options.theme === "sepia") {
        ctx.strokeStyle = accentColor;
        ctx.lineWidth = 4;
        ctx.strokeRect(24, 24, canvas.width - 48, canvas.height - 48);
        ctx.strokeStyle = borderColor;
        ctx.lineWidth = 1;
        ctx.strokeRect(32, 32, canvas.width - 64, canvas.height - 64);
    } else {
        ctx.fillStyle = accentColor;
        ctx.fillRect(0, 0, 16, canvas.height);
    }

    // SVGs
    const iconColor = options.theme === "tinted" ? textPrimary : accentColor;
    const ghostColor = options.theme === "tinted" ? textPrimary : accentColor;

    const [clockImg, flameImg, bookImg, highlightImg, ghostImg, theoremImg] = await Promise.all([
        createSvgImage(CLOCK_SVG, iconColor, 1.0),
        createSvgImage(FLAME_SVG, iconColor, 1.0),
        createSvgImage(BOOK_SVG, iconColor, 1.0),
        createSvgImage(HIGHLIGHT_SVG, iconColor, 1.0),
        createSvgImage(TRENDING_UP_SVG, ghostColor, 1.0),
        createSvgImage(THEOREM_SVG, textPrimary)
    ]);

    // Watermark
    const ghostSize = options.format === "story" ? 1000 : 700;
    ctx.globalAlpha = options.theme === "tinted" ? 0.08 : 0.05;
    ctx.drawImage(
        ghostImg, 
        canvas.width - ghostSize * 0.6, 
        canvas.height - ghostSize * 0.8, 
        ghostSize, 
        ghostSize
    );
    ctx.globalAlpha = 1.0;

    // Layout calculations
    const paddingX = 96; 
    const paddingY = options.format === "story" ? 220 : 96;
    const maxWidth = canvas.width - (paddingX * 2) - 16;
    const drawX = 16 + paddingX;

    // Format stats values
    const formatReadingTimeStr = (minutes: number): string => {
        if (minutes < 60) return `${minutes}m`;
        const hours = Math.floor(minutes / 60);
        const mins = minutes % 60;
        return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
    };

    const timeVal = formatReadingTimeStr(statsData.totalReadingTime);
    const streakVal = `${statsData.currentStreak} Days`;
    const booksVal = `${statsData.completedBooks} Books`;
    const highlightsVal = `${statsData.totalHighlights} Highlights`;

    ctx.textBaseline = "top";

    if (options.format === "square") {
        // Draw Header
        // Eyebrow label
        ctx.fillStyle = textPrimary;
        ctx.globalAlpha = 0.45;
        ctx.font = `600 13px ${fontSans}`;
        if ('letterSpacing' in ctx) (ctx as any).letterSpacing = "2.5px";
        ctx.fillText("THEOREM STATISTICS", drawX, paddingY);
        if ('letterSpacing' in ctx) (ctx as any).letterSpacing = "0px";
        ctx.globalAlpha = 1.0;

        // Title
        ctx.fillStyle = textPrimary;
        ctx.font = `italic 40px ${fontSerif}`;
        ctx.fillText("My Reading Journey", drawX, paddingY + 24);

        // Draw 2x2 Grid of Stat Boxes
        const gridY = paddingY + 90;
        const boxSpacing = 20;
        const boxW = (maxWidth - boxSpacing) / 2;
        const boxH = 165;

        drawStatBox(ctx, drawX, gridY, boxW, boxH, timeVal, "Total Reading Time", clockImg, options.theme, borderColor, textPrimary, fontSerif, fontSans);
        drawStatBox(ctx, drawX + boxW + boxSpacing, gridY, boxW, boxH, streakVal, `Best: ${statsData.longestStreak}d streak`, flameImg, options.theme, borderColor, textPrimary, fontSerif, fontSans);
        drawStatBox(ctx, drawX, gridY + boxH + boxSpacing, boxW, boxH, booksVal, `${statsData.totalBooks} books in library`, bookImg, options.theme, borderColor, textPrimary, fontSerif, fontSans);
        drawStatBox(ctx, drawX + boxW + boxSpacing, gridY + boxH + boxSpacing, boxW, boxH, highlightsVal, "Highlights Created", highlightImg, options.theme, borderColor, textPrimary, fontSerif, fontSans);

        // Draw progress bar
        const progressY = gridY + (boxH * 2) + (boxSpacing * 2) + 28;
        drawCanvasProgressBar(ctx, drawX, progressY, maxWidth, 10, statsData.booksReadThisYear, statsData.yearlyBookGoal, "Yearly Reading Goal", accentColor, borderColor, textPrimary, fontSans);

        // Currently Reading strip
        if (statsData.recentlyReading) {
            const crY = progressY + 10 + 15 + 14 + 36; // label + bar + % label + gap
            const crPad = 20;
            const crH = 72;

            // Card background
            ctx.fillStyle = options.theme === "dark" ? "#111111" : options.theme === "sepia" ? "#EAE0CF" : "rgba(0,0,0,0.03)";
            if (options.theme === "tinted") ctx.fillStyle = textPrimary === "#FFFFFF" ? "rgba(255,255,255,0.12)" : "rgba(0,0,0,0.08)";
            ctx.strokeStyle = borderColor;
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            if (typeof (ctx as any).roundRect === 'function') (ctx as any).roundRect(drawX, crY, maxWidth, crH, 10);
            else ctx.rect(drawX, crY, maxWidth, crH);
            ctx.fill();
            ctx.stroke();

            // Left accent stripe
            ctx.fillStyle = accentColor;
            ctx.globalAlpha = 0.7;
            ctx.beginPath();
            if (typeof (ctx as any).roundRect === 'function') (ctx as any).roundRect(drawX, crY, 4, crH, [10, 0, 0, 10]);
            else ctx.rect(drawX, crY, 4, crH);
            ctx.fill();
            ctx.globalAlpha = 1.0;

            // Eyebrow
            ctx.fillStyle = textPrimary;
            ctx.globalAlpha = 0.4;
            ctx.font = `600 11px ${fontSans}`;
            if ('letterSpacing' in ctx) (ctx as any).letterSpacing = "1.5px";
            ctx.fillText("CURRENTLY READING", drawX + crPad + 4, crY + crPad - 2);
            if ('letterSpacing' in ctx) (ctx as any).letterSpacing = "0px";
            ctx.globalAlpha = 1.0;

            // Title
            ctx.fillStyle = textPrimary;
            ctx.font = `500 17px ${fontSans}`;
            const crMaxTitleW = maxWidth - crPad * 2 - 4 - 120;
            let crTitle = statsData.recentlyReading.title;
            while (ctx.measureText(crTitle).width > crMaxTitleW && crTitle.length > 4) crTitle = crTitle.slice(0, -1);
            if (crTitle !== statsData.recentlyReading.title) crTitle = crTitle.slice(0, -1) + "\u2026";
            ctx.fillText(crTitle, drawX + crPad + 4, crY + crPad + 16);

            // Author
            ctx.fillStyle = textPrimary;
            ctx.globalAlpha = 0.5;
            ctx.font = `400 13px ${fontSans}`;
            let crAuthor = statsData.recentlyReading.author;
            while (ctx.measureText(crAuthor).width > crMaxTitleW && crAuthor.length > 4) crAuthor = crAuthor.slice(0, -1);
            if (crAuthor !== statsData.recentlyReading.author) crAuthor = crAuthor.slice(0, -1) + "\u2026";
            ctx.fillText(crAuthor, drawX + crPad + 4, crY + crPad + 38);
            ctx.globalAlpha = 1.0;

            // Mini progress bar (right side)
            const pct = Math.min(1, statsData.recentlyReading.progress);
            const barW = 110;
            const barH = 6;
            const barX = drawX + maxWidth - crPad - barW;
            const barY = crY + (crH - barH) / 2 - 6;
            ctx.fillStyle = "rgba(128,128,128,0.2)";
            ctx.beginPath();
            if (typeof (ctx as any).roundRect === 'function') (ctx as any).roundRect(barX, barY, barW, barH, barH / 2);
            else ctx.rect(barX, barY, barW, barH);
            ctx.fill();
            if (pct > 0) {
                ctx.fillStyle = accentColor;
                ctx.globalAlpha = 0.85;
                ctx.beginPath();
                if (typeof (ctx as any).roundRect === 'function') (ctx as any).roundRect(barX, barY, barW * pct, barH, barH / 2);
                else ctx.rect(barX, barY, barW * pct, barH);
                ctx.fill();
                ctx.globalAlpha = 1.0;
            }
            // % label
            ctx.fillStyle = textPrimary;
            ctx.globalAlpha = 0.45;
            ctx.font = `400 12px ${fontSans}`;
            const pctLabel = `${Math.round(pct * 100)}%`;
            const pctLabelW = ctx.measureText(pctLabel).width;
            ctx.fillText(pctLabel, barX + (barW - pctLabelW) / 2, barY + barH + 10);
            ctx.globalAlpha = 1.0;
        }

    } else {
        // Story format
        // Eyebrow label
        ctx.fillStyle = textPrimary;
        ctx.globalAlpha = 0.45;
        ctx.font = `600 15px ${fontSans}`;
        if ('letterSpacing' in ctx) (ctx as any).letterSpacing = "2.5px";
        ctx.fillText("THEOREM STATISTICS", drawX, paddingY);
        if ('letterSpacing' in ctx) (ctx as any).letterSpacing = "0px";
        ctx.globalAlpha = 1.0;

        // Title
        ctx.fillStyle = textPrimary;
        ctx.font = `italic 56px ${fontSerif}`;
        ctx.fillText("My Reading Journey", drawX, paddingY + 30);

        // Vertical stack of horizontal cards
        const cardStartY = paddingY + 120;
        const cardSpacing = 24;
        const cardH = 150;

        drawHorizontalStatCard(ctx, drawX, cardStartY, maxWidth, cardH, streakVal, `Best: ${statsData.longestStreak} days streak`, flameImg, options.theme, borderColor, textPrimary, fontSerif, fontSans);
        drawHorizontalStatCard(ctx, drawX, cardStartY + cardH + cardSpacing, maxWidth, cardH, timeVal, "Total Reading Time", clockImg, options.theme, borderColor, textPrimary, fontSerif, fontSans);
        drawHorizontalStatCard(ctx, drawX, cardStartY + (cardH * 2) + (cardSpacing * 2), maxWidth, cardH, booksVal, `${statsData.totalBooks} books in library`, bookImg, options.theme, borderColor, textPrimary, fontSerif, fontSans);
        drawHorizontalStatCard(ctx, drawX, cardStartY + (cardH * 3) + (cardSpacing * 3), maxWidth, cardH, highlightsVal, "Annotations and Highlights Created", highlightImg, options.theme, borderColor, textPrimary, fontSerif, fontSans);

        // Progress bar
        const progressY = cardStartY + (cardH * 4) + (cardSpacing * 4) + 36;
        drawCanvasProgressBar(ctx, drawX, progressY, maxWidth, 12, statsData.booksReadThisYear, statsData.yearlyBookGoal, "Yearly Reading Goal", accentColor, borderColor, textPrimary, fontSans);

        // Currently Reading strip (story layout)
        if (statsData.recentlyReading) {
            const crY = progressY + 15 + 12 + 10 + 14 + 40;
            const crPad = 20;
            const crH = 90;

            ctx.fillStyle = options.theme === "dark" ? "#111111" : options.theme === "sepia" ? "#EAE0CF" : "rgba(0,0,0,0.03)";
            if (options.theme === "tinted") ctx.fillStyle = textPrimary === "#FFFFFF" ? "rgba(255,255,255,0.12)" : "rgba(0,0,0,0.08)";
            ctx.strokeStyle = borderColor;
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            if (typeof (ctx as any).roundRect === 'function') (ctx as any).roundRect(drawX, crY, maxWidth, crH, 12);
            else ctx.rect(drawX, crY, maxWidth, crH);
            ctx.fill();
            ctx.stroke();

            ctx.fillStyle = accentColor;
            ctx.globalAlpha = 0.7;
            ctx.beginPath();
            if (typeof (ctx as any).roundRect === 'function') (ctx as any).roundRect(drawX, crY, 5, crH, [12, 0, 0, 12]);
            else ctx.rect(drawX, crY, 5, crH);
            ctx.fill();
            ctx.globalAlpha = 1.0;

            ctx.fillStyle = textPrimary;
            ctx.globalAlpha = 0.4;
            ctx.font = `600 13px ${fontSans}`;
            if ('letterSpacing' in ctx) (ctx as any).letterSpacing = "1.5px";
            ctx.fillText("CURRENTLY READING", drawX + crPad + 5, crY + crPad);
            if ('letterSpacing' in ctx) (ctx as any).letterSpacing = "0px";
            ctx.globalAlpha = 1.0;

            ctx.fillStyle = textPrimary;
            ctx.font = `500 22px ${fontSans}`;
            const crMaxW = maxWidth - crPad * 2 - 5 - 150;
            let crTitle = statsData.recentlyReading.title;
            while (ctx.measureText(crTitle).width > crMaxW && crTitle.length > 4) crTitle = crTitle.slice(0, -1);
            if (crTitle !== statsData.recentlyReading.title) crTitle = crTitle.slice(0, -1) + "\u2026";
            ctx.fillText(crTitle, drawX + crPad + 5, crY + crPad + 24);

            ctx.fillStyle = textPrimary;
            ctx.globalAlpha = 0.5;
            ctx.font = `400 16px ${fontSans}`;
            let crAuthor = statsData.recentlyReading.author;
            while (ctx.measureText(crAuthor).width > crMaxW && crAuthor.length > 4) crAuthor = crAuthor.slice(0, -1);
            if (crAuthor !== statsData.recentlyReading.author) crAuthor = crAuthor.slice(0, -1) + "\u2026";
            ctx.fillText(crAuthor, drawX + crPad + 5, crY + crPad + 52);
            ctx.globalAlpha = 1.0;

            const pct = Math.min(1, statsData.recentlyReading.progress);
            const barW = 140;
            const barH = 8;
            const barX = drawX + maxWidth - crPad - barW;
            const barY = crY + (crH - barH) / 2 - 8;
            ctx.fillStyle = "rgba(128,128,128,0.2)";
            ctx.beginPath();
            if (typeof (ctx as any).roundRect === 'function') (ctx as any).roundRect(barX, barY, barW, barH, barH / 2);
            else ctx.rect(barX, barY, barW, barH);
            ctx.fill();
            if (pct > 0) {
                ctx.fillStyle = accentColor;
                ctx.globalAlpha = 0.85;
                ctx.beginPath();
                if (typeof (ctx as any).roundRect === 'function') (ctx as any).roundRect(barX, barY, barW * pct, barH, barH / 2);
                else ctx.rect(barX, barY, barW * pct, barH);
                ctx.fill();
                ctx.globalAlpha = 1.0;
            }
            ctx.fillStyle = textPrimary;
            ctx.globalAlpha = 0.45;
            ctx.font = `400 14px ${fontSans}`;
            const pctLabel = `${Math.round(pct * 100)}% complete`;
            ctx.fillText(pctLabel, barX, barY + barH + 16);
            ctx.globalAlpha = 1.0;
        }
    }

    // Draw Footer (Source and Branding)
    const footerFontSize = 22;
    const bottomY = canvas.height - (options.format === "story" ? 120 : 80);
    const rightX = canvas.width - paddingX;

    // Draw "Shared via Theorem"
    ctx.fillStyle = textPrimary;
    ctx.globalAlpha = options.theme === "tinted" ? 0.75 : 0.45;
    ctx.font = `500 ${footerFontSize}px ${fontSans}`;
    const sharedText = "Shared via Theorem";
    const textWidth = ctx.measureText(sharedText).width;

    // textBaseline is "top" here — text top edge is at bottomY
    // Logo is drawn from (logoX, bottomY) to (logoX+size, bottomY+size),
    // so its top exactly matches the text top → both on the same line
    const logoSize = footerFontSize;
    const logoX = rightX - textWidth - logoSize - 10;

    ctx.fillText(sharedText, rightX - textWidth, bottomY);
    ctx.globalAlpha = options.theme === "tinted" ? 0.95 : 0.85;
    ctx.drawImage(theoremImg, logoX, bottomY, logoSize, logoSize);
    ctx.globalAlpha = 1.0;

    return new Promise((resolve, reject) => {
        canvas.toBlob((blob) => {
            if (blob) resolve(blob);
            else reject(new Error("Canvas toBlob failed"));
        }, "image/png", 0.95);
    });
}
