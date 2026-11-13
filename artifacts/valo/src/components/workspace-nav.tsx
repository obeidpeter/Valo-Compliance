import { Link, useLocation } from 'wouter';
import { cn } from '@/lib/utils';

const TABS = [
  { href: '/workspace', label: 'Overview', exact: true },
  { href: '/workspace/ai', label: 'Draft assistant' },
  { href: '/workspace/assessments', label: 'Assessments' },
  { href: '/workspace/tasks', label: 'Tasks' },
  { href: '/workspace/reminders', label: 'Reminders' },
  { href: '/workspace/profile', label: 'Profile' },
];

export function WorkspaceNav() {
  const [loc] = useLocation();
  return (
    <nav aria-label="Workspace" className="-mx-5 mb-8 overflow-x-auto border-b border-border px-5 lg:mx-0 lg:px-0">
      <ul className="flex min-w-max gap-1">
        {TABS.map((t) => {
          const active = t.exact ? loc === t.href || loc.startsWith('/workspace/documents') : loc.startsWith(t.href);
          return (
            <li key={t.href}>
              <Link
                href={t.href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'relative block px-3 py-3 text-sm transition-colors focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring',
                  active ? 'font-medium text-foreground after:absolute after:inset-x-3 after:-bottom-px after:h-0.5 after:rounded-full after:bg-primary' : 'text-muted-foreground hover:text-foreground',
                )}
                data-testid={'link-ws-' + t.label.toLowerCase().replace(/ /g, '-')}
              >
                {t.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
