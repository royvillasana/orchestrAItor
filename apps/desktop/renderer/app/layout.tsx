import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = {
  title: 'OrchestrAI — Your studio, connected',
  description: 'A local-first music production workspace.',
};
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
