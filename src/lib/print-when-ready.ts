/**
 * Abre la vista previa de impresión recién cuando el nodo a imprimir ya existe.
 *
 * `window.print()` congela el DOM en ese instante. En las pantallas que esconden
 * todo el body y dejan visible una sola sección (el ticket, la factura), llamarlo
 * antes de que React monte esa sección imprime una hoja en blanco. Un timeout
 * fijo no alcanza: depende de cuándo se hidrata y monta el árbol.
 *
 * Si el nodo nunca aparece se imprime igual al vencer el plazo, para no dejar al
 * usuario sin diálogo de impresión.
 *
 * @returns `true` si el nodo estaba presente al imprimir.
 */
export async function printWhenReady(
  elementId: string,
  {
    timeoutMs = 3000,
    intervalMs = 30,
    print = () => window.print(),
    now = () => Date.now(),
  }: {
    timeoutMs?: number;
    intervalMs?: number;
    print?: () => void;
    now?: () => number;
  } = {}
): Promise<boolean> {
  const deadline = now() + timeoutMs;

  while (!document.getElementById(elementId) && now() < deadline) {
    await new Promise<void>((resolve) => {
      window.setTimeout(resolve, intervalMs);
    });
  }

  print();
  return document.getElementById(elementId) !== null;
}
