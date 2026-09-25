import { LoadingState } from '@/components/ui/loading-state';

export function RouteLoading({ label = 'Cargando...' }: { label?: string }) {
  return (
    <div className="py-10">
      <LoadingState label={label} />
    </div>
  );
}