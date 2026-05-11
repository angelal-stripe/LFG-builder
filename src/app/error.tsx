"use client";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="mx-auto flex min-h-screen max-w-lg flex-col gap-6 px-6 py-16">
      <h1 className="sd-heading text-xl">Something went wrong</h1>
      <p className="sd-muted text-sm">{error.message}</p>
      <button type="button" className="sd-btn-primary w-fit" onClick={() => reset()}>
        Try again
      </button>
    </main>
  );
}
