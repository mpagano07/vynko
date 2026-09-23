import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Pagination } from './pagination';

describe('Pagination', () => {
  it('renders nothing when totalPages is 1 or less', () => {
    const onPageChange = vi.fn();
    const { container } = render(
      <Pagination currentPage={1} totalPages={1} onPageChange={onPageChange} />
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders page label and page buttons', () => {
    render(<Pagination currentPage={2} totalPages={5} onPageChange={vi.fn()} />);
    expect(screen.getByText(/Página/)).toHaveTextContent('Página 2 de 5');
    expect(screen.getByRole('button', { name: 'Anterior' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Siguiente' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '1' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '3' })).toBeInTheDocument();
  });

  it('disables Anterior on first page and Siguiente on last page', () => {
    const first = render(<Pagination currentPage={1} totalPages={3} onPageChange={vi.fn()} />);
    expect(first.getByRole('button', { name: 'Anterior' })).toBeDisabled();
    expect(first.getByRole('button', { name: 'Siguiente' })).toBeEnabled();
    first.unmount();

    const last = render(<Pagination currentPage={3} totalPages={3} onPageChange={vi.fn()} />);
    expect(last.getByRole('button', { name: 'Anterior' })).toBeEnabled();
    expect(last.getByRole('button', { name: 'Siguiente' })).toBeDisabled();
  });

  it('calls onPageChange with the selected page', () => {
    const onPageChange = vi.fn();
    render(<Pagination currentPage={3} totalPages={5} onPageChange={onPageChange} />);
    fireEvent.click(screen.getByRole('button', { name: '5' }));
    expect(onPageChange).toHaveBeenCalledWith(5);
  });

  it('calls onPageChange with the next/previous page', () => {
    const onPageChange = vi.fn();
    render(<Pagination currentPage={3} totalPages={5} onPageChange={onPageChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'Siguiente' }));
    expect(onPageChange).toHaveBeenCalledWith(4);
    fireEvent.click(screen.getByRole('button', { name: 'Anterior' }));
    expect(onPageChange).toHaveBeenCalledWith(2);
  });

  it('renders resultInfo alongside the page label', () => {
    render(<Pagination currentPage={2} totalPages={5} onPageChange={vi.fn()} resultInfo="Mostrando 11–20 de 50" />);
    expect(screen.getByText('Mostrando 11–20 de 50')).toBeInTheDocument();
    expect(screen.getByText(/Página/)).toHaveTextContent('Página 2 de 5');
  });

  it('shows ellipsis for distant page ranges', () => {
    const { container } = render(<Pagination currentPage={6} totalPages={10} onPageChange={vi.fn()} />);
    expect(container.textContent).toContain('…');
  });
});