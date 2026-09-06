/** Two continuous page lines form paperflow's lowercase p. Keep the paths in
 * public/brand/paperflow-mark.svg and app/icon.svg aligned with this master. */
export function LogoMark({ size = 34, className = "" }: { size?: number; className?: string }) {
  return (
    <svg className={`paperflow-mark ${className}`} width={size} height={size} viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false">
      <path d="M9 33V11C9 8.24 11.24 6 14 6H25C28.87 6 32 9.13 32 13V16C32 19.87 28.87 23 25 23H16" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M16 33V16C16 14.34 17.34 13 19 13H25" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
