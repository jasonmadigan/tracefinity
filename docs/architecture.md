# Architecture

## Backend (Python/FastAPI)
- Image upload with auto paper corner detection (OpenCV)
- Perspective correction using user-adjusted corners (portrait + landscape)
- AI tracing via Google Gemini (`gemini-3-pro-image-preview`)
- Manual mask upload as alternative to API
- Session persistence (JSON files)
- Tool library + bin persistence (JSON files)
- STL/3MF generation with build123d + moritzmhmk gridfinity library

## Frontend (Next.js 16/React/TypeScript)
- Dashboard with tool library + bin management
- Paper corner editor with draggable handles
- Polygon editor with vertex editing, undo/redo
- Tool editor for editing saved tools (vertices, finger holes)
- Bin editor for positioning tools in bins, adding text labels
- 3D STL preview (react-three-fiber)
- Shows user what prompts are sent to Gemini

## Project Structure

```
tracefinity/
├── backend/
│   ├── app/
│   │   ├── main.py
│   │   ├── config.py
│   │   ├── api/routes.py
│   │   └── services/
│   │       ├── ai_tracer.py       # Gemini mask + contour tracing
│   │       ├── image_processor.py  # paper detection + perspective
│   │       ├── polygon_scaler.py   # px to mm conversion + clearance
│   │       ├── stl_generator.py    # gridfinity STL + bin splitting
│   │       ├── session_store.py
│   │       ├── tool_store.py       # tool library persistence
│   │       └── bin_store.py        # bin persistence
│   └── requirements.txt
├── frontend/
│   ├── src/
│   │   ├── app/
│   │   │   ├── page.tsx           # dashboard (tools + bins)
│   │   │   ├── trace/[id]/        # corner + polygon editing
│   │   │   ├── tools/[id]/        # tool vertex/hole editor
│   │   │   └── bins/[id]/         # bin builder + 3D preview
│   │   ├── components/
│   │   │   ├── BinEditor.tsx      # bin layout with placed tools
│   │   │   ├── BinConfigurator.tsx # bin settings panel
│   │   │   ├── BinPreview3D.tsx   # three.js STL viewer
│   │   │   ├── ToolEditor.tsx     # single tool vertex editor
│   │   │   ├── ToolBrowser.tsx    # sidebar tool picker for bins
│   │   │   ├── PolygonEditor.tsx  # trace-time polygon editor
│   │   │   └── ...
│   │   └── lib/api.ts
│   └── package.json
├── .github/workflows/
│   ├── docker-dev.yml      # build on push to main
│   └── docker-release.yml  # build on release
├── Dockerfile              # single container (frontend + backend)
├── .env.example
└── README.md
```

## Data Model

- **Tool**: a single traced polygon + finger holes, stored in mm, centred at origin. Lives in a persistent library (`tools.json`).
- **PlacedTool**: a positioned copy of a tool in a bin. Points/holes in bin-space mm. Has `tool_id` linking back to source.
- **Bin**: bin config + placed tools + text labels. Used for STL generation (`bins.json`).
- **Session**: ephemeral, used only for upload/trace workflow. Output is tools saved to library via `save-tools`.

PlacedTools sync with their library source on bin load (`GET /bins/{id}`). Edits to a tool's points, finger holes, or name propagate to all bins that use it. The position offset is preserved.
