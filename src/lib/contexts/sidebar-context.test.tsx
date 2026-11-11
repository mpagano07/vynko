import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { SidebarProvider, useSidebar } from './sidebar-context';

function Probe() {
  const { isOpen, open, close, toggle } = useSidebar();
  return (
    <div>
      <span data-testid="sidebar-state">{isOpen ? 'abierto' : 'cerrado'}</span>
      <button type="button" onClick={open}>Abrir</button>
      <button type="button" onClick={close}>Cerrar</button>
      <button type="button" onClick={toggle}>Alternar</button>
    </div>
  );
}

describe('SidebarProvider / useSidebar', () => {
  it('arranca cerrado y expone abrir, cerrar y alternar', () => {
    render(
      <SidebarProvider>
        <Probe />
      </SidebarProvider>
    );

    expect(screen.getByTestId('sidebar-state')).toHaveTextContent('cerrado');

    fireEvent.click(screen.getByRole('button', { name: 'Abrir' }));
    expect(screen.getByTestId('sidebar-state')).toHaveTextContent('abierto');

    // El toggle alterna en base al estado previo.
    fireEvent.click(screen.getByRole('button', { name: 'Alternar' }));
    expect(screen.getByTestId('sidebar-state')).toHaveTextContent('cerrado');
    fireEvent.click(screen.getByRole('button', { name: 'Alternar' }));
    expect(screen.getByTestId('sidebar-state')).toHaveTextContent('abierto');

    fireEvent.click(screen.getByRole('button', { name: 'Cerrar' }));
    expect(screen.getByTestId('sidebar-state')).toHaveTextContent('cerrado');
  });

  it('useSidebar fuera del provider falla con error claro', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => render(<Probe />)).toThrow('useSidebar must be used within a SidebarProvider');
    spy.mockRestore();
  });
});
