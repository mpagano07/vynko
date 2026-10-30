import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { ExportProductsModal } from './export-products-modal';

const baseProps = {
  open: true,
  onClose: vi.fn(),
  onExport: vi.fn(),
  exporting: false,
  count: 3,
};

describe('ExportProductsModal', () => {
  it('muestra el formulario de exportación', () => {
    render(<ExportProductsModal {...baseProps} />);

    expect(screen.getByLabelText('Exportar productos')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Guardar en Drive' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Descargar' })).toBeInTheDocument();
  });

  it('confirma el archivo guardado y permite abrirlo en Drive', () => {
    const onClose = vi.fn();
    const onExportAnother = vi.fn();

    render(
      <ExportProductsModal
        {...baseProps}
        onClose={onClose}
        driveResult={{
          fileName: 'vynko-productos.xls',
          webViewLink: 'https://drive.google.com/file/d/123/view',
          accountEmail: 'duena@example.com',
        }}
        onExportAnother={onExportAnother}
      />
    );

    expect(screen.getByLabelText('Archivo guardado en Google Drive')).toBeInTheDocument();
    expect(screen.getByText('vynko-productos.xls')).toBeInTheDocument();
    expect(screen.getByText('duena@example.com')).toBeInTheDocument();

    const openLink = screen.getByRole('link', { name: /Abrir en Drive/ });
    expect(openLink).toHaveAttribute('href', 'https://drive.google.com/file/d/123/view');
    expect(openLink).toHaveAttribute('target', '_blank');

    fireEvent.click(screen.getByRole('button', { name: 'Exportar otra' }));
    expect(onExportAnother).toHaveBeenCalledOnce();

    fireEvent.click(screen.getByRole('button', { name: 'Listo' }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('oculta el botón de abrir si Drive no devolvió un link', () => {
    render(
      <ExportProductsModal
        {...baseProps}
        driveResult={{ fileName: 'vynko-productos.csv' }}
      />
    );

    expect(screen.queryByRole('link', { name: /Abrir en Drive/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Listo' })).toBeInTheDocument();
  });

  it('reabre con las opciones pendientes al retomar un export', () => {
    const onExport = vi.fn();

    render(
      <ExportProductsModal
        {...baseProps}
        onExport={onExport}
        initialPlatform="mercadolibre"
        initialFormat="csv"
      />
    );

    expect(screen.getByText(/plantilla de publicación masiva de MercadoLibre/i)).toBeInTheDocument();
    expect(screen.getByText(/Texto separado por comas/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Guardar en Drive' }));
    expect(onExport).toHaveBeenCalledWith({
      platform: 'mercadolibre',
      format: 'csv',
      destination: 'drive',
    });
  });

  it('no cierra el modal mientras se está subiendo el archivo', () => {
    const onClose = vi.fn();

    render(<ExportProductsModal {...baseProps} onClose={onClose} exporting />);

    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cerrar' }));

    expect(onClose).not.toHaveBeenCalled();
  });
});
