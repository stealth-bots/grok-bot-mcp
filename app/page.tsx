export default function HomePage() {
  return (
    <main>
      <h1>grok-bot-mcp</h1>
      <p>Remote MCP server that lets external agents talk to a Grok Bot.</p>
      <ul>
        <li>
          MCP endpoint: <code>/api/mcp</code>
        </li>
        <li>
          Reply callback: <code>/api/reply</code>
        </li>
      </ul>
    </main>
  );
}
