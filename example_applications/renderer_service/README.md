# Renderer Service — pict-renderer-graph example app

The smallest sensible standalone Orator app that hosts `pict-renderer-graph`. Copy this pattern into your own retold service if you want to expose a `/render` endpoint to the wider system.

## Run

```bash
npm install
npm start                            # serves on http://127.0.0.1:7790
PORT=8080 npm start                  # custom port
```

## Use

```bash
# Process flow
curl -X POST http://127.0.0.1:7790/render \
     -H 'Content-Type: application/json' \
     -d '{
       "type": "flow",
       "title": "service flow",
       "nodes": [
         { "id": "user", "label": "User", "kind": "ellipse" },
         { "id": "api",  "label": "API" },
         { "id": "db",   "label": "DB" }
       ],
       "edges": [
         { "from": "user", "to": "api", "label": "request" },
         { "from": "api",  "to": "db",  "label": "query" }
       ]
     }' > flow.svg
open flow.svg
```

```bash
# Hub-and-spoke
curl -X POST http://127.0.0.1:7790/render \
     -d @star-input.json > star.svg

# Sequence diagram
curl -X POST http://127.0.0.1:7790/render \
     -d @sequence-input.json > sequence.svg

# PNG output (2x scale)
curl -X POST 'http://127.0.0.1:7790/render?format=png&scale=2' \
     -d @diagram.json > diagram.png

# JSON envelope (svg + scene + source)
curl -X POST 'http://127.0.0.1:7790/render?format=json' \
     -d @diagram.json | jq .
```

## Inspect

```bash
curl http://127.0.0.1:7790/render/types  | jq .
curl http://127.0.0.1:7790/render/styles | jq .
```

## What the example actually does

[`Renderer-Service-Application.js`](Renderer-Service-Application.js) is ~50 lines:

1. New Fable instance with `Product` set (required by OratorServiceServer).
2. Add Orator + restify service-server to fable's serviceManager.
3. New `PictRendererGraph` instance; `initialize()` (boots Chromium up-front).
4. `renderer.connectRoutes(fable.OratorServiceServer)` registers POST `/render`, GET `/render/types`, GET `/render/styles`.
5. Start the server. Hook SIGINT/SIGTERM for clean Chromium shutdown.

That's the whole pattern. Use it as a template — or just `npm install pict-renderer-graph` and call `renderer.connectRoutes` from whichever Orator app you already run.
