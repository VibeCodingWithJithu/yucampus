import { cn } from '../cn';

/** The YuCampus mark. `onDark` is for the indigo sign-in panel. */
export function LogoMark({ size = 36, onDark = false }: { size?: number; onDark?: boolean }) {
  return (
    <span
      role="img"
      aria-label="YuCampus logo"
      className={cn('flex flex-none items-center justify-center', onDark ? 'bg-white' : 'bg-primary')}
      style={{ width: size, height: size, borderRadius: size / 4 }}
    >
      <svg width={size * 0.72} height={size * 0.72} viewBox="0 0 96 96" aria-hidden="true">
        <path
          d="M10 40 L48 12 L86 40"
          fill="none"
          stroke={onDark ? '#2B3990' : '#FFFFFF'}
          strokeWidth="10"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          d="M28 44 L48 64 L68 44 M48 64 V86"
          fill="none"
          stroke={onDark ? '#0E7068' : '#5ED1C4'}
          strokeWidth="11"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </span>
  );
}

export function Logo({ onDark = false, size = 'md' }: { onDark?: boolean; size?: 'md' | 'lg' }) {
  const large = size === 'lg';
  return (
    <div className={cn('flex items-center', large ? 'gap-3' : 'gap-2.5')}>
      <LogoMark size={large ? 48 : 36} onDark={onDark} />
      <div className="flex flex-col">
        <span
          className={cn(
            'font-extrabold tracking-[-0.01em]',
            large ? 'text-xl' : 'text-[17px]',
            onDark ? 'text-white' : 'text-ink',
          )}
        >
          <span className={onDark ? 'text-teal-light' : 'text-teal'}>Yu</span>Campus
        </span>
        <span className={cn(large ? 'text-[13px]' : 'text-[11px]', onDark ? 'text-on-primary-muted' : 'text-muted')}>
          by Yubhian Technologies
        </span>
      </div>
    </div>
  );
}
