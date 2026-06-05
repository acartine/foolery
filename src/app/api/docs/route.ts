const HTML = `<!DOCTYPE html>
<html>
  <head>
    <title>Foolery API</title>
    <meta charset="utf-8"/>
    <meta name="viewport" content="width=device-width, initial-scale=1"/>
    <style>
      body { margin: 0; padding: 0; }
      .agent-banner {
        font: 14px/1.5 system-ui, sans-serif;
        padding: 10px 16px;
        background: #0d1117;
        color: #c9d1d9;
        border-bottom: 1px solid #30363d;
      }
      .agent-banner a { color: #58a6ff; }
    </style>
  </head>
  <body>
    <div class="agent-banner">
      Agents: start at the machine-discovery entrypoint
      <a href="/.well-known/foolery.json">/.well-known/foolery.json</a>
      (alias <a href="/api/discovery">/api/discovery</a>) or the raw spec
      <a href="/api/openapi.json">/api/openapi.json</a>. The guide below covers
      base URLs, repository resolution, and response envelopes.
    </div>
    <redoc spec-url="/api/openapi.json"></redoc>
    <script src="https://cdn.redoc.ly/redoc/latest/bundles/redoc.standalone.js"></script>
  </body>
</html>
`;

export function GET() {
  return new Response(HTML, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
    },
  });
}
