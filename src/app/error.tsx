"use client";

export default function Error({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string }
  unstable_retry: () => void
}) {
  console.error('Error boundary caught:', error);

  const link = (href: string, label: string) => (
    <a href={href} style={{ color: '#22d3ee' }}>{label}</a>
  );

  return (
    <div style={{ padding: '20px', textAlign: 'center' }}>
      <h1>Algo salió mal</h1>
      <p>Por favor, intenta de nuevo más tarde.</p>
      <button
        onClick={unstable_retry}
        style={{
          marginTop: '16px',
          padding: '8px 24px',
          background: '#6366f1',
          color: '#fff',
          border: 'none',
          borderRadius: '8px',
          cursor: 'pointer',
        }}
      >
        Reintentar
      </button>
      <div style={{ marginTop: '24px', fontSize: '12px' }}>
        {link('/privacidad', 'Privacidad')} · {link('/terminos', 'Términos')} · {link('/cookies', 'Cookies')}
      </div>
    </div>
  );
}