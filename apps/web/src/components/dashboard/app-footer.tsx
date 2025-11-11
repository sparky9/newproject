import Link from 'next/link';

export function AppFooter() {
  const year = new Date().getFullYear();

  return (
    <footer
      className="border-t bg-background/95 px-4 py-6 text-sm text-muted-foreground backdrop-blur supports-[backdrop-filter]:bg-background/75 sm:px-6 lg:px-8"
      role="contentinfo"
    >
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <p className="text-xs sm:text-sm">© {year} Online C-Suite. All rights reserved.</p>
        <nav className="flex flex-wrap items-center gap-4 text-xs sm:text-sm" aria-label="Footer links">
          <Link href="/legal/terms" className="transition-colors hover:text-foreground">
            Terms
          </Link>
          <Link href="/legal/privacy" className="transition-colors hover:text-foreground">
            Privacy
          </Link>
          <Link href="/settings" className="transition-colors hover:text-foreground">
            Settings
          </Link>
        </nav>
      </div>
    </footer>
  );
}
