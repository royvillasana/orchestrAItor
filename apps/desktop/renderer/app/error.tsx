'use client';
export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <main className="flex min-h-screen items-center justify-center p-12">
      <section className="max-w-lg rounded-2xl border border-line bg-panel p-10">
        <p className="mb-4 text-accent">OrchestrAI</p>
        <h1 className="text-2xl">The workspace could not render.</h1>
        <p className="my-5 text-muted">
          Your saved conversations remain on this computer. Reload the interface to continue.
        </p>
        <button className="rounded-lg bg-accent px-5 py-3 text-ink" onClick={reset}>
          Reload workspace
        </button>
      </section>
    </main>
  );
}
