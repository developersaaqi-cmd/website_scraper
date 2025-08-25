"use client";

import { useState } from "react";
import pLimit from "p-limit";

export default function Home() {
  const [urls, setUrls] = useState("");
  const [results, setResults] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState({ processed: 0, fetched: 0 });
  const [timeTaken, setTimeTaken] = useState<number | null>(null);

  async function handleBulkScrape() {
    const urlList = urls
      .split("\n")
      .map((u) => u.trim())
      .filter(Boolean);

    if (urlList.length === 0) return;

    setLoading(true);
    setResults([]);
    setProgress({ processed: 0, fetched: 0 });
    setTimeTaken(null);

    const startTime = performance.now(); // Start timer

    const limit = pLimit(30);
    let tempResults: any[] = [];
    let processedCount = 0;

    const tasks = urlList.map((url) =>
      limit(async () => {
        try {
          const res = await fetch("/api/scrape", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ urls: [url] }),
          });
          const data = await res.json();

          processedCount++;
          if (data.results && data.results.length > 0) {
            data.results.forEach((item: { data: { emails: string | any[]; phones: string | any[]; social: {}; }; }) => {
              if (
                (item.data.emails && item.data.emails.length) ||
                (item.data.phones && item.data.phones.length) ||
                (item.data.social && Object.keys(item.data.social).length)
              ) {
                tempResults.push(item);
              }
            });
          }

          setProgress({ processed: processedCount, fetched: tempResults.length });
          setResults([...tempResults]);
        } catch {
          processedCount++;
          setProgress({ processed: processedCount, fetched: tempResults.length });
        }
      })
    );

    await Promise.all(tasks);

    const endTime = performance.now(); // End timer
    setTimeTaken((endTime - startTime) / 1000); // time in seconds

    setLoading(false);
  }

  function handleCopy() {
    navigator.clipboard.writeText(JSON.stringify(results, null, 2));
    alert("JSON copied to clipboard!");
  }

  function handleDownloadJSON() {
    const blob = new Blob([JSON.stringify(results, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "scrape-results.json";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  const urlCount = typeof window !== "undefined" ? urls.split("\n").filter(Boolean).length : 0;

  return (
    <div className="p-8 font-sans bg-gray-50 min-h-screen">
      <div className="max-w-6xl mx-auto">
        <h1 className="text-4xl font-extrabold mb-6 text-center text-blue-700">Bulk Website Scraper</h1>

        {/* Top Buttons */}
        <div className="flex justify-center gap-4 mb-6">
          <a
            href="https://www.convertcsv.com/json-to-csv.htm"
            target="_blank"
            className="px-4 py-2 bg-indigo-600 text-white rounded-lg shadow hover:bg-indigo-700 transition"
          >
            JSON → Excel
          </a>
          <a
            href="https://tableconvert.com/excel-to-json"
            target="_blank"
            className="px-4 py-2 bg-green-600 text-white rounded-lg shadow hover:bg-green-700 transition"
          >
            Excel → JSON
          </a>
        </div>

        {/* Input */}
        <textarea
          rows={6}
          placeholder="Enter one URL per line"
          value={urls}
          onChange={(e) => setUrls(e.target.value)}
          className="w-full p-4 border border-gray-300 rounded-xl shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 mb-4 resize-none"
        />

        {/* Action Buttons */}
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4 mb-6">
          <button
            onClick={handleBulkScrape}
            disabled={loading || !urls.trim()}
            className="w-full sm:w-auto px-6 py-3 bg-blue-600 text-white font-semibold rounded-lg shadow hover:bg-blue-700 disabled:opacity-50 transition"
          >
            {loading ? "Processing..." : "Fetch All"}
          </button>

          {typeof window !== "undefined" && urlCount > 0 && (
            <span className="text-gray-700 font-medium">
              Processed {progress.processed} / {urlCount} (Fetched: {progress.fetched})
            </span>
          )}

          {!loading && results.length > 0 && typeof window !== "undefined" && (
            <div className="flex gap-2">
              <button
                onClick={handleCopy}
                className="px-5 py-3 bg-green-600 text-white rounded-lg shadow hover:bg-green-700 transition"
              >
                Copy JSON
              </button>
              <button
                onClick={handleDownloadJSON}
                className="px-5 py-3 bg-yellow-500 text-white rounded-lg shadow hover:bg-yellow-600 transition"
              >
                Download JSON
              </button>
            </div>
          )}
        </div>

        {/* Time Taken */}
        {!loading && timeTaken !== null && (
          <div className="text-gray-700 mb-4">
            <span className="font-semibold">Total Time Taken:</span> {timeTaken.toFixed(2)} seconds
          </div>
        )}

        {/* JSON Results */}
        {typeof window !== "undefined" && results.length > 0 && (
          <div className="bg-white rounded-xl shadow p-4 overflow-x-auto mb-6">
            <h2 className="text-lg font-semibold mb-2 text-gray-700">Scrape Results (JSON)</h2>
            <pre className="bg-gray-100 rounded-lg p-4 overflow-auto max-h-96 text-sm text-gray-800 font-mono">
              {JSON.stringify(results, null, 2)}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}
