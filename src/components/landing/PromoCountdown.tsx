'use client';

import { useEffect, useState } from 'react';
import { Clock3, Flame } from 'lucide-react';
import { getActivePromo, getPromoDeadline } from '@/lib/plans';

interface TimeLeft {
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
}

function pad(n: number) {
  return String(n).padStart(2, '0');
}

function getTimeLeft(target: Date): TimeLeft {
  const total = Math.max(0, Math.floor((target.getTime() - Date.now()) / 1000));
  return {
    days: Math.floor(total / 86400),
    hours: Math.floor((total % 86400) / 3600),
    minutes: Math.floor((total % 3600) / 60),
    seconds: total % 60,
  };
}

function useCountdown(deadline: Date | null) {
  const [left, setLeft] = useState<TimeLeft | null>(null);

  useEffect(() => {
    if (!deadline) return;
    const id = setInterval(() => {
      const next = getTimeLeft(deadline);
      if (next.days === 0 && next.hours === 0 && next.minutes === 0 && next.seconds === 0) {
        clearInterval(id);
      }
      setLeft(next);
    }, 1000);
    return () => clearInterval(id);
  }, [deadline]);

  return left;
}

type PromoCountdownProps = {
  variant?: 'pill' | 'banner';
};

export default function PromoCountdown({ variant = 'pill' }: PromoCountdownProps) {
  const active = getActivePromo();
  const deadline = getPromoDeadline(active);
  const left = useCountdown(deadline);

  if (!active || !deadline || !left) return null;

  const expired =
    left.days === 0 && left.hours === 0 && left.minutes === 0 && left.seconds === 0;

  const timer = (
    <>
      {left.days > 0 ? `${left.days}d ` : ''}
      {pad(left.hours)}:{pad(left.minutes)}:{pad(left.seconds)}
    </>
  );

  if (variant === 'banner') {
    return (
      <div className="flex flex-col items-center justify-center gap-1 rounded-xl bg-gradient-to-r from-orange-500/15 via-amber-500/20 to-orange-500/15 border border-orange-500/40 px-4 py-3 text-center">
        <p className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-orange-400">
          <Flame className="w-4 h-4 animate-pulse" />
          {expired ? 'Oferta finalizada' : 'Oferta por tiempo limitado'}
        </p>
        {!expired && (
          <p className="text-sm font-extrabold tabular-nums text-amber-400">
            Termina en <span className="text-orange-400">{timer}</span>
          </p>
        )}
      </div>
    );
  }

  return (
    <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-500/10 border border-amber-500/30 text-amber-400 text-xs font-semibold">
      <Clock3 className="w-3.5 h-3.5 animate-pulse" />
      {expired ? (
        'Oferta finalizada'
      ) : (
        <>
          Por tiempo limitado · termina en {timer}
        </>
      )}
    </span>
  );
}