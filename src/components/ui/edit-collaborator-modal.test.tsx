import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { EditCollaboratorModal } from './edit-collaborator-modal';

const TENANTS = [
  { id: 'tenant-a', name: 'Sucursal A' },
  { id: 'tenant-b', name: 'Sucursal B' },
];

const MEMBERSHIPS = [
  { tenant_id: 'tenant-a', role: 'member' },
  { tenant_id: 'tenant-b', role: 'manager' },
];

function renderModal(overrides: Partial<Parameters<typeof EditCollaboratorModal>[0]> = {}) {
  const onSave = vi.fn(async () => undefined);
  const onCancel = vi.fn();
  render(
    <EditCollaboratorModal
      open
      fullName="Ana Pérez"
      email="ana@empresa-a.com"
      role="manager"
      tenants={TENANTS}
      memberships={MEMBERSHIPS}
      onCancel={onCancel}
      onSave={onSave}
      {...overrides}
    />
  );
  return { onSave, onCancel };
}

describe('EditCollaboratorModal', () => {
  it('no renderiza nada si está cerrado', () => {
    renderModal({ open: false });
    expect(screen.queryByText('Editar colaborador')).not.toBeInTheDocument();
  });

  it('permite editar el nombre y lo manda junto con las sucursales', async () => {
    const { onSave } = renderModal();

    const nameInput = screen.getByLabelText('Nombre');
    expect(nameInput).toHaveValue('Ana Pérez');

    fireEvent.change(nameInput, { target: { value: 'Ana María Pérez' } });
    fireEvent.click(screen.getByText('Guardar'));

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave).toHaveBeenCalledWith({
      memberships: [
        { tenant_id: 'tenant-a', role: 'member' },
        { tenant_id: 'tenant-b', role: 'manager' },
      ],
      full_name: 'Ana María Pérez',
    });
  });

  it('si el nombre queda vacío no pide borrarlo', async () => {
    const { onSave } = renderModal();

    fireEvent.change(screen.getByLabelText('Nombre'), { target: { value: '   ' } });
    fireEvent.click(screen.getByText('Guardar'));

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave.mock.calls[0][0]).toMatchObject({ full_name: null });
  });

  it('quitar una sucursal deja sólo las tildadas', async () => {
    const { onSave } = renderModal();

    fireEvent.click(screen.getByLabelText('Sucursal B'));
    fireEvent.click(screen.getByText('Guardar'));

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave.mock.calls[0][0].memberships).toEqual([
      { tenant_id: 'tenant-a', role: 'member' },
    ]);
  });

  it('no deja guardar sin ninguna sucursal', () => {
    renderModal();

    fireEvent.click(screen.getByLabelText('Sucursal A'));
    fireEvent.click(screen.getByLabelText('Sucursal B'));

    expect(screen.getByText('Guardar').closest('button')).toBeDisabled();
  });
});
