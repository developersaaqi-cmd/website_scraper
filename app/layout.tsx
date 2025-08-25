import "./globals.css";

// app/layout.tsx
export const metadata = {
  title: 'Bulk Website Scraper',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="antialiased bg-gray-50 min-h-screen">{children}</body>
    </html>
  );
}
