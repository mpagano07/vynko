// Inicializa Sentry en el browser antes de que React hidrate, para capturar
// errores de carga temprana. Sin NEXT_PUBLIC_SENTRY_DSN no hace nada.
import './sentry.client';