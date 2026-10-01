import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { Tooltip } from './tooltip';

function setup() {
  render(
    <Tooltip content="Solo 'Nombre' es obligatorio">
      <button type="button">¿Qué columnas usar?</button>
    </Tooltip>
  );
  return screen.getByRole('button', { name: '¿Qué columnas usar?' });
}

describe('Tooltip', () => {
  it('renderiza el trigger y el tooltip oculto', () => {
    const trigger = setup();
    const tooltip = screen.getByRole('tooltip', { hidden: true });
    expect(tooltip).toHaveTextContent("Solo 'Nombre' es obligatorio");
    expect(tooltip.className).toContain('opacity-0');
    expect(trigger).not.toHaveAttribute('aria-describedby');
  });

  it('muestra el tooltip al hacer hover y lo oculta al salir', () => {
    const trigger = setup();

    fireEvent.mouseOver(trigger);
    expect(screen.getByRole('tooltip').className).toContain('opacity-100');
    expect(trigger.getAttribute('aria-describedby')).toBe(
      screen.getByRole('tooltip').getAttribute('id')
    );

    fireEvent.mouseOut(trigger);
    expect(screen.getByRole('tooltip', { hidden: true }).className).toContain('opacity-0');
    expect(trigger).not.toHaveAttribute('aria-describedby');
  });

  it('abre el tooltip con el foco del teclado', () => {
    const trigger = setup();

    fireEvent.focusIn(trigger);
    expect(screen.getByRole('tooltip').className).toContain('opacity-100');

    fireEvent.focusOut(trigger);
    expect(screen.getByRole('tooltip', { hidden: true }).className).toContain('opacity-0');
  });

  it('ubica el tooltip segun side y align', () => {
    render(
      <Tooltip content="Ayuda" side="bottom" align="start">
        <button type="button">Ayuda</button>
      </Tooltip>
    );
    const tooltip = screen.getByRole('tooltip', { hidden: true });
    expect(tooltip.className).toContain('top-full');
    expect(tooltip.className).toContain('left-0');
  });

  it('acepta contenido React y className extra', () => {
    render(
      <Tooltip content={<strong>Nombre</strong>} contentClassName="bg-red-500">
        <button type="button">X</button>
      </Tooltip>
    );
    const tooltip = screen.getByRole('tooltip', { hidden: true });
    expect(tooltip.querySelector('strong')).not.toBeNull();
    expect(tooltip.className).toContain('bg-red-500');
  });
});