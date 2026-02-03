# Plan to Fix PDF Metadata and Cover Extraction

## Problem
The application currently uses `foliate-js` for all book metadata extraction. `foliate-js` explicitly throws an error when attempting to open PDF files ("PDF files should be opened with PDFViewer, not foliate-js view"), causing metadata and cover extraction to fail for imported PDFs.

## Solution
We will leverage the existing `PDFEngine` (based on `pdfjs-dist`) to handle PDF files separately in the extraction pipeline.

### Step 1: Enhance `PDFEngine`
We need to add a method to `src/engines/pdf/pdf-engine.ts` that allows rendering a single page to a Blob without using the complex `CanvasPool` or `RenderQueue` designed for the viewer UI. This is necessary for generating cover images (thumbnails).

**Changes:**
- Add `renderToBlob(pageNumber, scale)` method to `PDFEngine`.

### Step 2: Update `CoverExtractor`
Modify `src/lib/cover-extractor.ts` to detect PDF files and route them to a new internal handler that uses `PDFEngine`.

**Changes:**
- Import `PDFEngine`.
- In `extractBookMetadata`:
    - Check if the file MIME type is `application/pdf`.
    - If PDF: Instantiate `PDFEngine`, load document, extract metadata, render page 1 as cover, destroy engine, and return result.
    - If other: Proceed with existing `foliate-js` logic.
- In `extractCoverOnly`:
    - Similar logic: If PDF, use `PDFEngine` to render page 1.

## Implementation Details

### `src/engines/pdf/pdf-engine.ts`
```typescript
async renderToBlob(pageNumber: number, scale = 1.0): Promise<Blob | null> {
    // ... implementation using off-screen canvas and page.render() ...
}
```

### `src/lib/cover-extractor.ts`
```typescript
export async function extractBookMetadata(...) {
    // ...
    if (file.type === "application/pdf") {
        return extractPdfMetadata(file, bookId);
    }
    // ... existing foliate logic ...
}

async function extractPdfMetadata(file: File, bookId?: string) {
    const engine = new PDFEngine();
    try {
        await engine.loadDocument(file);
        const metadata = await engine.extractMetadata(); // This is private, might need to expose or access via doc
        // ... get cover via renderToBlob(1) ...
    } finally {
        await engine.destroy();
    }
}
```

## Verification
1.  **Import a PDF:** Verify that the "PDF files should be opened..." error is gone.
2.  **Check Metadata:** Confirm Title and Author are populated in the Library view.
3.  **Check Cover:** Confirm the first page of the PDF appears as the book cover.
4.  **Non-PDFs:** Ensure EPUBs still import correctly (regression test).
