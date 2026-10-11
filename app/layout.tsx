import type { ReactNode } from 'react';

export const metadata = {
  title: 'grok-bot-mcp',
  description: 'Remote MCP server that lets external agents talk to a Grok Bot.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
