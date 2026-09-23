import * as React from 'react';
import { Search } from 'lucide-react';
import { cn } from '@/lib/utils/cn';
import { Input, type InputProps } from './input';

export const SearchInput = React.forwardRef<HTMLInputElement, InputProps>(function SearchInput(
  { className, ...props },
  ref
) {
  return (
    <div className="relative">
      <Search className="absolute left-3 top-3 h-4 w-4 text-gray-400 pointer-events-none" />
      <Input ref={ref} className={cn('pl-9', className)} {...props} />
    </div>
  );
});