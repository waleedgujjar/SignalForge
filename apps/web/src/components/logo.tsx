import Link from 'next/link';
import { cn } from '@/lib/utils';

type LogoProps = {
  className?: string;
  href?: string | null;
  size?: 'sm' | 'md' | 'lg';
};

const sizeStyles = {
  sm: 'text-lg',
  md: 'text-2xl',
  lg: 'text-4xl',
} as const;

export function Logo({ className, href = '/', size = 'md' }: LogoProps) {
  const mark = (
    <span className={cn('inline-flex items-baseline font-bold tracking-tight', sizeStyles[size], className)}>
      <span className="text-primary">Signal</span>
      <span className="text-foreground">Forge</span>
    </span>
  );

  if (href) {
    return (
      <Link href={href} className="inline-block no-underline" aria-label="SignalForge">
        {mark}
      </Link>
    );
  }

  return mark;
}
