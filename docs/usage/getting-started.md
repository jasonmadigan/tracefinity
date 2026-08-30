# Getting Started

Tracefinity turns photos of tools into 3D-printable gridfinity bins. It runs as a single Docker container with no cloud account or signup required; the first visit creates a local administrator account.

## Running

```bash
docker run -p 3000:3000 -v ./data:/app/storage ghcr.io/tracefinity/tracefinity
```

Open `http://localhost:3000`. The first visit asks you to create the administrator account for the installation. Data persists in the `./data` directory on your host.

For cloud-based tracing with Google Gemini (better results, requires an API key):

```bash
docker run -p 3000:3000 -v ./data:/app/storage -e GOOGLE_API_KEY=your-key ghcr.io/tracefinity/tracefinity
```

Without an API key, tracing uses a local model (IS-Net by default). See [tracing.md](tracing.md) for backend options.

## Your first trace

1. Place tools flat on a sheet of A4, Letter, A3, or Tabloid paper. Use a contrasting surface underneath.
2. Photograph from above. Directly overhead gives the best scale accuracy.
3. From the home page, drag and drop your photo onto the uploader (or click to browse). JPG, PNG, WebP, and HEIC are accepted.
4. Drag the four corner handles onto the paper edges. Select A4, Letter, A3, or Tabloid.
5. Tracing starts automatically. The AI generates silhouette masks for each tool, typically in a few seconds.
6. Click to select which traced tools to keep. Selected tools are saved to your library.

The paper is for scale only. Tools can extend beyond the paper edges and will still be traced.

From there, edit outlines in the tool editor, add cutouts, then drop tools into a bin and export STL or 3MF for printing.

## Navigating the app

- **Home** -- tool library and bin list. Search, sort, rename, and delete tools. Create new bins.
- **Tool editor** -- click any saved tool to edit its outline, add cutouts (finger holes, pockets), flip, rotate, and export SVG.
- **Bin editor** -- configure gridfinity dimensions, drag tools in from the library, add text labels, and export STL/3MF.
- **Projects** -- group related tools and bins together. Track status (active, ready to print, printed, archived). Useful for planning drawer layouts across multiple bins.

## Session persistence

In-progress traces are saved automatically. If you close the browser or navigate away mid-trace, your work is preserved and you can resume where you left off.

## Settings

Click the gear icon in the top bar to open settings. Currently this lets you set your default printer bed size (150-500mm). Bins wider than this threshold are automatically split into printable pieces on export.

## Collapsible sections

The home page sections (Projects, Tools, Bins) can be collapsed and expanded by clicking the section header. Collapse state is remembered between sessions.

## Dark and light mode

Toggle between dark and light themes using the sun/moon icon in the top bar. Your preference is saved in the browser.
